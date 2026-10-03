/**
 * check-sarashina-summary-canary.ts の集計・判定ロジック(I/Oを伴わない純粋関数のみ)。
 *
 * ADR-0027 PR6のcanary客観ゲート(1)〜(3)を機械判定する。外部依存が無いためモック不要でunit testできる。
 * 「不明をPASSにしない」ことを重視する(分母0・p95が測れない場合は必ずFAIL)。
 *
 * 処理時間はFirestoreの文書には保存されていない(summaryStateUpdatedAtはclaim時と完了時に上書きされる)。
 * そのためゲート(3)はSarashinaサービスのCloud Runリクエストログ(POST、httpRequest.latency)の
 * リクエスト単位で測る。コールドスタートは最初のリクエストのlatencyに含まれる。
 * 文書単位ではないため、再試行で複数リクエストになった文書は複数件として数えられる。
 */
import { percentile } from './confirmedReplayStats';

export const CANARY_MIN_DENOMINATOR = 10;
export const CANARY_DONE_RATE_NUMERATOR = 9; // 10件中9件(90%)以上
export const CANARY_P95_LIMIT_SECONDS = 300;
/** p95を信頼できる200応答の最小件数(1件だけのp95で判定しない)。 */
export const CANARY_MIN_LATENCY_SAMPLES = 10;

export interface CanaryDocSnapshot {
  state: string | null;
  errorKind: string | null;
  /** 要約を実際に生成したプロバイダ(summaryProvider)。フィールド不在はnull。 */
  provider: string | null;
}

export interface CanaryDocSummary {
  denominator: number;
  missing: number;
  /** doneはSarashinaで生成された文書のみ。他プロバイダ(geminiへのロールバック時等)のdoneは含めない。 */
  byState: { pending: number; processing: number; done: number; error: number; skipped: number; none: number };
  /** state=doneだがsummaryProviderがsarashinaではない文書数(canaryの成功に数えない)。 */
  doneByOtherProvider: number;
  fabricationFinalErrors: number;
}

const KNOWN_STATES = ['pending', 'processing', 'done', 'error', 'skipped'] as const;

/**
 * 取得できた文書のsummaryState別件数と、捏造疑いの最終error件数を数える。
 * `missing`は指定されたが存在しなかった文書数で、分母に含める(取りこぼしを成功扱いにしない)。
 * 捏造疑いの再試行中(state=pending)は最終errorではないため数えない。
 * Sarashina以外で生成されたdone(L1がgeminiへロールバックされた期間等)は、Sarashinaのcanary成功に
 * 数えない(done率ゲートがSarashina以外の実績で満たされるのを防ぐ)。
 */
export function summarizeCanaryDocs(docs: CanaryDocSnapshot[], missing: number): CanaryDocSummary {
  const byState = { pending: 0, processing: 0, done: 0, error: 0, skipped: 0, none: 0 };
  let fabricationFinalErrors = 0;
  let doneByOtherProvider = 0;
  for (const d of docs) {
    if (d.state === 'done' && d.provider !== 'sarashina') {
      doneByOtherProvider += 1;
      continue;
    }
    const known = (KNOWN_STATES as readonly string[]).includes(d.state ?? '');
    byState[known ? (d.state as (typeof KNOWN_STATES)[number]) : 'none'] += 1;
    if (d.state === 'error' && d.errorKind === 'fabrication_suspected') fabricationFinalErrors += 1;
  }
  return { denominator: docs.length + missing, missing, byState, doneByOtherProvider, fabricationFinalErrors };
}

/** Cloud Runの`httpRequest.latency`("23.35s"形式)を秒に変換する。不正はnull。 */
export function parseLatencySeconds(latency: string | undefined): number | null {
  if (!latency) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(latency);
  return m ? Number(m[1]) : null;
}

export interface RequestLogEntry {
  status: number;
  latency: string | undefined;
}

export interface LatencySummary {
  okCount: number;
  rejected429: number;
  otherFailures: number;
  /** 200/429以外の失敗(504タイムアウト・499切断等)のうち、latencyが基準(300秒)以上のもの。遅い要求が欠けたままPASSしないよう、ゲート(3)をFAILにする。 */
  slowFailures: number;
  unparsable: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

/** 200応答のlatencyだけでp50/p95/maxを出す。429(同時実行上限による拒否)とその他の失敗は別に数える。その他の失敗のうち300秒以上かかったもの(タイムアウト等)はslowFailuresとして数え、ゲートでFAILにする。 */
export function summarizeRequestLatencies(entries: RequestLogEntry[]): LatencySummary {
  const oks: number[] = [];
  let rejected429 = 0;
  let otherFailures = 0;
  let slowFailures = 0;
  let unparsable = 0;
  for (const e of entries) {
    if (e.status === 200) {
      const sec = parseLatencySeconds(e.latency);
      if (sec === null) unparsable += 1;
      else oks.push(sec);
    } else if (e.status === 429) {
      rejected429 += 1;
    } else {
      otherFailures += 1;
      const sec = parseLatencySeconds(e.latency);
      if (sec !== null && sec >= CANARY_P95_LIMIT_SECONDS) slowFailures += 1;
    }
  }
  oks.sort((a, b) => a - b);
  return {
    okCount: oks.length,
    rejected429,
    otherFailures,
    slowFailures,
    unparsable,
    p50: oks.length ? percentile(oks, 50) : null,
    p95: oks.length ? percentile(oks, 95) : null,
    max: oks.length ? oks[oks.length - 1] : null,
  };
}

/**
 * latency測定が不完全か。ログが取得上限に達した場合、status 200なのにlatencyを読めない要求、または
 * statusを読めずに捨てた行が1件でもある場合は、遅い要求が欠けている可能性があるためp95ゲートをFAILにする(不明をPASSにしない)。
 */
export function isLatencyIncomplete(latency: LatencySummary, logsTruncated: boolean, droppedLogRows = 0): boolean {
  return logsTruncated || latency.unparsable > 0 || droppedLogRows > 0;
}

export interface GateResult {
  pass: boolean;
  detail: string;
}

export interface CanaryGate {
  doneRate: GateResult;
  fabrication: GateResult;
  latency: GateResult;
  allPass: boolean;
}

/**
 * 客観ゲート(1)done率90%以上・分母10件以上、(2)捏造の最終error 0件、
 * (3)リクエストp95が300秒以下(200応答10件以上、遅い失敗要求なし、測定が完全であること)。
 */
export function evaluateCanaryGate(input: {
  denominator: number;
  done: number;
  fabricationFinalErrors: number;
  p95Seconds: number | null;
  /** p95の母集団(200応答)の件数。 */
  okCount: number;
  slowFailures: number;
  /** リクエストログの取得上限到達・latency不明の200応答・status不明の行がある(不完全な測定はFAIL)。 */
  latencyIncomplete?: boolean;
  logFetchFailed?: boolean;
  /** 文書の取得が上限で打切りになった(期間モード)。 */
  docsIncomplete?: boolean;
}): CanaryGate {
  const { denominator, done, fabricationFinalErrors, p95Seconds, okCount, slowFailures } = input;
  const doneRate: GateResult = input.docsIncomplete
    ? { pass: false, detail: '文書の取得が上限で打切りになり集計が不完全。FAIL扱い' }
    : denominator < CANARY_MIN_DENOMINATOR
      ? { pass: false, detail: `分母${denominator}件(${CANARY_MIN_DENOMINATOR}件以上が必要)` }
      : {
          pass: done * 10 >= denominator * CANARY_DONE_RATE_NUMERATOR,
          detail: `done ${done}/${denominator}(基準: 90%以上)`,
        };
  const fabrication: GateResult = {
    pass: fabricationFinalErrors === 0,
    detail: `捏造疑いの最終error ${fabricationFinalErrors}件(基準: 0件)`,
  };
  let latency: GateResult;
  if (input.logFetchFailed) {
    latency = { pass: false, detail: 'リクエストログの取得に失敗し測定できない。FAIL扱い' };
  } else if (input.latencyIncomplete) {
    latency = { pass: false, detail: 'リクエストログの測定が不完全(取得上限到達・latency/status不明の行あり)。欠けた分に遅い要求がありうるためFAIL扱い' };
  } else if (slowFailures > 0) {
    latency = { pass: false, detail: `${CANARY_P95_LIMIT_SECONDS}秒以上かかった失敗要求(タイムアウト等)が${slowFailures}件。FAIL扱い` };
  } else if (p95Seconds === null || !Number.isFinite(p95Seconds)) {
    latency = { pass: false, detail: 'p95を測れない(200応答のログなし)。不明はFAIL扱い' };
  } else if (okCount < CANARY_MIN_LATENCY_SAMPLES) {
    latency = { pass: false, detail: `200応答が${okCount}件で、p95の判定に必要な${CANARY_MIN_LATENCY_SAMPLES}件に満たない(サンプル不足)` };
  } else {
    latency = {
      pass: p95Seconds <= CANARY_P95_LIMIT_SECONDS,
      detail: `リクエストp95 ${p95Seconds.toFixed(1)}秒(基準: ${CANARY_P95_LIMIT_SECONDS}秒以下、200応答${okCount}件)`,
    };
  }
  return { doneRate, fabrication, latency, allPass: doneRate.pass && fabrication.pass && latency.pass };
}

/**
 * 1回の測定結果(文書集計+リクエストログ集計+取得状態)から最終判定を合成する。
 * CLIに合成ロジックを残さずここでテストする(打切り・取得失敗を落とす回帰を検出するため)。
 */
export function evaluateCanaryRun(input: {
  summary: CanaryDocSummary;
  latency: LatencySummary;
  logsTruncated: boolean;
  logFetchFailed: boolean;
  droppedLogRows: number;
  docsTruncated: boolean;
}): CanaryGate {
  const { summary, latency } = input;
  return evaluateCanaryGate({
    denominator: summary.denominator,
    done: summary.byState.done,
    fabricationFinalErrors: summary.fabricationFinalErrors,
    p95Seconds: latency.p95,
    okCount: latency.okCount,
    slowFailures: latency.slowFailures,
    latencyIncomplete: isLatencyIncomplete(latency, input.logsTruncated, input.droppedLogRows),
    logFetchFailed: input.logFetchFailed,
    docsIncomplete: input.docsTruncated,
  });
}
