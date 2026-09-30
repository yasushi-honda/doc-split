/**
 * 同名の兄弟Driveフォルダ2つ(統合元S・統合先D)を、子孫を含めて再帰的に統合するツールの
 * plan / 承認 / manifest の型定義(plan-crossreview 2026-09-30 反映)。
 *
 * 背景: `execute-drive-sibling-merge`は統合元に子フォルダがあると拒否し、
 * `classify-drive-folder-duplicates`は統合元がゴミ箱済みであることを要求し、
 * `execute-drive-claim-resync`は`ambiguous-full-scan`を対象外にする。子フォルダを多数持つ
 * 同名フォルダ2つ(kanameoneの`(root)/森奈穂美`)はどれでも解消できないため、本ツールを新設する。
 *
 * PII対策: plan・manifest・ログにはフォルダ名・ファイル名を一切入れない(IDのみ)。
 * trash時の改名は、execute時にliveの名前を取得して接尾辞を付ける。
 */

export const FOLDER_TREE_MERGE_PLAN_SCHEMA_VERSION = 'folder-tree-merge-plan-v1';

/** planの有効期間。fence(claimのupdateTime)や対象の状態は時間とともに古くなるため、実行直前に取り直す運用にする。 */
export const PLAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** ルートclaim(`(rootFolderId, name)`スロット)のplan生成時の状態。finalizeのfenceに使う。 */
export interface RootClaimFence {
  folderId: string;
  divergentReason: string;
  /** plan生成時に読んだ`DocumentSnapshot.updateTime.toMillis()`。 */
  updateTimeMs: number;
}

export type TreeMergeOp =
  | { opId: string; kind: 'move-file'; fileId: string; fromParentId: string; toParentId: string }
  | { opId: string; kind: 'move-folder'; folderId: string; fromParentId: string; toParentId: string }
  /** 空になったS側フォルダの改名+trash。post-order(深い順)でopsに並ぶ。 */
  | { opId: string; kind: 'trash-folder'; folderId: string; parentId: string };

/** execute全体を拒否する阻害要因(名前は含めずID・件数のみ)。 */
export type TreeMergeBlockerCode =
  | 'shortcut'
  | 'shortcut-to-trashed-folder'
  | 'multi-parent'
  | 'cannot-move'
  | 'cannot-add-children'
  | 'cannot-trash'
  | 'target-same-name-multiple'
  | 'source-same-name-multiple'
  | 'docid-duplicate'
  | 'claims-reference-source-tree'
  | 'claim-exists-at-target-slot';

export interface TreeMergeBlocker {
  code: TreeMergeBlockerCode;
  /** 関係するDriveのfolder/file ID(あれば)。 */
  id?: string;
  /** 補足の件数(claims-reference-source-tree等)。 */
  count?: number;
}

export interface FolderTreeMergeSummary {
  fileMoves: number;
  folderMoves: number;
  folderTrashes: number;
  /** 統合先と同名のファイルがペア内に存在した件数(名前は出さない。承認者が併存を認識するため)。 */
  sameNameFileCount: number;
  /** 走査した統合元フォルダ数(S本体+再帰した子フォルダ)。 */
  visitedSourceFolderCount: number;
}

export interface FolderTreeMergePlan {
  schemaVersion: typeof FOLDER_TREE_MERGE_PLAN_SCHEMA_VERSION;
  planId: string;
  createdAt: string;
  environment: string;
  projectId: string;
  rootFolderId: string;
  sourceFolderId: string;
  targetFolderId: string;
  rootClaim: RootClaimFence;
  ops: TreeMergeOp[];
  /** planで「参照するclaimが無い」ことを確認した統合元ツリーのフォルダID(再親付けサブツリーの子孫を含む)。executeが同じ集合で再検査する。 */
  claimCheckFolderIds: string[];
  blockers: TreeMergeBlocker[];
  summary: FolderTreeMergeSummary;
  googleapisLockfileVersion?: string;
  lockfileHash?: string;
}

export interface FolderTreeMergeApproval {
  planId: string;
  expectedFileMoves: number;
  expectedFolderMoves: number;
  expectedFolderTrashes: number;
}

export type TreeMergeOpStatus = 'applied' | 'skipped-already-applied' | 'applied-after-error' | 'failed';

export interface TreeMergeManifestEntry {
  opId: string;
  kind: TreeMergeOp['kind'];
  status: TreeMergeOpStatus;
  timestamp: string;
  error?: string;
}

export type FolderTreeMergeStatus =
  | 'dry-run'
  | 'completed'
  | 'already-completed'
  | 'refused-blockers'
  | 'refused-approval-mismatch'
  | 'refused-plan-expired'
  | 'aborted-root-claim-changed'
  | 'aborted-drift'
  | 'aborted-op-failure'
  | 'aborted-not-empty'
  | 'aborted-source-not-trashed'
  | 'finalize-failed';

export interface FolderTreeMergeManifest {
  planId: string;
  environment: string;
  startedAt: string;
  status: FolderTreeMergeStatus | 'in-progress';
  entries: TreeMergeManifestEntry[];
  finalize: FolderTreeMergeFinalize;
}

/** ルートclaimのfinalize結果。no-opは理由が必須(型でreason無しのno-opを作れないようにする)。 */
export type FolderTreeMergeFinalize =
  | { outcome: 'resolved' }
  | { outcome: 'no-op'; reason: string }
  | { outcome: 'not-attempted' };

/** CLIの終了コード。Recordにすることで、新しいstatusを足した際の割当漏れをコンパイルで検知する。 */
export const FOLDER_TREE_MERGE_EXIT_CODE: Record<FolderTreeMergeStatus, 0 | 3> = {
  'dry-run': 0,
  completed: 0,
  'already-completed': 0,
  'refused-blockers': 3,
  'refused-approval-mismatch': 3,
  'refused-plan-expired': 3,
  'aborted-root-claim-changed': 3,
  'aborted-drift': 3,
  'aborted-op-failure': 3,
  'aborted-not-empty': 3,
  'aborted-source-not-trashed': 3,
  'finalize-failed': 3,
};

/** ルートclaim(driveFolderLocks)のstate。functions側の`ClaimState`+読取不能時の'unknown'。 */
export type RootClaimState = 'creating' | 'resolved' | 'invalidated' | 'divergent' | 'unknown';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * JSONから読んだplanの形を検証する(承認制の破壊的操作の入口)。手編集・破損したplanは、
 * 未定義のままドリフト扱いで先へ進むのではなく、ここで拒否する。エラー文言に内容は含めない(PII対策)。
 */
export function parseFolderTreeMergePlan(raw: unknown): FolderTreeMergePlan {
  const bad = (what: string): never => {
    throw new Error(`invalid folder-tree-merge plan: ${what}`);
  };
  if (!isObj(raw)) return bad('not-an-object');
  if (raw.schemaVersion !== FOLDER_TREE_MERGE_PLAN_SCHEMA_VERSION) return bad('schemaVersion');
  for (const k of ['planId', 'createdAt', 'environment', 'projectId', 'rootFolderId', 'sourceFolderId', 'targetFolderId']) {
    if (!isStr(raw[k])) bad(k);
  }
  const rc = raw.rootClaim;
  if (!isObj(rc) || !isStr(rc.folderId) || !isStr(rc.divergentReason) || typeof rc.updateTimeMs !== 'number') bad('rootClaim');
  if (!Array.isArray(raw.claimCheckFolderIds) || !raw.claimCheckFolderIds.every(isStr)) bad('claimCheckFolderIds');
  if (!Array.isArray(raw.blockers) || !raw.blockers.every((b) => isObj(b) && isStr(b.code))) bad('blockers');
  const sm = raw.summary;
  if (!isObj(sm) || !['fileMoves', 'folderMoves', 'folderTrashes', 'sameNameFileCount', 'visitedSourceFolderCount'].every((k) => isCount(sm[k]))) {
    bad('summary');
  }
  if (!Array.isArray(raw.ops)) return bad('ops');
  for (const op of raw.ops) {
    if (!isObj(op) || !isStr(op.opId)) return bad('op');
    if (op.kind === 'move-file') {
      if (![op.fileId, op.fromParentId, op.toParentId].every(isStr)) bad('move-file');
    } else if (op.kind === 'move-folder') {
      if (![op.folderId, op.fromParentId, op.toParentId].every(isStr)) bad('move-folder');
    } else if (op.kind === 'trash-folder') {
      if (![op.folderId, op.parentId].every(isStr)) bad('trash-folder');
    } else {
      bad('op.kind');
    }
  }
  const plan = raw as unknown as FolderTreeMergePlan;
  const count = (k: TreeMergeOp['kind']): number => plan.ops.filter((o) => o.kind === k).length;
  if (
    count('move-file') !== plan.summary.fileMoves ||
    count('move-folder') !== plan.summary.folderMoves ||
    count('trash-folder') !== plan.summary.folderTrashes
  ) {
    bad('summary-ops-mismatch');
  }
  return plan;
}

/** JSONから読んだ承認の形を検証する。 */
export function parseFolderTreeMergeApproval(raw: unknown): FolderTreeMergeApproval {
  if (
    !isObj(raw) ||
    !isStr(raw.planId) ||
    !isCount(raw.expectedFileMoves) ||
    !isCount(raw.expectedFolderMoves) ||
    !isCount(raw.expectedFolderTrashes)
  ) {
    throw new Error('invalid folder-tree-merge approval');
  }
  return raw as unknown as FolderTreeMergeApproval;
}

/** 承認JSONがplanの件数と一致するか。 */
export function approvalMatchesPlan(plan: FolderTreeMergePlan, approval: FolderTreeMergeApproval): boolean {
  return (
    approval.planId === plan.planId &&
    approval.expectedFileMoves === plan.summary.fileMoves &&
    approval.expectedFolderMoves === plan.summary.folderMoves &&
    approval.expectedFolderTrashes === plan.summary.folderTrashes
  );
}
