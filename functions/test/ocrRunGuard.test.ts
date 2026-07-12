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
  type OcrRunExpectation,
} from '../src/ocr/ocrRunGuard';

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
});
