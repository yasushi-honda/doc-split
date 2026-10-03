import { expect } from 'chai';
import {
  evaluateCanaryGate,
  evaluateCanaryRun,
  isLatencyIncomplete,
  parseLatencySeconds,
  summarizeCanaryDocs,
  summarizeRequestLatencies,
  type CanaryDocSnapshot,
  type LatencySummary,
} from '../../scripts/lib/sarashinaCanaryStats';

const doc = (
  state: CanaryDocSnapshot['state'],
  errorKind: CanaryDocSnapshot['errorKind'] = null,
  provider: CanaryDocSnapshot['provider'] = state === 'done' ? 'sarashina' : null
): CanaryDocSnapshot => ({ state, errorKind, provider });

describe('summarizeCanaryDocs', () => {
  it('summaryState別に集計し、分母は取得できた文書数+不在文書数にする', () => {
    const r = summarizeCanaryDocs([doc('done'), doc('done'), doc('error', 'quota'), doc('pending')], 1);
    expect(r.denominator).to.equal(5);
    expect(r.missing).to.equal(1);
    expect(r.byState).to.deep.equal({ pending: 1, processing: 0, done: 2, error: 1, skipped: 0, none: 0 });
    expect(r.doneByOtherProvider).to.equal(0);
  });

  it('Sarashina以外(gemini等)でdoneになった文書はdoneに数えず、doneByOtherProviderへ分ける', () => {
    const r = summarizeCanaryDocs([doc('done', null, 'sarashina'), doc('done', null, 'gemini'), doc('done', null, null)], 0);
    expect(r.byState.done).to.equal(1);
    expect(r.doneByOtherProvider).to.equal(2);
    expect(r.denominator).to.equal(3);
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
  const base = { denominator: 10, done: 9, fabricationFinalErrors: 0, p95Seconds: 120, okCount: 20, slowFailures: 0 };

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

  it('(3) ログが上限に達して不完全な場合は、p95が小さくてもFAIL(欠けた分に遅い要求がありうる)', () => {
    const g = evaluateCanaryGate({ ...base, p95Seconds: 10, latencyIncomplete: true });
    expect(g.latency.pass).to.equal(false);
    expect(g.latency.detail).to.include('不完全');
    expect(g.allPass).to.equal(false);
  });

  it('(3) latencyIncompleteがfalse/未指定なら従来どおり判定する', () => {
    expect(evaluateCanaryGate({ ...base, latencyIncomplete: false }).latency.pass).to.equal(true);
  });
});

describe('isLatencyIncomplete', () => {
  const ok: LatencySummary = { okCount: 5, rejected429: 0, otherFailures: 0, slowFailures: 0, unparsable: 0, p50: 1, p95: 2, max: 3 };

  it('ログ打切りもlatency不明の200応答も無ければ完全', () => {
    expect(isLatencyIncomplete(ok, false)).to.equal(false);
  });

  it('ログが取得上限に達していれば不完全', () => {
    expect(isLatencyIncomplete(ok, true)).to.equal(true);
  });

  it('status 200なのにlatencyを読めない要求が1件でもあれば不完全(遅い要求が欠けうる)', () => {
    expect(isLatencyIncomplete({ ...ok, unparsable: 1 }, false)).to.equal(true);
  });

  it('不完全判定がゲートのFAILにつながる(p95が小さくても)', () => {
    const incomplete = isLatencyIncomplete({ ...ok, unparsable: 1 }, false);
    const g = evaluateCanaryGate({
      denominator: 10,
      done: 10,
      fabricationFinalErrors: 0,
      p95Seconds: 5,
      okCount: 20,
      slowFailures: 0,
      latencyIncomplete: incomplete,
    });
    expect(g.latency.pass).to.equal(false);
  });
});

describe('isLatencyIncomplete: status不明の行', () => {
  const ok: LatencySummary = { okCount: 5, rejected429: 0, otherFailures: 0, slowFailures: 0, unparsable: 0, p50: 1, p95: 2, max: 3 };
  it('statusを読めず捨てた行が1件でもあれば不完全', () => {
    expect(isLatencyIncomplete(ok, false, 1)).to.equal(true);
    expect(isLatencyIncomplete(ok, false, 0)).to.equal(false);
  });
});

describe('summarizeRequestLatencies: percentile境界とslowFailures', () => {
  const oks = (secs: number[]) => secs.map((s) => ({ status: 200, latency: `${s}s` }));

  it('n=1: p50=p95=max', () => {
    const r = summarizeRequestLatencies(oks([7]));
    expect([r.p50, r.p95, r.max]).to.deep.equal([7, 7, 7]);
  });

  it('n=2: p50は小さい方、p95は大きい方', () => {
    const r = summarizeRequestLatencies(oks([1, 9]));
    expect([r.p50, r.p95]).to.deep.equal([1, 9]);
  });

  it('n=20: p95は2番目に大きい値で、maxとは異なる', () => {
    const r = summarizeRequestLatencies(oks(Array.from({ length: 20 }, (_, i) => i + 1)));
    expect(r.p95).to.equal(19);
    expect(r.max).to.equal(20);
  });

  it('n=21: p95=20(nearest-rank)', () => {
    const r = summarizeRequestLatencies(oks(Array.from({ length: 21 }, (_, i) => i + 1)));
    expect(r.p95).to.equal(20);
  });

  it('未ソート入力でも数値順に並べて計算する(辞書順にならない)', () => {
    const r = summarizeRequestLatencies(oks([100, 20, 3, 40]));
    expect(r.max).to.equal(100);
    expect(r.p50).to.equal(20);
  });

  it('同値だけでも計算できる', () => {
    const r = summarizeRequestLatencies(oks([5, 5, 5]));
    expect([r.p50, r.p95, r.max]).to.deep.equal([5, 5, 5]);
  });

  it('200/429以外の失敗でlatencyが300秒以上のものだけslowFailuresに数える(504タイムアウト等)', () => {
    const r = summarizeRequestLatencies([
      { status: 504, latency: '600s' },
      { status: 499, latency: '300s' },
      { status: 500, latency: '5s' },
      { status: 503, latency: undefined },
    ]);
    expect(r.otherFailures).to.equal(4);
    expect(r.slowFailures).to.equal(2);
  });

  it('299.9秒の失敗はslowFailuresに数えない(境界)', () => {
    expect(summarizeRequestLatencies([{ status: 504, latency: '299.9s' }]).slowFailures).to.equal(0);
  });
});

describe('parseLatencySeconds: 異常系の追加', () => {
  for (const bad of ['1e3s', 'Infinity s', ' 5s', '5.s', '.5s', '10S', '1,5s', '5s ']) {
    it(`不正な表記 ${JSON.stringify(bad)} はnull`, () => {
      expect(parseLatencySeconds(bad)).to.equal(null);
    });
  }
  it('最小の正の値と300超の小数は読める', () => {
    expect(parseLatencySeconds('0.000000001s')).to.be.greaterThan(0);
    expect(parseLatencySeconds('300.000000001s')).to.be.greaterThan(300);
  });
});

describe('evaluateCanaryGate: 追加の境界と優先順位', () => {
  const base = { denominator: 10, done: 9, fabricationFinalErrors: 0, p95Seconds: 120, okCount: 20, slowFailures: 0 };

  it('(1) done率の境界: 11件中10件PASS・9件FAIL、20件中18件PASS・17件FAIL、10件中10件PASS', () => {
    expect(evaluateCanaryGate({ ...base, denominator: 11, done: 10 }).doneRate.pass).to.equal(true);
    expect(evaluateCanaryGate({ ...base, denominator: 11, done: 9 }).doneRate.pass).to.equal(false);
    expect(evaluateCanaryGate({ ...base, denominator: 20, done: 18 }).doneRate.pass).to.equal(true);
    expect(evaluateCanaryGate({ ...base, denominator: 20, done: 17 }).doneRate.pass).to.equal(false);
    expect(evaluateCanaryGate({ ...base, denominator: 10, done: 10 }).doneRate.pass).to.equal(true);
  });

  it('(1) 文書の取得が打切りならdone率が高くてもFAIL', () => {
    const g = evaluateCanaryGate({ ...base, done: 10, docsIncomplete: true });
    expect(g.doneRate.pass).to.equal(false);
    expect(g.allPass).to.equal(false);
  });

  it('(3) 200応答が10件ちょうどはPASS、9件はFAIL(サンプル不足)', () => {
    expect(evaluateCanaryGate({ ...base, okCount: 10 }).latency.pass).to.equal(true);
    const g = evaluateCanaryGate({ ...base, okCount: 9 });
    expect(g.latency.pass).to.equal(false);
    expect(g.latency.detail).to.include('サンプル不足');
  });

  it('(3) 1件だけの速い200応答ではPASSしない', () => {
    expect(evaluateCanaryGate({ ...base, okCount: 1, p95Seconds: 2 }).latency.pass).to.equal(false);
  });

  it('(3) 300秒以上かかった失敗要求が1件でもあればp95が小さくてもFAIL', () => {
    const g = evaluateCanaryGate({ ...base, p95Seconds: 10, slowFailures: 1 });
    expect(g.latency.pass).to.equal(false);
    expect(g.latency.detail).to.include('失敗要求');
  });

  it('(3) ログ取得失敗は他の条件より優先して「取得に失敗」と示す', () => {
    const g = evaluateCanaryGate({ ...base, p95Seconds: null, latencyIncomplete: true, logFetchFailed: true });
    expect(g.latency.pass).to.equal(false);
    expect(g.latency.detail).to.include('取得に失敗');
  });

  it('(3) 不完全かつp95=nullのときは「不完全」の理由を示す', () => {
    const g = evaluateCanaryGate({ ...base, p95Seconds: null, latencyIncomplete: true });
    expect(g.latency.detail).to.include('不完全');
  });

  it('(3) p95がNaNならFAIL', () => {
    expect(evaluateCanaryGate({ ...base, p95Seconds: NaN }).latency.pass).to.equal(false);
  });

  it('(2)だけFAIL・(3)だけFAILでもallPassはfalse', () => {
    expect(evaluateCanaryGate({ ...base, fabricationFinalErrors: 1 }).allPass).to.equal(false);
    expect(evaluateCanaryGate({ ...base, p95Seconds: 301 }).allPass).to.equal(false);
  });
});

describe('evaluateCanaryRun: 最終判定の合成', () => {
  const docs = (n: number, provider: string) =>
    Array.from({ length: n }, () => ({ state: 'done', errorKind: null, provider }) as CanaryDocSnapshot);
  const goodLatency = summarizeRequestLatencies(
    Array.from({ length: 20 }, (_, i) => ({ status: 200, latency: `${10 + i}s` }))
  );
  const run = {
    summary: summarizeCanaryDocs(docs(10, 'sarashina'), 0),
    latency: goodLatency,
    logsTruncated: false,
    logFetchFailed: false,
    droppedLogRows: 0,
    docsTruncated: false,
  };

  it('すべて満たせば全ゲートPASS', () => {
    const g = evaluateCanaryRun(run);
    expect(g.allPass).to.equal(true);
  });

  it('文書が打切りなら他が全PASSでもFAIL', () => {
    expect(evaluateCanaryRun({ ...run, docsTruncated: true }).allPass).to.equal(false);
  });

  it('ログ取得失敗ならFAILで、理由に「取得に失敗」を含む', () => {
    const g = evaluateCanaryRun({ ...run, latency: summarizeRequestLatencies([]), logFetchFailed: true });
    expect(g.allPass).to.equal(false);
    expect(g.latency.detail).to.include('取得に失敗');
  });

  it('ログが打切りならFAIL', () => {
    expect(evaluateCanaryRun({ ...run, logsTruncated: true }).allPass).to.equal(false);
  });

  it('status不明の行を捨てていたらFAIL', () => {
    expect(evaluateCanaryRun({ ...run, droppedLogRows: 1 }).allPass).to.equal(false);
  });

  it('Sarashina1件+gemini9件のdoneではdone率ゲートがFAIL(他プロバイダの実績で満たさない)', () => {
    const summary = summarizeCanaryDocs([...docs(1, 'sarashina'), ...docs(9, 'gemini')], 0);
    const g = evaluateCanaryRun({ ...run, summary });
    expect(summary.denominator).to.equal(10);
    expect(g.doneRate.pass).to.equal(false);
  });

  it('Sarashina9件+gemini1件は分母10でdone9となりPASS(境界)', () => {
    const summary = summarizeCanaryDocs([...docs(9, 'sarashina'), ...docs(1, 'gemini')], 0);
    expect(evaluateCanaryRun({ ...run, summary }).doneRate.pass).to.equal(true);
  });

  it('providerの表記ゆれ(大文字・空白・空文字)はSarashinaに数えない', () => {
    const summary = summarizeCanaryDocs(
      [doc('done', null, 'Sarashina'), doc('done', null, 'sarashina '), doc('done', null, '')],
      0
    );
    expect(summary.byState.done).to.equal(0);
    expect(summary.doneByOtherProvider).to.equal(3);
  });

  it('provider違いのfabrication最終errorも数える(保守的にFAIL側。仕様として固定)', () => {
    const summary = summarizeCanaryDocs([doc('error', 'fabrication_suspected', 'gemini')], 0);
    expect(summary.fabricationFinalErrors).to.equal(1);
  });
});
