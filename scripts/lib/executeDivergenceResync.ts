/**
 * Issue #871 恒久対応: `execute-drive-claim-resync.ts`のコアロジックを、fake Drive/
 * fake claim関数を注入してテストできる形に切り出したもの
 * (`scripts/lib/buildDivergencePlan.ts`と同型パターン)。
 *
 * 書き込み順序はDrive先→Firestore後(§5)。Drive側の書込みが成功し再検証が取れてから
 * `resolveDivergentClaim()`/`releaseDivergentClaim()`を呼ぶ。Firestore書込みが失敗した
 * 場合はDrive側をロールバックせずdivergentのまま残す——次回の`buildDivergencePlan`が
 * 「実体は既に期待通りだがclaimだけdivergent」を検知し`finalize-resolved`を提案するため、
 * 次回classify→execute サイクルで自然に収束する(idempotent)。
 */

import type { drive_v3 } from 'googleapis';
import type * as admin from 'firebase-admin';
import {
  evaluatePreflight,
  type BlockedReason,
  type ClaimGraphConflict,
  type DivergenceApproval,
  type DivergenceOperation,
  type DivergencePlan,
  type DivergenceResyncManifest,
  type DivergenceResyncManifestEntry,
  type DriveEntitySnapshot,
  type ResolutionMode,
} from './divergenceResolutionPlan';

interface DriveFile {
  id: string;
  name: string;
  parents: string[];
  trashed: boolean;
}

interface DriveDeps {
  drive: drive_v3.Drive;
  supportsAllDrives: Record<string, unknown>;
  folderMimeType: string;
  escapeQueryValue: (value: string) => string;
}

interface ClaimFence {
  expectedFolderId?: string;
  expectedDivergentReason: string;
  expectedUpdateTimeMs: number;
  actor: string;
}
type ClaimOutcome = { outcome: 'resolved' } | { outcome: 'no-op'; reason: string };

export interface ClaimFunctions {
  resolveDivergentClaim: (
    firestore: admin.firestore.Firestore,
    parentId: string,
    name: string,
    fence: ClaimFence,
    /** type-design-analyzerレビュー指摘対応: resyncHistory[]でrestore-expected/
     * finalize-resolvedを区別するため、実際に承認されたmodeを伝える。 */
    mode: 'restore-expected' | 'finalize-resolved'
  ) => Promise<ClaimOutcome>;
  releaseDivergentClaim: (
    firestore: admin.firestore.Firestore,
    parentId: string,
    name: string,
    fence: ClaimFence
  ) => Promise<ClaimOutcome>;
  buildFolderLockId: (parentId: string, name: string) => string;
}

export interface ExecuteDivergenceResyncOptions {
  execute: boolean;
  actor: string;
  log?: (message: string) => void;
  /**
   * 各operation処理完了直後に呼ばれる(pr-review-toolkit:code-reviewer Important指摘対応)。
   * `execute-drive-folder-merge.ts`は書込みループの途中でmanifestを都度ディスクへ
   * 書き出しており(「ループの途中でプロセスがクラッシュ/killされた場合でも、それまでに
   * 成功したfile移動をrollback可能な状態にする」)、本スクリプトも同じ理由でDrive書込みを
   * 伴う destructive operation のため同型にする。呼び出し元(CLI)がここで都度
   * `manifest-out`ファイルへ書き出すことを想定。
   */
  onProgress?: (manifest: DivergenceResyncManifest) => void;
}

export type OperationExecutionStatus =
  | 'executed'
  | 'dry-run'
  | 'not-approved'
  | 'blocked'
  | 'claim-drift'
  | 'drive-drift'
  | 'error';

export interface OperationExecutionOutcome {
  operationId: string;
  status: OperationExecutionStatus;
  mode: ResolutionMode | null;
  reasons: BlockedReason[];
  errorMessage?: string;
  /** 成功時(executed)のみ非空。呼び出し元が`--requeue`でこれらのdocIdを再試行する。 */
  affectedDocIds: string[];
}

function isNotFoundError(err: unknown): boolean {
  const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
  return status === 404;
}

async function fetchSnapshot(deps: DriveDeps, fileId: string): Promise<DriveEntitySnapshot | null> {
  try {
    const res = await deps.drive.files.get({
      fileId,
      fields: 'id, name, parents, trashed, modifiedTime',
      ...deps.supportsAllDrives,
    });
    const d = res.data;
    return {
      id: d.id ?? fileId,
      name: d.name ?? '',
      parents: d.parents ?? [],
      trashed: !!d.trashed,
      modifiedTime: d.modifiedTime ?? '',
    };
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

function snapshotsMatch(a: DriveEntitySnapshot, b: DriveEntitySnapshot): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.trashed === b.trashed &&
    // modifiedTimeも比較対象に含める(codex review Medium指摘対応)。id/name/parents/trashedが
    // 同一でも、第三者が内容更新や移動→復帰(親は結果的に同じだがmodifiedTimeは進む)を行った
    // 場合を検知するため、設計上のスナップショット定義({id,name,parents,trashed,modifiedTime})
    // の完全一致を保証する。
    a.modifiedTime === b.modifiedTime &&
    a.parents.length === b.parents.length &&
    a.parents.every((p) => b.parents.includes(p))
  );
}

const KNOWN_RESOLUTION_MODES: ReadonlySet<string> = new Set<ResolutionMode>([
  'restore-expected',
  'release-claim',
  'finalize-resolved',
]);

async function listAll(deps: DriveDeps, q: string): Promise<DriveFile[]> {
  const results: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await deps.drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name, parents, trashed)',
      includeItemsFromAllDrives: true,
      pageSize: 100,
      pageToken,
      ...deps.supportsAllDrives,
    });
    for (const f of res.data.files ?? []) {
      if (!f.id || f.name === undefined || f.name === null) continue;
      results.push({ id: f.id, name: f.name, parents: f.parents ?? [], trashed: !!f.trashed });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return results;
}

async function reevaluateClaimGraph(
  firestore: admin.firestore.Firestore,
  folderId: string,
  selfParentId: string,
  selfName: string
): Promise<ClaimGraphConflict[]> {
  const snapshot = await firestore
    .collection('driveFolderLocks')
    .where('folderId', '==', folderId)
    .where('state', 'in', ['resolved', 'divergent'])
    .get();
  const conflicts: ClaimGraphConflict[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.parentId === selfParentId && data.name === selfName) continue;
    conflicts.push({
      otherParentId: data.parentId as string,
      otherName: data.name as string,
      otherState: data.state as 'resolved' | 'divergent',
    });
  }
  return conflicts;
}

async function processOperation(
  deps: DriveDeps,
  firestore: admin.firestore.Firestore,
  claimFns: ClaimFunctions,
  op: DivergenceOperation,
  approval: DivergenceApproval,
  options: ExecuteDivergenceResyncOptions
): Promise<{ outcome: OperationExecutionOutcome; manifestEntry: DivergenceResyncManifestEntry | null }> {
  const log = options.log ?? (() => {});

  const approvedEntry = approval.approvedOperations[op.operationId];
  if (!approvedEntry) {
    return {
      outcome: { operationId: op.operationId, status: 'not-approved', mode: null, reasons: [], affectedDocIds: [] },
      manifestEntry: null,
    };
  }
  const approvedMode = approvedEntry.mode;

  // 未知のmode文字列をrestore-expected扱いにfall-throughさせない(codex review Medium指摘対応)。
  // approval JSONは外部入力であり、GHA側のjqバリデーションを経由しないローカルCLI直接実行
  // 経路では検証されない。誤字・不正値のmodeがそのまま`else`(restore-expected)分岐へ流れ、
  // 権限チェック等がスキップされたままDrive書込みが実行されるfail-openな穴を塞ぐ。
  if (!KNOWN_RESOLUTION_MODES.has(approvedMode)) {
    return {
      outcome: {
        operationId: op.operationId,
        status: 'error',
        mode: null,
        reasons: [],
        errorMessage: `未知のresolutionMode: ${JSON.stringify(approvedMode)}`,
        affectedDocIds: [],
      },
      manifestEntry: null,
    };
  }

  if (op.claimFolderId === null && approvedMode !== 'release-claim') {
    return {
      outcome: {
        operationId: op.operationId,
        status: 'blocked',
        mode: approvedMode,
        reasons: ['missing-folder-id'],
        affectedDocIds: [],
      },
      manifestEntry: null,
    };
  }

  // ─── claim drift再確認(fenceの根拠: divergent状態のclaimは人手介入まで不変) ───
  const claimDocId = claimFns.buildFolderLockId(op.parentId, op.name);
  const claimSnap = await firestore.collection('driveFolderLocks').doc(claimDocId).get();
  if (!claimSnap.exists) {
    return {
      outcome: { operationId: op.operationId, status: 'claim-drift', mode: approvedMode, reasons: [], affectedDocIds: [] },
      manifestEntry: null,
    };
  }
  const claimData = claimSnap.data()!;
  const freshUpdateTimeMs = claimSnap.updateTime?.toMillis();
  if (
    claimData.state !== 'divergent' ||
    claimData.divergentReason !== op.divergentReason ||
    (op.claimFolderId !== null && claimData.folderId !== op.claimFolderId) ||
    freshUpdateTimeMs !== op.claimUpdateTimeMs
  ) {
    return {
      outcome: { operationId: op.operationId, status: 'claim-drift', mode: approvedMode, reasons: [], affectedDocIds: [] },
      manifestEntry: null,
    };
  }

  // ─── Drive実体側のTOCTOU再確認(claimのfenceとは別物、§1参照) ───
  let freshActual: DriveEntitySnapshot | null = null;
  if (op.claimFolderId !== null) {
    freshActual = await fetchSnapshot(deps, op.claimFolderId);
    const planActual = op.actual;
    const driveDrifted =
      (freshActual === null) !== (planActual === null) ||
      (freshActual !== null && planActual !== null && !snapshotsMatch(freshActual, planActual));
    if (driveDrifted) {
      return {
        outcome: { operationId: op.operationId, status: 'drive-drift', mode: approvedMode, reasons: [], affectedDocIds: [] },
        manifestEntry: null,
      };
    }
  }

  // ─── claimグラフ掃引の再確認(execute直前、並行して新規作成されたclaimも検出) ───
  const claimGraphConflicts =
    op.claimFolderId !== null
      ? await reevaluateClaimGraph(firestore, op.claimFolderId, op.parentId, op.name)
      : [];

  let expectedParent: { found: boolean; canAddChildren: boolean } | null = null;
  let duplicateNameAtTarget = false;
  let canMoveItemWithinDrive: boolean | null = null;
  let canRename: boolean | null = null;
  if (approvedMode === 'restore-expected' && op.claimFolderId !== null) {
    try {
      const res = await deps.drive.files.get({
        fileId: op.expectedParentId,
        fields: 'id, capabilities(canAddChildren)',
        ...deps.supportsAllDrives,
      });
      expectedParent = { found: true, canAddChildren: res.data.capabilities?.canAddChildren ?? false };
    } catch (err) {
      if (isNotFoundError(err)) {
        expectedParent = { found: false, canAddChildren: false };
      } else {
        throw err;
      }
    }
    if (expectedParent.found) {
      const q = `'${op.expectedParentId}' in parents and name='${deps.escapeQueryValue(op.expectedName)}' and mimeType='${deps.folderMimeType}'`;
      const matches = await listAll(deps, q);
      duplicateNameAtTarget = matches.some((m) => m.id !== op.claimFolderId);
    }
    const capRes = await deps.drive.files.get({
      fileId: op.claimFolderId,
      fields: 'capabilities(canMoveItemWithinDrive, canRename)',
      ...deps.supportsAllDrives,
    });
    canMoveItemWithinDrive = capRes.data.capabilities?.canMoveItemWithinDrive ?? false;
    canRename = capRes.data.capabilities?.canRename ?? false;
  }

  let directChildCount: number | null = null;
  if (approvedMode === 'release-claim' && op.claimFolderId !== null) {
    const children = await listAll(deps, `'${op.claimFolderId}' in parents`);
    directChildCount = children.length;
  }

  // finalize-resolvedはop.recommendedModeではなくoperator承認値(approvedMode)であり、
  // classify時点の推奨とは独立にoperatorが選べる。実体が本当に期待値と一致しているかを
  // ここで(execute直前にfetchしたfreshActualで)フレッシュに確認する(codex review High
  // 指摘対応: 推奨がrestore-expectedだったoperationに誤ってfinalize-resolvedを承認しても、
  // 乖離を残したままclaimがresolvedへ戻ることを防ぐ)。
  const actualMatchesExpected =
    freshActual !== null &&
    !freshActual.trashed &&
    freshActual.name === op.expectedName &&
    freshActual.parents.includes(op.expectedParentId);

  const preflight = evaluatePreflight({
    approvedMode,
    actual: freshActual,
    expectedParent: approvedMode === 'restore-expected' && op.parentsDiffer ? expectedParent : null,
    canMoveItemWithinDrive: approvedMode === 'restore-expected' && op.parentsDiffer ? canMoveItemWithinDrive : null,
    canRename: approvedMode === 'restore-expected' && op.nameDiffers ? canRename : null,
    duplicateNameAtTarget,
    claimGraphConflicts,
    directChildCount,
    acknowledgedStrandedCount: approvedEntry.acknowledgedStrandedFiles ?? null,
    actualMatchesExpected,
  });

  if (preflight.blocked) {
    return {
      outcome: { operationId: op.operationId, status: 'blocked', mode: approvedMode, reasons: preflight.reasons, affectedDocIds: [] },
      manifestEntry: null,
    };
  }

  if (!options.execute) {
    return {
      outcome: { operationId: op.operationId, status: 'dry-run', mode: approvedMode, reasons: [], affectedDocIds: op.affectedDocIds },
      manifestEntry: null,
    };
  }

  const fence: ClaimFence = {
    expectedFolderId: op.claimFolderId ?? undefined,
    expectedDivergentReason: op.divergentReason,
    expectedUpdateTimeMs: freshUpdateTimeMs as number,
    actor: options.actor,
  };

  let manifestEntry: DivergenceResyncManifestEntry | null = null;

  if (approvedMode === 'release-claim') {
    const result = await claimFns.releaseDivergentClaim(firestore, op.parentId, op.name, fence);
    if (result.outcome === 'no-op') {
      return {
        outcome: { operationId: op.operationId, status: 'error', mode: approvedMode, reasons: [], errorMessage: `releaseDivergentClaim no-op: ${result.reason}`, affectedDocIds: [] },
        manifestEntry: null,
      };
    }
    manifestEntry = {
      operationId: op.operationId,
      parentId: op.parentId,
      name: op.name,
      mode: approvedMode,
      claimFolderId: op.claimFolderId,
      driveChange: null,
      requeuedDocIds: [],
      timestamp: new Date().toISOString(),
    };
  } else if (approvedMode === 'finalize-resolved') {
    // Firestore書込み直前の最終ドリフト確認(codex review High指摘対応: プリフライト完了後も
    // capabilities取得等でAPI呼出しを重ねており、その間に第三者が動かした変更を見逃す
    // 可能性があった)。claimGraphConflicts再評価からこの時点までの間にDrive側が動いていない
    // ことを、書込み直前に取得した最新スナップショットで再確認する。
    if (op.claimFolderId !== null) {
      const finalActual = await fetchSnapshot(deps, op.claimFolderId);
      const finalMatches =
        finalActual !== null &&
        !finalActual.trashed &&
        finalActual.name === op.expectedName &&
        finalActual.parents.includes(op.expectedParentId);
      if (!finalMatches) {
        return {
          outcome: { operationId: op.operationId, status: 'drive-drift', mode: approvedMode, reasons: [], affectedDocIds: [] },
          manifestEntry: null,
        };
      }
    }
    const result = await claimFns.resolveDivergentClaim(firestore, op.parentId, op.name, fence, 'finalize-resolved');
    if (result.outcome === 'no-op') {
      return {
        outcome: { operationId: op.operationId, status: 'error', mode: approvedMode, reasons: [], errorMessage: `resolveDivergentClaim no-op: ${result.reason}`, affectedDocIds: [] },
        manifestEntry: null,
      };
    }
    manifestEntry = {
      operationId: op.operationId,
      parentId: op.parentId,
      name: op.name,
      mode: approvedMode,
      claimFolderId: op.claimFolderId,
      driveChange: null,
      requeuedDocIds: [],
      timestamp: new Date().toISOString(),
    };
  } else {
    // restore-expected: Drive先→Firestore後
    const oldParents = freshActual!.parents;
    const oldName = freshActual!.name;
    const newParents = op.parentsDiffer ? [op.expectedParentId] : oldParents;
    const newName = op.nameDiffers ? op.expectedName : oldName;

    const updateParams: Record<string, unknown> = {
      fileId: op.claimFolderId,
      fields: 'id, name, parents, trashed',
      ...deps.supportsAllDrives,
    };
    if (op.parentsDiffer) {
      updateParams.addParents = op.expectedParentId;
      updateParams.removeParents = oldParents.join(',');
    }
    if (op.nameDiffers) {
      updateParams.requestBody = { name: op.expectedName };
    }

    // Drive書込み直前の最終ドリフト確認(codex review High指摘対応: 期待親取得・重複名検索・
    // capabilities取得の3回のAPI呼出しを経てからfiles.updateへ進んでおり、この間に第三者が
    // 再度移動・改名していないかを、書込み直前に取得した最新スナップショットで再確認する)。
    const preWriteActual = await fetchSnapshot(deps, op.claimFolderId as string);
    if (preWriteActual === null || !snapshotsMatch(preWriteActual, freshActual!)) {
      return {
        outcome: { operationId: op.operationId, status: 'drive-drift', mode: approvedMode, reasons: [], affectedDocIds: [] },
        manifestEntry: null,
      };
    }

    try {
      await deps.drive.files.update(updateParams);
    } catch (updateErr) {
      // タイムアウト/切断でも実際には成功している可能性がある(execute-drive-folder-merge.ts
      // と同じ理由)。再取得して既に期待通りになっていれば成功経路へ合流する。
      // silent-failure-hunterレビュー指摘対応: この再取得(reconcile確認)自体が失敗した
      // 場合(権限エラー・レート制限等)を「反映されていない」と静かに同一視しない。
      // reconcile確認が本当に失敗したのか、確認できただけで反映されていなかったのかを
      // errorMessageで区別できるようにする。
      let reconciled: DriveEntitySnapshot | null;
      let reconcileError: Error | null;
      try {
        reconciled = await fetchSnapshot(deps, op.claimFolderId as string);
        reconcileError = null;
      } catch (verifyErr) {
        reconciled = null;
        reconcileError = verifyErr as Error;
      }
      const alreadyApplied =
        reconciled !== null &&
        reconciled.name === newName &&
        newParents.every((p) => reconciled!.parents.includes(p));
      if (!alreadyApplied) {
        const reconcileNote = reconcileError
          ? ` (加えて反映確認自体も失敗: ${reconcileError.message})`
          : '';
        return {
          outcome: {
            operationId: op.operationId,
            status: 'error',
            mode: approvedMode,
            reasons: [],
            errorMessage: `files.update failed: ${(updateErr as Error).message}${reconcileNote}`,
            affectedDocIds: [],
          },
          manifestEntry: null,
        };
      }
      log(`files.update例外だが実際には反映済みと確認、成功経路へ合流: ${op.operationId}`);
    }

    const verified = await fetchSnapshot(deps, op.claimFolderId as string);
    if (verified === null || verified.name !== newName || !newParents.every((p) => verified.parents.includes(p))) {
      return {
        outcome: {
          operationId: op.operationId,
          status: 'error',
          mode: approvedMode,
          reasons: [],
          errorMessage: 'Drive書込み後の再検証に失敗しました(期待値と不一致)',
          affectedDocIds: [],
        },
        manifestEntry: null,
      };
    }

    const result = await claimFns.resolveDivergentClaim(firestore, op.parentId, op.name, fence, 'restore-expected');
    if (result.outcome === 'no-op') {
      // Drive側は既に正しい位置に書き換わっているが、Firestore確定が失敗した。
      // ロールバックはしない(divergentのまま残す)。次回classifyがfinalize-resolvedを
      // 提案し、次サイクルで自然に収束する(§5参照)。
      return {
        outcome: {
          operationId: op.operationId,
          status: 'error',
          mode: approvedMode,
          reasons: [],
          errorMessage: `Drive書込みは成功したがresolveDivergentClaimがno-op(${result.reason})。claimはdivergentのまま残ります。次回classifyでfinalize-resolvedとして再提案されます。`,
          affectedDocIds: [],
        },
        manifestEntry: null,
      };
    }

    manifestEntry = {
      operationId: op.operationId,
      parentId: op.parentId,
      name: op.name,
      mode: approvedMode,
      claimFolderId: op.claimFolderId,
      driveChange: { oldParents, oldName, newParents, newName },
      requeuedDocIds: [],
      timestamp: new Date().toISOString(),
    };
  }

  return {
    outcome: { operationId: op.operationId, status: 'executed', mode: approvedMode, reasons: [], affectedDocIds: op.affectedDocIds },
    manifestEntry,
  };
}

export async function executeDivergenceResync(
  deps: DriveDeps,
  firestore: admin.firestore.Firestore,
  claimFns: ClaimFunctions,
  plan: DivergencePlan,
  approval: DivergenceApproval,
  options: ExecuteDivergenceResyncOptions
): Promise<{ outcomes: OperationExecutionOutcome[]; manifest: DivergenceResyncManifest }> {
  const outcomes: OperationExecutionOutcome[] = [];
  const manifestEntries: DivergenceResyncManifestEntry[] = [];

  for (const op of plan.operations) {
    const { outcome, manifestEntry } = await processOperation(deps, firestore, claimFns, op, approval, options);
    outcomes.push(outcome);
    if (manifestEntry) {
      manifestEntries.push(manifestEntry);
      options.onProgress?.({ planId: plan.planId, environment: plan.environment, entries: manifestEntries });
    }
  }

  return {
    outcomes,
    manifest: { planId: plan.planId, environment: plan.environment, entries: manifestEntries },
  };
}
