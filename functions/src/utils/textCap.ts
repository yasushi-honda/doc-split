/**
 * テキスト長さ制限ユーティリティ (Issue #205, #209, #215, #258)
 *
 * 背景: Vertex AI Geminiのハルシネーション/暴走による異常に長い応答（実害事例: 1.1M chars）が
 * Firestoreの per-field 1 MiB 制限を超え INVALID_ARGUMENT を引き起こす問題への防御。
 *
 * 対象用途:
 * 1. per-page cap (capPageText + MAX_PAGE_TEXT_LENGTH): OCRページ単独の切り詰め
 * 2. aggregate cap (capPageResultsAggregate + MAX_AGGREGATE_PAGE_CHARS): 全ページ合計の切り詰め
 * 3. summary cap (capPageText + MAX_SUMMARY_LENGTH): AI要約の切り詰め (#215 で統合)
 *
 * Issue #258: 旧 `CappedText` 型は shared `SummaryField` と構造的同型だったため統合。
 * single source of truth = shared/types.ts の SummaryField。
 */

import type { SummaryField } from '../../../shared/types';

export const MAX_PAGE_TEXT_LENGTH = 50_000;

// 200K chars × 3 bytes/char (UTF-8 Japanese) ≈ 600KB。Firestore 1 MiB制限内に余裕を残す。
export const MAX_AGGREGATE_PAGE_CHARS = 200_000;

// summary は1書類あたり1フィールドのみ。30K chars × 3 bytes/char ≈ 90KB で1 MiB制限に十分余裕。
// (Issue #209) Vertex AI 暴走で summary が1.1M chars 等を返した場合の Firestore INVALID_ARGUMENT 防御。
export const MAX_SUMMARY_LENGTH = 30_000;

const TRUNCATION_MARKER = '\n[TRUNCATED]';

export function capPageText(rawText: string, maxLength: number = MAX_PAGE_TEXT_LENGTH): SummaryField {
  const originalLength = rawText.length;
  if (originalLength <= maxLength) {
    return { text: rawText, truncated: false };
  }
  const sliceLen = Math.max(0, maxLength - TRUNCATION_MARKER.length);
  const truncatedText = sliceLen === 0 ? '' : rawText.slice(0, sliceLen) + TRUNCATION_MARKER;
  const cappedText = truncatedText.slice(0, maxLength);

  // Issue #258 dev-assert: production では no-op、dev で originalLength > cappedText.length の不変条件を verify。
  if (process.env.NODE_ENV !== 'production' && originalLength <= cappedText.length) {
    throw new Error(
      `capPageText invariant violation: originalLength (${originalLength}) <= cappedText.length (${cappedText.length})`,
    );
  }

  return {
    text: cappedText,
    truncated: true,
    originalLength,
  };
}

// #258 follow-up (Issue #264): capPageResultsAggregate の generic 内部は flat optional `PageWithText`
// 制約のままで、戻り値も flat fields を生成している。新 PageOcrResult (discriminated union) を input にしても
// structural compatibility で tsc は通るが、runtime には truncated=false でも originalLength が同居する可能性がある。
// 機能的には Firestore 書込時に問題なし (旧型と同形式)。型レベル厳格化は #264 で対応:
// - Option A (推奨): capPageResultsAggregate を `<T extends SummaryField>` 化 + 戻り値で originalLength を明示 strip
// - Option B: ocrProcessor 専用 helper として specialize し、generic を捨てる
interface PageWithText {
  text: string;
  originalLength?: number;
  truncated?: boolean;
}

export function capPageResultsAggregate<T extends PageWithText>(pages: T[]): T[] {
  let runningTotal = 0;
  return pages.map((page) => {
    const remaining = Math.max(0, MAX_AGGREGATE_PAGE_CHARS - runningTotal);
    const perPageBudget = Math.min(MAX_PAGE_TEXT_LENGTH, remaining);

    if (page.text.length <= perPageBudget && !page.truncated) {
      runningTotal += page.text.length;
      return page;
    }

    const original = page.originalLength ?? page.text.length;
    const capped = capPageText(page.text, perPageBudget);
    runningTotal += capped.text.length;
    const cappedOriginalLength = capped.truncated ? capped.originalLength : page.text.length;
    return {
      ...page,
      text: capped.text,
      originalLength: Math.max(original, cappedOriginalLength),
      truncated: page.truncated || capped.truncated,
    };
  });
}
