/**
 * OCR結果と期待テキストの文字単位の類似度(純粋ロジック)。
 *
 * 画像の縮小前後で読み取り精度が変わらないかを比較するために使う。golden照合の完全一致判定
 * (paddle-ocr-verify.ts)と違い、1文字の違いを「どれだけ違うか」の数値で見られるようにする。
 */

/** 空白・改行・全角空白を除去する。OCRの改行位置・空白の揺れを比較から外す。 */
export function normalizeForCompare(text: string): string {
  return text.replace(/[\s　]+/g, '');
}

function levenshtein(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * 1 - (レーベンシュタイン距離 / 長い側の文字数)。0〜1。
 * サロゲートペア(旧字体の一部など)を1文字として数えるため、コードポイント単位で比較する。
 * 両方が空なら1(比較対象なし)、片方だけ空なら0。
 */
export function charSimilarity(expected: string, actual: string): number {
  const e = Array.from(normalizeForCompare(expected));
  const a = Array.from(normalizeForCompare(actual));
  const longest = Math.max(e.length, a.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(e, a) / longest;
}
