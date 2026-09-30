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
  | 'multi-parent'
  | 'cannot-move'
  | 'cannot-add-children'
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
  finalize: { outcome: 'resolved' | 'no-op' | 'not-attempted'; reason?: string };
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
