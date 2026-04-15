/**
 * OCRページテキスト長さ制限ユーティリティ (Issue #205)
 *
 * 背景: Vertex AI Geminiのハルシネーション/暴走による異常に長い応答（実害事例: 1.1M chars）が
 * Firestoreの per-field 1 MiB 制限を超え INVALID_ARGUMENT を引き起こす問題への防御。
 *
 * 二段防御:
 * 1. per-page cap (capPageText): 各ページ単独で MAX_PAGE_TEXT_LENGTH に切り詰め
 * 2. aggregate cap (capPageResultsAggregate): 全ページ合計で MAX_AGGREGATE_PAGE_CHARS に切り詰め
 */

export const MAX_PAGE_TEXT_LENGTH = 50_000;

// 200K chars × 3 bytes/char (UTF-8 Japanese) ≈ 600KB。Firestore 1 MiB制限内に余裕を残す。
export const MAX_AGGREGATE_PAGE_CHARS = 200_000;

const TRUNCATION_MARKER = '\n[TRUNCATED]';

export interface CappedText {
  text: string;
  originalLength: number;
  truncated: boolean;
}

export function capPageText(rawText: string, maxLength: number = MAX_PAGE_TEXT_LENGTH): CappedText {
  const originalLength = rawText.length;
  if (originalLength <= maxLength) {
    return { text: rawText, originalLength, truncated: false };
  }
  const sliceLen = Math.max(0, maxLength - TRUNCATION_MARKER.length);
  const truncatedText = sliceLen === 0 ? '' : rawText.slice(0, sliceLen) + TRUNCATION_MARKER;
  return {
    text: truncatedText.slice(0, maxLength),
    originalLength,
    truncated: true,
  };
}

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
    return {
      ...page,
      text: capped.text,
      originalLength: Math.max(original, capped.originalLength),
      truncated: page.truncated || capped.truncated,
    };
  });
}
