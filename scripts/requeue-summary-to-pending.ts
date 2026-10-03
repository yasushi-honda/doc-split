#!/usr/bin/env ts-node
/**
 * Sarashina要約canaryの再投入: 指定文書の要約だけを`summaryState: pending`へ戻す
 * (通常経路のGemini停止計画 PR-D)。
 *
 * `reset-document-to-pending.js`(OCRごとやり直す)と違い、OCR結果・確定項目・既存の要約本文は
 * 更新しない。Sarashinaが成功した時だけ要約が上書きされ、失敗時は元の要約が残る。
 *
 * 使用方法(FIREBASE_PROJECT_IDは必須、doc-split-dev / docsplit-kanameoneのみ):
 *   --requeue-ids id1,id2,...,id10   対象文書(1〜10件)
 *   --execute                        実書込み(省略時はdry-run)
 *
 * 安全策(いずれか1件でも満たさなければ1件も書き込まず終了):
 *   - デプロイ済みgenerateSummaryBatchのSUMMARY_PROVIDERが'sarashina'(gcloudで実機確認)
 *   - settings/features.sarashinaSummaryが明示true、かつ全IDがallowlist内(未設定=全許可)
 *   - 全文書がstatus=processedで、要約が処理中(summaryState=processing)ではない
 * 取得するのはstatus/summary*の状態フィールドのみ(fieldMask)。要約本文・OCR本文は読まない。
 * 再投入前の状態はログに出す(PIIなし)。
 *
 * 限界: OCR本文の長さは確認しない(実PIIの本文を読まない設計)。OCRが`MIN_OCR_LENGTH_FOR_SUMMARY`
 * 未満の文書を再投入しても、`generateSummaryBatch`が再度`skipped`へ倒す(Sarashinaは呼ばれない)。
 * 結果は`check-sarashina-summary-canary --canary-ids`で`skipped`として数えられる。
 */
import { execFileSync } from 'child_process';
import * as admin from 'firebase-admin';
import {
  buildRequeuePlan,
  buildStateBackup,
  evaluateRequeueEligibility,
  evaluateRequeueGate,
  formatStateBackupLine,
  isSameStateSnapshot,
  parseRequeueDocIds,
  resolveAllowlist,
} from './lib/summaryRequeue';

const ALLOWED_PROJECT_IDS = ['doc-split-dev', 'docsplit-kanameone'];
const STATE_FIELDS = [
  'status',
  'summaryState',
  'summaryAttemptCount',
  'summaryProvider',
  'summaryError',
  'summaryErrorKind',
  'summaryRunId',
];

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
if (!ALLOWED_PROJECT_IDS.includes(PROJECT_ID)) {
  console.error(`❌ FIREBASE_PROJECT_ID は ${ALLOWED_PROJECT_IDS.join('/')} のいずれかを指定してください (指定: ${PROJECT_ID})`);
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const execute = process.argv.includes('--execute');

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

function readDeployedSummaryProvider(): string | undefined {
  const out = execFileSync(
    'gcloud',
    [
      'functions',
      'describe',
      'generateSummaryBatch',
      '--gen2',
      '--region=asia-northeast1',
      `--project=${PROJECT_ID}`,
      '--format=value(serviceConfig.environmentVariables.SUMMARY_PROVIDER)',
    ],
    { encoding: 'utf8' }
  ).trim();
  return out === '' ? undefined : out;
}

async function readGate(): Promise<{ flag: unknown; allowlist: string[] | null }> {
  const snap = await db.doc('settings/features').get();
  const data = snap.data();
  return { flag: data?.sarashinaSummary, allowlist: resolveAllowlist(data) };
}

async function main(): Promise<void> {
  const ids = parseRequeueDocIds(getArg('--requeue-ids'));
  console.log(`=== Sarashina要約 再投入 (project=${PROJECT_ID}, ${execute ? 'EXECUTE' : 'dry-run'}, ${ids.length}件) ===`);

  const gate = evaluateRequeueGate({ l1Provider: readDeployedSummaryProvider(), ...(await readGate()) }, ids);
  if (!gate.ok) {
    console.error(`❌ 再投入の前提が揃っていません: ${gate.reason}`);
    process.exit(1);
  }
  console.log('✓ L1(SUMMARY_PROVIDER=sarashina) / L2(フラグtrue・allowlist内) を確認');
  console.log('⚠ OCR本文の長さは確認しません。短文(100字未満)の文書は再投入後もskippedになります。');

  const refs = ids.map((id) => db.doc(`documents/${id}`));
  const snaps = await db.getAll(...refs, { fieldMask: STATE_FIELDS });
  const problems: string[] = [];
  const backups = snaps.map((snap, i) => {
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
    const verdict = evaluateRequeueEligibility(data);
    if (!verdict.eligible) {
      problems.push(`${ids[i]}: ${verdict.reason}`);
    }
    const from = verdict.eligible ? (verdict.fromState ?? '(未設定)') : `対象外(${verdict.reason})`;
    console.log(`  ${ids[i]}  summaryState: ${from} → pending`);
    return buildStateBackup(ids[i], data ?? {});
  });
  if (problems.length > 0) {
    console.error(`❌ 対象外の文書があるため1件も書き込みません: ${problems.join(' / ')}`);
    process.exit(1);
  }

  // Actionsのログは波括弧をマスキングするためJSONにしない(値はURIエンコード、未設定は空値)
  console.log('--- 再投入前の状態(ロールバック用、PIIなし) ---');
  for (const b of backups) console.log(formatStateBackupLine(b));

  if (!execute) {
    console.log('dry-runのため書き込みません。--execute で実行します。');
    return;
  }

  const plan = buildRequeuePlan();
  const update: admin.firestore.UpdateData<admin.firestore.DocumentData> = { ...plan.set };
  for (const f of plan.serverTimestamps) update[f] = admin.firestore.FieldValue.serverTimestamp();
  for (const f of plan.deleteFields) update[f] = admin.firestore.FieldValue.delete();

  // 全件を1トランザクションで再判定してから書く(全か無か)。dry-run後に要約がclaimされた文書が
  // あれば、1件も書かずに終了する。
  const outcome = await db.runTransaction(async (tx) => {
    const fresh = await tx.getAll(...refs, { fieldMask: STATE_FIELDS });
    const blocked: string[] = [];
    fresh.forEach((snap, i) => {
      const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
      const verdict = evaluateRequeueEligibility(data);
      if (!verdict.eligible) {
        blocked.push(`${ids[i]}: ${verdict.reason}`);
      } else if (!isSameStateSnapshot(backups[i], buildStateBackup(ids[i], data ?? {}))) {
        // プレビュー後に状態が動いた(手動再生成など)。記録した巻き戻し状態と実際の上書き対象がずれる
        blocked.push(`${ids[i]}: state-changed-since-preview`);
      }
    });
    if (blocked.length > 0) return { written: 0, blocked };
    for (const ref of refs) tx.update(ref, update);
    return { written: refs.length, blocked };
  });
  if (outcome.blocked.length > 0) {
    console.error(`❌ 書込み直前の再判定で対象外/状態変化があったため1件も書き込みません(dry-runからやり直してください): ${outcome.blocked.join(' / ')}`);
    process.exit(1);
  }
  console.log(`完了: ${outcome.written}/${refs.length}件を pending へ再投入しました`);
}

main().catch((err) => {
  console.error('❌ 失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
