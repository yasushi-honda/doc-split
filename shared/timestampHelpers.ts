/**
 * Firestore Timestamp 変換ヘルパー。
 *
 * backfill (scripts) と本番 (functions/pdfOperations) で共有する純粋関数。
 * #332 で functions/src/utils/ に抽出、#334 で shared/ に昇格 (FE/BE/scripts 三者共有)。
 */

export interface TimestampLike {
  seconds: number;
  // #334: consumer (timestampToDateString) は seconds のみ使用するため optional。
  // Firestore Timestamp 本物の shape を documenting しつつ、plain object 経由の duck-type 互換性を持たせる。
  nanoseconds?: number;
  toDate?: () => Date;
}

/**
 * Firestore Timestamp（またはプレーンオブジェクト）を YYYY/MM/DD 文字列に変換
 */
export function timestampToDateString(
  ts: TimestampLike | null | undefined
): string | undefined {
  // seconds=0 (epoch 1970-01-01) を silent に missing 扱いしないため typeof で判定する (#346)。
  // NaN / Infinity は typeof 'number' を通るが Date(NaN) → "NaN/NaN/NaN" silent 誤出力になるため isFinite で排除する。
  if (!ts || typeof ts.seconds !== 'number' || !Number.isFinite(ts.seconds)) return undefined;

  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}
