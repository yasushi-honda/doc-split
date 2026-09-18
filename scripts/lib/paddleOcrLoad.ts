/**
 * ADR-0025 PR4c Stage 3: 負荷試験(`scripts/paddle-ocr-verify.ts --mode=load`)の
 * 純ロジック(型・定数・統計・ゲート判定・レポート構築)。I/O(HTTP送信・gcloud呼出し)は
 * 一切含まない。`scripts/paddle-ocr-verify.ts`本体はこのモジュールの関数を呼び出す
 * オーケストレーション層に徹する。
 *
 * 承認済み仕様の出典:
 * - ゲート数値・試行回数(N): ~/.claude/plans/shiny-knitting-flamingo.md(2026-09-12、
 *   decision-maker確定・AskUserQuestion経由)
 * - cold/warm分離・trial打ち切り緩和の設計判断: ~/.claude/plans/fuzzy-moseying-book.md §4
 *   および 2026-09-18 の plan mode 再設計(Fable 5.1レビュー+実コード検証で、承認済みの
 *   revision作成方式が原理的に成立しないことが判明したための代替設計。理由は
 *   ~/.claude/plans/peaceful-strolling-squid.md「cold測定の再設計」節参照)
 * - 完了率ゲートの分母(page単位): 2026-09-18、decision-maker確定(AskUserQuestion経由)
 */

import { percentile } from './confirmedReplayStats';

// ============================================================================
// tier・試行回数
// ============================================================================

/** 承認済み仕様のページ数tier(shiny-knitting-flamingo.md ゲート表)。 */
export const LOAD_TIERS = [1, 20, 71, 160] as const;
export type LoadTier = (typeof LOAD_TIERS)[number];

export type LoadSeries = 'warm' | 'cold';
export type LoadIntensity = 'full' | 'quick';

/**
 * load fixture(`scripts/fixtures/paddle-ocr-load/load_<tier>p.pdf`)の期待SHA-256。
 * golden側の`manifest.json`(SHA-256突合による世代混在検知)に相当する簡易版。loadは
 * テキスト完全一致検証を行わないため専用manifestは持たず、この定数で代替する
 * (2026-09-18 Fable 5.1レビュー指摘M8反映)。fixture再生成時
 * (`scripts/fixtures/paddleOcrLoadFixtures.ts --generate-pdfs`)は必ずこの値も更新すること。
 */
export const EXPECTED_LOAD_FIXTURE_SHA256: Record<LoadTier, string> = {
  1: '106c6b48a9edfc3194d906c303732db1e3a3eb4473256546f1090612da36bee0',
  20: '853b350661552accc92a428260c9b44ff014f2a3b18d52262ac3a15efc3a47ef',
  71: 'a8d0b85ef9a40925e635c0338b0bea365d826ad473e8a28dfa54547292f48406',
  160: '67af9c3cda5377ec13d722aa3b4c60649b8b2cf05c7ff82cfc57d6463c68013e',
};

/** 出典: fuzzy-moseying-book.md §4「試行回数(既定intensity=full)」(decision-maker確定済み)。 */
export const WARM_TRIALS_FULL: Record<LoadTier, number> = { 1: 30, 20: 20, 71: 20, 160: 2 };

/**
 * coldはバースト方式(2026-09-18再設計)。1バースト=`COLD_BURST_SIZE`件同時発火、
 * その最大値を「そのバーストのcold候補サンプル」とする。バースト回数=承認済み仕様の
 * 「K=5」を踏襲する(手段は変わったが標本数の意図は変えない)。
 */
export const COLD_BURSTS_FULL = 5;
export const COLD_BURST_SIZE = 3; // 既存Cloud Run設定のmax-instances=3に合わせる(変更しない)

/**
 * quickモードのパラメータ(計画書に規定なし、本設計での提案)。デバッグ用でありゲート判定には
 * 使わない(intensity=quickは全tier強制NOT_EVALUATED)。全tier(1/20/71/160)を数十分以内で
 * 一巡できる値にする。
 */
export const QUICK_PARAMS = { warmTrials: 2, coldBursts: 1, maxPagesPerTrial: 5 } as const;

/** trial打ち切り→クールダウン→サーキットブレークの閾値(承認済み仕様の緩和実装、本設計提案)。 */
export const CIRCUIT_BREAK_THRESHOLD = 3;
export const COOLDOWN_AFTER_FAILURE_MS = 300_000; // Cloud Run --timeout=300 相当

/** load モードのリトライ・タイムアウト方針(本番 functions/src/utils/retry.ts の
 * RETRY_CONFIGS.paddleOcr と同値に揃える。golden側の「統計的純度優先」ポリシーは load には
 * 適用しない。理由: 完了率ゲートの目的は「本番が完走するか」であり、本番が救済するケースを
 * ハーネスが誤って失敗カウントしないようにするため)。 */
export const LOAD_MAX_RETRIES = 3;
export const LOAD_INITIAL_BACKOFF_MS = 2_000;
export const LOAD_REQUEST_TIMEOUT_MS = 250_000;
export const LOAD_TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

// ============================================================================
// ゲート表
// ============================================================================

export interface LoadGateSpec {
  /** 160は null(参考測定のみ、合否ゲートにしない)。 */
  latencySeconds: number | null;
  /** page単位の完了率しきい値(2026-09-18確定)。1/20=1.0, 71=0.95, 160=null。 */
  pageCompletionThreshold: number | null;
  metric: 'coldMax' | 'warmP95';
  kind: 'gate' | 'referenceOnly';
}

/** 出典: ~/.claude/plans/shiny-knitting-flamingo.md ゲート表(decision-maker確定済み、数値は変更不可)。 */
export const LOAD_GATES: Record<LoadTier, LoadGateSpec> = {
  1: { latencySeconds: 30, pageCompletionThreshold: 1.0, metric: 'coldMax', kind: 'gate' },
  20: { latencySeconds: 400, pageCompletionThreshold: 1.0, metric: 'warmP95', kind: 'gate' },
  71: { latencySeconds: 850, pageCompletionThreshold: 0.95, metric: 'warmP95', kind: 'gate' },
  160: { latencySeconds: null, pageCompletionThreshold: null, metric: 'warmP95', kind: 'referenceOnly' },
};

export type LoadVerdict = 'PASS' | 'FAIL' | 'NOT_EVALUATED' | 'MEASURED_ONLY';

// ============================================================================
// trial状態遷移(純粋reducer、I/O注入可能。fault injectionテスト用)
// ============================================================================

export type PageFailureKind = 'clientTimeout' | 'serverTimeout504' | 'networkError' | 'httpFatal';

export type PageOutcomeEvent =
  | { type: 'pageSuccess'; pageIndex: number; wallMs: number }
  | { type: 'pageFailure'; pageIndex: number; kind: PageFailureKind; detail?: string };

export interface TrialRunState {
  tier: LoadTier;
  trialIndex: number;
  pagesPlanned: number;
  pagesSent: number;
  /** 打ち切り時、未送信の残りページも含めた失敗ページ数(本番は1ページ失敗で文書処理全体が
   * 失敗するため、page単位完了率ゲートの計算上は「送らなかった残りページ」も失敗として扱う。
   * これはpagesPlanned - 成功ページ数として finalizeTrialFailure() で確定する)。 */
  failedPageCount: number;
  aborted: boolean;
  firstFailure?: { pageIndex: number; kind: PageFailureKind; detail?: string };
}

export function initialTrialState(tier: LoadTier, trialIndex: number, pagesPlanned: number): TrialRunState {
  return { tier, trialIndex, pagesPlanned, pagesSent: 0, failedPageCount: 0, aborted: false };
}

/**
 * 1ページの結果を反映する。承認済み仕様の緩和(golden側の「1件でも全体inconclusive」は
 * loadには適用しない): page単位で失敗を検知したら、そのtrialを即座に打ち切る
 * (呼び出し側は`aborted:true`を見て残りページの送信を止める)。
 */
export function reduceTrialOutcome(state: TrialRunState, event: PageOutcomeEvent): TrialRunState {
  if (state.aborted) return state;
  if (event.type === 'pageSuccess') {
    return { ...state, pagesSent: state.pagesSent + 1 };
  }
  return {
    ...state,
    pagesSent: state.pagesSent + 1,
    aborted: true,
    firstFailure: state.firstFailure ?? { pageIndex: event.pageIndex, kind: event.kind, detail: event.detail },
  };
}

/** 打ち切られたtrialの失敗ページ数を、未送信分も含めて確定する(page単位完了率ゲート用)。 */
export function finalizeTrialFailedPageCount(state: TrialRunState): number {
  if (!state.aborted) return 0;
  const succeeded = state.pagesSent - 1; // 最後の1件が失敗イベントそのもの
  return state.pagesPlanned - Math.max(0, succeeded);
}

export function trialSucceeded(state: TrialRunState): boolean {
  return !state.aborted && state.pagesSent === state.pagesPlanned;
}

/** trial間のサーキットブレーカ状態(純粋reducer)。連続`CIRCUIT_BREAK_THRESHOLD`回失敗で発火。 */
export interface RunCircuitState {
  consecutiveTrialFailures: number;
  broken: boolean;
}

export function initialCircuitState(): RunCircuitState {
  return { consecutiveTrialFailures: 0, broken: false };
}

export function reduceCircuitState(state: RunCircuitState, thisTrialSucceeded: boolean): RunCircuitState {
  if (state.broken) return state;
  if (thisTrialSucceeded) {
    return { consecutiveTrialFailures: 0, broken: false };
  }
  const next = state.consecutiveTrialFailures + 1;
  return { consecutiveTrialFailures: next, broken: next >= CIRCUIT_BREAK_THRESHOLD };
}

// ============================================================================
// レコード型
// ============================================================================

export interface LoadContractCheck {
  pageCountOk: boolean;
  engineOk: boolean;
  renderDpiOk: boolean;
  modelVersionMatch: boolean;
  /** golden側のtextFieldOkに相当。expectedTextとの突合ではなく、レスポンス自身の
   * text/pages[0]が自己整合していることのみ検証する(loadはテキスト正確性を検証しないため)。 */
  textSelfConsistent: boolean;
  /** 白紙応答の無言PASSを防ぐ(空文字はtextSelfConsistentだけでは検知できないため)。 */
  nonEmptyText: boolean;
}

export function checkLoadContract(
  parsed: { pageCount?: number; engine?: string; renderDpi?: number; modelVersion?: string; text?: string; pages?: string[] },
  expectedModelVersion: string
): LoadContractCheck {
  const text = parsed.text ?? '';
  const pages0 = parsed.pages?.[0] ?? '';
  return {
    pageCountOk: parsed.pageCount === 1,
    engineOk: parsed.engine === 'paddleocr',
    renderDpiOk: parsed.renderDpi === 200,
    modelVersionMatch: parsed.modelVersion === expectedModelVersion,
    textSelfConsistent: text === pages0,
    nonEmptyText: text.trim().length > 0,
  };
}

export function loadContractOk(c: LoadContractCheck): boolean {
  return c.pageCountOk && c.engineOk && c.renderDpiOk && c.modelVersionMatch && c.textSelfConsistent && c.nonEmptyText;
}

export interface LoadPageRecord {
  series: LoadSeries;
  trial: number;
  pageIndex: number;
  wallMs: number;
  serviceProcessingMs: number | null;
  clientObservedExcessMs: number | null;
  httpStatus: number | null;
  retriedCount: number;
  authRetried: boolean;
  timedOut: boolean;
  failureKind?: PageFailureKind;
  errorDetail?: string;
  fatal: boolean;
  fatalReason?: string;
  contractCheck?: LoadContractCheck;
}

export interface LoadTrialRecord {
  series: LoadSeries;
  trial: number;
  pagesPlanned: number;
  pagesSent: number;
  /** Σページwallms(Cloud Run呼出し単体の合計。850秒予算の対象、
   * fuzzy-moseying-book.md §4「71ページの850秒はCloud Run呼出し単体の予算」に対応)。
   * 打ち切られたtrialは送信できた分の合計のみ(未送信分は含めない、実測できないため)。 */
  totalWallMs: number;
  /** trial開始〜終了のend-to-end実時間(参考値、クールダウン待機等は含まない)。 */
  trialWallClockMs: number;
  totalServiceProcessingMs: number | null;
  completed: boolean;
  /** 未送信分を含めて確定した失敗ページ数(page単位完了率ゲートの分子計算に使う)。 */
  failedPageCount: number;
  firstFailure?: { pageIndex: number; kind: PageFailureKind; detail?: string };
  startedAt: string;
  finishedAt: string;
}

export interface ColdBurstRecord {
  burstIndex: number;
  pages: LoadPageRecord[];
  /** バースト内最大値。既に温まっていたインスタンスの応答は速く返るため、外れ値の遅い
   * 応答が新規インスタンス起動を経由したものである可能性が高い、という代理指標。 */
  coldCandidateMs: number;
}

// ============================================================================
// 統計(nearest-rank法、既存confirmedReplayStats.tsのpercentileを再利用)
// ============================================================================

export interface LoadLatencySummary {
  p50Ms: number;
  p95Ms: number;
  n: number;
}

/**
 * 失敗trial(未完走)は統計から除外せず、右側打ち切り(+Infinity)として順位統計に含める。
 * 除外方式は「遅かったから失敗した」trialを取り除くことによる生存者バイアスで、p95が
 * 下方に歪む(2026-09-18 Fable 5.1レビュー指摘)。
 */
function trialLatencyForPercentile(t: LoadTrialRecord): number {
  return t.completed ? t.totalWallMs : Number.POSITIVE_INFINITY;
}

export function summarizeWarmTrials(trials: readonly LoadTrialRecord[]): LoadLatencySummary | null {
  if (trials.length === 0) return null;
  const sorted = trials.map(trialLatencyForPercentile).sort((a, b) => a - b);
  return { p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95), n: sorted.length };
}

export function computePageCompletionRate(trials: readonly LoadTrialRecord[]): number | null {
  if (trials.length === 0) return null;
  const totalPlanned = trials.reduce((sum, t) => sum + t.pagesPlanned, 0);
  const totalFailed = trials.reduce((sum, t) => sum + t.failedPageCount, 0);
  if (totalPlanned === 0) return null;
  return (totalPlanned - totalFailed) / totalPlanned;
}

export function computeTrialCompletionRate(trials: readonly LoadTrialRecord[], expectedWarmTrials: number): number | null {
  // trials.length===0(warm系列を実行していない、または未着手)の場合はexpectedWarmTrialsの
  // 値に関わらずnullを返す。expectedWarmTrials自体は evaluateLoadGate の標本数不足判定
  // (hasSufficientWarmSamples)にも使われるため、ここで0に丸めてはならない(Fable 5.1
  // レビュー指摘H1、2026-09-18)。
  if (trials.length === 0 || expectedWarmTrials === 0) return null;
  const completed = trials.filter((t) => t.completed).length;
  return completed / expectedWarmTrials;
}

// ============================================================================
// ゲート判定
// ============================================================================

export interface LoadGateEntry {
  tier: LoadTier;
  kind: 'gate' | 'referenceOnly';
  latencyMetric: 'coldMax' | 'warmP95';
  thresholdSeconds: number | null;
  /** Number.POSITIVE_INFINITYになりうる内部計算結果をJSON安全な形にした値(Infinityはnullとして
   * 表現し、verdictReasonで理由を明記する)。 */
  actualSeconds: number | null;
  pageCompletionRate: number | null;
  pageCompletionThreshold: number | null;
  verdict: LoadVerdict;
  verdictReason: string;
  reference: {
    warmP50Ms: number | null;
    warmP95Ms: number | null;
    warmN: number;
    /** バースト内失敗によりPOSITIVE_INFINITYになった要素はnullとしてJSON安全化する
     * (JSON.stringifyはInfinityを無言でnullにするため、意図してnull化したことを明示する)。 */
    coldCandidatesMs: (number | null)[];
    coldMaxMs: number | null;
    trialCompletionRate: number | null;
  };
}

const MIN_WARM_SAMPLE_RATIO = 1.0; // 標本数不足の判定: 期待trial数を全て試行できていること

export function evaluateLoadGate(input: {
  tier: LoadTier;
  intensity: LoadIntensity;
  warmTrials: readonly LoadTrialRecord[];
  coldBursts: readonly ColdBurstRecord[];
  expectedWarmTrials: number;
  expectedColdBursts: number;
}): LoadGateEntry {
  const spec = LOAD_GATES[input.tier];
  // 破棄用ウォームアップリクエストはそもそもLoadTrialRecord化されない(オーケストレーション層
  // が単発リクエストとして送信し、trial配列に含めない設計)ため、ここでのフィルタは不要。
  const warmTrialsForStats = input.warmTrials;
  const warmSummary = summarizeWarmTrials(warmTrialsForStats);
  // ゲート判定(actualMs)にはPOSITIVE_INFINITYを含む生の値を使う(バースト内失敗を
  // レイテンシ超過と同様にFAIL側へ倒すため)。JSON出力用のreferenceだけ後段でnull化する。
  const rawColdCandidatesMs = input.coldBursts.map((b) => b.coldCandidateMs);
  const coldMaxMs = rawColdCandidatesMs.length > 0 ? Math.max(...rawColdCandidatesMs) : null;
  const pageCompletionRate = computePageCompletionRate(warmTrialsForStats);
  const trialCompletionRate = computeTrialCompletionRate(warmTrialsForStats, input.expectedWarmTrials);

  const reference = {
    warmP50Ms: warmSummary && Number.isFinite(warmSummary.p50Ms) ? warmSummary.p50Ms : null,
    warmP95Ms: warmSummary && Number.isFinite(warmSummary.p95Ms) ? warmSummary.p95Ms : null,
    warmN: warmSummary?.n ?? 0,
    coldCandidatesMs: rawColdCandidatesMs.map((v) => (Number.isFinite(v) ? v : null)),
    coldMaxMs: coldMaxMs !== null && Number.isFinite(coldMaxMs) ? coldMaxMs : null,
    trialCompletionRate,
  };

  const base = {
    tier: input.tier,
    kind: spec.kind,
    latencyMetric: spec.metric,
    thresholdSeconds: spec.latencySeconds,
    pageCompletionThreshold: spec.pageCompletionThreshold,
    pageCompletionRate,
    reference,
  };

  if (spec.kind === 'referenceOnly') {
    const actualMs = spec.metric === 'coldMax' ? coldMaxMs : (warmSummary?.p95Ms ?? null);
    const actualSeconds = actualMs !== null && Number.isFinite(actualMs) ? actualMs / 1000 : null;
    return {
      ...base,
      actualSeconds,
      verdict: 'MEASURED_ONLY',
      verdictReason: '160ページは実データに存在しない理論上限であり参考測定のみ。合否ゲートにしない(未達でも本移行スコープ外の別Issue化、decision-maker確定済み)。',
    };
  }

  if (input.intensity === 'quick') {
    const actualMs = spec.metric === 'coldMax' ? coldMaxMs : (warmSummary?.p95Ms ?? null);
    const actualSeconds = actualMs !== null && Number.isFinite(actualMs) ? actualMs / 1000 : null;
    return {
      ...base,
      actualSeconds,
      verdict: 'NOT_EVALUATED',
      verdictReason: 'intensity=quick はデバッグ用でありゲート判定に使わない(承認済み計画 §4)。',
    };
  }

  // quality-gate-evaluator指摘(2026-09-18): metricがcoldMaxのtier(=tier1)を評価する際、
  // warm標本の充足を無条件で要求すると、page完了率計算(completionOk)がwarmTrialsに
  // 依存する設計と相まって「--series=cold単独+intensity=full」が原理的に恒久的に
  // NOT_EVALUATEDにしかならない(hasSufficientColdSamplesと対称に、metric自身が
  // 要求する系列の標本数のみを見る)。
  const hasSufficientWarmSamples =
    spec.metric !== 'warmP95' || warmTrialsForStats.length >= input.expectedWarmTrials * MIN_WARM_SAMPLE_RATIO;
  const hasSufficientColdSamples = spec.metric !== 'coldMax' || coldBurstsSufficient(input.coldBursts.length, input.expectedColdBursts);

  if (!hasSufficientWarmSamples || !hasSufficientColdSamples) {
    const actualMs = spec.metric === 'coldMax' ? coldMaxMs : (warmSummary?.p95Ms ?? null);
    const actualSeconds = actualMs !== null && Number.isFinite(actualMs) ? actualMs / 1000 : null;
    return {
      ...base,
      actualSeconds,
      verdict: 'NOT_EVALUATED',
      verdictReason: `標本数が不足しています(warm: ${warmTrialsForStats.length}/${input.expectedWarmTrials}, cold: ${input.coldBursts.length}/${input.expectedColdBursts})。予算超過またはサーキットブレークによる途中打ち切りの可能性があります。`,
    };
  }

  const actualMs = spec.metric === 'coldMax' ? coldMaxMs : (warmSummary?.p95Ms ?? null);
  if (actualMs === null) {
    return {
      ...base,
      actualSeconds: null,
      verdict: 'NOT_EVALUATED',
      verdictReason: '有効な実測値がありません。',
    };
  }
  const actualSeconds = Number.isFinite(actualMs) ? actualMs / 1000 : null;
  const latencyOk = Number.isFinite(actualMs) && spec.latencySeconds !== null && actualMs / 1000 <= spec.latencySeconds;
  const completionOk =
    pageCompletionRate !== null && spec.pageCompletionThreshold !== null && pageCompletionRate >= spec.pageCompletionThreshold;

  const verdict: LoadVerdict = latencyOk && completionOk ? 'PASS' : 'FAIL';
  const reasonParts: string[] = [];
  if (!Number.isFinite(actualMs)) {
    reasonParts.push(
      spec.metric === 'coldMax'
        ? 'coldバースト内に失敗ページがあり、coldCandidateMsが算出不能(=無限大)でした'
        : 'warm系列のp95が右側打ち切り(未完走trialを含む)により算出不能(=無限大)でした'
    );
  } else if (!latencyOk) {
    reasonParts.push(`レイテンシ${(actualMs / 1000).toFixed(1)}秒が基準${spec.latencySeconds}秒を超過`);
  }
  if (!completionOk) {
    reasonParts.push(
      `page単位完了率${pageCompletionRate !== null ? (pageCompletionRate * 100).toFixed(2) : 'N/A'}%が基準${
        spec.pageCompletionThreshold !== null ? spec.pageCompletionThreshold * 100 : 'N/A'
      }%を下回る`
    );
  }
  const verdictReason = verdict === 'PASS' ? '基準を全て満たしました。' : reasonParts.join('。 ') + '。';

  return { ...base, actualSeconds, verdict, verdictReason };
}

function coldBurstsSufficient(actual: number, expected: number): boolean {
  return actual >= expected;
}

// ============================================================================
// レポート・Step Summary・exitCode
// ============================================================================

export interface LoadServiceSnapshot {
  revisionName: string;
  imageDigest: string | null;
}

export interface LoadReport {
  schemaVersion: 1;
  mode: 'load';
  tier: LoadTier;
  intensity: LoadIntensity;
  seriesExecuted: LoadSeries[];
  startedAt: string;
  finishedAt: string | null;
  serviceUrl: string;
  fixtureFile: string;
  fixtureSha256: string;
  fixturePageCount: number;
  expectedModelVersion: string;
  serviceSnapshotWarmStart: LoadServiceSnapshot | null;
  serviceSnapshotWarmEnd: LoadServiceSnapshot | null;
  inconclusive: boolean;
  inconclusiveReason: string | null;
  abortedReason: 'budgetExceeded' | 'consecutiveTrialFailures' | null;
  warmTrials: LoadTrialRecord[];
  coldBursts: ColdBurstRecord[];
  gate: LoadGateEntry;
  fatalError: string | null;
  notes: string[];
}

/** 承認済み仕様が明記を義務付ける固定注記(2026-09-18 Fable 5.1レビュー反映分含む)。 */
export const LOAD_REPORT_NOTES = [
  'N=20は統計的証明ではなく、PR6着手前の実用性スクリーニングである。20/20成功でも完了率95%の両側95%信頼区間下限は約83%にとどまる。',
  '71ページの850秒はCloud Run呼出し単体の予算。Functions全体900秒予算のうち残り50秒は非OCR処理に充てる想定(kanameone本番実測の非OCRオーバーヘッド9.9秒に対し約5倍のマージン)。',
  '160ページは実データに存在しない理論上限であり参考測定のみ。合否ゲートにしない(未達時は本移行スコープ外の別Issue)。',
  'wallMsはクライアント観測値(GHA runner米国↔asia-northeast1のネットワーク往復を含む)。serviceProcessingMsとの差分が転送オーバーヘッド。',
  'p95は右側打ち切り(未完走trialを+Infinity扱い)で算出する。除外方式は生存者バイアスで下方に歪むため採用しない。',
  'fixtureは合成PDF。実運用のFAX/スキャン文書より文字密度が低く、楽観側の測定である。',
  'coldはバースト方式(3件同時発火の最大値)による代理指標。当初計画のrevision強制作成方式は、Cloud Runのstartup probe自体がモデルロード完了を待ってからReadyにする仕様のため原理的に成立しないと判明し、この方式へ差し替えた(理由の詳細はPRの計画書参照)。',
  '本ハーネスは--concurrency=1の単一ストリーム測定であり、本番の複数文書同時処理時の輻輳(max-instances=3飽和・キュー待ち)は測定していない。',
  'onCreateトリガーはtimeoutSeconds=540のハード上限があり、71ページ級書類は初回試行(onCreate)では完走せずscheduled経路(900秒)へフォールバックする既存設計(ADR-0023)である。',
];

export function buildLoadReport(input: {
  tier: LoadTier;
  intensity: LoadIntensity;
  seriesExecuted: LoadSeries[];
  startedAt: string;
  finishedAt: string;
  serviceUrl: string;
  fixtureFile: string;
  fixtureSha256: string;
  fixturePageCount: number;
  expectedModelVersion: string;
  serviceSnapshotWarmStart: LoadServiceSnapshot | null;
  serviceSnapshotWarmEnd: LoadServiceSnapshot | null;
  warmTrials: LoadTrialRecord[];
  coldBursts: ColdBurstRecord[];
  expectedWarmTrials: number;
  expectedColdBursts: number;
  abortedReason: 'budgetExceeded' | 'consecutiveTrialFailures' | null;
}): LoadReport {
  const snapshotMismatch =
    input.seriesExecuted.includes('warm') &&
    input.serviceSnapshotWarmStart !== null &&
    input.serviceSnapshotWarmEnd !== null &&
    input.serviceSnapshotWarmStart.imageDigest !== input.serviceSnapshotWarmEnd.imageDigest;

  const gate = evaluateLoadGate({
    tier: input.tier,
    intensity: input.intensity,
    warmTrials: input.warmTrials,
    coldBursts: input.coldBursts,
    expectedWarmTrials: input.expectedWarmTrials,
    expectedColdBursts: input.expectedColdBursts,
  });

  const inconclusive = input.abortedReason === 'consecutiveTrialFailures' || snapshotMismatch;
  const inconclusiveReason = snapshotMismatch
    ? 'warm系列の開始時・終了時でimageDigestが一致しません(デプロイ混入の疑い)。'
    : input.abortedReason === 'consecutiveTrialFailures'
      ? `連続${CIRCUIT_BREAK_THRESHOLD}回のtrial失敗によりサーキットブレークしました。`
      : null;

  return {
    schemaVersion: 1,
    mode: 'load',
    tier: input.tier,
    intensity: input.intensity,
    seriesExecuted: input.seriesExecuted,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    serviceUrl: input.serviceUrl,
    fixtureFile: input.fixtureFile,
    fixtureSha256: input.fixtureSha256,
    fixturePageCount: input.fixturePageCount,
    expectedModelVersion: input.expectedModelVersion,
    serviceSnapshotWarmStart: input.serviceSnapshotWarmStart,
    serviceSnapshotWarmEnd: input.serviceSnapshotWarmEnd,
    inconclusive,
    inconclusiveReason,
    abortedReason: input.abortedReason,
    warmTrials: input.warmTrials,
    coldBursts: input.coldBursts,
    gate,
    fatalError: null,
    notes: LOAD_REPORT_NOTES,
  };
}

export function emptyLoadReportSkeleton(input: {
  tier: LoadTier;
  intensity: LoadIntensity;
  startedAt: string;
  finishedAt: string;
  serviceUrl: string;
  fatalError: string;
}): LoadReport {
  return {
    schemaVersion: 1,
    mode: 'load',
    tier: input.tier,
    intensity: input.intensity,
    seriesExecuted: [],
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    serviceUrl: input.serviceUrl,
    fixtureFile: '',
    fixtureSha256: '',
    fixturePageCount: 0,
    expectedModelVersion: '',
    serviceSnapshotWarmStart: null,
    serviceSnapshotWarmEnd: null,
    inconclusive: true,
    inconclusiveReason: null,
    abortedReason: null,
    warmTrials: [],
    coldBursts: [],
    gate: {
      tier: input.tier,
      kind: LOAD_GATES[input.tier].kind,
      latencyMetric: LOAD_GATES[input.tier].metric,
      thresholdSeconds: LOAD_GATES[input.tier].latencySeconds,
      actualSeconds: null,
      pageCompletionRate: null,
      pageCompletionThreshold: LOAD_GATES[input.tier].pageCompletionThreshold,
      verdict: 'NOT_EVALUATED',
      verdictReason: '致命的エラーにより計測できませんでした。',
      reference: { warmP50Ms: null, warmP95Ms: null, warmN: 0, coldCandidatesMs: [], coldMaxMs: null, trialCompletionRate: null },
    },
    fatalError: input.fatalError,
    notes: LOAD_REPORT_NOTES,
  };
}

/**
 * 承認済み仕様が要求する失敗判定表(fuzzy-moseying-book.md §4)の機械的実装:
 * 160ページ(referenceOnly)は完全に無視する。fatal/inconclusive/通信異常のみexitCode 1。
 * intensity=quickはNOT_EVALUATEDをFAIL扱いしない(合否ゲートに使わないため)。
 */
export function determineLoadExitCode(report: LoadReport): 0 | 1 {
  if (report.fatalError !== null) return 1;
  if (report.inconclusive) return 1;
  if (report.abortedReason !== null) return 1;
  if (report.gate.kind === 'referenceOnly') return 0;
  if (report.intensity === 'quick') return 0;
  return report.gate.verdict === 'PASS' ? 0 : 1;
}

export function buildLoadStepSummaryMarkdown(report: LoadReport): string {
  const lines: string[] = [];
  lines.push(`## PaddleOCR PR4c Stage 3: load ${report.tier}ページ ${report.seriesExecuted.join('+')} (${report.intensity})`);
  lines.push('');
  if (report.intensity === 'quick') {
    lines.push('**⚠️ intensity=quick はデバッグ用の疎通確認結果であり、合否ゲート判定には使いません。**');
    lines.push('');
  }
  lines.push(`- inconclusive: ${report.inconclusive}${report.inconclusiveReason ? ` (${report.inconclusiveReason})` : ''}`);
  lines.push(`- abortedReason: ${report.abortedReason ?? 'なし'}`);
  lines.push('');
  const g = report.gate;
  lines.push('| tier | 種別 | 指標 | 基準(秒) | 実測(秒) | page完了率 | 基準完了率 | 判定 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  lines.push(
    `| ${g.tier} | ${g.kind} | ${g.latencyMetric} | ${g.thresholdSeconds ?? 'N/A'} | ${
      g.actualSeconds !== null ? g.actualSeconds.toFixed(1) : 'N/A'
    } | ${g.pageCompletionRate !== null ? (g.pageCompletionRate * 100).toFixed(2) + '%' : 'N/A'} | ${
      g.pageCompletionThreshold !== null ? (g.pageCompletionThreshold * 100).toFixed(0) + '%' : 'N/A'
    } | ${g.verdict} |`
  );
  lines.push('');
  lines.push(`判定理由: ${g.verdictReason}`);
  lines.push('');
  lines.push(
    `参考値: warm p50=${g.reference.warmP50Ms ?? 'N/A'}ms p95=${g.reference.warmP95Ms ?? 'N/A'}ms n=${g.reference.warmN} / cold候補=[${g.reference.coldCandidatesMs.join(', ')}]ms(最大${g.reference.coldMaxMs ?? 'N/A'}ms) / trial単位完了率=${
      g.reference.trialCompletionRate !== null ? (g.reference.trialCompletionRate * 100).toFixed(1) + '%' : 'N/A'
    }`
  );
  if (g.kind === 'referenceOnly') {
    lines.push('');
    lines.push('**このtierは参考測定のみであり、合否ゲートではありません。未達でも本移行のNo-Go材料にはせず、別Issueへ切り出します。**');
  }
  lines.push('');
  lines.push('### 注記');
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  return lines.join('\n');
}
