import { expect } from 'chai';
import {
  evaluateCanaryGate,
  parseLatencySeconds,
  summarizeCanaryDocs,
  summarizeRequestLatencies,
  type CanaryDocSnapshot,
} from '../../scripts/lib/sarashinaCanaryStats';

const doc = (
  state: CanaryDocSnapshot['state'],
  errorKind: CanaryDocSnapshot['errorKind'] = null
): CanaryDocSnapshot => ({ state, errorKind });

describe('summarizeCanaryDocs', () => {
  it('summaryState別に集計し、分母は取得できた文書数+不在文書数にする', () => {
    const r = summarizeCanaryDocs([doc('done'), doc('done'), doc('error', 'quota'), doc('pending')], 1);
    expect(r.denominator).to.equal(5);
    expect(r.missing).to.equal(1);
    expect(r.byState).to.deep.equal({ pending: 1, processing: 0, done: 2, error: 1, skipped: 0, none: 0 });
  });

  it('summaryStateが無い文書はnoneに数える(doneにしない)', () => {
    const r = summarizeCanaryDocs([doc(null)], 0);
    expect(r.byState.none).to.equal(1);
    expect(r.byState.done).to.equal(0);
  });

  it('捏造疑いの最終error(state=error かつ kind=fabrication_suspected)だけを数え、再試行中のpendingは数えない', () => {
    const r = summarizeCanaryDocs(
      [doc('error', 'fabrication_suspected'), doc('pending', 'fabrication_suspected'), doc('error', 'quota')],
      0
    );
    expect(r.fabricationFinalErrors).to.equal(1);
  });

  it('空配列と不在のみでも分母が正しい', () => {
    expect(summarizeCanaryDocs([], 0).denominator).to.equal(0);
    expect(summarizeCanaryDocs([], 3).denominator).to.equal(3);
  });

  it('未知のsummaryState値はnoneに倒す', () => {
    const r = summarizeCanaryDocs([doc('weird' as CanaryDocSnapshot['state'])], 0);
    expect(r.byState.none).to.equal(1);
  });
});

describe('parseLatencySeconds', () => {
  it('Cloud Runのlatency表記(秒)を数値にする', () => {
    expect(parseLatencySeconds('23.354903561s')).to.be.closeTo(23.3549, 0.0001);
    expect(parseLatencySeconds('0s')).to.equal(0);
  });

  it('不正・不在はnull', () => {
    expect(parseLatencySeconds(undefined)).to.equal(null);
    expect(parseLatencySeconds('')).to.equal(null);
    expect(parseLatencySeconds('abc')).to.equal(null);
    expect(parseLatencySeconds('12')).to.equal(null);
    expect(parseLatencySeconds('-1s')).to.equal(null);
  });
});

describe('summarizeRequestLatencies', () => {
  it('p50/p95/maxは200応答のみで計算し、429とその他の失敗は別に数える', () => {
    const entries = [
      ...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((s) => ({ status: 200, latency: `${s}s` })),
      { status: 429, latency: '0s' },
      { status: 500, latency: '5s' },
    ];
    const r = summarizeRequestLatencies(entries);
    expect(r.okCount).to.equal(10);
    expect(r.rejected429).to.equal(1);
    expect(r.otherFailures).to.equal(1);
    expect(r.p50).to.equal(50);
    expect(r.p95).to.equal(100);
    expect(r.max).to.equal(100);
  });

  it('200応答が0件ならp50/p95/maxはnull(0にしない)', () => {
    const r = summarizeRequestLatencies([{ status: 429, latency: '0s' }]);
    expect(r.okCount).to.equal(0);
    expect(r.p95).to.equal(null);
  });

  it('latencyが不正な200応答は計算から除外し、その件数を返す', () => {
    const r = summarizeRequestLatencies([
      { status: 200, latency: '10s' },
      { status: 200, latency: undefined },
    ]);
    expect(r.okCount).to.equal(1);
    expect(r.unparsable).to.equal(1);
  });

  it('空配列でも例外にならない', () => {
    const r = summarizeRequestLatencies([]);
    expect(r.okCount).to.equal(0);
    expect(r.p95).to.equal(null);
  });
});

describe('evaluateCanaryGate', () => {
  const base = { denominator: 10, done: 9, fabricationFinalErrors: 0, p95Seconds: 120 };

  it('10件中9件done・捏造0・p95 120秒は(1)(2)(3)すべてPASS', () => {
    const g = evaluateCanaryGate(base);
    expect(g.doneRate.pass).to.equal(true);
    expect(g.fabrication.pass).to.equal(true);
    expect(g.latency.pass).to.equal(true);
    expect(g.allPass).to.equal(true);
  });

  it('(1) 10件中8件doneはFAIL', () => {
    expect(evaluateCanaryGate({ ...base, done: 8 }).doneRate.pass).to.equal(false);
  });

  it('(1) 分母0はFAIL(0/0をPASSにしない)', () => {
    const g = evaluateCanaryGate({ ...base, denominator: 0, done: 0 });
    expect(g.doneRate.pass).to.equal(false);
    expect(g.allPass).to.equal(false);
  });

  it('(1) 分母が10未満はFAIL(canaryは10件以上が前提)', () => {
    expect(evaluateCanaryGate({ ...base, denominator: 9, done: 9 }).doneRate.pass).to.equal(false);
  });

  it('(2) 捏造の最終errorが1件でもあればFAIL', () => {
    expect(evaluateCanaryGate({ ...base, fabricationFinalErrors: 1 }).fabrication.pass).to.equal(false);
  });

  it('(3) p95がちょうど300秒はPASS、300.01秒はFAIL', () => {
    expect(evaluateCanaryGate({ ...base, p95Seconds: 300 }).latency.pass).to.equal(true);
    expect(evaluateCanaryGate({ ...base, p95Seconds: 300.01 }).latency.pass).to.equal(false);
  });

  it('(3) p95が測れない(null)場合はFAIL(不明をPASSにしない)', () => {
    const g = evaluateCanaryGate({ ...base, p95Seconds: null });
    expect(g.latency.pass).to.equal(false);
    expect(g.allPass).to.equal(false);
  });
});
