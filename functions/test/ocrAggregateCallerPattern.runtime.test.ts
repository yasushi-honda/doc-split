/**
 * aggregate caller wrapper パターンの runtime 契約テスト (Issue #294 item 8, #293/#297 補完)
 *
 * 目的: ocrProcessor.processDocument 内の `capPageResultsAggregate` 呼出周辺パターン
 * (try/catch + pendingLogs drain + 継続保証) を admin 非依存で runtime 検証する。
 *
 * 制約: 本物の processDocument は admin.firestore() / storage.bucket() / Vertex AI に
 * 広範囲に依存するため、unit test 環境から直接呼べない。本テストは **期待される caller
 * パターン** を inline で再現し、capPageResultsAggregate との結合動作を lock-in する。
 *
 * #301 Evaluator HIGH 指摘 (AC-4/AC-5 動的 assert 不在) への部分的対応。
 * ocrProcessor 側の実装が本パターンから逸脱した場合は `ocrProcessorAggregateCallerContract.test.ts`
 * (grep 契約) で検知される。両者を組み合わせて二段防御とする。
 *
 * 完全な processDocument 統合 test は Issue #299 (ts-node/esm 環境整備 + admin mock) に委譲。
 */

import { expect } from 'chai';
import { capPageResultsAggregate } from '../src/utils/textCap';
import type { LogErrorParams } from '../src/utils/errorLogger';
import type { SummaryField } from '../../shared/types';

/**
 * test 用 invalid page fixture. truncated=false なのに originalLength が残存する
 * Firestore 旧データ相当を SummaryField 型に流すためのキャスト吸収。
 */
function makeInvalidPage(originalLength: number, text = 'invalid'): SummaryField {
  return {
    text,
    truncated: false,
    originalLength,
  } as unknown as SummaryField;
}

/**
 * mixed-input fixture. [valid, invalid, valid, invalid, ...] の順で交互生成。
 * `originalLengths` 要素数分 invalid を差し込み、両端と間に valid を挿入する。
 */
function makeMixedPages(originalLengths: number[] = [999]): SummaryField[] {
  const pages: SummaryField[] = [{ text: 'valid1', truncated: false }];
  originalLengths.forEach((len, i) => {
    pages.push(makeInvalidPage(len, `invalid${i + 1}`));
    pages.push({ text: `valid${i + 2}`, truncated: false });
  });
  return pages;
}

/**
 * caller wrapper の想定シグネチャ (test 用再現)。
 * ocrProcessor.ts:158-186 の try/catch + drain block と意味的に等価。
 * 実装の enriched message 加工 (pages/totalChars 付与) も再現する。
 */
async function aggregateWithCallerWrapper<T extends SummaryField>(
  pages: T[],
  context: { documentId: string; functionName: string },
  safeLogErrorStub: (params: LogErrorParams) => Promise<void>,
): Promise<T[]> {
  const pendingLogs: Promise<void>[] = [];
  const beforeAggregateChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  let resultPages = pages;
  try {
    resultPages = capPageResultsAggregate(pages, {
      documentId: context.documentId,
      pendingLogs,
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
  if (pendingLogs.length > 0) {
    await Promise.allSettled(pendingLogs);
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

  describe('prod 環境: caller は throw を受けず pendingLogs drain (#297)', () => {
    it('prod で invalid 混入 → safeLogError spy は catch 経由では呼ばれない (throw しないため)', async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const calls: LogErrorParams[] = [];
      const spy = async (p: LogErrorParams): Promise<void> => {
        calls.push(p);
      };
      try {
        const pages = makeMixedPages();
        const result = await aggregateWithCallerWrapper(
          pages,
          { documentId: 'doc-prod', functionName: 'processDocumentTest' },
          spy,
        );
        expect(result).to.have.length(pages.length);
        // prod は handleAggregateInvariantViolation 内で emit されるため caller catch は通らない。
        expect(calls).to.have.length(0);
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  });
});
