#!/usr/bin/env ts-node
/**
 * Sarashina要約canaryの再投入: 指定文書の要約だけを`summaryState: pending`へ戻す
 * (通常経路のGemini停止計画 PR-D)。
 *
 * `reset-document-to-pending.js`(OCRごとやり直す)と違い、OCR結果・確定項目・既存の要約本文は
 * 更新しない。Sarashinaが成功した時だけ要約が上書きされ、失敗時は元の要約が残る。
 *
 * 使用方法(FIREBASE_PROJECT_IDは必須、doc-split-dev / docsplit-kanameoneのみ):
 *   --requeue-ids id1,id2,...,id10   対象文書(1〜10件、先頭は英数字)
 *   --execute                        実書込み(省略時はdry-run)
 *
 * 運用手順(順序を守る):
 *   1. set-sarashina-summary-allowlist --set で対象IDに絞る(先)
 *   2. set-feature-flag --flag sarashinaSummary --value true (後)
 *   3. 本スクリプトをdry-run → 内容確認 → --execute
 *   allowlistが未設定(=全文書対象)のまま再投入すると、再投入していない既存のpending文書もバッチが
 *   処理してしまうため、本スクリプトは未設定を拒否する。
 *
 * 安全策(いずれか1件でも満たさなければ1件も書き込まず終了):
 *   - デプロイ済みgenerateSummaryBatchのSUMMARY_PROVIDERが'sarashina'(gcloudで実機確認)
 *   - settings/features.sarashinaSummaryが明示true、かつallowlistが設定済みで全IDを含む
 *     (書込みトランザクション内でも再確認する。L1のgcloud値は再確認しない)
 *   - 全文書がstatus=processedで、要約が処理中(summaryState=processing)ではない
 *   - 書込みは全件1トランザクション。プレビュー時から状態が動いていれば1件も書かない
 * 取得するのはstatus/summary*の状態フィールドのみ(fieldMask)。要約本文・OCR本文は読まない。
 * 再投入前の状態はログに出す(PIIなし、key=value1行)。
 *
 * 限界:
 *   - OCR本文の長さは確認しない(実PIIの本文を読まない設計)。OCRが`MIN_OCR_LENGTH_FOR_SUMMARY`
 *     未満の文書を再投入しても、`generateSummaryBatch`が再度`skipped`へ倒す(Sarashinaは呼ばれない)。
 *     結果は`check-sarashina-summary-canary --canary-ids`で`skipped`として数えられる。
 *   - 不可逆: Sarashinaが成功すると、旧要約本文は上書きされて戻せない。ログの状態記録は
 *     summaryState等の状態だけで、要約本文は含まない。復旧手段はFirestoreネイティブバックアップ
 *     (日次)のみ。--execute の前にバックアップの存在を確認すること。
 */
import { execFileSync } from 'child_process';
import * as admin from 'firebase-admin';
import {
  buildRequeuePlan,
  buildRequeueUpdate,
  buildStateBackup,
  evaluateRequeueEligibility,
  evaluateRequeueGate,
  formatStateBackupLine,
  parseRequeueDocIds,
  planRequeueWrite,
  resolveAllowlist,
} from './lib/summaryRequeue';

const ALLOWED_PROJECT_IDS = ['doc-split-dev', 'docsplit-kanameone'];
const GCLOUD_TIMEOUT_MS = 60_000;
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
const settingsRef = db.doc('settings/features');

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
    { encoding: 'utf8', timeout: GCLOUD_TIMEOUT_MS }
  ).trim();
  return out === '' ? undefined : out;
}

function gateInput(l1Provider: string | undefined, settings: Record<string, unknown> | undefined) {
  return { l1Provider, flag: settings?.sarashinaSummary, allowlist: resolveAllowlist(settings) };
}

async function main(): Promise<void> {
  const ids = parseRequeueDocIds(getArg('--requeue-ids'));
  console.log(`=== Sarashina要約 再投入 (project=${PROJECT_ID}, ${execute ? 'EXECUTE' : 'dry-run'}, ${ids.length}件) ===`);

  const l1Provider = readDeployedSummaryProvider();
  const gate = evaluateRequeueGate(gateInput(l1Provider, (await settingsRef.get()).data()), ids);
  if (!gate.ok) {
    console.error(`❌ 再投入の前提が揃っていません: ${gate.reason}`);
    process.exit(1);
  }
  console.log('✓ L1(SUMMARY_PROVIDER=sarashina) / L2(フラグtrue・allowlist設定済みで全IDを含む) を確認');
  console.log('⚠ OCR本文の長さは確認しません。短文(100字未満)の文書は再投入後もskippedになります。');
  console.log('⚠ Sarashinaが成功すると旧要約本文は上書きされ戻せません(復旧は日次バックアップのみ)。');

  const refs = ids.map((id) => db.doc(`documents/${id}`));
  const snaps = await db.getAll(...refs, { fieldMask: STATE_FIELDS });
  const datas = snaps.map((snap) => (snap.exists ? (snap.data() as Record<string, unknown>) : undefined));
  datas.forEach((data, i) => {
    const verdict = evaluateRequeueEligibility(data);
    const from = verdict.eligible ? (verdict.fromState ?? '(未設定)') : `対象外(${verdict.reason})`;
    console.log(`  ${ids[i]}  summaryState: ${from} → pending`);
  });
  const preview = planRequeueWrite(ids, datas);
  if (preview.blocked.length > 0) {
    console.error(`❌ 対象外の文書があるため1件も書き込みません: ${preview.blocked.join(' / ')}`);
    process.exit(1);
  }

  // Actionsのログは波括弧をマスキングするためJSONにしない(値はURIエンコード、未設定は空値)
  const backups = ids.map((id, i) => buildStateBackup(id, datas[i] ?? {}));
  console.log('--- 再投入前の状態(ロールバック用、PIIなし) ---');
  for (const b of backups) console.log(formatStateBackupLine(b));

  if (!execute) {
    console.log('dry-runのため書き込みません。--execute で実行します。');
    return;
  }

  const update = buildRequeueUpdate(buildRequeuePlan(), {
    serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
    deleteField: admin.firestore.FieldValue.delete(),
  }) as admin.firestore.UpdateData<admin.firestore.DocumentData>;

  // 全件を1トランザクションで再判定してから書く(全か無か)。トランザクション内で、L2(フラグ・allowlist)の
  // 再確認、文書の適格性、プレビュー時からの状態一致を確認する。1つでも外れれば1件も書かない。
  const outcome = await db.runTransaction(async (tx) => {
    const settings = (await tx.get(settingsRef)).data();
    const txGate = evaluateRequeueGate(gateInput(l1Provider, settings), ids);
    if (!txGate.ok) return { written: 0, blocked: [`gate: ${txGate.reason}`] };

    const fresh = await tx.getAll(...refs, { fieldMask: STATE_FIELDS });
    const freshDatas = fresh.map((snap) => (snap.exists ? (snap.data() as Record<string, unknown>) : undefined));
    const { blocked } = planRequeueWrite(ids, freshDatas, backups);
    if (blocked.length > 0) return { written: 0, blocked };

    for (const ref of refs) tx.update(ref, update);
    return { written: refs.length, blocked };
  });
  if (outcome.blocked.length > 0) {
    console.error(`❌ 書込み直前の再判定で対象外/状態変化/ゲート不一致があったため1件も書き込みません(dry-runからやり直してください): ${outcome.blocked.join(' / ')}`);
    process.exit(1);
  }
  console.log(`完了: ${outcome.written}/${refs.length}件を pending へ再投入しました`);
}

main().catch((err) => {
  console.error('❌ 失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
