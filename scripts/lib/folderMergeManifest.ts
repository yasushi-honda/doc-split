/**
 * Issue #811 Phase B: execute-drive-folder-merge.ts が書き込むmanifest型定義。
 * rollback-drive-folder-merge.ts がこのmanifestを読み、逆操作を行う。
 *
 * Google Driveのmove/rename/untrashは全て単一APIコールでアトミック・可逆なため
 * (PDF/Storage版のcopy→update→deleteのような中間状態が生じない)、file単位の完全な
 * 事前状態(旧parents・旧trashed状態・旧name)を記録すればrollbackが成立する。
 */

export interface FileMoveManifestEntry {
  operationId: string;
  docId: string;
  driveFileId: string;
  /** このファイルが元々属していたduplicateフォルダのルートID(classify時点のsourceFolderId) */
  sourceRootId: string;
  /** 移動前の親フォルダID配列(通常1件) */
  oldParents: string[];
  /** 移動前のtrashed状態 */
  oldTrashed: boolean;
  /** 移動前のname(執行時に変更はしないが、rollback時の整合性確認用に記録) */
  oldName: string;
  /** 移動先(canonical配下)のフォルダID */
  newParentId: string;
  timestamp: string;
}

export interface FolderRenameManifestEntry {
  folderId: string;
  oldName: string;
  newName: string;
  timestamp: string;
}

export interface ExecutionManifest {
  planId: string;
  environment: string;
  /** このrunで実行に成功したfile移動のみ(gate-rejected/skipped/errorは含まない) */
  fileMoves: FileMoveManifestEntry[];
  /**
   * duplicateフォルダの子が0件になったため統合済みリネームを行った記録。
   * rollbackは「そのfolderIdのfileMoves全件がrollback対象に含まれる場合のみ」
   * name復元を行う(file単位の部分rollbackでは復元しない、folderRenameManifest.ts参照)。
   */
  folderRenames: FolderRenameManifestEntry[];
}
