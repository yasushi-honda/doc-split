import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  LOAD_TIERS,
  LOAD_GATES,
  EXPECTED_LOAD_FIXTURE_SHA256,
  WARM_TRIALS_FULL,
  COLD_BURSTS_FULL,
  COLD_BURST_SIZE,
  QUICK_PARAMS,
  CIRCUIT_BREAK_THRESHOLD,
  initialTrialState,
  reduceTrialOutcome,
  finalizeTrialFailedPageCount,
  trialSucceeded,
  initialCircuitState,
  reduceCircuitState,
  checkLoadContract,
  loadContractOk,
  summarizeWarmTrials,
  computePageCompletionRate,
  computeTrialCompletionRate,
  evaluateLoadGate,
  buildLoadReport,
  determineLoadExitCode,
  buildLoadStepSummaryMarkdown,
  emptyLoadReportSkeleton,
  type LoadTrialRecord,
  type ColdBurstRecord,
  type LoadPageRecord,
  type LoadTier,
} from './paddleOcrLoad';

// ---------------------------------------------------------------------------
// ゲート表・定数(承認済み仕様の値がそのまま埋め込まれていることを固定する回帰テスト)
// ---------------------------------------------------------------------------

test('LOAD_TIERS: 承認済み仕様の4tier', () => {
  assert.deepEqual(LOAD_TIERS, [1, 20, 71, 160]);
});

test('LOAD_GATES: shiny-knitting-flamingo.md確定値と一致する', () => {
  assert.equal(LOAD_GATES[1].latencySeconds, 30);
  assert.equal(LOAD_GATES[1].pageCompletionThreshold, 1.0);
  assert.equal(LOAD_GATES[1].metric, 'coldMax');
  assert.equal(LOAD_GATES[1].kind, 'gate');

  assert.equal(LOAD_GATES[20].latencySeconds, 400);
  assert.equal(LOAD_GATES[20].pageCompletionThreshold, 1.0);
  assert.equal(LOAD_GATES[20].metric, 'warmP95');

  assert.equal(LOAD_GATES[71].latencySeconds, 850);
  assert.equal(LOAD_GATES[71].pageCompletionThreshold, 0.95);
  assert.equal(LOAD_GATES[71].metric, 'warmP95');
  assert.equal(LOAD_GATES[71].kind, 'gate');

  assert.equal(LOAD_GATES[160].latencySeconds, null);
  assert.equal(LOAD_GATES[160].pageCompletionThreshold, null);
  assert.equal(LOAD_GATES[160].kind, 'referenceOnly');
});

test('WARM_TRIALS_FULL: fuzzy-moseying-book.md §4確定値(1p=30,20p=20,71p=20,160p=2)', () => {
  assert.deepEqual(WARM_TRIALS_FULL, { 1: 30, 20: 20, 71: 20, 160: 2 });
});

test('COLD_BURSTS_FULL=5, COLD_BURST_SIZE=3(既存max-instances=3に合わせる)', () => {
  assert.equal(COLD_BURSTS_FULL, 5);
  assert.equal(COLD_BURST_SIZE, 3);
});

test('CIRCUIT_BREAK_THRESHOLD=3', () => {
  assert.equal(CIRCUIT_BREAK_THRESHOLD, 3);
});

test('EXPECTED_LOAD_FIXTURE_SHA256: 実ファイルのSHA-256と一致する(fixture世代混在検知)', () => {
  const fixtureDir = path.join(__dirname, '..', 'fixtures', 'paddle-ocr-load');
  for (const tier of LOAD_TIERS) {
    const filePath = path.join(fixtureDir, `load_${tier}p.pdf`);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    assert.equal(actual, EXPECTED_LOAD_FIXTURE_SHA256[tier], `tier=${tier}`);
  }
});

// ---------------------------------------------------------------------------
// trial状態遷移(純粋reducer)
// ---------------------------------------------------------------------------

test('reduceTrialOutcome: 全ページ成功でtrialSucceededがtrueになる', () => {
  let state = initialTrialState(20, 0, 20);
  for (let i = 0; i < 20; i++) {
    state = reduceTrialOutcome(state, { type: 'pageSuccess', pageIndex: i, wallMs: 1000 });
  }
  assert.equal(state.pagesSent, 20);
  assert.equal(state.aborted, false);
  assert.equal(trialSucceeded(state), true);
  assert.equal(finalizeTrialFailedPageCount(state), 0);
});

test('reduceTrialOutcome: page失敗でそのtrialを即座に打ち切る(golden側と異なるload固有の緩和)', () => {
  let state = initialTrialState(71, 0, 71);
  for (let i = 0; i < 4; i++) {
    state = reduceTrialOutcome(state, { type: 'pageSuccess', pageIndex: i, wallMs: 1000 });
  }
  state = reduceTrialOutcome(state, { type: 'pageFailure', pageIndex: 4, kind: 'serverTimeout504' });
  assert.equal(state.aborted, true);
  assert.equal(trialSucceeded(state), false);
  assert.deepEqual(state.firstFailure, { pageIndex: 4, kind: 'serverTimeout504', detail: undefined });
  // 4ページ成功、5ページ目で失敗 → 残り66ページ(71-5)も未送信分として失敗に含める
  assert.equal(finalizeTrialFailedPageCount(state), 67);
});

test('reduceTrialOutcome: 打ち切り後のイベントは無視される(冪等)', () => {
  let state = initialTrialState(20, 0, 20);
  state = reduceTrialOutcome(state, { type: 'pageFailure', pageIndex: 0, kind: 'networkError' });
  const afterAbort = reduceTrialOutcome(state, { type: 'pageSuccess', pageIndex: 1, wallMs: 500 });
  assert.deepEqual(afterAbort, state);
});

test('reduceTrialOutcome: 1ページ目で失敗した場合、finalizeTrialFailedPageCountは全ページ数になる', () => {
  let state = initialTrialState(20, 0, 20);
  state = reduceTrialOutcome(state, { type: 'pageFailure', pageIndex: 0, kind: 'clientTimeout' });
  assert.equal(finalizeTrialFailedPageCount(state), 20);
});

test('reduceCircuitState: 連続3回失敗でbroken=trueになる', () => {
  let circuit = initialCircuitState();
  circuit = reduceCircuitState(circuit, false);
  assert.equal(circuit.consecutiveTrialFailures, 1);
  assert.equal(circuit.broken, false);
  circuit = reduceCircuitState(circuit, false);
  assert.equal(circuit.broken, false);
  circuit = reduceCircuitState(circuit, false);
  assert.equal(circuit.consecutiveTrialFailures, 3);
  assert.equal(circuit.broken, true);
});

test('reduceCircuitState: 成功でconsecutiveTrialFailuresがリセットされる', () => {
  let circuit = initialCircuitState();
  circuit = reduceCircuitState(circuit, false);
  circuit = reduceCircuitState(circuit, false);
  circuit = reduceCircuitState(circuit, true);
  assert.equal(circuit.consecutiveTrialFailures, 0);
  assert.equal(circuit.broken, false);
});

test('reduceCircuitState: 一度brokenになったら以降のイベントで変化しない', () => {
  let circuit = initialCircuitState();
  for (let i = 0; i < 3; i++) circuit = reduceCircuitState(circuit, false);
  assert.equal(circuit.broken, true);
  const after = reduceCircuitState(circuit, true);
  assert.deepEqual(after, circuit);
});

// ---------------------------------------------------------------------------
// 契約検証(load固有: expectedTextとの突合ではなく自己整合性のみ)
// ---------------------------------------------------------------------------

test('checkLoadContract: 正常なレスポンスは全項目OK', () => {
  const c = checkLoadContract(
    { pageCount: 1, engine: 'paddleocr', renderDpi: 200, modelVersion: 'PP-OCRv6_medium/det:abc/rec:def', text: 'hello', pages: ['hello'] },
    'PP-OCRv6_medium/det:abc/rec:def'
  );
  assert.equal(loadContractOk(c), true);
});

test('checkLoadContract: text と pages[0] が不一致なら textSelfConsistent=false', () => {
  const c = checkLoadContract(
    { pageCount: 1, engine: 'paddleocr', renderDpi: 200, modelVersion: 'v1', text: 'A', pages: ['B'] },
    'v1'
  );
  assert.equal(c.textSelfConsistent, false);
  assert.equal(loadContractOk(c), false);
});

test('checkLoadContract: 空文字応答はnonEmptyText=falseで検知する(白紙応答の無言PASS防止)', () => {
  const c = checkLoadContract({ pageCount: 1, engine: 'paddleocr', renderDpi: 200, modelVersion: 'v1', text: '', pages: [''] }, 'v1');
  assert.equal(c.textSelfConsistent, true);
  assert.equal(c.nonEmptyText, false);
  assert.equal(loadContractOk(c), false);
});

test('checkLoadContract: modelVersion不一致を検知する', () => {
  const c = checkLoadContract(
    { pageCount: 1, engine: 'paddleocr', renderDpi: 200, modelVersion: 'stale', text: 'x', pages: ['x'] },
    'v1'
  );
  assert.equal(c.modelVersionMatch, false);
  assert.equal(loadContractOk(c), false);
});

// ---------------------------------------------------------------------------
// レコード生成ヘルパー(テスト専用)
// ---------------------------------------------------------------------------

function makeTrial(overrides: Partial<LoadTrialRecord> & { pagesPlanned: number }): LoadTrialRecord {
  return {
    series: 'warm',
    trial: 0,
    pagesSent: overrides.pagesPlanned,
    totalWallMs: 1000,
    trialWallClockMs: 1000,
    totalServiceProcessingMs: 900,
    completed: true,
    failedPageCount: 0,
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:01Z',
    ...overrides,
  };
}

function makeColdBurst(coldCandidateMs: number, burstIndex = 0): ColdBurstRecord {
  const page: LoadPageRecord = {
    series: 'cold',
    trial: burstIndex,
    pageIndex: 0,
    wallMs: coldCandidateMs,
    serviceProcessingMs: coldCandidateMs - 100,
    clientObservedExcessMs: 100,
    httpStatus: 200,
    retriedCount: 0,
    authRetried: false,
    timedOut: false,
    fatal: false,
  };
  return { burstIndex, pages: [page], coldCandidateMs };
}

// ---------------------------------------------------------------------------
// 統計(右側打ち切り)
// ---------------------------------------------------------------------------

test('summarizeWarmTrials: 全trial完走時は通常のnearest-rank p50/p95', () => {
  const trials = [100, 200, 300, 400, 500].map((ms, i) => makeTrial({ pagesPlanned: 20, totalWallMs: ms, trial: i }));
  const summary = summarizeWarmTrials(trials);
  assert.ok(summary);
  assert.equal(summary!.n, 5);
  assert.equal(Number.isFinite(summary!.p95Ms), true);
});

test('summarizeWarmTrials: 未完走trialは右側打ち切り(+Infinity)として順位統計に含まれる(生存者バイアス回避)', () => {
  const completed = [100, 200, 300, 400].map((ms, i) => makeTrial({ pagesPlanned: 20, totalWallMs: ms, trial: i }));
  const failed = makeTrial({ pagesPlanned: 20, completed: false, failedPageCount: 20, trial: 4 });
  const summary = summarizeWarmTrials([...completed, failed]);
  assert.ok(summary);
  assert.equal(summary!.n, 5);
  // n=5のp95(nearest-rank)は5番目(最大値) → 失敗trialのInfinityが選ばれる
  assert.equal(summary!.p95Ms, Number.POSITIVE_INFINITY);
});

test('summarizeWarmTrials: warmupDiscardedは呼び出し側でフィルタする想定(この関数自体はフィルタしない)', () => {
  const trials = [makeTrial({ pagesPlanned: 1, totalWallMs: 9999, warmupDiscarded: true }), makeTrial({ pagesPlanned: 1, totalWallMs: 100 })];
  const summary = summarizeWarmTrials(trials);
  assert.equal(summary!.n, 2);
});

test('summarizeWarmTrials: 空配列はnull', () => {
  assert.equal(summarizeWarmTrials([]), null);
});

// ---------------------------------------------------------------------------
// 完了率(page単位・trial単位)
// ---------------------------------------------------------------------------

test('computePageCompletionRate: 全trial完走なら100%', () => {
  const trials = Array.from({ length: 5 }, (_, i) => makeTrial({ pagesPlanned: 71, trial: i }));
  assert.equal(computePageCompletionRate(trials), 1);
});

test('computePageCompletionRate: page単位で計算する(2026-09-18decision-maker確定)。71ページ×20trial中1trialが5ページ目で失敗した場合', () => {
  const completedTrials = Array.from({ length: 19 }, (_, i) => makeTrial({ pagesPlanned: 71, trial: i }));
  const failedTrial = makeTrial({ pagesPlanned: 71, completed: false, failedPageCount: 67, trial: 19 }); // 4成功+1失敗+66未送信
  const rate = computePageCompletionRate([...completedTrials, failedTrial]);
  // 分母: 71*20=1420, 分子: 1420-67=1353
  assert.equal(rate, (1420 - 67) / 1420);
  assert.ok(rate! > 0.95); // trial単位なら19/20=95%だが、page単位ではさらに緩い基準になる
});

test('computeTrialCompletionRate: 20trial中19完走なら95%(参考値)', () => {
  const trials = [
    ...Array.from({ length: 19 }, (_, i) => makeTrial({ pagesPlanned: 71, trial: i })),
    makeTrial({ pagesPlanned: 71, completed: false, failedPageCount: 67, trial: 19 }),
  ];
  assert.equal(computeTrialCompletionRate(trials, 20), 0.95);
});

test('computePageCompletionRate/computeTrialCompletionRate: 空配列/expectedWarmTrials=0はnull', () => {
  assert.equal(computePageCompletionRate([]), null);
  assert.equal(computeTrialCompletionRate([makeTrial({ pagesPlanned: 1 })], 0), null);
});

// ---------------------------------------------------------------------------
// ゲート判定(evaluateLoadGate)
// ---------------------------------------------------------------------------

test('evaluateLoadGate: 160ページはkind=referenceOnly、verdict=MEASURED_ONLYで、latencyが基準超過でもFAILにならない', () => {
  const trials = Array.from({ length: 2 }, (_, i) => makeTrial({ pagesPlanned: 160, totalWallMs: 999_000, trial: i }));
  const gate = evaluateLoadGate({
    tier: 160,
    intensity: 'full',
    warmTrials: trials,
    coldBursts: [],
    expectedWarmTrials: 2,
    expectedColdBursts: 0,
  });
  assert.equal(gate.kind, 'referenceOnly');
  assert.equal(gate.verdict, 'MEASURED_ONLY');
  assert.equal(gate.actualSeconds, 999);
});

test('evaluateLoadGate: intensity=quick は全tier強制NOT_EVALUATED', () => {
  const trials = Array.from({ length: 20 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 100, trial: i }));
  const cold = Array.from({ length: 5 }, (_, i) => makeColdBurst(1000, i));
  for (const tier of LOAD_TIERS) {
    const gate = evaluateLoadGate({
      tier,
      intensity: 'quick',
      warmTrials: trials,
      coldBursts: cold,
      expectedWarmTrials: 20,
      expectedColdBursts: 5,
    });
    if (LOAD_GATES[tier].kind === 'gate') {
      assert.equal(gate.verdict, 'NOT_EVALUATED', `tier=${tier}`);
    }
  }
});

test('evaluateLoadGate: 標本数不足(warm)はNOT_EVALUATED', () => {
  const trials = Array.from({ length: 5 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 100, trial: i })); // 期待20に対し5件のみ
  const gate = evaluateLoadGate({
    tier: 71,
    intensity: 'full',
    warmTrials: trials,
    coldBursts: [],
    expectedWarmTrials: 20,
    expectedColdBursts: 0,
  });
  assert.equal(gate.verdict, 'NOT_EVALUATED');
  assert.match(gate.verdictReason, /標本数が不足/);
});

test('evaluateLoadGate: 標本数不足(cold、tier=1)はNOT_EVALUATED', () => {
  const trials = Array.from({ length: 30 }, (_, i) => makeTrial({ pagesPlanned: 1, totalWallMs: 5000, trial: i }));
  const cold = [makeColdBurst(10000, 0)]; // 期待5に対し1件のみ
  const gate = evaluateLoadGate({
    tier: 1,
    intensity: 'full',
    warmTrials: trials,
    coldBursts: cold,
    expectedWarmTrials: 30,
    expectedColdBursts: 5,
  });
  assert.equal(gate.verdict, 'NOT_EVALUATED');
});

test('evaluateLoadGate: 71ページ、レイテンシ・完了率とも基準内でPASS', () => {
  const trials = Array.from({ length: 20 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 600_000, trial: i })); // 600秒 < 850秒
  const gate = evaluateLoadGate({
    tier: 71,
    intensity: 'full',
    warmTrials: trials,
    coldBursts: [],
    expectedWarmTrials: 20,
    expectedColdBursts: 0,
  });
  assert.equal(gate.verdict, 'PASS');
  assert.equal(gate.pageCompletionRate, 1);
});

test('evaluateLoadGate: 71ページ、レイテンシ超過でFAIL', () => {
  const trials = Array.from({ length: 20 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 900_000, trial: i })); // 900秒 > 850秒
  const gate = evaluateLoadGate({
    tier: 71,
    intensity: 'full',
    warmTrials: trials,
    coldBursts: [],
    expectedWarmTrials: 20,
    expectedColdBursts: 0,
  });
  assert.equal(gate.verdict, 'FAIL');
  assert.match(gate.verdictReason, /基準850秒を超過/);
});

test('evaluateLoadGate: 71ページ、page単位完了率が95%未満でFAIL(レイテンシは基準内)', () => {
  // 20trial中2trialが1ページ目で失敗 → page単位: (1420 - 2*71)/1420 = 0.90 < 0.95
  const completed = Array.from({ length: 18 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 500_000, trial: i }));
  const failed = Array.from({ length: 2 }, (_, i) =>
    makeTrial({ pagesPlanned: 71, completed: false, failedPageCount: 71, totalWallMs: 0, trial: 18 + i })
  );
  const gate = evaluateLoadGate({
    tier: 71,
    intensity: 'full',
    warmTrials: [...completed, ...failed],
    coldBursts: [],
    expectedWarmTrials: 20,
    expectedColdBursts: 0,
  });
  assert.equal(gate.verdict, 'FAIL');
  assert.match(gate.verdictReason, /完了率/);
  assert.ok(gate.pageCompletionRate! < 0.95);
});

test('evaluateLoadGate: 1ページはcoldMax指標で判定する', () => {
  const warm = Array.from({ length: 30 }, (_, i) => makeTrial({ pagesPlanned: 1, totalWallMs: 5000, trial: i }));
  const cold = [makeColdBurst(25000, 0), makeColdBurst(20000, 1), makeColdBurst(15000, 2), makeColdBurst(10000, 3), makeColdBurst(28000, 4)];
  const gate = evaluateLoadGate({
    tier: 1,
    intensity: 'full',
    warmTrials: warm,
    coldBursts: cold,
    expectedWarmTrials: 30,
    expectedColdBursts: 5,
  });
  assert.equal(gate.reference.coldMaxMs, 28000);
  assert.equal(gate.actualSeconds, 28);
  assert.equal(gate.verdict, 'PASS'); // 28秒 <= 30秒
});

test('evaluateLoadGate: 1ページ、coldMaxが30秒超過でFAIL', () => {
  const warm = Array.from({ length: 30 }, (_, i) => makeTrial({ pagesPlanned: 1, totalWallMs: 5000, trial: i }));
  const cold = Array.from({ length: 5 }, (_, i) => makeColdBurst(35000, i));
  const gate = evaluateLoadGate({
    tier: 1,
    intensity: 'full',
    warmTrials: warm,
    coldBursts: cold,
    expectedWarmTrials: 30,
    expectedColdBursts: 5,
  });
  assert.equal(gate.verdict, 'FAIL');
});

test('evaluateLoadGate: p95がInfinity(右側打ち切り)の場合、actualSecondsはnullでFAIL', () => {
  const completed = Array.from({ length: 18 }, (_, i) => makeTrial({ pagesPlanned: 20, totalWallMs: 100, trial: i }));
  // 20trial中2件failed → n=20でp95(19番目)はまだ完走値だが、95%点がinfinityになるよう十分な失敗を混ぜる
  const failed = Array.from({ length: 3 }, (_, i) => makeTrial({ pagesPlanned: 20, completed: false, failedPageCount: 20, trial: 18 + i }));
  const gate = evaluateLoadGate({
    tier: 20,
    intensity: 'full',
    warmTrials: [...completed, ...failed],
    coldBursts: [],
    expectedWarmTrials: 20,
    expectedColdBursts: 0,
  });
  assert.equal(gate.actualSeconds, null);
  assert.equal(gate.verdict, 'FAIL');
  assert.match(gate.verdictReason, /右側打ち切り/);
});

// ---------------------------------------------------------------------------
// determineLoadExitCode
// ---------------------------------------------------------------------------

function buildBaseReportInput(tier: LoadTier, overrides: Record<string, unknown> = {}) {
  return {
    tier,
    intensity: 'full' as const,
    seriesExecuted: ['warm' as const],
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T01:00:00Z',
    serviceUrl: 'https://example.com',
    fixtureFile: 'load_71p.pdf',
    fixtureSha256: 'abc',
    fixturePageCount: tier,
    expectedModelVersion: 'v1',
    serviceSnapshotWarmStart: { revisionName: 'rev-1', imageDigest: 'digest-1' },
    serviceSnapshotWarmEnd: { revisionName: 'rev-1', imageDigest: 'digest-1' },
    warmTrials: [] as LoadTrialRecord[],
    coldBursts: [] as ColdBurstRecord[],
    expectedWarmTrials: WARM_TRIALS_FULL[tier],
    expectedColdBursts: COLD_BURSTS_FULL,
    abortedReason: null,
    ...overrides,
  };
}

test('determineLoadExitCode: fatalErrorがあれば1', () => {
  const report = emptyLoadReportSkeleton({
    tier: 71,
    intensity: 'full',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:01Z',
    serviceUrl: 'https://example.com',
    fatalError: 'boom',
  });
  assert.equal(determineLoadExitCode(report), 1);
});

test('determineLoadExitCode: 160ページ(referenceOnly)はFAILでも0', () => {
  const trials = Array.from({ length: 2 }, (_, i) => makeTrial({ pagesPlanned: 160, totalWallMs: 999_999, trial: i }));
  const report = buildLoadReport(buildBaseReportInput(160, { warmTrials: trials }));
  assert.equal(report.gate.kind, 'referenceOnly');
  assert.equal(determineLoadExitCode(report), 0);
});

test('determineLoadExitCode: intensity=quickはNOT_EVALUATEDでも0(fatal/inconclusive/abortedがない限り)', () => {
  const report = buildLoadReport(buildBaseReportInput(71, { intensity: 'quick' }));
  assert.equal(report.gate.verdict, 'NOT_EVALUATED');
  assert.equal(determineLoadExitCode(report), 0);
});

test('determineLoadExitCode: full intensityでゲートFAILなら1', () => {
  const trials = Array.from({ length: 20 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 900_000, trial: i }));
  const report = buildLoadReport(buildBaseReportInput(71, { warmTrials: trials }));
  assert.equal(report.gate.verdict, 'FAIL');
  assert.equal(determineLoadExitCode(report), 1);
});

test('determineLoadExitCode: full intensityでゲートPASSなら0', () => {
  const trials = Array.from({ length: 20 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 600_000, trial: i }));
  const report = buildLoadReport(buildBaseReportInput(71, { warmTrials: trials }));
  assert.equal(report.gate.verdict, 'PASS');
  assert.equal(determineLoadExitCode(report), 0);
});

test('determineLoadExitCode: サーキットブレークでabortedReason設定時は1(ゲート結果によらず)', () => {
  const trials = Array.from({ length: 20 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 600_000, trial: i }));
  const report = buildLoadReport(buildBaseReportInput(71, { warmTrials: trials, abortedReason: 'consecutiveTrialFailures' }));
  assert.equal(determineLoadExitCode(report), 1);
  assert.equal(report.inconclusive, true);
});

test('determineLoadExitCode: 予算超過(budgetExceeded)も1', () => {
  const trials = Array.from({ length: 5 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 600_000, trial: i }));
  const report = buildLoadReport(buildBaseReportInput(71, { warmTrials: trials, abortedReason: 'budgetExceeded' }));
  assert.equal(determineLoadExitCode(report), 1);
});

// ---------------------------------------------------------------------------
// buildLoadReport: デプロイ混入検知(warm系列のimageDigest不一致)
// ---------------------------------------------------------------------------

test('buildLoadReport: warm開始/終了でimageDigestが不一致ならinconclusive', () => {
  const trials = Array.from({ length: 20 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 600_000, trial: i }));
  const report = buildLoadReport(
    buildBaseReportInput(71, {
      warmTrials: trials,
      serviceSnapshotWarmStart: { revisionName: 'rev-1', imageDigest: 'digest-1' },
      serviceSnapshotWarmEnd: { revisionName: 'rev-2', imageDigest: 'digest-2' },
    })
  );
  assert.equal(report.inconclusive, true);
  assert.match(report.inconclusiveReason ?? '', /デプロイ混入/);
  assert.equal(determineLoadExitCode(report), 1);
});

test('buildLoadReport: cold系列のみ実行時はimageDigest不一致チェックをスキップする(revisionは意図的に変わらないため対象外)', () => {
  const cold = Array.from({ length: 5 }, (_, i) => makeColdBurst(10000, i));
  const report = buildLoadReport(
    buildBaseReportInput(1, {
      seriesExecuted: ['cold'],
      warmTrials: [],
      coldBursts: cold,
      serviceSnapshotWarmStart: null,
      serviceSnapshotWarmEnd: null,
    })
  );
  assert.equal(report.inconclusive, false);
});

// ---------------------------------------------------------------------------
// Step Summary Markdown(スモークテスト: 例外を投げない・主要な値を含む)
// ---------------------------------------------------------------------------

test('buildLoadStepSummaryMarkdown: PASSレポートの主要フィールドを含む', () => {
  const trials = Array.from({ length: 20 }, (_, i) => makeTrial({ pagesPlanned: 71, totalWallMs: 600_000, trial: i }));
  const report = buildLoadReport(buildBaseReportInput(71, { warmTrials: trials }));
  const md = buildLoadStepSummaryMarkdown(report);
  assert.match(md, /71ページ/);
  assert.match(md, /PASS/);
  assert.match(md, /N=20は統計的証明ではなく/);
});

test('buildLoadStepSummaryMarkdown: quickモードは警告バナーを含む', () => {
  const report = buildLoadReport(buildBaseReportInput(71, { intensity: 'quick' }));
  const md = buildLoadStepSummaryMarkdown(report);
  assert.match(md, /デバッグ用の疎通確認結果/);
});

test('buildLoadStepSummaryMarkdown: referenceOnly(160p)は専用の注記を含む', () => {
  const trials = Array.from({ length: 2 }, (_, i) => makeTrial({ pagesPlanned: 160, totalWallMs: 999_000, trial: i }));
  const report = buildLoadReport(buildBaseReportInput(160, { warmTrials: trials, expectedWarmTrials: 2 }));
  const md = buildLoadStepSummaryMarkdown(report);
  assert.match(md, /参考測定のみ/);
});

// ---------------------------------------------------------------------------
// QUICK_PARAMS(本設計の提案値、計画書に規定はないが妥当性を固定する)
// ---------------------------------------------------------------------------

test('QUICK_PARAMS: 全tierを数十分以内で一巡できる軽量値', () => {
  assert.equal(QUICK_PARAMS.warmTrials, 2);
  assert.equal(QUICK_PARAMS.coldBursts, 1);
  assert.equal(QUICK_PARAMS.maxPagesPerTrial, 5);
});
