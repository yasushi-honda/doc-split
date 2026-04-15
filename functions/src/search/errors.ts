/**
 * Firestoreの NOT_FOUND エラーかを判定
 *
 * 削除トリガーで対象インデックスエントリが不在のケースを冪等な削除として許容する用途。
 * Firebase admin SDK は SDK経由で `'not-found'` (kebab-case)、
 * gRPC 直接呼び出しは数値 `5` または `'NOT_FOUND'` (UPPER) を返すため3形式を許容する。
 */
export function isFirestoreNotFoundError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 5 || code === 'NOT_FOUND' || code === 'not-found';
}
