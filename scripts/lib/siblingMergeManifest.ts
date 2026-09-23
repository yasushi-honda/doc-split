/**
 * Issue #1028(ADR-0028): execute-drive-sibling-merge.tsが書き込むmanifest型定義。
 *
 * 実行順序はcodex High#5指摘対応で「Drive移動完了確認→claim無効化の成功件数照合→
 * その後にapp側の空フォルダをtrash」に固定しているため、`duplicateTrashedAt`が
 * nullのentryは「ファイル移動・claim無効化までは完了しているがtrashは未実行」の
 * 部分成功状態を表す。再実行時はduplicate folderがまだ存在し空であることを再確認し、
 * trashのみを完了させる(#811のrollback-drive-folder-merge.tsのような別スクリプトは
 * 設けず、同一スクリプトの再実行で完結させる設計)。
 */

export interface SiblingMergeManifestEntry {
  groupId: string;
  canonicalFolderId: string;
  duplicateFolderId: string;
  /** 移動に成功したfile idの一覧(部分成功時、失敗したfileは含まない)。 */
  movedFileIds: string[];
  /** 移動を試みたが失敗したfileの記録(権限エラー・404等)。1件でもあればtrashは実行しない。 */
  failedFileMoves: Array<{ fileId: string; error: string }>;
  /** invalidateResolvedClaimByFolderId()の戻り値(無効化に成功したclaim件数)。 */
  claimInvalidatedCount: number;
  /** trash実行時刻。ファイル移動・claim無効化が未完了の間はnull。 */
  duplicateTrashedAt: string | null;
  timestamp: string;
}

export interface SiblingMergeManifest {
  planId: string;
  environment: string;
  entries: SiblingMergeManifestEntry[];
  /** fingerprint不一致・既に統合済み等でskipしたgroupの記録(承認画面へのフィードバック用)。 */
  skipped: Array<{ groupId: string; reason: string }>;
}
