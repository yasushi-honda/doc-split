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

/**
 * SummaryField 部 (text/truncated/originalLength) を除いた meta 部のみを抽出する helper。
 * caller が追加フィールド (pageNumber/inputTokens/outputTokens 等) を持つ場合に、
 * SummaryField を再構築する際の meta 保持のため使用。
 *
 * 用途は cap path (text 再生成経路) 限定。short path (L91 `return page;`) は入力が型準拠している
 * 前提でそのまま返すため、本 helper は経由しない。型違反入力 (例: truncated=false に originalLength
 * が混入) の robustness は cap path 内でのみ担保される。
 */
function stripSummaryFields<T extends SummaryField>(
  page: T,
): Omit<T, 'text' | 'truncated' | 'originalLength'> {
  const rest = { ...page } as Record<string, unknown>;
  delete rest.text;
  delete rest.truncated;
  delete rest.originalLength;
  return rest as Omit<T, 'text' | 'truncated' | 'originalLength'>;
}

/**
 * ページ配列の合計文字数を MAX_AGGREGATE_PAGE_CHARS 以下に収めるよう切り詰める。
 *
 * #264: generic を `<T extends SummaryField>` に制約することで、caller (PageOcrResult 等) の
 * discriminated union 不変条件 (truncated=false ⟹ originalLength 不在) を型レベル + runtime で
 * 両面保証する。`stripSummaryFields` で meta 部を抽出後、truncated=false/true を明示分岐して
 * SummaryField を再構築する。
 *
 * T は `SummaryField` フル union を期待する。narrow された T (例: truncated=true 固定型) を
 * 渡すと、cap 結果が truncated=false になる経路で型契約違反になるため、caller は union 型を保つこと。
 */
export function capPageResultsAggregate<T extends SummaryField>(pages: T[]): T[] {
  let runningTotal = 0;
  return pages.map((page) => {
    const remaining = Math.max(0, MAX_AGGREGATE_PAGE_CHARS - runningTotal);
    const perPageBudget = Math.min(MAX_PAGE_TEXT_LENGTH, remaining);

    if (page.text.length <= perPageBudget && !page.truncated) {
      runningTotal += page.text.length;
      return page;
    }

    const capped = capPageText(page.text, perPageBudget);
    runningTotal += capped.text.length;

    const meta = stripSummaryFields(page);
    // input が既に truncated=true だった場合は常に truncated=true を保持する (情報保存)。
    // capped.truncated のみで分岐すると、input.truncated=true だが text が既に cap 内のケースで
    // truncated=false + originalLength 消失という regression が発生する。
    const isTruncated = page.truncated || capped.truncated;

    if (isTruncated) {
      // 再 cap 時は元の originalLength を優先保持 (idempotent + 過去情報保存)。
      // page.truncated=false の場合、text 未切り詰めなので text.length が原本の長さ。
      const originalFromPage = page.truncated ? page.originalLength : page.text.length;
      const cappedOriginal = capped.truncated ? capped.originalLength : capped.text.length;
      return {
        ...meta,
        text: capped.text,
        truncated: true,
        originalLength: Math.max(originalFromPage, cappedOriginal),
      } as T;  // T は SummaryField union を保つ前提 (JSDoc 参照)
    }
    // truncated=false ⟹ originalLength 不在 (discriminated union 不変条件)
    return {
      ...meta,
      text: capped.text,
      truncated: false,
    } as T;  // T は SummaryField union を保つ前提 (JSDoc 参照)
  });
}
