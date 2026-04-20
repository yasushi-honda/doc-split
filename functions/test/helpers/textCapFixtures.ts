/**
 * textCap / OCR invariant test 用 fixture helper
 * (Issue #307, PR #305 /simplify Quality #7 + code-reviewer Suggestions follow-up)
 *
 * `as unknown as SummaryField` cast は、Firestore 旧データ由来の discriminated union
 * 違反 (#209 型, originalLength が valid page に混入) を test 側で再現するための意図的な
 * bypass。cast が 9 箇所 (textCap.test.ts 8 + ocrAggregateCallerPattern.runtime.test.ts 1)
 * に点在していたため、将来 cast 形状変更時 (例: `as never as ...`) の blast radius を
 * 局所化する目的で集約した。
 *
 * cast を使う理由は SummaryField が `{ text, truncated: true, originalLength }` と
 * `{ text, truncated: false }` の 2 ケース union で、invalid (`truncated: false` なのに
 * `originalLength` 付き) を直接組み立てられないため。本 helper 内 1 箇所の cast のみが
 * SummaryField signature 変更時の touch 対象となる。
 *
 * 詳細な位置づけは docs/context/test-strategy.md (#308) を参照。
 */

import type { SummaryField } from '../../../shared/types';

/**
 * invariant 違反 page (discriminated union 違反: `truncated:false` なのに `originalLength` 付き) を生成。
 *
 * Firestore 旧データ相当。`assertAggregatePageInvariant` の検出対象となる形状。
 *
 * @param originalLength - 違反を示すフィールド値 (通常は invariant に引っかかる正の数)
 * @param text - page 本文 (識別用、デフォルト `'invalid'`)
 */
export function makeInvalidPage(
  originalLength: number,
  text = 'invalid',
): SummaryField {
  return {
    text,
    truncated: false,
    originalLength,
  } as unknown as SummaryField;
}

/**
 * mixed-input fixture: `[valid, invalid, valid, invalid, ...]` の順で交互生成。
 *
 * `originalLengths` 要素数分 invalid を差し込み、両端と間に valid を挿入する。
 * #294 mixed-input invariant test / #297 pendingLogs drain test 等の caller wrapper
 * 再現シナリオで使用。
 *
 * @param originalLengths - invalid page の originalLength 一覧 (デフォルト `[999]`)
 */
export function makeMixedPages(originalLengths: number[] = [999]): SummaryField[] {
  const pages: SummaryField[] = [{ text: 'valid1', truncated: false }];
  originalLengths.forEach((len, i) => {
    pages.push(makeInvalidPage(len, `invalid${i + 1}`));
    pages.push({ text: `valid${i + 2}`, truncated: false });
  });
  return pages;
}
