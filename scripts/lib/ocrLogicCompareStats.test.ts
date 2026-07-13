import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeLogicSummaryStats,
  computeLogicMatchRate,
  computeGroundingFailureRate,
  computeOverallLogicPass,
  type LogicOutcomeForSummary,
} from './ocrLogicCompareStats';

function makeOutcome(overrides: Partial<LogicOutcomeForSummary> = {}): LogicOutcomeForSummary {
  return {
    success: true,
    inputTokens: 100,
    outputTokens: 50,
    thinkingTokens: 0,
    docTypeMatch: true,
    customerMatch: true,
    officeMatch: true,
    dateMatch: true,
    groundedCandidateCount: 0,
    nonNullCandidateCount: 0,
    ...overrides,
  };
}

const PRICING = { inputPer1MTokens: 1.5, outputPer1MTokens: 9.0 };

test('computeLogicSummaryStats: 全項目一致の文書はallFourPassに含まれる', () => {
  const stats = computeLogicSummaryStats(PRICING, [makeOutcome()]);
  assert.equal(stats.totalDocs, 1);
  assert.equal(stats.succeededDocs, 1);
  assert.equal(stats.failedDocs, 0);
  assert.equal(stats.docTypePass, 1);
  assert.equal(stats.customerPass, 1);
  assert.equal(stats.officePass, 1);
  assert.equal(stats.datePass, 1);
  assert.equal(stats.allFourPass, 1);
});

test('computeLogicSummaryStats: 3項目一致+1項目不一致はallFourPassに含まれない', () => {
  const stats = computeLogicSummaryStats(PRICING, [makeOutcome({ dateMatch: false })]);
  assert.equal(stats.docTypePass, 1);
  assert.equal(stats.customerPass, 1);
  assert.equal(stats.officePass, 1);
  assert.equal(stats.datePass, 0);
  assert.equal(stats.allFourPass, 0);
});

test('computeLogicSummaryStats: success:falseの文書はfailedDocsに数えられ、各Pass集計から除外される', () => {
  const stats = computeLogicSummaryStats(PRICING, [
    makeOutcome({ success: false, docTypeMatch: false, customerMatch: false, officeMatch: false, dateMatch: false }),
  ]);
  assert.equal(stats.totalDocs, 1);
  assert.equal(stats.succeededDocs, 0);
  assert.equal(stats.failedDocs, 1);
  assert.equal(stats.allFourPass, 0);
});

test('computeLogicSummaryStats: トークン数とコストが合算される', () => {
  const stats = computeLogicSummaryStats(PRICING, [
    makeOutcome({ inputTokens: 1000, outputTokens: 200, thinkingTokens: 50 }),
    makeOutcome({ inputTokens: 2000, outputTokens: 300, thinkingTokens: 0 }),
  ]);
  assert.equal(stats.totalInput, 3000);
  assert.equal(stats.totalOutput, 500);
  assert.equal(stats.totalThinking, 50);
  const expectedCost = (3000 * PRICING.inputPer1MTokens + (500 + 50) * PRICING.outputPer1MTokens) / 1_000_000;
  assert.equal(stats.costUsd, expectedCost);
});

test('computeLogicSummaryStats: groundedCandidateCount/nonNullCandidateCountが合算される', () => {
  const stats = computeLogicSummaryStats(PRICING, [
    makeOutcome({ groundedCandidateCount: 3, nonNullCandidateCount: 4 }),
    makeOutcome({ groundedCandidateCount: 2, nonNullCandidateCount: 2 }),
  ]);
  assert.equal(stats.groundedCandidateCount, 5);
  assert.equal(stats.nonNullCandidateCount, 6);
});

test('computeLogicMatchRate: 絶対件数ではなく一致率で比較できる(succeededDocs差異の誤判定防止)', () => {
  // baseline: 10成功/8一致=80% vs candidate: 9成功/7一致=77.8% は絶対件数(7<8)ではなく
  // 一致率で比較すると baseline の方がわずかに高精度と判定できる
  const baseline = computeLogicSummaryStats(PRICING, [
    ...Array.from({ length: 8 }, () => makeOutcome()),
    ...Array.from({ length: 2 }, () => makeOutcome({ dateMatch: false })),
  ]);
  const candidate = computeLogicSummaryStats(PRICING, [
    ...Array.from({ length: 7 }, () => makeOutcome()),
    ...Array.from({ length: 2 }, () => makeOutcome({ dateMatch: false })),
    makeOutcome({ success: false, docTypeMatch: false, customerMatch: false, officeMatch: false, dateMatch: false }),
  ]);
  assert.equal(baseline.succeededDocs, 10);
  assert.equal(candidate.succeededDocs, 9);
  const baselineRate = computeLogicMatchRate(baseline);
  const candidateRate = computeLogicMatchRate(candidate);
  assert.ok(candidateRate < baselineRate);
});

test('computeLogicMatchRate: succeededDocsが0の場合はゼロ除算せず0を返す', () => {
  const stats = computeLogicSummaryStats(PRICING, [
    makeOutcome({ success: false, docTypeMatch: false, customerMatch: false, officeMatch: false, dateMatch: false }),
  ]);
  assert.equal(computeLogicMatchRate(stats), 0);
});

test('computeGroundingFailureRate: 非null候補のうちgroundingされなかった割合を返す', () => {
  const stats = computeLogicSummaryStats(PRICING, [
    makeOutcome({ groundedCandidateCount: 3, nonNullCandidateCount: 4 }),
  ]);
  assert.equal(computeGroundingFailureRate(stats), 0.25);
});

test('computeGroundingFailureRate: nonNullCandidateCountが0の場合はゼロ除算せず0を返す', () => {
  const stats = computeLogicSummaryStats(PRICING, [makeOutcome()]);
  assert.equal(computeGroundingFailureRate(stats), 0);
});

test('computeOverallLogicPass: 全ゲートPASSならtrue', () => {
  assert.equal(
    computeOverallLogicPass({
      regressed: false,
      baselineFailureRateExceeded: false,
      candidateFailureRateExceeded: false,
    }),
    true
  );
});

test('computeOverallLogicPass: regressedのみtrueでも全体はfalse', () => {
  assert.equal(
    computeOverallLogicPass({
      regressed: true,
      baselineFailureRateExceeded: false,
      candidateFailureRateExceeded: false,
    }),
    false
  );
});

test('computeOverallLogicPass: 失敗率ゲート超過のみでも全体はfalse(見た目上のPASSを防ぐ)', () => {
  assert.equal(
    computeOverallLogicPass({
      regressed: false,
      baselineFailureRateExceeded: false,
      candidateFailureRateExceeded: true,
    }),
    false
  );
});
