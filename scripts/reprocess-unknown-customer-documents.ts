#!/usr/bin/env ts-node
/**
 * 利用者不明(customerName='不明顧客')の書類を再処理し、結果を件数だけで測る(PIIなし)。
 *
 * 背景: ADR-0031。ページ向き補正の入った新しい版で再処理して、利用者不明・書類種別「未判定」が
 * 解消する書類がどれだけあるかを、書類名・利用者名・ID・本文を出さずに測る。GitHub Actionsのログは
 * 公開されるため、出力は件数のみ。
 *
 * 対象: status=processed・人の確認なし(verified!==true)・利用者不明・処理日時 >= --since(JST 0時)。
 * 人が確認済みの書類は触らない(確認の結果が再処理で消える可能性があるため)。
 *
 * 動作: 再処理の前に各書類の書類種別を控え、statusをpendingへ戻し(pageResultsのキャッシュもクリア。
 * 分割子は親のキャッシュを引き継ぐため、残すとOCR自体がスキップされる)、完了まで待って(読み取りのみ)、
 * 前後の遷移を件数で出す。待機ループには副作用を置かない。
 *
 * バックアップは保存しない: 書類の全フィールドをartifactに残すと、公開リポジトリでは第三者が取得
 * しうるため。再処理で書き換わるのはOCR由来のフィールドで、同じ操作で再生成できる。確認済みの
 * 書類は対象外なので、人の作業は失われない。
 *
 * 使用方法(GitHub Actions: Run Operations Script):
 *   reprocess-unknown-customer-documents --since 2026-11-01                     (dry-run: 対象件数のみ)
 *   reprocess-unknown-customer-documents --since 2026-11-01 --limit 5 --execute  (カナリア)
 *   reprocess-unknown-customer-documents --since 2026-11-01 --all --execute      (全件)
 */

import { execFileSync } from 'node:child_process';
import * as admin from 'firebase-admin';
import { isCustomerUnknown, parseSinceArg } from './lib/undeterminedSummary';
import { bucketDocumentType, bucketStatus } from './lib/unknownCustomerDiagnosis';
import {
  selectReprocessTargets,
  summarizeTransitions,
  type AfterState,
  type BeforeState,
  type TargetCandidate,
} from './lib/reprocessUnknownCustomer';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const since = getArg('--since');
const sinceMs = parseSinceArg(since);
if (!since || sinceMs === null) {
  console.error('--since YYYY-MM-DD(JSTの実在する日付)を指定してください');
  process.exit(1);
}
const sinceStartMs: number = sinceMs;
const execute = process.argv.includes('--execute');
const all = process.argv.includes('--all');
const limitArg = getArg('--limit');
const limit = limitArg === undefined ? undefined : Number(limitArg);
if (limitArg !== undefined && !(Number.isInteger(limit) && (limit as number) > 0)) {
  console.error('--limit は1以上の整数を指定してください');
  process.exit(1);
}
if (execute && !all && limit === undefined) {
  console.error('--execute には --limit N(カナリア)または --all(全件)の指定が必要です');
  process.exit(1);
}
if (all && limit !== undefined) {
  console.error('--all と --limit は同時に指定できません');
  process.exit(1);
}
const waitMinutes = Number(getArg('--wait-minutes') ?? '40');
if (!Number.isFinite(waitMinutes) || waitMinutes <= 0 || waitMinutes > 120) {
  console.error('--wait-minutes は1〜120の数値を指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const STORED_UNKNOWN_CUSTOMER = '不明顧客';
const FIELDS = ['status', 'processedAt', 'verified', 'customerName', 'documentType'] as const;
const READ_LIMIT = 20000;
const POLL_INTERVAL_MS = 30_000;

function toMs(v: unknown): number | null {
  const t = v as admin.firestore.Timestamp | undefined;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
}

/** 実機のprocessOCRがPaddleで動いていることを確認する(reset-document-to-pending.jsと同じ。Geminiへ倒れる事故の防止) */
function assertPaddleProvider(): void {
  let provider: string;
  try {
    provider = execFileSync(
      'gcloud',
      ['functions', 'describe', 'processOCR', '--gen2', '--region=asia-northeast1', `--project=${projectId}`, '--format=value(serviceConfig.environmentVariables.OCR_PROVIDER)'],
      { encoding: 'utf8' },
    ).trim();
  } catch (err) {
    console.error(`ERROR: processOCR FunctionsのOCR_PROVIDER確認に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (provider !== 'paddle') {
    console.error(`ERROR: OCR_PROVIDER="${provider || '(未設定)'}" です(明示的なpaddleが必要)。中断します。`);
    process.exit(1);
  }
  console.log('✓ OCR_PROVIDER確認OK(processOCR Functionsで明示的にpaddle)');
}

async function main(): Promise<void> {
  console.log(`対象: customerName='不明顧客'・processed・人の確認なし・処理日時(JST) >= ${since} 0時`);
  const snap = await db
    .collection('documents')
    .where('customerName', '==', STORED_UNKNOWN_CUSTOMER)
    .select(...FIELDS)
    .limit(READ_LIMIT)
    .get();
  if (snap.size >= READ_LIMIT) {
    console.error(`ERROR: 読み取り上限(${READ_LIMIT}件)に達しました。対象の取りこぼしを避けるため中断します`);
    process.exit(1);
  }

  const candidates: TargetCandidate[] = [];
  const typeById = new Map<string, BeforeState>();
  for (const d of snap.docs) {
    const data = d.data();
    candidates.push({
      id: d.id,
      status: bucketStatus(data.status),
      verified: data.verified === true,
      processedAtMs: toMs(data.processedAt),
      customerUnknown: isCustomerUnknown(data.customerName),
    });
    typeById.set(d.id, { docTypeBucket: bucketDocumentType(data.documentType) });
  }
  const ids = selectReprocessTargets(candidates, sinceStartMs, all ? undefined : limit);
  const allIds = selectReprocessTargets(candidates, sinceStartMs);
  console.log(`customerName='不明顧客'の書類(全期間): ${snap.size}件`);
  console.log(`再処理の対象(窓の内側・processed・確認なし・利用者不明): ${allIds.length}件`);
  console.log(`今回の実行対象: ${ids.length}件${all ? '(全件)' : limit !== undefined ? `(--limit ${limit})` : ''}`);
  const before = new Map<string, BeforeState>();
  for (const id of ids) before.set(id, typeById.get(id) as BeforeState);
  const beforeTypes: Record<string, number> = {};
  for (const b of before.values()) beforeTypes[b.docTypeBucket] = (beforeTypes[b.docTypeBucket] ?? 0) + 1;
  console.log(`  書類種別(再処理前): ${Object.entries(beforeTypes).map(([k, v]) => `${k}=${v}`).join(', ') || '(なし)'}`);

  if (!execute) {
    console.log('\nDRY RUN: 書込みは実行しません。--execute と --limit N または --all で実行してください。');
    return;
  }
  if (ids.length === 0) {
    console.log('対象が0件のため何もしません');
    return;
  }
  assertPaddleProvider();

  // 1) pendingへ戻す(pageResultsのキャッシュもクリア)
  let reset = 0;
  for (const id of ids) {
    const ref = db.doc(`documents/${id}`);
    const detailRef = db.doc(`documents/${id}/detail/main`);
    const [docSnap, detailSnap] = await Promise.all([ref.get(), detailRef.get()]);
    const data = docSnap.data();
    // 取得後に状態が変わった書類(確認済みになった等)は触らない
    if (!data || data.status !== 'processed' || data.verified === true) continue;
    const hasDetail = detailSnap.exists && detailSnap.data()?.pageResults !== undefined;
    const hasLegacy = data.pageResults !== undefined;
    const batch = db.batch();
    batch.update(ref, {
      status: 'pending',
      retryCount: 0,
      lastErrorMessage: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      pass2Promotion: admin.firestore.FieldValue.delete(),
      errorRescueCount: admin.firestore.FieldValue.delete(),
      lastRescuedAt: admin.firestore.FieldValue.delete(),
      retryAfter: admin.firestore.FieldValue.delete(),
      ...(hasLegacy ? { pageResults: admin.firestore.FieldValue.delete() } : {}),
    });
    if (hasDetail) batch.update(detailRef, { pageResults: admin.firestore.FieldValue.delete() });
    await batch.commit();
    reset += 1;
  }
  console.log(`✓ pendingへ戻した: ${reset}件(取得後に状態が変わり対象外にした: ${ids.length - reset}件)`);
  if (reset === 0) return;

  // 2) 完了を待つ(読み取りのみ。副作用なし)
  const refs = ids.map((id) => db.doc(`documents/${id}`));
  const deadline = Date.now() + waitMinutes * 60_000;
  let lastUnfinished = -1;
  for (;;) {
    const snaps = await db.getAll(...refs, { fieldMask: ['status'] });
    const unfinished = snaps.filter((s) => {
      const st = s.exists ? bucketStatus(s.data()?.status) : 'missing';
      return st === 'pending' || st === 'processing';
    }).length;
    if (unfinished !== lastUnfinished) console.log(`待機: 未完了 ${unfinished}件`);
    lastUnfinished = unfinished;
    if (unfinished === 0 || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // 3) 前後を比べる
  const finalSnaps = await db.getAll(...refs, { fieldMask: ['status', 'customerName', 'documentType'] });
  const after = new Map<string, AfterState>();
  finalSnaps.forEach((s, i) => {
    if (!s.exists) return;
    const data = s.data() ?? {};
    after.set(ids[i], {
      status: bucketStatus(data.status),
      customerUnknown: isCustomerUnknown(data.customerName),
      docTypeBucket: bucketDocumentType(data.documentType),
    });
  });
  const s = summarizeTransitions(before, after);
  console.log('');
  console.log(`結果(再処理した ${s.total}件)`);
  console.log(`  改善(利用者または書類種別が解消): ${s.improved}件`);
  console.log(`    うち利用者が不明でなくなった: ${s.customerResolved}件`);
  console.log(`    うち書類種別が「未判定」でなくなった: ${s.docTypeResolved}件`);
  console.log(`  変化なし: ${s.unchanged}件`);
  console.log(`  悪化(判定済みだった書類種別が未判定に): ${s.worsened}件`);
  console.log(`  エラー: ${s.error}件 / 未完了: ${s.notFinished}件 / 見つからない: ${s.missing}件`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
