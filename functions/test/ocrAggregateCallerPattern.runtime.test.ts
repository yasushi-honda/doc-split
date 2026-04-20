/**
 * aggregate caller wrapper パターンの runtime 契約テスト (Issue #294 item 8, #293/#297 補完、
 * #304 naming refactor で `pendingLogs` → `drainSink`)
 *
 * 目的: processDocument 内の `capPageResultsAggregate` 呼出周辺パターン (try/catch +
 * drainSink drain + 継続保証) を admin 非依存で runtime 検証する。
 *
 * 背景: 本物の processDocument は admin.firestore() / storage.bucket() / Vertex AI に広範囲
 * 依存するため unit test 環境から直接呼べない。本テストは期待される caller パターンを inline
 * 再現し、`ocrProcessorAggregateCallerContract.test.ts` (grep 契約) と組み合わせて二段防御
 * とする (#301 Evaluator HIGH 指摘への部分的対応)。
 *
 * 方式: runtime pattern test (docs/context/test-strategy.md §2.3 参照)。
 * 将来委譲: 完全な processDocument 統合 test は Issue #299 (ts-node/esm 環境整備 + admin mock) に委譲。
 */

import { expect } from 'chai';
import { capPageResultsAggregate } from '../src/utils/textCap';
import type { LogErrorParams } from '../src/utils/errorLogger';
import type { SummaryField } from '../../shared/types';
import { makeMixedPages } from './helpers/textCapFixtures';
import { withNodeEnvAsync } from './helpers/withNodeEnv';

/**
 * caller wrapper の想定シグネチャ (test 用最小再現、AC-4/AC-5 相当)。
 * ocrProcessor.ts:158-186 の try/catch + drain block と**主要 semantics のみ**一致:
 *   - drainSink 配列の生成と drain (#304 naming: 旧 pendingLogs → drainSink)
 *   - try/catch で dev throw を捕捉、enriched message で safeLogError 呼出
 *   - invariant/unexpected の suffix 分岐
 *
 * 実装側の `Promise.allSettled` 後の rejected 件数 console.error 監視 (ocrProcessor.ts:192-199) は
 * 本 wrapper では省略。AC-4/AC-5 検証が目的でそこまでの再現は不要 (必要なら個別 test を追加)。
 */
async function aggregateWithCallerWrapper<T extends SummaryField>(
  pages: T[],
  context: { documentId: string; functionName: string },
  safeLogErrorStub: (params: LogErrorParams) => Promise<void>,
): Promise<T[]> {
  const drainSink: Promise<void>[] = [];
  const beforeAggregateChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  let resultPages = pages;
  try {
    resultPages = capPageResultsAggregate(pages, {
      documentId: context.documentId,
      drainSink,
    }) as unknown as T[];
  } catch (err) {
    const baseError = err instanceof Error ? err : new Error(String(err));
    const isKnownInvariant = baseError.message.startsWith(
      'capPageResultsAggregate invariant violation:',
    );
    const suffix = isKnownInvariant ? 'aggregateCap:invariant' : 'aggregateCap:unexpected';
    // 実装 (ocrProcessor.ts) と同じ message 加工で drift を検知可能に。
    const enriched = new Error(
      `${baseError.message} (pages=${pages.length}, totalChars=${beforeAggregateChars})`,
    );
    if (baseError.stack) enriched.stack = baseError.stack;
    await safeLogErrorStub({
      error: enriched,
      source: 'ocr',
      functionName: `${context.functionName}:${suffix}`,
      documentId: context.documentId,
    });
  }
  if (drainSink.length > 0) {
    await Promise.allSettled(drainSink);
  }
  return resultPages;
}

describe('aggregate caller wrapper runtime pattern (#294)', () => {
  describe('dev 環境: try/catch で throw を捕捉して継続 (#293, AC-4/AC-5)', () => {
    it('invalid 要素混在で safeLogError spy が呼ばれる (AC-4 動的検証)', async () => {
      const calls: LogErrorParams[] = [];
      const spy = async (p: LogErrorParams): Promise<void> => {
        calls.push(p);
      };

      const pages = makeMixedPages();
      await aggregateWithCallerWrapper(
        pages,
        { documentId: 'doc-dev-mixed', functionName: 'processDocumentTest' },
        spy,
      );

      expect(calls).to.have.length(1);
      expect(calls[0]?.source).to.equal('ocr');
      expect(calls[0]?.documentId).to.equal('doc-dev-mixed');
      expect(calls[0]?.functionName).to.equal(
        'processDocumentTest:aggregateCap:invariant',
      );
      expect(calls[0]?.error.message).to.match(/invariant violation/);
      // enriched message に triage 文脈 (pages=N, totalChars=M) が含まれる (実装整合)。
      expect(calls[0]?.error.message).to.match(/pages=\d+, totalChars=\d+/);
    });

    it('catch 後 pageResults は input と同数を保つ (AC-5 継続保証 動的検証)', async () => {
      const spyNoop = async (): Promise<void> => {
        /* noop */
      };
      const pages = makeMixedPages();
      const result = await aggregateWithCallerWrapper(
        pages,
        { documentId: 'doc-dev-continuity', functionName: 'processDocumentTest' },
        spyNoop,
      );

      expect(result).to.have.length(pages.length);
      // pass-through = 入力参照そのまま (cap 前)
      expect(result).to.equal(pages);
    });

    it('valid のみの入力では safeLogError spy が呼ばれない (false positive 防止)', async () => {
      const calls: LogErrorParams[] = [];
      const spy = async (p: LogErrorParams): Promise<void> => {
        calls.push(p);
      };
      const pages: SummaryField[] = [
        { text: 'valid1', truncated: false },
        { text: 'valid2', truncated: false },
      ];
      await aggregateWithCallerWrapper(
        pages,
        { documentId: 'doc-all-valid', functionName: 'processDocumentTest' },
        spy,
      );
      expect(calls).to.have.length(0);
    });
  });

  describe('prod 環境: caller は throw を受けず drainSink drain (#297, #304 rename)', () => {
    it('prod で invalid 混入 → safeLogError spy は catch 経由では呼ばれない (throw しないため)', async () => {
      const calls: LogErrorParams[] = [];
      const spy = async (p: LogErrorParams): Promise<void> => {
        calls.push(p);
      };
      await withNodeEnvAsync('production', async () => {
        const pages = makeMixedPages();
        const result = await aggregateWithCallerWrapper(
          pages,
          { documentId: 'doc-prod', functionName: 'processDocumentTest' },
          spy,
        );
        expect(result).to.have.length(pages.length);
        // prod は handleAggregateInvariantViolation 内で emit されるため caller catch は通らない。
        expect(calls).to.have.length(0);
      });
    });
  });
});
