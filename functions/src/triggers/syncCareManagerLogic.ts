/**
 * 顧客マスターcareManagerName変更時の同期ロジック（純粋関数）
 *
 * #173: 顧客マスターのcareManagerName変更が既存ドキュメントに反映されない
 */

interface CustomerMasterData {
  name: string;
  careManagerName?: string;
}

/**
 * before/afterのcareManagerNameを比較し、変更があるかを判定する。
 *
 * - 新規作成（before=null）でcareManagerNameありの場合はtrue
 * - 削除（after=null）の場合はfalse（ドキュメント更新不要）
 */
export function detectCareManagerChange(
  before: CustomerMasterData | null,
  after: CustomerMasterData | null,
): boolean {
  if (!after) return false;
  const beforeCm = before?.careManagerName ?? undefined;
  const afterCm = after.careManagerName ?? undefined;
  return beforeCm !== afterCm;
}

/**
 * careManagerNameからFirestoreドキュメント更新データを構築する。
 */
export function buildCareManagerUpdate(
  careManagerName: string | undefined,
): { careManager: string | null; careManagerKey: string } {
  const careManager = careManagerName || null;
  return {
    careManager,
    careManagerKey: careManager || '',
  };
}
