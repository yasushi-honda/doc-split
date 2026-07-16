/**
 * 配列を指定サイズのチャンクに分割する。
 *
 * search_index の db.getAll(...indexRefs) が一度に多数の参照を読み込むと
 * (Issue #217、kanameone 512MiB OOM 201件既発)、チャンク単位で逐次処理して
 * ピークメモリを抑えるために使用する。
 */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error(`chunkArray: size must be positive, got ${size}`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
