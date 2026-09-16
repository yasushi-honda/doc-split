#!/usr/bin/env ts-node
/**
 * Issue #871 恒久対応: 承認付き再同期の実行(write)
 *
 * `classify-drive-claim-divergence.ts`が出力したPlanと、operationごとに承認された
 * resolutionMode(`DivergenceApproval.approvedOperations`)を読み、承認されたoperationのみ
 * 実行する。既定dry-run、`--execute`必須、`--dry-run`と`--execute`の同時指定はエラー。
 *
 * 書き込み順序はDrive先→Firestore後(`scripts/lib/executeDivergenceResync.ts`参照)。
 * fail-closedプリフライトと各種drift再確認(claim/Drive実体/claimグラフ)をexecute直前に
 * 再実行してから初めて書き込む。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/execute-drive-claim-resync.ts \
 *     --plan /tmp/divergence-plan.json --approval /tmp/divergence-approval.json
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/execute-drive-claim-resync.ts \
 *     --plan /tmp/divergence-plan.json --approval /tmp/divergence-approval.json --execute --requeue
 *
 * オプション:
 *   --plan <path>          classify-drive-claim-divergence.tsが出力したPlan(必須)
 *   --approval <path>      DivergenceApproval JSON(必須、{planId, approvedOperations: {opId: {mode, acknowledgedStrandedFiles?}}})
 *   --execute              実際に書き込む(省略時はdry-run)
 *   --manifest-out <path>  rollback manifestの出力先(既定: manifest-output.json)
 *   --requeue              executed操作の影響書類をexecuteDriveExport('error')で即時再試行する
 *
 * approval JSON例:
 *   {
 *     "planId": "<classifyのplanId>",
 *     "approvedOperations": {
 *       "op-0001": { "mode": "restore-expected" },
 *       "op-0002": { "mode": "release-claim", "acknowledgedStrandedFiles": 0 }
 *     }
 *   }
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as os from 'os';
import type { drive_v3 } from 'googleapis';
import {
  DIVERGENCE_PLAN_SCHEMA_VERSION,
  type DivergenceApproval,
  type DivergencePlan,
} from './lib/divergenceResolutionPlan';
import { executeDivergenceResync } from './lib/executeDivergenceResync';
import { readDriveApiVersionSnapshot, verifyDriveApiVersionMatch } from './lib/driveApiVersionGate';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

function getOpt(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const planFile = getOpt('--plan');
const approvalFile = getOpt('--approval');
const manifestOutFile = getOpt('--manifest-out') ?? 'manifest-output.json';
const execute = process.argv.includes('--execute');
const dryRunFlagSeen = process.argv.includes('--dry-run');
const requeue = process.argv.includes('--requeue');

if (dryRunFlagSeen && execute) {
  console.error('--dry-run と --execute は同時に指定できません');
  process.exit(1);
}
if (!planFile || !approvalFile) {
  console.error('--plan <plan.json> と --approval <approval.json> は必須です');
  process.exit(1);
}

const plan: DivergencePlan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const approval: DivergenceApproval = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));

// === schemaVersion gate ===
if (plan.schemaVersion !== DIVERGENCE_PLAN_SCHEMA_VERSION) {
  console.error(
    `FATAL: unsupported plan schemaVersion (got '${(plan as { schemaVersion?: string }).schemaVersion ?? '<missing>'}', expected '${DIVERGENCE_PLAN_SCHEMA_VERSION}'). classify-drive-claim-divergence.tsを再実行してください。`
  );
  process.exit(2);
}
// === Gate: planId 一致 ===
if (approval.planId !== plan.planId) {
  console.error(`FATAL: approval.planId (${approval.planId}) !== plan.planId (${plan.planId})`);
  process.exit(2);
}
// === Gate: projectId 一致 ===
if (plan.projectId !== projectId) {
  console.error(`FATAL: plan.projectId (${plan.projectId}) !== runtime FIREBASE_PROJECT_ID (${projectId})`);
  process.exit(2);
}
// === driveApiVersionGate ===
const runtimeDriveApiVersion = readDriveApiVersionSnapshot();
const driveApiVersionResult = verifyDriveApiVersionMatch(plan.driveApiVersion, runtimeDriveApiVersion);
if (!driveApiVersionResult.ok) {
  console.error(`FATAL: ${driveApiVersionResult.reason}`);
  process.exit(2);
}

admin.initializeApp({ projectId });

function resolveActor(): string {
  if (process.env.GITHUB_RUN_ID && process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY) {
    return `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  }
  return `local:${os.userInfo().username}@${os.hostname()}`;
}

async function main(): Promise<void> {
  const { getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { SUPPORTS_ALL_DRIVES, FOLDER_MIME_TYPE, escapeQueryValue } = await import(
    '../functions/src/drive/driveApiConstants'
  );
  const { resolveDivergentClaim, releaseDivergentClaim, buildFolderLockId } = await import(
    '../functions/src/drive/driveFolderClaim'
  );
  const { retryDriveExportCore } = await import('../functions/src/drive/retryDriveExport');

  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`承認operation数: ${Object.keys(approval.approvedOperations).length}件`);

  const drive: drive_v3.Drive = await getDriveClient();
  const db = admin.firestore();
  const actor = resolveActor();

  const { outcomes, manifest } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    { resolveDivergentClaim, releaseDivergentClaim, buildFolderLockId },
    plan,
    approval,
    { execute, actor, log: (m) => console.log(m) }
  );

  for (const o of outcomes) {
    console.log(
      `${o.operationId}: status=${o.status} mode=${o.mode ?? '-'}${o.reasons.length ? ` reasons=${o.reasons.join(',')}` : ''}${o.errorMessage ? ` error="${o.errorMessage}"` : ''}`
    );
  }

  fs.writeFileSync(manifestOutFile, JSON.stringify(manifest, null, 2));
  console.log(`manifest出力: ${manifestOutFile}(${manifest.entries.length}件)`);

  if (execute && requeue) {
    console.log('--- --requeue: executed操作の影響書類を即時再試行(ErrorsPageのリトライボタンと同一ロジック) ---');
    const executedDocIds = outcomes.filter((o) => o.status === 'executed').flatMap((o) => o.affectedDocIds);
    let requeuedSuccess = 0;
    let requeuedStillError = 0;
    let requeueSkipped = 0;
    for (const docId of executedDocIds) {
      try {
        const result = await retryDriveExportCore(db, docId, {});
        if (result.success) {
          requeuedSuccess++;
        } else {
          requeuedStillError++;
          console.warn(`requeue後も再度error(次回スイープで自然にリトライされます): ${docId} error="${result.error}"`);
        }
      } catch (err) {
        requeueSkipped++;
        console.warn(`requeue対象外(既にリトライ可能な状態でない): ${docId}`, err);
      }
    }
    console.log(
      `requeue完了: 対象${executedDocIds.length}件中 成功${requeuedSuccess}件・再度error${requeuedStillError}件・対象外${requeueSkipped}件`
    );
  }

  const summary = {
    executed: outcomes.filter((o) => o.status === 'executed').length,
    dryRun: outcomes.filter((o) => o.status === 'dry-run').length,
    blocked: outcomes.filter((o) => o.status === 'blocked').length,
    claimDrift: outcomes.filter((o) => o.status === 'claim-drift').length,
    driveDrift: outcomes.filter((o) => o.status === 'drive-drift').length,
    notApproved: outcomes.filter((o) => o.status === 'not-approved').length,
    error: outcomes.filter((o) => o.status === 'error').length,
  };
  console.log('---');
  console.log(
    `完了: executed=${summary.executed} dry-run=${summary.dryRun} blocked=${summary.blocked} claim-drift=${summary.claimDrift} drive-drift=${summary.driveDrift} not-approved=${summary.notApproved} error=${summary.error}`
  );

  if (summary.error > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('execute-drive-claim-resync が失敗しました:', err);
  process.exit(1);
});
