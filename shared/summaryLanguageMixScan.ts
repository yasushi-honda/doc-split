/**
 * 要約への英単語混入スキャナ (PR-C)
 *
 * 要約(モデル出力)に、送信した原文に存在しない4文字以上の英単語が含まれていないかを検知する。
 * 日本語書類の要約に突然英語/独語が混ざる現象(ADR-0027 canary #7: 「folgerende medical
 * instructions」)への対策で、`summaryFabricationScan`(固有名詞の捏造)とは別軸。
 *
 * Firestore/Admin SDK非依存の純粋関数。frontend/functions双方から参照できる。
 * 第1段階はログのみ(誤検知率を実運用で測ってからブロック化を判断する)ため、
 * 結果は検知件数と語のリストのみを返す。語そのものはログ用でありPIIを含みうる点に注意
 * (`summaryError`等のFirestoreフィールドへは書かない)。
 */

/** 検知対象とする英単語の最小文字数。ADL・AI・BMI等の一般的な略語(3文字以下)を除外する。 */
export const LANGUAGE_MIX_MIN_WORD_LENGTH = 4;

export interface LanguageMixScanResult {
  count: number;
  /** 原文に存在しなかった語(要約中の表記のまま、重複排除・出現順)。 */
  words: string[];
}

const ASCII_WORD_PATTERN = new RegExp(`[A-Za-z]{${LANGUAGE_MIX_MIN_WORD_LENGTH},}`, 'g');

/**
 * 全角英字等をNFKCで半角へ正規化し、英字は小文字化する。
 * 要約側・原文側の両方に同じ正規化を適用して比較する。
 */
function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

export function scanSummaryForForeignWords(summary: string, sentText: string): LanguageMixScanResult {
  const normalizedSummary = summary.normalize('NFKC');
  const normalizedSent = normalize(sentText);
  const seen = new Set<string>();
  const words: string[] = [];

  for (const match of normalizedSummary.matchAll(ASCII_WORD_PATTERN)) {
    const word = match[0];
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!normalizedSent.includes(key)) words.push(word);
  }
  return { count: words.length, words };
}
