/**
 * Issue #1028(ADR-0028): execute-drive-sibling-merge.tsが書き込むmanifest型定義。
 *
 * 実行順序は「Drive移動完了確認→trash直前の再列挙(0件確認)→claim状態確認→claim
 * 無効化の成功件数照合→その後にapp側の空フォルダをtrash」に固定している。
 * `duplicateTrashedAt`がnullのentryは、以下いずれかの理由でtrashが未実行の状態を表す
 * (`SiblingDuplicateManifest.skipped`に理由が記録される):
 * - ファイル移動の一部が失敗した(次回再実行で再試行対象)
 * - trash直前の再列挙でduplicateフォルダが空でなかった(並行export競合の疑い)
 * - claimが'resolved'以外(divergent/creating等)のため、claim無効化を経ずには
 *   trashできない(先にexecute-drive-claim-resyncでの解消が必要)
 * いずれのケースも、既に移動済みのファイル(`movedFileIds`)はそのまま維持され、
 * duplicateフォルダ自体は現存する。再実行時は同一スクリプトが上記チェックを
 * やり直すため、専用のrollbackスクリプトは設けていない。
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
