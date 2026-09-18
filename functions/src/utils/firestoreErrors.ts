/**
 * Firestoreの NOT_FOUND エラーかを判定
 *
 * 削除トリガーで対象インデックスエントリが不在のケースを冪等な削除として許容する用途や、
 * write-then-deleteレースで対象documentが既に削除された非致命的なケースを判別する用途。
 * Firebase admin SDK は SDK経由で `'not-found'` (kebab-case)、
 * gRPC 直接呼び出しは数値 `5` または `'NOT_FOUND'` (UPPER) を返すため3形式を許容する。
 */
export function isFirestoreNotFoundError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 5 || code === 'NOT_FOUND' || code === 'not-found';
}

/**
 * `@google-cloud/firestore`の`isRetryableTransactionError`が内部リトライ対象とする
 * gRPC transientコード8種のうち、**8(RESOURCE_EXHAUSTED)を除く**7種
 * (`executeDriveExport.ts`の`GRPC_TRANSIENT_CODES`は8を含む全8種、こちらは
 * 外側リトライ(`withBackoffRetry`、`../utils/retry`)専用に意図的に縮小)。
 *
 * fable-reviewセカンドオピニオン指摘(Issue #954、driveFolderClaim.ts由来): code 8は
 * SDK内部で`backoff.resetToMax()`(最大60秒程度)まで引き上げられる特別扱いのため、
 * SDK内部リトライ(最大5回)だけで既に長時間を要しうる。ここでさらに外側リトライを
 * 重ねると、ホットパスでCloud Functions timeoutに接近するリスクが無視できない。
 * 8はSDK自身が既に最大限の猶予を与えているため、外側リトライでの追加効果は薄く、
 * timeoutリスクの方が優る(decision-maker承認済み、2026-09-18)。
 *
 * 元は`driveFolderClaim.ts`のclaim書込みtransaction専用private関数だったが、
 * Issue #957で`ocrProcessor.ts`のOCR確定commit/エラーハンドリングtransactionにも
 * 同型パターンで適用するため共通化した。
 */
export const FIRESTORE_TRANSIENT_GRPC_CODES = new Set([1, 2, 4, 10, 13, 14, 16]);

export function isRetryableFirestoreError(error: unknown): boolean {
  const code = (error as { code?: number } | undefined)?.code;
  return typeof code === 'number' && FIRESTORE_TRANSIENT_GRPC_CODES.has(code);
}
