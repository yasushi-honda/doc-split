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
  if (!ts || !ts.seconds) return undefined;

  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}
