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
// type-only import: runtime では erased されるため errorLogger.ts の top-level `admin.firestore()`
// 副作用を誘発しない。#303 fallback の stringly-typed を compile-time drift 検知に格上げする。
// `ErrorLog` 本体を import することで union 値の drift だけでなく interface shape drift (必須
// field 追加、property rename 等) も tsc エラーとして検知可能化 (PR #319 CodeRabbit Major 対応)。
// `ErrorLog.createdAt: admin.firestore.FieldValue` が透過的に引き継がれるため firebase-admin の
// type-only import は不要。
import type { ErrorLog } from './errorLogger';

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
 *
 * #297 (Codex HIGH): prod 分岐の `safeLogError` fire-and-forget は Cloud Functions handler
 * Promise 解決後の未 await async work を完了保証しない。caller が `drainSink` mutable array
 * を渡すと、`handleAggregateInvariantViolation` が Promise を push し、caller 側で
 * `await Promise.allSettled(drainSink)` による drain で flush 可能になる。
 * 未渡しの場合は従来通り fire-and-forget（既存 caller への後方互換維持）。
 *
 * #304 naming: `pendingLogs` → `drainSink` にリネーム。役割 (caller が drain 責務を負う
 * output channel) を名前から伝える (OpenTelemetry / Zod ctx.addIssue と整合)。
 *
 * #304 Option 採否:
 * - Option A (interface 分離 AggregateObservabilityContext/AggregateDrainContext):
 *   caller が 1 箇所 (ocrProcessor.ts) のみで、役割分離の型レベル強制は過剰。見送り。
 * - Option B (brand type `DrainSink = Promise<void>[] & { __mustDrain }`):
 *   grep 誤用検知は既存 contract test (textCapDrainSinkContract / ocrProcessorAggregateCallerContract)
 *   で代替可能。branded cast の caller 側コスト増に見合う恩恵なし。見送り。
 * - Option C (名称変更のみ): 採用。diff 最小 + 役割伝達。caller に drain 責務を型レベルで強制する
 *   enforcement (drainSink を渡した caller が `Promise.allSettled` で drain することの強制) は
 *   見送り、代わりに contract test 層 (textCapDrainSinkContract + ocrProcessorAggregateCallerContract)
 *   の grep-based 検証でカバーする方針を維持。本判断は caller が ocrProcessor.ts 単一で
 *   あることを前提とするため、caller が 2 箇所以上に増えた場合は Option A 再評価のトリガーとする。
 */
export interface AggregateInvariantContext {
  documentId?: string;
  drainSink?: Promise<void>[];
}

/**
 * invariant violation 検出時の dev/prod 分岐ハンドラ。
 *
 * - dev: throw で early fail (#284 契約)
 * - prod: throw せず errors collection に記録。以下 3 段階で observability を確保:
 *   1. `safeLogError` を呼び、戻り Promise を caller の drainSink に push (#297)。drainSink
 *      未渡し時は後方互換 fire-and-forget (`void logPromise`) を維持 (#288 item 6)。
 *   2. `require('./errorLogger')` が失敗した場合は `admin.firestore().collection('errors').add()`
 *      直接書込 fallback で救う (#303)。bundler regression / 初期化 race で errorLogger 経路が
 *      壊れた場合の silent 消失を防ぐ。fallback 書込 Promise も主経路と対称に drainSink に
 *      push し、caller の `Promise.allSettled(drainSink)` で Cloud Functions freeze 前の完了
 *      保証。drainSink 未渡し時のみ fire-and-forget (後方互換)。
 *   3. fallback 書込が reject した場合は `.catch((writeErr) => console.error(...))` で
 *      loader 失敗と区別できる一意タグで surface (PERMISSION_DENIED / RESOURCE_EXHAUSTED 等の
 *      operational signal を silent に落とさない)。require('firebase-admin') / admin.firestore()
 *      の同期失敗も外側 catch で console.error 出力し区別可能化 (rules/error-handling.md §1)。
 *
 * errorLogger は top-level で admin.firestore() を呼ぶため prod path に限定した
 * dynamic require で unit test (admin 未初期化) への影響を回避 (buildPageResult.ts 方針と整合)。
 * safeLogError 内部で try/catch 済み (errorLogger.ts の `safeLogError` 関数) なので reject せず処理継続。
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
      const logPromise = safeLogError({
        error: new Error(message),
        source: 'ocr',
        functionName: 'capPageResultsAggregate',
        documentId: context?.documentId,
      });
      if (context?.drainSink) {
        context.drainSink.push(logPromise);
      } else {
        // 後方互換 fallback: drainSink 未渡し caller には従来通り fire-and-forget を維持する。
        void logPromise;
      }
    } catch (loadErr) {
      // 最低限のローカルログは確実に残す (rules/error-handling.md §1:
      // "最低限のconsole.error はtry-catch外で先に実行")。以降の fallback 書込失敗でも
      // このログは残存するため、Cloud Logging alert から原因特定可能。
      console.error(
        '[textCap] failed to load errorLogger for prod invariant report:',
        loadErr,
        message,
      );
      // #303: bundler/esbuild config 変更や admin.firestore() 初期化 race で dynamic require が
      // 壊れた場合、errorLogger 経路で失われる invariant violation を errors collection に直接
      // 書込で救う fallback。二重失敗は silent swallow (rules/error-handling.md §1「状態復旧 >
      // ログ記録 > 通知」優先順位: さらに上位の fallback は不存在、プロセス継続のみ保証)。
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const admin = require('firebase-admin') as typeof import('firebase-admin');
        // schema drift 完全検知: `ErrorLog` interface (errorLogger.ts の primary schema) の shape
        // を `Omit<ErrorLog, ...> & { loaderError; documentId: string | null }` で連動 binding する。
        // - fallback では logError 側で自動採番される `id` / 解決後に付く `resolvedAt` / 発生コンテキスト
        //   の `fileId` / prod では含めない `stackTrace` / 手動解決系の `resolution`/`resolvedBy` は
        //   `Omit` で除外 (fallback 時点では取得不能)。
        // - fallback 固有の拡張 `loaderError: string` は ErrorLog に存在しない診断専用 field。
        //   将来 ErrorLog に標準化された場合 (`logError` 側でも同形式で使う) は本追加フィールドを外す。
        // - `documentId` は ErrorLog で optional string だが、Firestore が undefined を拒否するため
        //   fallback では null 正規化 (rules/error-handling.md §2)。型も override で明示する。
        // これにより ErrorLog 側で必須 field 追加 / property rename が行われた瞬間、本 annotation が
        // tsc エラーで追従を強制する (PR #319 CodeRabbit Major 対応)。
        //
        // loaderError 構造化 (#303): `String(loadErr)` は Error 以外が throw された場合に
        // `[object Object]` になる silent 情報欠損、および `FirebaseAppError.code` 等の triage
        // 重要フィールドが落ちる問題がある。name/message/code を抽出して JSON で保存する。
        // stack は production path のため含めない (errorLogger.ts の stack 保持方針と整合)。
        const loaderErrInfo =
          loadErr instanceof Error
            ? {
                name: loadErr.name,
                message: loadErr.message,
                code: (loadErr as { code?: string }).code ?? null,
              }
            : { raw: String(loadErr) };
        type FallbackErrorRecord = Omit<
          ErrorLog,
          'id' | 'resolvedAt' | 'fileId' | 'stackTrace' | 'resolution' | 'resolvedBy' | 'documentId'
        > & {
          documentId: string | null;
          loaderError: string;
        };
        const fallbackRecord: FallbackErrorRecord = {
          source: 'ocr',
          functionName: 'capPageResultsAggregate:loaderFailed',
          severity: 'critical',
          category: 'fatal',
          status: 'pending',
          errorCode: 'LOADER_FAILED',
          errorMessage: message,
          loaderError: JSON.stringify(loaderErrInfo),
          // Firestore は undefined を拒否するため null に正規化 (rules/error-handling.md §2)。
          documentId: context?.documentId ?? null,
          retryCount: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        // write Promise を drainSink に push し主経路と対称化 (#303 revisit:
        // silent-failure-hunter I2)。drainSink 未渡し caller のみ fire-and-forget。
        // write reject 時は loader 失敗と区別できる一意タグで surface することで、
        // PERMISSION_DENIED / RESOURCE_EXHAUSTED / UNAVAILABLE / INVALID_ARGUMENT 等の
        // operational signal を silent に落とさない (silent-failure-hunter C1)。
        const fallbackWritePromise: Promise<void> = admin
          .firestore()
          .collection('errors')
          .add(fallbackRecord)
          .then(() => undefined)
          .catch((writeErr: unknown) => {
            console.error(
              '[textCap] fallback errors-collection write also failed:',
              writeErr,
              { loaderError: loaderErrInfo, invariant: message, documentId: context?.documentId ?? null },
            );
          });
        if (context?.drainSink) {
          context.drainSink.push(fallbackWritePromise);
        } else {
          void fallbackWritePromise;
        }
      } catch (fallbackSetupErr) {
        // require('firebase-admin') / admin.firestore() / FieldValue の同期失敗。
        // loader 失敗とは別タグで記録することで、Cloud Logging alert 上で
        // 「loader も fallback setup も共に壊れている」状態を triage 可能化する。
        // さらなる fallback 経路は存在しないためプロセス継続のみ保証。
        console.error(
          '[textCap] fallback setup itself failed (admin load / firestore init):',
          fallbackSetupErr,
          message,
        );
      }
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
