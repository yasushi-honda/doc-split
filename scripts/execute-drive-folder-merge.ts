#!/usr/bin/env ts-node
/**
 * Issue #811 Phase B Part A: Google Drive フォルダ重複統合の実行(承認制)
 *
 * `scripts/classify-drive-folder-duplicates.ts`が出力したPlanを読み、承認された
 * operationのみをGate chainで再評価してから実行する。`scripts/execute-collision-migration.ts`
 * (Issue #432、実装済み)の2-phase preflight(write-free)→write phase設計をそのまま踏襲する。
 *
 * ケアマネ・ルート階層の解決には`findOrCreateFolder.ts`(本番用、trashed=false固定検索)を
 * 一切使わない。canonicalFolderIdはPlanに固定値として記録されており、customer/
 * documentCategory階層は`childFolderResolver.ts`(Part A専用、trashed込み検索)で解決する。
 * これにより本スクリプトの実行は、findOrCreateFolder.tsの将来の修正(Part B)に一切依存しない
 * (4回の独立診断で確定した「循環依存回避」設計)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/execute-drive-folder-merge.ts \
 *     --plan plan-output.json --approval approval.json [--operations op-0001,op-0002] \
 *     [--execute] [--manifest-out manifest-output.json]
 *
 *   --execute なし: dry-run (Drive/Firestoreへの書込みゼロ、preflightのみ)
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import type { drive_v3 } from 'googleapis';
import {
  FOLDER_MERGE_PLAN_SCHEMA_VERSION,
  verifyActionProvenanceInvariant,
  verifyFolderProvenanceCompleteness,
  verifyFolderProvenanceMatch,
  computeFirestoreSnapshotHash,
  buildDrivePath,
  type Approval,
  type FolderFileProvenance,
  type Operation,
  type Plan,
} from './lib/folderMergePlanTypes';
import { readDriveApiVersionSnapshot, verifyDriveApiVersionMatch } from './lib/driveApiVersionGate';
import type { FileMoveManifestEntry, FolderRenameManifestEntry, ExecutionManifest } from './lib/folderMergeManifest';
import { resolveExportCategory } from './lib/resolveExportCategory';

const DRIFT_RUNBOOK = `
[precondition drift 発生時の再開手順]
1. write phaseで停止したoperationは一切実行されていない(preflight通過後〜write到達までの
   間にDrive/Firestore側が変化した)。
2. 本manifestとログを保存する。
3. classify-drive-folder-duplicates.tsを再実行し、最新状態でPlanを再生成する。
4. 再生成されたPlanで、既にexecuted済みのoperationはidempotencyチェックによりskip
   (already migrated)される。未完了分のみ新しいapprovalで再承認・再実行する。
`.trim();

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

function getOpt(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const planFile = getOpt('--plan');
const approvalFile = getOpt('--approval');
const operationsFilterRaw = getOpt('--operations');
const operationsFilter = operationsFilterRaw
  ? new Set(operationsFilterRaw.split(',').map((s) => s.trim()))
  : null;
const manifestOutFile = getOpt('--manifest-out') ?? 'manifest-output.json';
const execute = process.argv.includes('--execute');

if (!planFile || !approvalFile) {
  console.error('--plan <plan.json> と --approval <approval.json> は必須です');
  process.exit(1);
}

const plan: Plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const approval: Approval = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));

// === schemaVersion gate ===
if (plan.schemaVersion !== FOLDER_MERGE_PLAN_SCHEMA_VERSION) {
  console.error(
    `FATAL: unsupported plan schemaVersion (got '${plan.schemaVersion ?? '<missing>'}', expected '${FOLDER_MERGE_PLAN_SCHEMA_VERSION}'). Re-run classify-drive-folder-duplicates.ts.`
  );
  process.exit(2);
}
// === Gate 1: planId 一致 ===
if (approval.planId !== plan.planId) {
  console.error(`FATAL: approval.planId (${approval.planId}) !== plan.planId (${plan.planId})`);
  process.exit(2);
}
// === Gate 4-env: projectId 一致 ===
if (plan.projectId !== projectId) {
  console.error(`FATAL: plan.projectId (${plan.projectId}) !== runtime FIREBASE_PROJECT_ID (${projectId})`);
  process.exit(2);
}
// === driveApiVersionGate ===
const runtimeDriveApiVersion = readDriveApiVersionSnapshot();
const driveApiVersionResult = verifyDriveApiVersionMatch(
  { lockfileHash: plan.lockfileHash, googleapisLockfileVersion: plan.googleapisLockfileVersion },
  runtimeDriveApiVersion
);
if (!driveApiVersionResult.ok) {
  console.error(`FATAL: ${driveApiVersionResult.reason}`);
  process.exit(2);
}

const approvedOpIds = new Set(approval.approvedOperationIds);
const approvedPaths = new Set(approval.approvedPaths);

admin.initializeApp({ projectId });
const db = admin.firestore();

interface OperationOutcome {
  operationId: string;
  docId: string;
  action: Operation['recommendedAction'];
  status: 'executed' | 'dry-run' | 'skipped' | 'gate-rejected' | 'error';
  reason: string;
  details?: Record<string, unknown>;
}

interface LiveSnapshot {
  parents: string[];
  trashed: boolean;
  name: string;
  version: string;
  md5Checksum: string | null;
  headRevisionId: string | null;
}

async function fetchLiveSnapshot(
  drive: drive_v3.Drive,
  fileId: string,
  SUPPORTS_ALL_DRIVES: Record<string, boolean>
): Promise<LiveSnapshot> {
  const res = await drive.files.get({
    fileId,
    fields: 'parents, trashed, name, version, md5Checksum, headRevisionId',
    ...SUPPORTS_ALL_DRIVES,
  });
  return {
    parents: res.data.parents ?? [],
    trashed: !!res.data.trashed,
    name: res.data.name ?? '',
    version: res.data.version ?? '',
    md5Checksum: res.data.md5Checksum ?? null,
    headRevisionId: res.data.headRevisionId ?? null,
  };
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

async function checkFirestoreDrift(
  op: Operation
): Promise<{ ok: boolean; reason: string }> {
  if (op.expectedFirestoreSnapshotHash === null) {
    return { ok: true, reason: 'no firestore snapshot expected' };
  }
  const snap = await db.doc(`documents/${op.docId}`).get();
  if (!snap.exists) {
    return { ok: false, reason: 'firestore doc no longer exists' };
  }
  const data = snap.data()!;
  // classify側(resolveExportCategory + customer furigana取得)と完全に同一のロジックで
  // 再計算する(codex review P1/P2指摘対応: 生のdoc.categoryや、customerId/furigana抜きの
  // hashだと、documentType手動訂正・同姓同名customer付け替え・furigana訂正を見逃す)。
  const documentTypeRaw = (data.documentType as string | undefined) ?? '';
  const documentCategory = await resolveExportCategory(db, documentTypeRaw);
  const customerId = (data.customerId as string | null | undefined) ?? null;
  let customerFurigana: string | null = null;
  if (customerId) {
    const customerSnap = await db.doc(`masters/customers/items/${customerId}`).get();
    customerFurigana = customerSnap.exists ? ((customerSnap.data() as { furigana?: string }).furigana ?? null) : null;
  }
  const currentHash = computeFirestoreSnapshotHash({
    careManager: (data.careManager as string | undefined) ?? '',
    customerName: (data.customerName as string | undefined) ?? '',
    customerId,
    customerFurigana,
    documentCategory,
    documentType: documentTypeRaw,
    fileDateIso: data.fileDate ? (data.fileDate as admin.firestore.Timestamp).toDate().toISOString() : null,
  });
  if (currentHash !== op.expectedFirestoreSnapshotHash) {
    return { ok: false, reason: 'firestore snapshot drift (careManager/customerName/customerId/customerFurigana/category/fileDate changed since classify)' };
  }
  return { ok: true, reason: 'firestore snapshot matched' };
}

async function main(): Promise<void> {
  const { getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { SUPPORTS_ALL_DRIVES, escapeQueryValue } = await import('../functions/src/drive/driveApiConstants');
  const { resolveChildFolderPath, resolveChildFolderPathReadOnly } = await import(
    '../functions/src/drive/childFolderResolver'
  );

  const drive: drive_v3.Drive = await getDriveClient();

  // === canonicalフォルダの再健全性確認(codex review P1指摘対応) ===
  // classify時点の健全性確認(active・rootFolderId直下)はPlanに記録されるだけで、
  // execute時には再検証されていなかった。承認からexecute実行までの間にcanonicalが
  // 移動・trashed化された場合、無効な場所へファイルを移動し続けてしまうリスクがあった。
  {
    const canonicalCheck = await drive.files.get({
      fileId: plan.canonicalFolderId,
      fields: 'id, name, parents, trashed',
      ...SUPPORTS_ALL_DRIVES,
    });
    if (canonicalCheck.data.trashed) {
      console.error(`FATAL: canonicalFolderId (${plan.canonicalFolderId}) is now trashed. Re-run classify to confirm current state.`);
      process.exit(2);
    }
    if (canonicalCheck.data.name !== plan.canonicalProvenance.name) {
      console.error(
        `FATAL: canonicalFolderId name drift (plan="${plan.canonicalProvenance.name}", runtime="${canonicalCheck.data.name}"). Re-run classify.`
      );
      process.exit(2);
    }
    if (!sameStringSet(canonicalCheck.data.parents ?? [], plan.canonicalProvenance.parents)) {
      console.error(
        `FATAL: canonicalFolderId parents drift (plan=${JSON.stringify(plan.canonicalProvenance.parents)}, runtime=${JSON.stringify(canonicalCheck.data.parents)}). Re-run classify.`
      );
      process.exit(2);
    }
  }

  // === duplicateフォルダ(root)群の再健全性確認(codex review P1指摘対応) ===
  // 個々のfile移動のGate5(precondition drift)はfile自身のparents/trashed/nameしか見ない
  // ため、file の直接の親フォルダ「ID」さえ変わらなければ、その祖先(duplicateフォルダ
  // root自体)がclassify後にrename/移動/復元されていても検知できない。特に末尾の
  // 統合済みリネーム処理は`dupProvenance.name`(classify時点の古い名前)を前提に動くため、
  // 全rootを事前に再検証しfail-closedにする。
  for (const dupProvenance of plan.sourceFolderProvenance) {
    const dupCheck = await drive.files.get({
      fileId: dupProvenance.id,
      fields: 'id, name, parents, trashed',
      ...SUPPORTS_ALL_DRIVES,
    });
    if (
      dupCheck.data.name !== dupProvenance.name ||
      dupCheck.data.trashed !== dupProvenance.trashed ||
      !sameStringSet(dupCheck.data.parents ?? [], dupProvenance.parents)
    ) {
      console.error(
        `FATAL: duplicateFolderId ${dupProvenance.id} drift since classify ` +
          `(plan: name="${dupProvenance.name}" trashed=${dupProvenance.trashed} parents=${JSON.stringify(dupProvenance.parents)}, ` +
          `runtime: name="${dupCheck.data.name}" trashed=${dupCheck.data.trashed} parents=${JSON.stringify(dupCheck.data.parents)}). Re-run classify.`
      );
      process.exit(2);
    }
  }

  const fileMoves: FileMoveManifestEntry[] = [];
  const folderRenames: FolderRenameManifestEntry[] = [];
  const restoredTargetFolderIdSet = new Set<string>();

  async function processOperation(op: Operation, currentlyExecuting: boolean): Promise<OperationOutcome> {
    // Gate 0 (defense-in-depth)
    if (op.classification === 'ManualReviewRequired' && op.recommendedAction !== 'manual-review') {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'gate-rejected',
        reason: `defense-in-depth: ManualReviewRequired classification must use manual-review action (got ${op.recommendedAction})`,
      };
    }

    // Gate 8: action ↔ provenanceRequired invariant
    const invariantResult = verifyActionProvenanceInvariant(op.recommendedAction, op.provenanceRequired);
    if (!invariantResult.ok) {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'gate-rejected',
        reason: invariantResult.reason,
      };
    }

    // Gate 2: operationId 認可
    if (!approvedOpIds.has(op.operationId)) {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'gate-rejected',
        reason: 'operationId not in approvedOperationIds',
      };
    }

    if (op.recommendedAction === 'manual-review') {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'skipped',
        reason: 'manual-review action: no automated execution',
      };
    }

    // Gate 3: path 認可(実際の現在の親フォルダ基準)
    const sourceParent = op.expectedParents[0];
    const approvedPath = sourceParent ? buildDrivePath(sourceParent, op.driveFileId) : null;
    if (!approvedPath || !approvedPaths.has(approvedPath)) {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'gate-rejected',
        reason: `path not in approvedPaths: ${approvedPath ?? '<no source parent>'}`,
      };
    }

    // 冪等性チェック(precondition評価より前。既に完了済みの移動をdriftとして
    // silent skipしないため、collision版のF-A3と同じ順序)
    const readOnlyTargetId = await resolveChildFolderPathReadOnly(drive, plan.canonicalFolderId, op.targetSegments);
    const liveForIdempotency = await fetchLiveSnapshot(drive, op.driveFileId, SUPPORTS_ALL_DRIVES);
    if (readOnlyTargetId !== null && liveForIdempotency.parents.includes(readOnlyTargetId)) {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'skipped',
        reason: 'already migrated (idempotent)',
      };
    }

    // Gate 5: precondition drift(Drive側 + Firestore側、同一のfetch結果を再利用)
    const parentsMatch = sameStringSet(liveForIdempotency.parents, op.expectedParents);
    if (!parentsMatch || liveForIdempotency.trashed !== op.expectedTrashed || liveForIdempotency.name !== op.expectedName) {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'skipped',
        reason: `precondition mismatch: drive drift (parents=${JSON.stringify(liveForIdempotency.parents)} vs expected=${JSON.stringify(op.expectedParents)}, trashed=${liveForIdempotency.trashed} vs expected=${op.expectedTrashed}, name="${liveForIdempotency.name}" vs expected="${op.expectedName}")`,
      };
    }
    const firestoreDrift = await checkFirestoreDrift(op);
    if (!firestoreDrift.ok) {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'skipped',
        reason: `precondition mismatch: ${firestoreDrift.reason}`,
      };
    }

    // 移動先の競合を再確認(codex review P1指摘対応): classify時点では競合なしと
    // 判定されていても、承認からexecute実行までの間に別のエクスポート等が同一
    // docSplitDocIdのファイルを移動先へ作成している可能性がある。readOnlyTargetIdが
    // 既に存在する場合のみ、そこに他ファイルが無いか再確認する。
    if (readOnlyTargetId !== null && op.docId !== '<unresolved>') {
      const conflictCheck = await drive.files.list({
        q: `'${readOnlyTargetId}' in parents and appProperties has { key='docSplitDocId' and value='${escapeQueryValue(op.docId)}' }`,
        fields: 'files(id)',
        includeItemsFromAllDrives: true,
        ...SUPPORTS_ALL_DRIVES,
      });
      const conflictingFiles = (conflictCheck.data.files ?? []).filter((f) => f.id !== op.driveFileId);
      if (conflictingFiles.length > 0) {
        return {
          operationId: op.operationId,
          docId: op.docId,
          action: op.recommendedAction,
          status: 'skipped',
          reason: `precondition mismatch: destination conflict detected at execution time (${conflictingFiles.length} other file(s) with same docSplitDocId already at target)`,
        };
      }
    }

    // Gate 9a/9b: provenance completeness + runtime再照合(Gate5と同一fetch結果を再利用、
    // Driveメタデータ取得は軽量なためPDF版のような二重ダウンロード回避の必要がない)
    if (op.provenanceRequired) {
      const completeness = verifyFolderProvenanceCompleteness(op.provenance);
      if (!completeness.ok) {
        return {
          operationId: op.operationId,
          docId: op.docId,
          action: op.recommendedAction,
          status: 'gate-rejected',
          reason: `provenance: ${completeness.reason}`,
        };
      }
      const runtimeProvenance: FolderFileProvenance = {
        fileId: op.driveFileId,
        version: liveForIdempotency.version,
        md5Checksum: liveForIdempotency.md5Checksum,
        headRevisionId: liveForIdempotency.headRevisionId,
      };
      const matchResult = verifyFolderProvenanceMatch(op.provenance as FolderFileProvenance, runtimeProvenance);
      if (!matchResult.ok) {
        return {
          operationId: op.operationId,
          docId: op.docId,
          action: op.recommendedAction,
          status: 'gate-rejected',
          reason: `provenance: ${matchResult.reason}`,
        };
      }
    }

    if (!currentlyExecuting) {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'dry-run',
        reason: 'all gates passed; would execute',
        details: { targetSegments: op.targetSegments },
      };
    }

    // === 実行 ===
    try {
      const { id: targetFolderId, restoredFolderIds } = await resolveChildFolderPath(
        drive,
        plan.canonicalFolderId,
        op.targetSegments
      );
      for (const id of restoredFolderIds) restoredTargetFolderIdSet.add(id);
      await drive.files.update({
        fileId: op.driveFileId,
        addParents: targetFolderId,
        removeParents: liveForIdempotency.parents.join(','),
        requestBody: { trashed: false },
        fields: 'id, parents, trashed',
        ...SUPPORTS_ALL_DRIVES,
      });
      fileMoves.push({
        operationId: op.operationId,
        docId: op.docId,
        driveFileId: op.driveFileId,
        sourceRootId: op.sourceFolderId,
        oldParents: liveForIdempotency.parents,
        oldTrashed: liveForIdempotency.trashed,
        oldName: liveForIdempotency.name,
        newParentId: targetFolderId,
        timestamp: new Date().toISOString(),
      });
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'executed',
        reason: 'moved to canonical subtree',
        details: { newParentId: targetFolderId },
      };
    } catch (err) {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'error',
        reason: (err as Error).message,
      };
    }
  }

  const OUTCOME_SYMBOLS: Record<string, string> = {
    executed: '✅',
    'dry-run': '📋',
    skipped: '⏭️ ',
    'gate-rejected': '🚫',
    error: '❌',
  };

  function summarize(outcomes: OperationOutcome[]): Record<string, number> {
    return outcomes.reduce(
      (acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  console.log(`Project: ${projectId}`);
  console.log(`Plan   : ${planFile} (planId=${plan.planId}, schemaVersion=${plan.schemaVersion})`);
  console.log(`Approval: ${approvalFile}`);
  console.log(`Mode   : ${execute ? 'EXECUTE (preflight + write)' : 'DRY-RUN (preflight only)'}`);
  if (operationsFilter) {
    console.log(`Filter : ${[...operationsFilter].join(', ')}`);
  }

  const ops = operationsFilter
    ? plan.operations.filter((op) => operationsFilter.has(op.operationId))
    : plan.operations;
  console.log(`Processing ${ops.length}/${plan.operations.length} operations...`);

  console.log('\n[Phase 1/2] Preflight (write-free gate evaluation)\n');
  const preflightOutcomes: OperationOutcome[] = [];
  for (const op of ops) {
    const outcome = await processOperation(op, false);
    preflightOutcomes.push(outcome);
    console.log(`${OUTCOME_SYMBOLS[outcome.status] ?? '?'} ${outcome.operationId} ${outcome.docId}: ${outcome.reason}`);
  }
  const preflightSummary = summarize(preflightOutcomes);
  console.log('\n=== Preflight Summary ===');
  console.log(JSON.stringify(preflightSummary, null, 2));

  const hasPreflightFailure =
    (preflightSummary['gate-rejected'] ?? 0) > 0 || (preflightSummary['error'] ?? 0) > 0;

  if (hasPreflightFailure || !execute) {
    await admin.app().delete();
    if (hasPreflightFailure) {
      console.error('\nFATAL: preflight phase had gate-rejected or error outcomes. Write phase aborted.');
      process.exit(1);
    }
    process.exit(0);
  }

  console.log('\n[Phase 2/2] Write (preflight passed, executing destructive actions)\n');
  const writeOutcomes: OperationOutcome[] = [];
  for (const op of ops) {
    const outcome = await processOperation(op, true);
    writeOutcomes.push(outcome);
    console.log(`${OUTCOME_SYMBOLS[outcome.status] ?? '?'} ${outcome.operationId} ${outcome.docId}: ${outcome.reason}`);
  }
  const writeSummary = summarize(writeOutcomes);
  console.log('\n=== Write Summary ===');
  console.log(JSON.stringify(writeSummary, null, 2));

  function buildManifest(): ExecutionManifest {
    return {
      planId: plan.planId,
      environment: plan.environment,
      fileMoves,
      folderRenames,
      restoredTargetFolderIds: [...restoredTargetFolderIdSet],
    };
  }

  // チェックポイント書き込み(codex review P1指摘対応): 後続の統合済みリネーム走査
  // (isFolderTreeEmptyの再帰列挙)が一時的なDrive APIエラー等でthrowした場合でも、
  // ここまでに成功したfile移動のmanifestを確実に残す(rollbackに必須の記録)。
  fs.writeFileSync(manifestOutFile, JSON.stringify(buildManifest(), null, 2));

  const writeSkippedDrift = writeOutcomes.filter(
    (o) => o.status === 'skipped' && o.reason.startsWith('precondition mismatch')
  );
  if (writeSkippedDrift.length > 0) {
    console.error(`\nFATAL: ${writeSkippedDrift.length} op(s) had precondition drift between preflight and write phase. These ops were NOT executed:`);
    for (const o of writeSkippedDrift) {
      console.error(`  - ${o.operationId} ${o.docId}: ${o.reason}`);
    }
    console.error('');
    console.error(DRIFT_RUNBOOK);
    fs.writeFileSync(manifestOutFile, JSON.stringify(buildManifest(), null, 2));
    await admin.app().delete();
    process.exit(1);
  }

  // ─── 統合済みduplicateフォルダの終端処理(全ファイル移動済みならrename) ────
  // write phaseでdriftが1件もなかった場合のみ実施(部分的な状態でrenameしない)。
  async function isFolderTreeEmpty(folderId: string): Promise<boolean> {
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents`,
        fields: 'nextPageToken, files(id, mimeType)',
        includeItemsFromAllDrives: true,
        pageSize: 100,
        pageToken,
        ...SUPPORTS_ALL_DRIVES,
      });
      for (const f of res.data.files ?? []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          if (f.id && !(await isFolderTreeEmpty(f.id))) return false;
        } else {
          return false;
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return true;
  }

  const renameStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (const dupProvenance of plan.sourceFolderProvenance) {
    // codex review P1指摘対応: isFolderTreeEmpty自体のthrow(一時的なDrive APIエラー等)も
    // このtry/catchで吸収し、1フォルダの失敗が後続フォルダのリネーム処理や、既に
    // 書き込み済みのmanifest(上のチェックポイント参照)を失わせないようにする。
    try {
      const empty = await isFolderTreeEmpty(dupProvenance.id);
      if (!empty) continue;
      const newName = `${dupProvenance.name} (統合済み_${renameStamp})`;
      await drive.files.update({
        fileId: dupProvenance.id,
        requestBody: { name: newName },
        fields: 'id',
        ...SUPPORTS_ALL_DRIVES,
      });
      folderRenames.push({
        folderId: dupProvenance.id,
        oldName: dupProvenance.name,
        newName,
        timestamp: new Date().toISOString(),
      });
      console.log(`📁 統合済みリネーム: ${dupProvenance.id} "${dupProvenance.name}" → "${newName}"`);
    } catch (err) {
      console.error(`⚠️  duplicateフォルダ ${dupProvenance.id} の空判定/リネームに失敗: ${(err as Error).message}`);
    }
  }

  fs.writeFileSync(manifestOutFile, JSON.stringify(buildManifest(), null, 2));
  console.log(
    `\nManifest written to ${manifestOutFile} (${fileMoves.length} file moves, ${folderRenames.length} folder renames, ${restoredTargetFolderIdSet.size} restored target folders)`
  );

  await admin.app().delete();

  if ((writeSummary['error'] ?? 0) > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('Failed:', err);
  try {
    await admin.app().delete();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
