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
  exitCodeFor,
  fitsInWaitWindow,
  isReprocessEligible,
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

/** 読み取りだけの処理を、一時的なエラーに備えて数回やり直す(副作用がないため安全) */
async function withReadRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
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
  if (!fitsInWaitWindow(ids.length, waitMinutes)) {
    console.error(
      `ERROR: 対象${ids.length}件は、待機${waitMinutes}分(処理能力は1分5件)で終わる見込みを超えます。書き込みの前に中断します。--limit で分けるか、--wait-minutes を増やしてください。`,
    );
    process.exit(1);
  }
  console.log(`注意: 再処理した書類は、新しく届く書類より先に処理されます(新規の処理が約${Math.ceil(ids.length / 5)}分遅れる見込み)`);
  assertPaddleProvider();

  // 1) pendingへ戻す(pageResultsのキャッシュもクリア)。適格性の再確認と書き込みを、書類ごとの
  //    トランザクションで原子的に行う(取得後に人が確認済みにした書類を再処理しないため)。
  //    再処理した書類のIDだけを控え、待機と集計はそのIDに限る(スキップした書類を混ぜない)。
  const resetIds: string[] = [];
  const failureCodes: Record<string, number> = {};
  let failedResets = 0;
  for (const id of ids) {
    const ref = db.doc(`documents/${id}`);
    const detailRef = db.doc(`documents/${id}/detail/main`);
    let done = false;
    try {
      done = await db.runTransaction(async (tx) => {
      const [docSnap, detailSnap] = await Promise.all([tx.get(ref), tx.get(detailRef)]);
      const data = docSnap.data();
      if (
        !data ||
        !isReprocessEligible({ status: bucketStatus(data.status), verified: data.verified === true, customerUnknown: isCustomerUnknown(data.customerName) })
      ) {
        return false;
      }
      const hasDetail = detailSnap.exists && detailSnap.data()?.pageResults !== undefined;
      const hasLegacy = data.pageResults !== undefined;
      tx.update(ref, {
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
      if (hasDetail) tx.update(detailRef, { pageResults: admin.firestore.FieldValue.delete() });
      return true;
      });
    } catch (err) {
      // 1件の失敗で全体を止めない(すでにpendingへ戻した書類を、集計されないまま残さないため)。
      // 出力はエラーコードの件数のみ(エラーメッセージには書類のパスが含まれうる)。
      failedResets += 1;
      const code = String((err as { code?: unknown }).code ?? 'unknown').slice(0, 40);
      failureCodes[code] = (failureCodes[code] ?? 0) + 1;
    }
    if (done) resetIds.push(id);
  }
  const skipped = ids.length - resetIds.length - failedResets;
  console.log(`✓ pendingへ戻した: ${resetIds.length}件(取得後に状態が変わり対象外にした: ${skipped}件 / リセットに失敗: ${failedResets}件)`);
  if (failedResets > 0) {
    console.log(`  失敗のエラーコード: ${Object.entries(failureCodes).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  if (resetIds.length === 0) {
    process.exitCode = failedResets > 0 ? 1 : 0;
    return;
  }

  // 2) 完了を待つ(読み取りのみ。副作用なし)
  const refs = resetIds.map((id) => db.doc(`documents/${id}`));
  const deadline = Date.now() + waitMinutes * 60_000;
  let lastUnfinished = -1;
  let timedOut = false;
  for (;;) {
    const snaps = await withReadRetry(() => db.getAll(...refs, { fieldMask: ['status'] }));
    const unfinished = snaps.filter((s) => {
      const st = s.exists ? bucketStatus(s.data()?.status) : 'missing';
      return st === 'pending' || st === 'processing';
    }).length;
    if (unfinished !== lastUnfinished) console.log(`待機: 未完了 ${unfinished}件`);
    lastUnfinished = unfinished;
    if (unfinished === 0) break;
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (timedOut) {
    console.log(`WARN: 待機が上限(${waitMinutes}分)に達しました。未完了の書類は、processOCR側で処理が続きます(下の集計には、完了した分だけが入ります)`);
  }

  // 3) 前後を比べる
  const finalSnaps = await withReadRetry(() => db.getAll(...refs, { fieldMask: ['status', 'customerName', 'documentType'] }));
  const after = new Map<string, AfterState>();
  finalSnaps.forEach((s, i) => {
    if (!s.exists) return;
    const data = s.data() ?? {};
    after.set(resetIds[i], {
      status: bucketStatus(data.status),
      customerUnknown: isCustomerUnknown(data.customerName),
      docTypeBucket: bucketDocumentType(data.documentType),
    });
  });
  const resetBefore = new Map<string, BeforeState>();
  for (const id of resetIds) resetBefore.set(id, before.get(id) as BeforeState);
  const s = summarizeTransitions(resetBefore, after);
  console.log('');
  console.log(`結果(再処理した ${s.total}件)`);
  console.log(`  改善(利用者または書類種別が解消): ${s.improved}件`);
  console.log(`    うち利用者が不明でなくなった: ${s.customerResolved}件`);
  console.log(`    うち書類種別が「未判定」でなくなった: ${s.docTypeResolved}件`);
  console.log(`  変化なし: ${s.unchanged}件`);
  console.log(`  悪化(判定済みだった書類種別が未判定に): ${s.worsened}件`);
  console.log(`  エラー: ${s.error}件 / 未完了: ${s.notFinished}件 / 見つからない: ${s.missing}件`);
  const code = exitCodeFor(s, failedResets);
  if (code !== 0) console.log(`終了コード ${code}(2=未完了あり、1=リセット失敗・エラー・見つからない書類あり)`);
  process.exitCode = code;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error('ERROR:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
