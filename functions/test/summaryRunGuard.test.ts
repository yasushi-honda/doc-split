/**
 * summaryRunGuard.ts の純粋関数テスト (ADR-0027 PR4)
 *
 * evaluateSummaryRunOwnership の全分岐・判定優先順位、classifySummaryFailure の
 * SarashinaSummaryError優先判定、decideOcrCompletionSummaryState のバックフィル防止判定、
 * 派生定数の不変条件を検証する。
 */

import { expect } from 'chai';
import {
  evaluateSummaryRunOwnership,
  SummarySupersededError,
  classifySummaryFailure,
  decideOcrCompletionSummaryState,
  MAX_SUMMARY_ATTEMPTS,
  SUMMARY_BATCH_TIMEOUT_SECONDS,
  SUMMARY_BATCH_SOFT_DEADLINE_MS,
  SUMMARY_STUCK_THRESHOLD_MS,
  type SummaryRunExpectation,
} from '../src/ocr/summaryRunGuard';
import { SarashinaSummaryError } from '../src/ocr/sarashinaSummaryClient';
import { SummaryBlockedError } from '../src/ocr/summaryErrorClassification';
import { SARASHINA_SUMMARY_CONFIG } from '../src/utils/config';

describe('summaryRunGuard', () => {
  describe('evaluateSummaryRunOwnership', () => {
    const expected: SummaryRunExpectation = { summaryRunId: 'run-a', ocrRunId: 'ocr-a' };
    const matchingFresh = { summaryState: 'processing', summaryRunId: 'run-a', ocrRunId: 'ocr-a' };

    it('全フィールド一致でok:trueを返す', () => {
      expect(evaluateSummaryRunOwnership(matchingFresh, expected)).to.deep.equal({ ok: true });
    });

    it('summaryRunId不一致を最優先で検出する(他が一致していても)', () => {
      const fresh = { ...matchingFresh, summaryRunId: 'run-b', ocrRunId: 'ocr-mismatch' };
      expect(evaluateSummaryRunOwnership(fresh, expected)).to.deep.equal({
        ok: false,
        reason: 'run-id-mismatch',
      });
    });

    it('summaryRunId一致・state不一致でstate-mismatchを返す', () => {
      const fresh = { ...matchingFresh, summaryState: 'done' };
      expect(evaluateSummaryRunOwnership(fresh, expected)).to.deep.equal({
        ok: false,
        reason: 'state-mismatch',
      });
    });

    it('runId・state一致・ocrRunId不一致でocr-generation-driftを返す(reprocess検出)', () => {
      const fresh = { ...matchingFresh, ocrRunId: 'ocr-new' };
      expect(evaluateSummaryRunOwnership(fresh, expected)).to.deep.equal({
        ok: false,
        reason: 'ocr-generation-drift',
      });
    });

    it('expected.ocrRunIdがnullの場合(手動claim等)、fresh側もnull/undefinedなら一致とみなす', () => {
      const expectedNoOcr: SummaryRunExpectation = { summaryRunId: 'run-a', ocrRunId: null };
      const fresh = { summaryState: 'processing', summaryRunId: 'run-a', ocrRunId: null };
      expect(evaluateSummaryRunOwnership(fresh, expectedNoOcr)).to.deep.equal({ ok: true });
    });
  });

  describe('SummarySupersededError', () => {
    it('docId/reasonを保持しname="SummarySupersededError"を持つ', () => {
      const err = new SummarySupersededError('msg', 'doc-1', 'run-id-mismatch');
      expect(err.name).to.equal('SummarySupersededError');
      expect(err.docId).to.equal('doc-1');
      expect(err.reason).to.equal('run-id-mismatch');
      expect(err).to.be.instanceOf(Error);
    });
  });

  describe('classifySummaryFailure', () => {
    it('SarashinaSummaryError(timeout)はleave-processing-stop-batch', () => {
      const err = new SarashinaSummaryError('timeout', 'timeout');
      expect(classifySummaryFailure(err)).to.deep.equal({ action: 'leave-processing-stop-batch' });
    });

    it('SarashinaSummaryError(config)はabort-batch-config', () => {
      const err = new SarashinaSummaryError('bad url', 'config');
      expect(classifySummaryFailure(err)).to.deep.equal({ action: 'abort-batch-config' });
    });

    it('SarashinaSummaryError(transient)はretry-or-error/transient、stopBatch:true', () => {
      const err = new SarashinaSummaryError('503', 'transient');
      expect(classifySummaryFailure(err)).to.deep.equal({
        action: 'retry-or-error',
        kind: 'transient',
        stopBatch: true,
      });
    });

    it('SarashinaSummaryError(permanent/incomplete/contextExceeded)はerror/unknown', () => {
      for (const kind of ['permanent', 'incomplete', 'contextExceeded'] as const) {
        const err = new SarashinaSummaryError('x', kind);
        expect(classifySummaryFailure(err)).to.deep.equal({ action: 'error', kind: 'unknown' });
      }
    });

    it('SarashinaSummaryErrorではないエラーはclassifySummaryErrorへフォールバックする(quota)', () => {
      const err = Object.assign(new Error('429'), { code: 429 });
      expect(classifySummaryFailure(err)).to.deep.equal({
        action: 'retry-or-error',
        kind: 'quota',
        stopBatch: false,
      });
    });

    it('SummaryBlockedErrorはerror/blocked', () => {
      const err = new SummaryBlockedError({});
      expect(classifySummaryFailure(err)).to.deep.equal({ action: 'error', kind: 'blocked' });
    });

    it('未知のエラーはerror/unknown', () => {
      expect(classifySummaryFailure(new Error('mystery'))).to.deep.equal({
        action: 'error',
        kind: 'unknown',
      });
    });
  });

  describe('decideOcrCompletionSummaryState', () => {
    it('L1=noneはフィールド不在(absent)を返す(バックフィル防止の中核、autoEnabledに関わらない)', () => {
      expect(decideOcrCompletionSummaryState('none', 5000, true)).to.deep.equal({ kind: 'absent' });
      expect(decideOcrCompletionSummaryState('none', 5000, false)).to.deep.equal({ kind: 'absent' });
    });

    it('autoEnabled=false(既定、手動のみ運用)は、L1が有効でもフィールド不在(absent)を返し、pendingを書かない(PR-C)', () => {
      expect(decideOcrCompletionSummaryState('sarashina', 5000, false)).to.deep.equal({ kind: 'absent' });
      expect(decideOcrCompletionSummaryState('gemini', 5000, false)).to.deep.equal({ kind: 'absent' });
      expect(decideOcrCompletionSummaryState('sarashina', 50, false)).to.deep.equal({ kind: 'absent' });
    });

    it('autoEnabled=trueかつL1=sarashinaかつOCR結果が十分長ければpendingを返す', () => {
      expect(decideOcrCompletionSummaryState('sarashina', 5000, true)).to.deep.equal({
        kind: 'set',
        state: 'pending',
      });
    });

    it('autoEnabled=trueかつL1=geminiかつOCR結果が短ければskippedを返す', () => {
      expect(decideOcrCompletionSummaryState('gemini', 50, true)).to.deep.equal({
        kind: 'set',
        state: 'skipped',
      });
    });

    it('境界値: MIN_OCR_LENGTH_FOR_SUMMARY-1文字はskipped、ちょうどはpending(autoEnabled=true)', () => {
      // MIN_OCR_LENGTH_FOR_SUMMARY = 100 (summaryPromptBuilder.ts)
      expect(decideOcrCompletionSummaryState('sarashina', 99, true)).to.deep.equal({
        kind: 'set',
        state: 'skipped',
      });
      expect(decideOcrCompletionSummaryState('sarashina', 100, true)).to.deep.equal({
        kind: 'set',
        state: 'pending',
      });
    });
  });

  describe('派生定数の不変条件', () => {
    it('SUMMARY_STUCK_THRESHOLD_MSは関数タイムアウトより大きい(processOCRのSTUCK_PROCESSING_THRESHOLD_MSと同型の不変条件)', () => {
      expect(SUMMARY_STUCK_THRESHOLD_MS).to.be.greaterThan(SUMMARY_BATCH_TIMEOUT_SECONDS * 1000);
    });

    it('SUMMARY_BATCH_SOFT_DEADLINE_MSはSarashina最大リクエスト時間を差し引いてもプラスかつ関数タイムアウト未満', () => {
      expect(SUMMARY_BATCH_SOFT_DEADLINE_MS).to.be.greaterThan(0);
      expect(SUMMARY_BATCH_SOFT_DEADLINE_MS).to.be.lessThan(SUMMARY_BATCH_TIMEOUT_SECONDS * 1000);
      expect(SUMMARY_BATCH_SOFT_DEADLINE_MS + SARASHINA_SUMMARY_CONFIG.requestTimeoutMs).to.be.lessThan(
        SUMMARY_BATCH_TIMEOUT_SECONDS * 1000
      );
    });

    it('SUMMARY_BATCH_SOFT_DEADLINE_MSはcontext-exceeded再送(最大2リクエスト分)を含めても関数タイムアウトを超えない(codex review P1指摘の回帰防止)', () => {
      // callSarashinaWithContextRetry(summaryPass.ts)はcontextExceeded時に1回だけ
      // 追加リクエストする。ソフトデッドライン直前にclaimした文書がこの2回目のリクエストの
      // 途中で関数タイムアウト(1800s)を超えてハードキルされないことを保証する。
      expect(
        SUMMARY_BATCH_SOFT_DEADLINE_MS + SARASHINA_SUMMARY_CONFIG.requestTimeoutMs * 2
      ).to.be.lessThan(SUMMARY_BATCH_TIMEOUT_SECONDS * 1000);
    });

    it('SUMMARY_BATCH_SOFT_DEADLINE_MSは手動依頼の待ち時間を抑えるため短い(120秒、PR-C)', () => {
      // 手動依頼は実行中のtickの終了を待つ。tickの長さの上限は「この値 + 1件分」になる。
      expect(SUMMARY_BATCH_SOFT_DEADLINE_MS).to.be.at.most(180_000);
    });

    it('MAX_SUMMARY_ATTEMPTSは1以上の整数', () => {
      expect(MAX_SUMMARY_ATTEMPTS).to.be.a('number').greaterThan(0);
      expect(Number.isInteger(MAX_SUMMARY_ATTEMPTS)).to.equal(true);
    });
  });
});
