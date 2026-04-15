/**
 * 検索インデックス関連のエラー判定ユーティリティ
 *
 * Issue #219: silent failure 防止のためのエラー分類
 */

/**
 * Firestoreの NOT_FOUND エラーかを判定 (gRPC code 5)
 *
 * removeTokensFromIndex でドキュメント不在は正常系として無視するが、
 * それ以外のエラーは握潰さず明示的にログを残す必要がある。
 */
export function isFirestoreNotFoundError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 5 || code === 'NOT_FOUND';
}
