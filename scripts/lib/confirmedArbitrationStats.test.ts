import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pct,
  computeArbitrationLogicSummaryStats,
  computeArbitrationMatchRate,
  computeGroundingFailureRate,
  computeOverallArbitrationPass,
  type ArbitrationLogicOutcomeForSummary,
} from './confirmedArbitrationStats';

function makeOutcome(overrides: Partial<ArbitrationLogicOutcomeForSummary> = {}): ArbitrationLogicOutcomeForSummary {
  return {
    success: true,
    inputTokens: 100,
    outputTokens: 50,
    thinkingTokens: 0,
    customerMatch: true,
    officeMatch: true,
    docTypeMatchReferenceOnly: true,
    groundedCandidateCount: 0,
    nonNullCandidateCount: 0,
    ...overrides,
  };
}

test('computeArbitrationLogicSummaryStats: 成功/失敗混在時、失敗文書はマッチ集計の分母から除外される', () => {
  const outcomes: ArbitrationLogicOutcomeForSummary[] = [
    makeOutcome({ customerMatch: true, officeMatch: true }),
    makeOutcome({ customerMatch: false, officeMatch: true }),
    makeOutcome({ success: false, customerMatch: false, officeMatch: false }),
  ];
  const stats = computeArbitrationLogicSummaryStats({ inputPer1MTokens: 1, outputPer1MTokens: 1 }, outcomes);
  assert.equal(stats.totalDocs, 3);
  assert.equal(stats.succeededDocs, 2);
  assert.equal(stats.failedDocs, 1);
  assert.equal(stats.customerPass, 1);
  assert.equal(stats.officePass, 2);
  assert.equal(stats.confirmedFieldsPass, 1);
});

test('computeArbitrationLogicSummaryStats: confirmedFieldsPassはcustomer/office両方一致の場合のみカウントする', () => {
  const outcomes: ArbitrationLogicOutcomeForSummary[] = [
    makeOutcome({ customerMatch: true, officeMatch: false }),
    makeOutcome({ customerMatch: true, officeMatch: true }),
  ];
  const stats = computeArbitrationLogicSummaryStats({ inputPer1MTokens: 1, outputPer1MTokens: 1 }, outcomes);
  assert.equal(stats.customerPass, 2);
  assert.equal(stats.officePass, 1);
  assert.equal(stats.confirmedFieldsPass, 1);
});

test('computeArbitrationLogicSummaryStats: docTypePassReferenceOnlyは参考値として集計されるがconfirmedFieldsPassには影響しない', () => {
  const outcomes: ArbitrationLogicOutcomeForSummary[] = [
    makeOutcome({ customerMatch: true, officeMatch: true, docTypeMatchReferenceOnly: false }),
  ];
  const stats = computeArbitrationLogicSummaryStats({ inputPer1MTokens: 1, outputPer1MTokens: 1 }, outcomes);
  assert.equal(stats.docTypePassReferenceOnly, 0);
  assert.equal(stats.confirmedFieldsPass, 1);
});

test('computeArbitrationMatchRate: 絶対件数ではなく一致率で比較できる(confirmedReplayStats.tsのcomputeMatchRateを再利用、過去の誤判定バグの回帰防止)', () => {
  const baselineRate = computeArbitrationMatchRate({ confirmedFieldsPass: 250, succeededDocs: 300 });
  const candidateRate = computeArbitrationMatchRate({ confirmedFieldsPass: 240, succeededDocs: 271 });
  assert.ok(candidateRate > baselineRate, 'candidateの一致率がbaselineを上回るべき');
});

test('computeArbitrationMatchRate: succeededDocsが0の場合はゼロ除算せず0を返す', () => {
  assert.equal(computeArbitrationMatchRate({ confirmedFieldsPass: 0, succeededDocs: 0 }), 0);
});

test('computeGroundingFailureRate: nonNullCandidateCountが0の場合はゼロ除算せず0を返す', () => {
  assert.equal(computeGroundingFailureRate({ groundedCandidateCount: 0, nonNullCandidateCount: 0 }), 0);
});

test('computeGroundingFailureRate: not-grounded件数の割合を返す', () => {
  const rate = computeGroundingFailureRate({ groundedCandidateCount: 18, nonNullCandidateCount: 20 });
  assert.ok(Math.abs(rate - 0.1) < 1e-9, `expected ~0.1, got ${rate}`);
});

test('computeOverallArbitrationPass: 全ゲート通過時のみtrue', () => {
  assert.equal(
    computeOverallArbitrationPass({
      regressed: false,
      baselineFailureRateExceeded: false,
      candidateFailureRateExceeded: false,
      downloadFailureRateExceeded: false,
    }),
    true
  );
});

test('computeOverallArbitrationPass: 精度劣化がなくても失敗率ゲート超過ならfalse(ヘッドライン不整合バグの回帰防止)', () => {
  assert.equal(
    computeOverallArbitrationPass({
      regressed: false,
      baselineFailureRateExceeded: false,
      candidateFailureRateExceeded: true,
      downloadFailureRateExceeded: false,
    }),
    false
  );
});

test('pct: 汎用ヘルパーがconfirmedReplayStats.tsから再輸出されている', () => {
  assert.equal(pct(1, 4), '25.0');
  assert.equal(pct(0, 0), '0.0');
});
