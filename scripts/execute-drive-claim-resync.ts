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
  type DivergenceResyncManifest,
} from './lib/divergenceResolutionPlan';
import { executeDivergenceResync } from './lib/executeDivergenceResync';
import { readDriveApiVersionSnapshot, verifyDriveApiVersionMatch } from './lib/driveApiVersionGate';

/**
 * manifestを一時ファイルへ書いてからrenameする(codex review 2巡目Medium指摘対応)。
 * `fs.writeFileSync`直接上書きは書込み途中でプロセスがkillされると、既存の(直前まで
 * 正しかった)rollback材料ごと破損・消失しうる。同一ファイルシステム内のrenameは
 * atomicなため、書込み完了前にkillされても元のmanifestファイルは無傷のまま残る。
 */
function writeManifestAtomic(outFile: string, manifest: DivergenceResyncManifest): void {
  const tmpFile = `${outFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmpFile, outFile);
}

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

// === approval JSON形状の厳格バリデーション(codex review Medium指摘対応) ===
// GHA経由の実行はrun-ops-script.yml内のjqバリデーションを通るが、ローカルCLI直接実行は
// この型キャストのみでは何も拒否しない。未知のmode文字列を許すとexecuteDivergenceResync側の
// 実行部が`else`(restore-expected)へfall-throughしうる設計だったため、ここでも独立に
// 拒否する(多層防御。executeDivergenceResync.ts自体も未知mode拒否ガードを持つ)。
const KNOWN_APPROVAL_MODES = new Set(['restore-expected', 'release-claim', 'finalize-resolved']);
function validateApproval(value: unknown): asserts value is DivergenceApproval {
  if (typeof value !== 'object' || value === null) {
    throw new Error('approval JSONはオブジェクトである必要があります');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.planId !== 'string' || v.planId.length === 0) {
    throw new Error('approval.planIdは非空文字列である必要があります');
  }
  if (typeof v.approvedOperations !== 'object' || v.approvedOperations === null || Array.isArray(v.approvedOperations)) {
    throw new Error('approval.approvedOperationsはオブジェクトである必要があります');
  }
  for (const [opId, entry] of Object.entries(v.approvedOperations as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`approval.approvedOperations["${opId}"]はオブジェクトである必要があります`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.mode !== 'string' || !KNOWN_APPROVAL_MODES.has(e.mode)) {
      throw new Error(
        `approval.approvedOperations["${opId}"].modeが不正です(値: ${JSON.stringify(e.mode)}、許容値: ${[...KNOWN_APPROVAL_MODES].join('/')})`
      );
    }
    if (
      e.acknowledgedStrandedFiles !== undefined &&
      (typeof e.acknowledgedStrandedFiles !== 'number' ||
        !Number.isInteger(e.acknowledgedStrandedFiles) ||
        e.acknowledgedStrandedFiles < 0)
    ) {
      throw new Error(`approval.approvedOperations["${opId}"].acknowledgedStrandedFilesは0以上の整数である必要があります`);
    }
  }
}
try {
  validateApproval(approval);
} catch (err) {
  console.error(`FATAL: approval JSONの検証に失敗しました: ${(err as Error).message}`);
  process.exit(2);
}

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
  const { retryDriveExportCore, DriveExportNotRetryableError } = await import(
    '../functions/src/drive/retryDriveExport'
  );

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
    {
      execute,
      actor,
      log: (m) => console.log(m),
      // pr-review-toolkit:code-reviewer Important指摘対応: ループの途中でプロセスが
      // クラッシュ/killされた場合でも、それまでに成功したDrive移動をrollback可能な状態に
      // する(execute-drive-folder-merge.tsと同じ理由)。
      onProgress: (m) => writeManifestAtomic(manifestOutFile, m),
    }
  );

  for (const o of outcomes) {
    console.log(
      `${o.operationId}: status=${o.status} mode=${o.mode ?? '-'}${o.reasons.length ? ` reasons=${o.reasons.join(',')}` : ''}${o.errorMessage ? ` error="${o.errorMessage}"` : ''}`
    );
  }

  writeManifestAtomic(manifestOutFile, manifest);
  console.log(`manifest出力: ${manifestOutFile}(${manifest.entries.length}件)`);

  if (execute && requeue) {
    console.log('--- --requeue: executed操作の影響書類を即時再試行(ErrorsPageのリトライボタンと同一ロジック) ---');
    let requeuedSuccess = 0;
    let requeuedStillError = 0;
    let requeueSkipped = 0;
    let requeueUnexpectedError = 0;
    let requeueAttempted = 0;
    // codex review 2巡目Low指摘対応: manifestは--requeue実行「前」に確定していたため、
    // 型に存在する`requeuedDocIds`が常に空のままだった。operationごとに実際に成功
    // requeueできたdocIdを記録し、requeue完了後にmanifestを再書込みする。
    const executedOutcomes = outcomes.filter((o) => o.status === 'executed');
    for (const o of executedOutcomes) {
      const entry = manifest.entries.find((e) => e.operationId === o.operationId);
      for (const docId of o.affectedDocIds) {
        requeueAttempted++;
        try {
          const result = await retryDriveExportCore(db, docId, {});
          if (result.success) {
            requeuedSuccess++;
            entry?.requeuedDocIds.push(docId);
          } else {
            requeuedStillError++;
            console.warn(`requeue後も再度error(次回スイープで自然にリトライされます): ${docId} error="${result.error}"`);
          }
        } catch (err) {
          // silent-failure-hunterレビュー指摘対応: DriveExportNotRetryableError(対象外、
          // 想定内)と、それ以外の予期しない例外(Firestoreトランザクション失敗・権限エラー等)
          // を区別する。従来は全て「requeue対象外(既にリトライ可能な状態でない)」という
          // 特定の(誤りうる)診断で一律ログしており、実際は無関係な障害が「対象外」として
          // 誤診断され、かつexit codeにも一切反映されずrunがgreenで終わっていた。
          if (err instanceof DriveExportNotRetryableError) {
            requeueSkipped++;
            console.warn(`requeue対象外(既にリトライ可能な状態でない): ${docId}`);
          } else {
            requeueUnexpectedError++;
            console.error(`requeue中に予期しないエラー: ${docId}`, err);
          }
        }
      }
    }
    writeManifestAtomic(manifestOutFile, manifest);
    console.log(
      `requeue完了: 対象${requeueAttempted}件中 成功${requeuedSuccess}件・再度error${requeuedStillError}件・対象外${requeueSkipped}件・予期しないエラー${requeueUnexpectedError}件`
    );
    if (requeueUnexpectedError > 0) {
      process.exitCode = 1;
    }
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

  // pr-review-toolkit:code-reviewer Important指摘対応: --execute時にblocked/claim-drift/
  // drive-drift/errorが1件でもあればexit 1にする。従来はsummary.error>0のみを見ており、
  // 承認済みoperationが軒並みblocked/driftで一切実行されなくてもrunがexit 0(green)で
  // 終わり、ログを読まない限り気付けなかった(execute-drive-folder-merge.tsの既存慣習と揃える)。
  // dry-run時はblocked/drift自体が承認前の診断結果として想定通りのため対象外。
  if (execute) {
    const failedCount = summary.blocked + summary.claimDrift + summary.driveDrift + summary.error;
    if (failedCount > 0) {
      console.error(
        `${failedCount}件のoperationが未実行のまま終了しました(blocked=${summary.blocked} claim-drift=${summary.claimDrift} drive-drift=${summary.driveDrift} error=${summary.error})。classify-drive-claim-divergence.tsを再実行し、最新のplanRunIdで再承認してください。`
      );
      process.exitCode = 1;
    }
  } else if (summary.error > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('execute-drive-claim-resync が失敗しました:', err);
  process.exit(1);
});
