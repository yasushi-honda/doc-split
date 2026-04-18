/**
 * OCR 1 ページ分の結果 (text + token counts) を PageOcrResult に変換する。(#267)
 *
 * 本モジュールは firebase-admin / Vertex AI などの副作用を持つ依存を持たず、
 * capPageText だけを利用する pure function に限定している。これにより
 * unit test から import しても admin 初期化エラーが発生しない。
 *
 * 不変条件 (#258):
 * - truncated=true ⟹ originalLength 必須（SummaryField の discriminated union で型保証）
 * - truncated=false の場合、戻り値オブジェクトに originalLength キーは存在しない
 */

import type { SummaryField } from '../../../shared/types';
import { capPageText, MAX_PAGE_TEXT_LENGTH } from '../utils/textCap';

/**
 * ページ単位OCR結果 (Issue #258 で discriminated union 化)
 *
 * SummaryField (text/truncated/originalLength) + OCR メタ (pageNumber/inputTokens/outputTokens) の合成。
 * 不変条件: truncated=true ⟹ originalLength 必須（型レベル保証）。
 * truncated=false の場合 page.originalLength は型に存在しない（access で tsc エラー）。
 */
export type PageOcrResult = SummaryField & {
  pageNumber: number;
  inputTokens: number;
  outputTokens: number;
};

/**
 * OCR 結果 (text + token counts) を PageOcrResult に変換する。
 *
 * capPageText で per-page cap を適用し、truncated=true の場合は originalLength を伝播する
 * discriminated union shape で返す。label は truncate 時の warn ログに使用。
 */
export function buildPageResult(
  result: { text: string; inputTokens: number; outputTokens: number },
  pageNumber: number,
  label: string
): PageOcrResult {
  const capped = capPageText(result.text);
  if (capped.truncated) {
    console.warn(`[OCR] ${label} text truncated: ${capped.originalLength} → ${capped.text.length} chars (cap=${MAX_PAGE_TEXT_LENGTH})`);
  }
  // #258: `...capped` で discriminated union の不変条件 (truncated tag + originalLength) が caller に伝播。
  return {
    ...capped,
    pageNumber,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
