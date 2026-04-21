/**
 * Firestore Timestamp 変換ヘルパー。
 *
 * backfill と本番 (pdfOperations) の両系列で使う。
 */

export interface TimestampLike {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
}

/**
 * Firestore Timestamp（またはプレーンオブジェクト）を YYYY/MM/DD 文字列に変換
 */
export function timestampToDateString(
  ts: TimestampLike | null | undefined
): string | undefined {
  // seconds=0 (epoch 1970-01-01) を silent に missing 扱いしないため typeof で判定する (#346)
  if (!ts || typeof ts.seconds !== 'number') return undefined;

  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}
