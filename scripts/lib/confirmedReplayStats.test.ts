import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  percentile,
  pct,
  isNonEmptyString,
  computeModelSummaryStats,
  computeMatchRate,
  computeOverallPass,
  type DocOutcomeForSummary,
} from './confirmedReplayStats';

function makeOutcome(overrides: Partial<DocOutcomeForSummary> = {}): DocOutcomeForSummary {
  return {
    success: true,
    inputTokens: 100,
    outputTokens: 50,
    thinkingTokens: 0,
    elapsedMs: 1000,
    docTypeMatch: true,
    customerMatch: true,
    officeMatch: true,
    anomalousPages: 0,
    hadRetry: false,
    ...overrides,
  };
}

test('percentile: 空配列は0を返す', () => {
  assert.equal(percentile([], 50), 0);
});

test('percentile: 単一要素はp値によらずその値を返す', () => {
  assert.equal(percentile([42], 50), 42);
  assert.equal(percentile([42], 99), 42);
});

test('percentile: p50/p95/p99の境界', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(sorted, 50), 5);
  assert.equal(percentile(sorted, 95), 10);
  assert.equal(percentile(sorted, 99), 10);
});

test('pct: totalが0の場合はゼロ除算せず"0.0"を返す', () => {
  assert.equal(pct(0, 0), '0.0');
  assert.equal(pct(5, 0), '0.0');
});

test('pct: 通常の割合計算', () => {
  assert.equal(pct(1, 4), '25.0');
});

test('isNonEmptyString: 有効な非空文字列のみtrue', () => {
  assert.equal(isNonEmptyString('a'), true);
  assert.equal(isNonEmptyString(''), false);
  assert.equal(isNonEmptyString(undefined), false);
  assert.equal(isNonEmptyString(null), false);
  assert.equal(isNonEmptyString(123), false);
});

test('computeModelSummaryStats: 成功/失敗混在時、失敗文書はマッチ集計の分母から除外される', () => {
  const outcomes: DocOutcomeForSummary[] = [
    makeOutcome({ docTypeMatch: true, customerMatch: true, officeMatch: true }),
    makeOutcome({ docTypeMatch: false, customerMatch: true, officeMatch: true }),
    makeOutcome({ success: false, docTypeMatch: false, customerMatch: false, officeMatch: false }),
  ];
  const stats = computeModelSummaryStats({ inputPer1MTokens: 1, outputPer1MTokens: 1 }, outcomes);
  assert.equal(stats.totalDocs, 3);
  assert.equal(stats.succeededDocs, 2);
  assert.equal(stats.failedDocs, 1);
  assert.equal(stats.allPass, 1);
});

test('computeMatchRate: 絶対件数ではなく一致率で比較できる(過去の誤判定バグの回帰防止)', () => {
  // baseline 300成功/250一致=83.3% vs candidate 271成功/240一致=88.6%は
  // 実質candidateの方が高精度だが、絶対件数(240<250)で比較すると誤って劣化判定していた。
  const baselineRate = computeMatchRate({ allPass: 250, succeededDocs: 300 });
  const candidateRate = computeMatchRate({ allPass: 240, succeededDocs: 271 });
  assert.ok(candidateRate > baselineRate, 'candidateの一致率がbaselineを上回るべき');
  assert.equal(candidateRate < baselineRate, false);
});

test('computeMatchRate: succeededDocsが0の場合はゼロ除算せず0を返す', () => {
  assert.equal(computeMatchRate({ allPass: 0, succeededDocs: 0 }), 0);
});

test('computeOverallPass: 全ゲート通過時のみtrue', () => {
  assert.equal(
    computeOverallPass({
      regressed: false,
      baselineFailureRateExceeded: false,
      candidateFailureRateExceeded: false,
      downloadFailureRateExceeded: false,
    }),
    true
  );
});

test('computeOverallPass: 精度劣化がなくても失敗率ゲート超過ならfalse(ヘッドライン不整合バグの回帰防止)', () => {
  // 過去、regressedのみでヘッドラインを決定していたため、失敗率ゲート超過時も
  // 「✅ PASS」と表示されてしまうバグがあった。
  assert.equal(
    computeOverallPass({
      regressed: false,
      baselineFailureRateExceeded: false,
      candidateFailureRateExceeded: true,
      downloadFailureRateExceeded: false,
    }),
    false
  );
});

test('computeOverallPass: ダウンロード失敗率ゲート超過だけでもfalse', () => {
  assert.equal(
    computeOverallPass({
      regressed: false,
      baselineFailureRateExceeded: false,
      candidateFailureRateExceeded: false,
      downloadFailureRateExceeded: true,
    }),
    false
  );
});

test('computeOverallPass: 精度劣化のみでもfalse', () => {
  assert.equal(
    computeOverallPass({
      regressed: true,
      baselineFailureRateExceeded: false,
      candidateFailureRateExceeded: false,
      downloadFailureRateExceeded: false,
    }),
    false
  );
});
