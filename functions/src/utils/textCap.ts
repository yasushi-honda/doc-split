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
 * 用途は cap path (text 再生成経路) 限定。short path (perPageBudget 内かつ !page.truncated の
 * early return 分岐) は入力が型準拠している前提でそのまま返すため、本 helper は経由しない。
 * cap path 内では truncated=false 経路から originalLength を確実に落とす (delete) ことで
 * discriminated union 不変条件を維持するが、値の型バリデーション (例: originalLength が number か)
 * は行わない — 入力 T が SummaryField 型契約に準拠していることを前提とする。
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
 * 戻り値 1 要素の型。caller T の meta 部 (Omit で SummaryField フィールドを除去) と
 * SummaryField union を合成したもの。#284 で `as T` cast を排除するために導入。
 */
export type CappedAggregatePage<T extends SummaryField> =
  Omit<T, 'text' | 'truncated' | 'originalLength'> & SummaryField;

/**
 * capPageResultsAggregate の observability context。
 * documentId を caller から伝搬させ、errors collection の triage を可能にする
 * (#288 item 6 + silent-failure-hunter/Codex S2 指摘対応)。
 */
export interface AggregateInvariantContext {
  documentId?: string;
}

/**
 * invariant violation 検出時の dev/prod 分岐ハンドラ。
 *
 * - dev: throw で early fail (#284 契約)
 * - prod: throw せず safeLogError fire-and-forget で errors collection に記録
 *   (#288 item 6, PR #290 silent-failure-hunter S1 対応)
 *
 * errorLogger は top-level で admin.firestore() を呼ぶため prod path に限定した
 * dynamic require で unit test (admin 未初期化) への影響を回避 (buildPageResult.ts 方針と整合)。
 * safeLogError 内部で try/catch 済み (errorLogger.ts:141-151) なので reject せず処理継続。
 */
function handleAggregateInvariantViolation(
  detail: string,
  context?: AggregateInvariantContext,
): void {
  const message = `capPageResultsAggregate invariant violation: ${detail}`;
  if (process.env.NODE_ENV === 'production') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { safeLogError } = require('./errorLogger') as typeof import('./errorLogger');
      void safeLogError({
        error: new Error(message),
        source: 'ocr',
        functionName: 'capPageResultsAggregate',
        documentId: context?.documentId,
      });
    } catch (loadErr) {
      console.error(
        '[textCap] failed to load errorLogger for prod invariant report:',
        loadErr,
        message,
      );
    }
    return;
  }
  throw new Error(message);
}

/**
 * dev-assert: capPageResultsAggregate の戻り値 1 要素が SummaryField discriminated union の
 * 不変条件を満たしているか runtime 検証する (#284 Option B)。
 *
 * - truncated は boolean / text は string
 * - truncated=true ⟹ originalLength は number
 * - truncated=false ⟹ originalLength キーが存在しない (undefined でなく絶対欠落)
 *
 * prod では `handleAggregateInvariantViolation` 経由で safeLogError emit に格上げ (#288 item 6)。
 */
function assertAggregatePageInvariant(page: unknown, context?: AggregateInvariantContext): void {
  if (typeof page !== 'object' || page === null) {
    handleAggregateInvariantViolation('not an object', context);
    return;
  }
  const record = page as Record<string, unknown>;
  const textOk = typeof record.text === 'string';
  const truncated = record.truncated;
  const truncatedOk = typeof truncated === 'boolean';
  const originalLengthOk =
    truncated === true
      ? typeof record.originalLength === 'number'
      : !('originalLength' in record);
  if (!textOk || !truncatedOk || !originalLengthOk) {
    handleAggregateInvariantViolation(
      `text=${typeof record.text} truncated=${String(truncated)} originalLengthKey=${'originalLength' in record}`,
      context,
    );
  }
}

/**
 * ページ配列の合計文字数を MAX_AGGREGATE_PAGE_CHARS 以下に収めるよう切り詰める。
 *
 * #264: generic を `<T extends SummaryField>` に制約することで、caller (RawPageOcrResult 等) の
 * discriminated union 不変条件 (truncated=false ⟹ originalLength 不在) を型レベルで強制。
 * #284: 戻り値型を `CappedAggregatePage<T>[]` = `Omit<T,...SummaryField keys> & SummaryField` に
 * 変更し、`as T` cast を排除した。narrow 型 T (truncated=true 固定等) を渡しても、戻り値は
 * SummaryField フル union に戻るため静的型が正しく mismatch を検知できる (silent 契約違反を防止)。
 * runtime では truncated=false 経路で originalLength を出力しない分岐を明示し、`assertAggregate
 * PageInvariant` で dev 環境のみ runtime 検証 (production no-op、capPageText と同パターン)。
 * `stripSummaryFields` で meta 部を抽出後、truncated=false/true を明示分岐して SummaryField
 * を再構築する。
 */
export function capPageResultsAggregate<T extends SummaryField>(
  pages: T[],
  context?: AggregateInvariantContext,
): Array<CappedAggregatePage<T>> {
  let runningTotal = 0;
  return pages.map((page) => {
    const remaining = Math.max(0, MAX_AGGREGATE_PAGE_CHARS - runningTotal);
    const perPageBudget = Math.min(MAX_PAGE_TEXT_LENGTH, remaining);

    // short path / cap path / isTruncated 再構築 の 3 分岐で計算した rebuild 結果を 1 箇所に
    // 集約し、map 末尾で 1 回だけ dev-assert を呼ぶ (分岐追加時の assert 漏れを防止、
    // evaluator MEDIUM + code-quality 指摘対応)。short path でも invariant を検証することで、
    // Firestore 旧データ由来の `originalLength` 混入 (truncated=false なのに残存) を dev 環境で
    // 早期検知できる。
    let rebuilt: CappedAggregatePage<T>;

    if (page.text.length <= perPageBudget && !page.truncated) {
      runningTotal += page.text.length;
      // short path: 入力 T が (truncated=false かつ budget 内) を満たす場合、T は structurally
      // `Omit<T, SummaryField keys> & {text, truncated:false}` → CappedAggregatePage<T> に
      // 無変換で代入可能。dev-assert は関数末尾で適用される。
      rebuilt = page;
    } else {
      const capped = capPageText(page.text, perPageBudget);
      runningTotal += capped.text.length;

      const meta = stripSummaryFields(page);
      // input が既に truncated=true だった場合は常に truncated=true を保持する (情報保存)。
      // capped.truncated のみで分岐すると、input.truncated=true だが text が既に cap 内のケースで
      // truncated=false + originalLength 消失という regression が発生する。
      const isTruncated = page.truncated || capped.truncated;

      // #283: 実テキスト長さが縮んだ時のみ per-page 粒度で警告。
      // - 新規 truncation (input truncated=false → capped truncated=true) は検知対象
      // - 既 truncated=true 入力でも aggregate budget でさらに短縮された場合は検知対象 (真の追加データロス)
      // - 同じ長さで返る idempotent 再 cap (text.length 不変) は重複アラート抑制
      // ocrProcessor 側の aggregate サマリ safeLogError (#283 Option B) と二段で観測性を確保。
      if (capped.text.length < page.text.length) {
        // #288 item 2: pageNumber を message に含めて「どのページで発動したか」を特定可能に。
        // T が pageNumber を持つ保証はない (SummaryField 自体に pageNumber なし) ため optional 読取り。
        // 欠落時は `unknown` を出力し、grep/alert の shape を pageNumber 有無で割らない。
        const pageNumber = (page as { pageNumber?: number }).pageNumber;
        const pageLabel = typeof pageNumber === 'number' ? pageNumber : 'unknown';
        console.warn(
          `[textCap] aggregate cap truncated page=${pageLabel}: ${page.text.length} → ${capped.text.length} chars (runningTotal=${runningTotal})`,
        );
      }

      if (isTruncated) {
        // 再 cap 時は元の originalLength を優先保持 (idempotent + 過去情報保存)。
        // page.truncated=false の場合、text 未切り詰めなので text.length が原本の長さ。
        const originalFromPage = page.truncated ? page.originalLength : page.text.length;
        const cappedOriginal = capped.truncated ? capped.originalLength : capped.text.length;
        rebuilt = {
          ...meta,
          text: capped.text,
          truncated: true,
          originalLength: Math.max(originalFromPage, cappedOriginal),
        };
      } else {
        // 意図的に originalLength 省略 (stripSummaryFields で除去済み、SummaryField 不変条件維持)
        rebuilt = {
          ...meta,
          text: capped.text,
          truncated: false,
        };
      }
    }

    assertAggregatePageInvariant(rebuilt, context);
    return rebuilt;
  });
}
