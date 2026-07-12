/**
 * ocrRunGuard.ts の純粋関数テスト (Issue #540)
 *
 * evaluateOcrRunOwnership の全分岐・判定優先順位(ocrRunId→status→fileUrl→mimeType)と
 * OcrRunSupersededError のフィールド保持を検証する。
 */

import { expect } from 'chai';
import {
  evaluateOcrRunOwnership,
  OcrRunSupersededError,
  applySupersededOutcome,
  type OcrRunExpectation,
  type OcrRunSupersededStats,
} from '../src/ocr/ocrRunGuard';

function makeStats(overrides: Partial<OcrRunSupersededStats> = {}): OcrRunSupersededStats {
  return {
    pagesProcessed: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalThinkingTokens: 0,
    superseded: 0,
    ...overrides,
  };
}

describe('ocrRunGuard', () => {
  const expected: OcrRunExpectation = {
    ocrRunId: 'run-a',
    fileUrl: 'gs://bucket/a.pdf',
    mimeType: 'application/pdf',
  };

  const matchingFresh = {
    status: 'processing',
    ocrRunId: 'run-a',
    fileUrl: 'gs://bucket/a.pdf',
    mimeType: 'application/pdf',
  };

  describe('evaluateOcrRunOwnership: 正常系', () => {
    it('ocrRunId/status/fileUrl/mimeTypeが全て一致する場合 ok:true を返す', () => {
      const result = evaluateOcrRunOwnership(matchingFresh, expected);
      expect(result).to.deep.equal({ ok: true });
    });
  });

  describe('evaluateOcrRunOwnership: 単独不一致', () => {
    it('ocrRunIdのみ不一致 → run-id-mismatch', () => {
      const fresh = { ...matchingFresh, ocrRunId: 'run-b' };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'run-id-mismatch' });
    });

    it('ocrRunIdがundefined(未書込み) → run-id-mismatch', () => {
      const fresh = { ...matchingFresh, ocrRunId: undefined };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'run-id-mismatch' });
    });

    it('statusがprocessing以外(pending) → status-mismatch', () => {
      const fresh = { ...matchingFresh, status: 'pending' };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'status-mismatch' });
    });

    it('statusがprocessing以外(processed) → status-mismatch', () => {
      const fresh = { ...matchingFresh, status: 'processed' };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'status-mismatch' });
    });

    it('statusがprocessing以外(error) → status-mismatch', () => {
      const fresh = { ...matchingFresh, status: 'error' };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'status-mismatch' });
    });

    it('fileUrlのみ不一致 → file-url-drift', () => {
      const fresh = { ...matchingFresh, fileUrl: 'gs://bucket/b.pdf' };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'file-url-drift' });
    });

    it('mimeTypeのみ不一致 → mime-type-drift', () => {
      const fresh = { ...matchingFresh, mimeType: 'image/png' };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'mime-type-drift' });
    });
  });

  describe('evaluateOcrRunOwnership: 判定優先順位 (複数不一致が重なる場合)', () => {
    it('ocrRunId不一致 + status不一致 → run-id-mismatchが優先される', () => {
      const fresh = { ...matchingFresh, ocrRunId: 'run-b', status: 'pending' };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'run-id-mismatch' });
    });

    it('status不一致 + fileUrl不一致(ocrRunId一致) → status-mismatchが優先される', () => {
      const fresh = { ...matchingFresh, status: 'pending', fileUrl: 'gs://bucket/b.pdf' };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'status-mismatch' });
    });

    it('fileUrl不一致 + mimeType不一致(ocrRunId/status一致) → file-url-driftが優先される', () => {
      const fresh = {
        ...matchingFresh,
        fileUrl: 'gs://bucket/b.pdf',
        mimeType: 'image/png',
      };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'file-url-drift' });
    });

    it('全項目が不一致 → run-id-mismatchが優先される', () => {
      const fresh = {
        status: 'pending',
        ocrRunId: 'run-b',
        fileUrl: 'gs://bucket/b.pdf',
        mimeType: 'image/png',
      };
      const result = evaluateOcrRunOwnership(fresh, expected);
      expect(result).to.deep.equal({ ok: false, reason: 'run-id-mismatch' });
    });
  });

  describe('OcrRunSupersededError', () => {
    it('Errorのサブクラスであり、name/docId/reasonを保持する', () => {
      const err = new OcrRunSupersededError('superseded message', 'doc-1', 'file-url-drift');
      expect(err).to.be.instanceOf(Error);
      expect(err.name).to.equal('OcrRunSupersededError');
      expect(err.message).to.equal('superseded message');
      expect(err.docId).to.equal('doc-1');
      expect(err.reason).to.equal('file-url-drift');
      expect(err.tokenUsage).to.be.undefined;
    });

    it('tokenUsageを任意で保持できる(コスト計測の受け渡し用)', () => {
      const tokenUsage = {
        inputTokens: 100,
        outputTokens: 200,
        thinkingTokens: 10,
        pagesProcessed: 3,
      };
      const err = new OcrRunSupersededError('superseded', 'doc-2', 'run-id-mismatch', tokenUsage);
      expect(err.tokenUsage).to.deep.equal(tokenUsage);
    });

    it('instanceof判定でcatch節から他のErrorと区別できる', () => {
      const errors: Error[] = [
        new Error('generic error'),
        new OcrRunSupersededError('superseded', 'doc-3', 'status-mismatch'),
      ];
      const supersededCount = errors.filter((e) => e instanceof OcrRunSupersededError).length;
      expect(supersededCount).to.equal(1);
    });
  });

  describe('applySupersededOutcome (processOCR.ts superseded配線、/review-pr指摘)', () => {
    it('tokenUsageがある場合、statsのpages/token各フィールドに加算しsupersededを増やす', () => {
      const stats = makeStats({ pagesProcessed: 5, totalInputTokens: 100 });

      applySupersededOutcome(stats, {
        tokenUsage: { inputTokens: 200, outputTokens: 50, thinkingTokens: 10, pagesProcessed: 3 },
      });

      expect(stats.superseded).to.equal(1);
      expect(stats.pagesProcessed).to.equal(8);
      expect(stats.totalInputTokens).to.equal(300);
      expect(stats.totalOutputTokens).to.equal(50);
      expect(stats.totalThinkingTokens).to.equal(10);
    });

    it('tokenUsageが無い場合、supersededのみ増やしpages/token各フィールドは変更しない', () => {
      const stats = makeStats({ pagesProcessed: 5, totalInputTokens: 100 });

      applySupersededOutcome(stats, {});

      expect(stats.superseded).to.equal(1);
      expect(stats.pagesProcessed).to.equal(5);
      expect(stats.totalInputTokens).to.equal(100);
    });

    it('複数回呼び出すとsupersededと各tokenフィールドが累積する', () => {
      const stats = makeStats();

      applySupersededOutcome(stats, {
        tokenUsage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 1, pagesProcessed: 2 },
      });
      applySupersededOutcome(stats, {
        tokenUsage: { inputTokens: 20, outputTokens: 10, thinkingTokens: 2, pagesProcessed: 3 },
      });

      expect(stats.superseded).to.equal(2);
      expect(stats.pagesProcessed).to.equal(5);
      expect(stats.totalInputTokens).to.equal(30);
      expect(stats.totalOutputTokens).to.equal(15);
      expect(stats.totalThinkingTokens).to.equal(3);
    });
  });
});
