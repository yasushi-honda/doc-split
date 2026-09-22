/**
 * ADR-0027 PR2b 実装ステップ4: Sarashina要約Cloud Run実機ゲートハーネス本体。
 *
 * `scripts/paddle-ocr-verify.ts`(ADR-0025 PR4c)のパターン(常にレポートを書き出す設計・
 * IDトークン管理・リトライ・ゲート判定・Step Summary生成)を踏襲しつつ、OCR(PDFバイナリ・
 * golden完全一致検証)とは対象が異なるため以下は独自設計にした:
 * - リクエストpayloadはJSON(OpenAI Chat Completions互換、`{messages:[...], max_tokens, ...}`)
 * - golden完全一致検証はしない(自由文の要約に対して「完全一致」は意味を持たない)。代わりに
 *   `scripts/lib/sarashinaSummaryScore.ts`(カバー率/数値捏造/金額混入/cross-entity)と
 *   `shared/summaryFabricationScan.ts`(固有名詞捏造)で採点する
 * - `sendSummaryWithRetries`は`/plan-crossreview`(codex指摘5)により`scripts/paddle-ocr-verify.ts`の
 *   `sendOcrWithRetries`から独立して実装する(timeout時は再送しないという安全方針は共通だが、
 *   PDF Buffer payload・OCR用リトライ方針をそのまま継承しない)
 *
 * v1プロンプト(本番`summaryPromptBuilder.ts`の`buildSummaryPrompt`と同一)を主対象として
 * 検証する(`/plan-crossreview` codex指摘2: v2プロンプトはPR0参考結果に留め、本番未採用の
 * プロンプトのPASSを本番品質の証明として扱わない)。
 *
 * ゲート表(9項目、`/plan-crossreview` codex指摘3・4・7・8反映):
 * - `runtime-contract`(3層のうち(a) `/props`実測値のみを担当。(b) `gcloud run services
 *   describe`によるrevision/image一貫性はサービススナップショット比較(`inconclusive`判定)側の
 *   責務、(c) manifest.json同士の静的検証は`sarashinaSummaryGoldenDrift.test.ts`(ステップ3)の
 *   責務。3層のいずれも「GGUF実体hashをruntimeで検証済み」とは主張しない)
 * - `fabrication`: FAIL可(固有名詞の捏造)
 * - `recombination`: WARN専用(原典の言い換え、捏造ではない)
 * - `coverage-aggregate`: FAIL可(全docの重み付きカバー率、role=fabrication除外、閾値85%)
 * - `coverage-per-doc`: FAIL可(mustCover/minCoveredFacts個別判定)
 * - `numeric-fabrication`: FAIL可
 * - `amount-absence`: WARN専用(金額混入検知は対照コーパス整備前のため、codex指摘4によりFAIL化しない)
 * - `determinism`: FAIL可(同一docの複数run間でPASS/FAIL判定が一致するか)
 * - `output-sanity`: WARN専用(codex指摘7とは別に、本ゲート表では`thinking-leak`を含む出力形状
 *   異常の全てをWARN専用として扱う設計判断。`scoreSummary()`自身の`blocking`/`warnings`分類
 *   〔thinking-leakをblocking扱いする〕とは意図的に異なるため、本モジュールは`scoreSummary()`を
 *   直接使わず`evaluateCoverage`/`scanNumericFabrication`/`checkAmountProhibition`/
 *   `analyzeOutputShape`/`checkCrossEntity`を個別に呼び出しゲート表へ再構成する)
 *
 * cross-entity判定(`checkCrossEntity`)は9ゲート表には含めない(plan「実装順序」ステップ4に
 * 明記されたゲート一覧に存在しないため)。D8(cross-entity role)の判定結果はレポートの
 * 参考情報(`crossEntityByDoc`)として記録するに留め、exitCodeには影響させない。
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { buildSummaryPrompt, MAX_SUMMARY_INPUT_LENGTH } from '../../functions/src/ocr/summaryPromptBuilder';
import { scanSummaryForFabrication, type FabricationScanResult } from '../../shared/summaryFabricationScan';
import {
  parseFixtureMeta,
  evaluateCoverage,
  aggregateCoverage,
  scanNumericFabrication,
  checkAmountProhibition,
  checkCrossEntity,
  analyzeOutputShape,
  type SummaryScoreSpec,
  type CoverageResult,
  type CoverageAggregateResult,
  type NumericFabricationResult,
  type AmountProhibitionResult,
  type CrossEntityResult,
  type OutputShapeResult,
} from './sarashinaSummaryScore';
import {
  GCLOUD_SUBPROCESS_TIMEOUT_MS,
  requireEnvField,
  IdTokenProvider,
  classifyFailure,
  sleep,
  parsePositiveIntMinutesToMs,
  type ServiceSnapshot,
} from './cloudRunVerifyCommon';

const execFileAsync = promisify(execFile);

// ============================================================================
// 定数
// ============================================================================

export const SERVICE_NAME = 'sarashina-summary';
export const GOLDEN_DIR = path.join(__dirname, '..', 'fixtures', 'sarashina-summary-golden');
export const DOCS_DIR = path.join(GOLDEN_DIR, 'docs');
export const MANIFEST_PATH = path.join(GOLDEN_DIR, 'manifest.json');
export const DEV_ENV_PATH = path.join(__dirname, '..', 'clients', 'dev.env');
export const EXPECTED_HASHES_PATH = path.join(
  __dirname,
  '..',
  '..',
  'services',
  'sarashina-summary',
  'expected-model-hashes.json'
);

/** meta.jsonに定義された全fixture doc(D5〜D8はPR0未実行、本ハーネスで初めて実機実行する)。 */
export const DOC_IDS: readonly string[] = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10'];

export const DEFAULT_RUNS_PER_DOC = 3;
export const DEFAULT_TEMPERATURE = 0.2;
/** Dockerfileの`LLAMA_ARG_N_PREDICT=1024`(max_tokens省略時のフォールバック)と同値。呼び出し元は
 * 必ずmax_tokensを明示すること、というサービスREADMEの契約を守るため明示的に指定する。 */
export const DEFAULT_MAX_TOKENS = 1024;
/** Cloud Run --timeout=600・LLAMA_ARG_TIMEOUT=600と揃え、サーバ側の504を先に観測できるよう
 * 余裕を持たせる(golden方式と同じ考え方、`scripts/paddle-ocr-verify.ts`のREQUEST_TIMEOUT_MS参照)。 */
export const REQUEST_TIMEOUT_MS = 620_000;
export const MAX_RETRIES = 1;
export const INITIAL_BACKOFF_MS = 2_000;
/** 1ページ相当の生成呼び出しがdoc数×runs回発生するため、429/5xx再試行の累積でも
 * ワークフローのtimeout-minutesを超過しないよう、実行時間そのものも監視する。 */
export const DEFAULT_BUDGET_MS = 60 * 60 * 1000;

const META_ROLE_EXCLUDE_FROM_AGGREGATE = ['fabrication'] as const;

// ============================================================================
// サービスURL解決・スナップショット(gcloud control-plane APIのみ、HTTPは叩かない)
// ============================================================================

/**
 * `scripts/paddle-ocr-verify.ts`の`resolveServiceUrl`と同じ設計(優先順位・ホスト一致チェック)。
 * Sarashina用に環境変数キーを`SARASHINA_SUMMARY_URL`に差し替えただけで、ロジックはPaddleOCR版と
 * 意図的に重複させている(`/plan-crossreview`codex指摘5: サービス固有の値を含む関数は
 * `cloudRunVerifyCommon.ts`へ抽出しない方針の一貫)。
 */
export function resolveServiceUrl(opts: {
  explicitUrl?: string;
  envVarUrl?: string;
  devEnvContent: string;
  devEnvPathForError: string;
}): string {
  const devUrl = requireEnvField(opts.devEnvContent, 'SARASHINA_SUMMARY_URL', opts.devEnvPathForError);
  const candidate = opts.explicitUrl || opts.envVarUrl || devUrl;

  let candidateHost: string;
  let devHost: string;
  try {
    candidateHost = new URL(candidate).host;
    devHost = new URL(devUrl).host;
  } catch {
    throw new Error(`サービスURLの形式が不正です: ${candidate}`);
  }
  if (candidateHost !== devHost) {
    throw new Error(
      `解決したサービスURL(${candidate})のホストが ${opts.devEnvPathForError} の SARASHINA_SUMMARY_URL(${devUrl})と一致しません。` +
        'PR2bはdev環境専用です。誤って他環境を指定していないか確認してください。'
    );
  }
  return candidate;
}

/**
 * `scripts/paddle-ocr-verify.ts`の`getServiceSnapshot`と同じ理由(min-instances=0のため`/health`
 * 等のHTTP呼び出し自体がコールドスタートを誘発する)でcontrol-plane APIのみを使う。
 * PaddleOCR版は`IMAGE_DIGEST`環境変数を読むが、Sarashinaサービスにはその環境変数が無いため、
 * デプロイされたコンテナイメージ参照(`spec.template.spec.containers[0].image`)そのものを
 * `ServiceSnapshot.imageDigest`フィールドへ格納する(型を共有するための意味の読み替え。
 * PaddleOCR版のような「ビルド時digestとの一致」比較には使わない、run開始/終了の一貫性
 * 〔`snapshotsMatch`〕にのみ用いる)。
 */
export async function getServiceSnapshot(projectId: string, region: string): Promise<ServiceSnapshot> {
  const { stdout: revisionRaw } = await execFileAsync('gcloud', [
    'run', 'services', 'describe', SERVICE_NAME,
    '--project', projectId,
    '--region', region,
    '--format', 'value(status.latestReadyRevisionName)',
  ], { timeout: GCLOUD_SUBPROCESS_TIMEOUT_MS });
  const { stdout: imageRaw } = await execFileAsync('gcloud', [
    'run', 'services', 'describe', SERVICE_NAME,
    '--project', projectId,
    '--region', region,
    '--format', 'value(spec.template.spec.containers[0].image)',
  ], { timeout: GCLOUD_SUBPROCESS_TIMEOUT_MS });
  return {
    revisionName: revisionRaw.trim(),
    imageDigest: imageRaw.trim() || null,
  };
}

// ============================================================================
// runtime-contract ゲート(層(a): /props実測値のみ)
// ============================================================================

export interface PropsResponse {
  build_info?: string;
  model_alias?: string;
  total_slots?: number;
  default_generation_settings?: { n_ctx?: number };
}

/**
 * codex review指摘(P2): 生成リクエスト(`makeSummaryRequestFn`)・gcloud呼び出し
 * (`GCLOUD_SUBPROCESS_TIMEOUT_MS`)はいずれもタイムアウトを持つが、本関数だけ無制限
 * `fetch`だとサーバが接続を受けたまま応答しない場合にハーネス全体がbudgetチェックにすら
 * 到達できず固まる。タイムアウト時は例外を投げ、呼び出し側で既存の`runtime-contract:
 * NOT_EVALUATED`扱いへ落ちるようにする。
 */
export const PROPS_REQUEST_TIMEOUT_MS = 60_000;

export async function fetchProps(serviceUrl: string, token: string, timeoutMs: number = PROPS_REQUEST_TIMEOUT_MS): Promise<PropsResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/props`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`/props が HTTP ${res.status} を返しました`);
    }
    return (await res.json()) as PropsResponse;
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new Error(`/props が${timeoutMs}ms以内に応答しませんでした`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface RuntimeManifest {
  model: { baseImageBuildInfo: string };
  runtimeContract: { modelAlias: string; nCtx: number; totalSlots: number };
}

export interface RuntimeContractCheck {
  buildInfoOk: boolean;
  modelAliasOk: boolean;
  nCtxOk: boolean;
  totalSlotsOk: boolean;
  actual: PropsResponse;
  expected: RuntimeManifest;
}

export function checkRuntimeContract(props: PropsResponse, manifest: RuntimeManifest): RuntimeContractCheck {
  return {
    buildInfoOk: props.build_info === manifest.model.baseImageBuildInfo,
    modelAliasOk: props.model_alias === manifest.runtimeContract.modelAlias,
    nCtxOk: props.default_generation_settings?.n_ctx === manifest.runtimeContract.nCtx,
    totalSlotsOk: props.total_slots === manifest.runtimeContract.totalSlots,
    actual: props,
    expected: manifest,
  };
}

export function runtimeContractOk(c: RuntimeContractCheck): boolean {
  return c.buildInfoOk && c.modelAliasOk && c.nCtxOk && c.totalSlotsOk;
}

// ============================================================================
// リクエスト送信(OpenAI Chat Completions互換、独自実装)
// ============================================================================

export interface ChatRequestBody {
  messages: { role: 'user'; content: string }[];
  max_tokens: number;
  temperature: number;
  cache_prompt: false;
  /** PR0(`bench.py`)と同一のリクエスト形状にするための互換フィールド。Sarashinaでは無視される
   * (Qwen系のthinking出力を抑制する目的でPR0が全モデル共通で送っていたもの)。 */
  chat_template_kwargs: { enable_thinking: false };
}

export function buildChatRequestBody(prompt: string, opts?: { maxTokens?: number; temperature?: number }): ChatRequestBody {
  return {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts?.temperature ?? DEFAULT_TEMPERATURE,
    cache_prompt: false,
    chat_template_kwargs: { enable_thinking: false },
  };
}

export interface ChatCompletionResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  timings?: { prompt_n?: number; prompt_ms?: number; predicted_n?: number; predicted_ms?: number };
}

export interface SummaryAttemptResult {
  status: number | null;
  body: string | null;
  wallMs: number;
  kind: 'success' | 'timeout' | 'networkError';
  errorDetail?: string;
}

export type SummaryRequestFn = (serviceUrl: string, requestBody: ChatRequestBody, token: string) => Promise<SummaryAttemptResult>;

export function makeSummaryRequestFn(timeoutMs: number): SummaryRequestFn {
  return async function summaryRequestFn(serviceUrl, requestBody, token): Promise<SummaryAttemptResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const body = await res.text();
      const wallMs = Date.now() - started;
      return { status: res.status, body, wallMs, kind: 'success' };
    } catch (err) {
      const wallMs = Date.now() - started;
      if ((err as { name?: string }).name === 'AbortError') {
        return { status: null, body: null, wallMs, kind: 'timeout' };
      }
      return {
        status: null,
        body: null,
        wallMs,
        kind: 'networkError',
        errorDetail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export const defaultSummaryRequestFn: SummaryRequestFn = makeSummaryRequestFn(REQUEST_TIMEOUT_MS);

/**
 * `/plan-crossreview`(codex指摘5、ADR-0027「Cloud Run timeoutと二重実行の防止」節)反映:
 * timeout・504はその場でリトライしない(サーバ側で処理が継続中の可能性があり、リトライは
 * 二重推論を招く)。429/5xxのみリトライ対象。golden方式(`retryOnTimeoutLike:false`)と同じ方針。
 */
export type RawSummarySendResult =
  | { kind: 'timedOut'; failureKind: 'clientTimeout' | 'serverTimeout504' | 'networkError'; httpStatus: number | null; errorDetail?: string }
  | { kind: 'fatal'; httpStatus: number | null; fatalReason: string }
  | { kind: 'success'; httpStatus: 200; body: string };

export interface SummarySendOutcome {
  elapsedMs: number;
  retriedCount: number;
  authRetried: boolean;
  result: RawSummarySendResult;
}

export async function sendSummaryWithRetries(opts: {
  requestBody: ChatRequestBody;
  serviceUrl: string;
  tokenProvider: IdTokenProvider;
  maxRetries?: number;
  backoffMs?: number;
  requestFn?: SummaryRequestFn;
  nowFn?: () => number;
}): Promise<SummarySendOutcome> {
  const requestFn = opts.requestFn ?? defaultSummaryRequestFn;
  const nowFn = opts.nowFn ?? Date.now;
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const backoffMs = opts.backoffMs ?? INITIAL_BACKOFF_MS;
  let retriedCount = 0;
  let authRetried = false;
  let started: number | undefined;

  for (;;) {
    const token = await opts.tokenProvider.getToken();
    if (started === undefined) started = nowFn();
    const attempt = await requestFn(opts.serviceUrl, opts.requestBody, token);
    const elapsedMs = nowFn() - started;

    if (attempt.kind === 'timeout') {
      return { elapsedMs, retriedCount, authRetried, result: { kind: 'timedOut', failureKind: 'clientTimeout', httpStatus: null } };
    }
    if (attempt.kind === 'networkError') {
      if (retriedCount < maxRetries) {
        retriedCount++;
        await sleep(backoffMs * 2 ** (retriedCount - 1));
        continue;
      }
      return {
        elapsedMs,
        retriedCount,
        authRetried,
        result: { kind: 'timedOut', failureKind: 'networkError', httpStatus: null, errorDetail: attempt.errorDetail },
      };
    }

    if ((attempt.status === 401 || attempt.status === 403) && !authRetried) {
      authRetried = true;
      await opts.tokenProvider.getToken(true);
      continue;
    }
    if ((attempt.status === 401 || attempt.status === 403) && authRetried) {
      return {
        elapsedMs,
        retriedCount,
        authRetried,
        result: { kind: 'fatal', httpStatus: attempt.status, fatalReason: `トークン再発行後も${attempt.status}が続きました` },
      };
    }
    if (attempt.status === 504) {
      return {
        elapsedMs,
        retriedCount,
        authRetried,
        result: { kind: 'timedOut', failureKind: 'serverTimeout504', httpStatus: 504, errorDetail: attempt.body?.slice(0, 500) },
      };
    }

    const failureClass = attempt.status !== null && attempt.status !== 200 ? classifyFailure('httpStatus', attempt.status) : null;
    if (failureClass === 'retryable' && retriedCount < maxRetries) {
      retriedCount++;
      await sleep(backoffMs * 2 ** (retriedCount - 1));
      continue;
    }
    if (attempt.status !== 200) {
      return {
        elapsedMs,
        retriedCount,
        authRetried,
        result: { kind: 'fatal', httpStatus: attempt.status, fatalReason: `HTTP ${attempt.status}: ${attempt.body?.slice(0, 500) ?? ''}` },
      };
    }
    return { elapsedMs, retriedCount, authRetried, result: { kind: 'success', httpStatus: 200, body: attempt.body ?? '' } };
  }
}

export function extractContent(rawBody: string): string {
  const parsed = JSON.parse(rawBody) as ChatCompletionResponse;
  return parsed.choices?.[0]?.message?.content ?? '';
}

// ============================================================================
// 1リクエスト分の記録・採点
// ============================================================================

export interface SummaryRunRecord {
  docId: string;
  run: number;
  wallMs: number;
  httpStatus: number | null;
  retriedCount: number;
  timedOut: boolean;
  failureKind?: 'clientTimeout' | 'serverTimeout504' | 'networkError';
  fatal: boolean;
  fatalReason?: string;
  rawText?: string;
  fabrication?: FabricationScanResult;
  coverage?: CoverageResult;
  numeric?: NumericFabricationResult;
  amount?: AmountProhibitionResult;
  crossEntity?: CrossEntityResult;
  output?: OutputShapeResult;
}

/** 成否に関わらず1件のレコードを作る。評価対象(rawText以降)は成功時のみ埋まる。 */
export function scoreRunRecord(
  docId: string,
  run: number,
  sourceTextForScoring: string,
  spec: SummaryScoreSpec,
  outcome: SummarySendOutcome
): SummaryRunRecord {
  const base = { docId, run, wallMs: outcome.elapsedMs, retriedCount: outcome.retriedCount };
  if (outcome.result.kind === 'timedOut') {
    return {
      ...base,
      httpStatus: outcome.result.httpStatus,
      timedOut: true,
      failureKind: outcome.result.failureKind,
      fatal: false,
    };
  }
  if (outcome.result.kind === 'fatal') {
    return {
      ...base,
      httpStatus: outcome.result.httpStatus,
      timedOut: false,
      fatal: true,
      fatalReason: outcome.result.fatalReason,
    };
  }
  const rawText = extractContent(outcome.result.body);
  return {
    ...base,
    httpStatus: 200,
    timedOut: false,
    fatal: false,
    rawText,
    fabrication: scanSummaryForFabrication(rawText, sourceTextForScoring),
    coverage: evaluateCoverage(rawText, spec),
    numeric: scanNumericFabrication(rawText, sourceTextForScoring),
    amount: checkAmountProhibition(rawText, spec),
    crossEntity: checkCrossEntity(rawText, spec),
    output: analyzeOutputShape(rawText),
  };
}

function isEvaluated(r: SummaryRunRecord): r is SummaryRunRecord & { rawText: string } {
  return !r.fatal && !r.timedOut && r.rawText !== undefined;
}

// ============================================================================
// ゲート判定(9項目)
// ============================================================================

export type SummaryGateVerdict = 'PASS' | 'FAIL' | 'WARN' | 'NOT_EVALUATED';

export interface SummaryGateEntry {
  id:
    | 'runtime-contract'
    | 'fabrication'
    | 'recombination'
    | 'coverage-aggregate'
    | 'coverage-per-doc'
    | 'numeric-fabrication'
    | 'amount-absence'
    | 'determinism'
    | 'output-sanity';
  verdict: SummaryGateVerdict;
  detail: string;
}

export function evaluateFabricationGate(records: readonly SummaryRunRecord[]): SummaryGateEntry {
  const evaluated = records.filter(isEvaluated);
  if (evaluated.length === 0) {
    return { id: 'fabrication', verdict: 'NOT_EVALUATED', detail: '評価対象のrunがありません(全件fatal/timedOut)' };
  }
  const fabricated = evaluated.filter((r) => (r.fabrication?.fabricatedCount ?? 0) > 0);
  if (fabricated.length > 0) {
    return {
      id: 'fabrication',
      verdict: 'FAIL',
      detail: `固有名詞の捏造を検知(${fabricated.length}/${evaluated.length}run): ${fabricated
        .map((r) => `${r.docId}#${r.run}`)
        .join('、')}`,
    };
  }
  return { id: 'fabrication', verdict: 'PASS', detail: `${evaluated.length}run全件で固有名詞捏造0件` };
}

export function evaluateRecombinationGate(records: readonly SummaryRunRecord[]): SummaryGateEntry {
  const evaluated = records.filter(isEvaluated);
  if (evaluated.length === 0) {
    return { id: 'recombination', verdict: 'NOT_EVALUATED', detail: '評価対象のrunがありません' };
  }
  const recombined = evaluated.filter((r) => (r.fabrication?.recombinedCount ?? 0) > 0);
  if (recombined.length > 0) {
    return {
      id: 'recombination',
      verdict: 'WARN',
      detail: `原典の言い換え(捏造ではない)を検知(${recombined.length}/${evaluated.length}run、人手レビュー推奨)`,
    };
  }
  return { id: 'recombination', verdict: 'PASS', detail: '再結合の疑いなし' };
}

export function evaluateCoverageAggregateGate(
  records: readonly SummaryRunRecord[],
  metaByDoc: Record<string, SummaryScoreSpec>
): { entry: SummaryGateEntry; aggregate: CoverageAggregateResult | null } {
  const evaluated = records.filter(isEvaluated);
  if (evaluated.length === 0) {
    return {
      entry: { id: 'coverage-aggregate', verdict: 'NOT_EVALUATED', detail: '評価対象のrunがありません' },
      aggregate: null,
    };
  }
  const inputs = evaluated.map((r) => ({
    docId: `${r.docId}#${r.run}`,
    role: metaByDoc[r.docId].role ?? 'coverage',
    coverage: r.coverage as CoverageResult,
  }));
  const aggregate = aggregateCoverage(inputs, { excludeRoles: META_ROLE_EXCLUDE_FROM_AGGREGATE });
  const verdict: SummaryGateVerdict = aggregate.factsTotal === 0 ? 'NOT_EVALUATED' : aggregate.passed ? 'PASS' : 'FAIL';
  const percent = aggregate.ratio !== null ? `${(aggregate.ratio * 100).toFixed(1)}%` : 'N/A';
  return {
    entry: {
      id: 'coverage-aggregate',
      verdict,
      detail: `カバー率${percent}(${aggregate.coveredTotal}/${aggregate.factsTotal}、閾値${aggregate.thresholdPercent}%、対象${aggregate.includedDocIds.length}run)`,
    },
    aggregate,
  };
}

export function evaluateCoveragePerDocGate(records: readonly SummaryRunRecord[]): SummaryGateEntry {
  const evaluated = records.filter(isEvaluated);
  if (evaluated.length === 0) {
    return { id: 'coverage-per-doc', verdict: 'NOT_EVALUATED', detail: '評価対象のrunがありません' };
  }
  const failing = evaluated.filter((r) => r.coverage && !r.coverage.passed);
  if (failing.length > 0) {
    return {
      id: 'coverage-per-doc',
      verdict: 'FAIL',
      detail: `mustCover/minCoveredFacts未充足(${failing.length}/${evaluated.length}run): ${failing
        .map((r) => `${r.docId}#${r.run}(欠落: ${r.coverage!.missingMustCover.join('、') || r.coverage!.missingFacts.join('、')})`)
        .join('、')}`,
    };
  }
  return { id: 'coverage-per-doc', verdict: 'PASS', detail: `${evaluated.length}run全件でmustCover充足` };
}

export function evaluateNumericFabricationGate(records: readonly SummaryRunRecord[]): SummaryGateEntry {
  const evaluated = records.filter(isEvaluated);
  if (evaluated.length === 0) {
    return { id: 'numeric-fabrication', verdict: 'NOT_EVALUATED', detail: '評価対象のrunがありません' };
  }
  const failing = evaluated.filter((r) => r.numeric && !r.numeric.passed);
  if (failing.length > 0) {
    return {
      id: 'numeric-fabrication',
      verdict: 'FAIL',
      detail: `数値捏造を検知(${failing.length}/${evaluated.length}run): ${failing.map((r) => `${r.docId}#${r.run}`).join('、')}`,
    };
  }
  return { id: 'numeric-fabrication', verdict: 'PASS', detail: `${evaluated.length}run全件で数値捏造0件` };
}

export function evaluateAmountAbsenceGate(records: readonly SummaryRunRecord[]): SummaryGateEntry {
  const evaluated = records.filter(isEvaluated).filter((r) => r.amount?.applicable);
  if (evaluated.length === 0) {
    return { id: 'amount-absence', verdict: 'NOT_EVALUATED', detail: 'must_not_contain_amount対象のdocに評価済みrunがありません' };
  }
  const violating = evaluated.filter((r) => r.amount && !r.amount.passed);
  if (violating.length > 0) {
    return {
      id: 'amount-absence',
      verdict: 'WARN',
      detail: `金額混入を検知(WARN、FAILゲート化は対照コーパス整備後に検討、${violating.length}/${evaluated.length}run): ${violating
        .map((r) => `${r.docId}#${r.run}`)
        .join('、')}`,
    };
  }
  return { id: 'amount-absence', verdict: 'PASS', detail: `${evaluated.length}run全件で金額混入なし` };
}

export function evaluateOutputSanityGate(records: readonly SummaryRunRecord[]): SummaryGateEntry {
  const evaluated = records.filter(isEvaluated);
  if (evaluated.length === 0) {
    return { id: 'output-sanity', verdict: 'NOT_EVALUATED', detail: '評価対象のrunがありません' };
  }
  const withAnomaly = evaluated.filter((r) => (r.output?.anomalies.length ?? 0) > 0);
  if (withAnomaly.length > 0) {
    const kinds = [...new Set(withAnomaly.flatMap((r) => r.output!.anomalies))].sort();
    return {
      id: 'output-sanity',
      verdict: 'WARN',
      detail: `出力形状の異常を検知(WARN専用、thinking漏れ含む。${withAnomaly.length}/${evaluated.length}run、種別: ${kinds.join('、')})`,
    };
  }
  return { id: 'output-sanity', verdict: 'PASS', detail: `${evaluated.length}run全件で出力形状異常なし` };
}

/**
 * 同一docの複数run間で、カバー率・数値捏造・固有名詞捏造それぞれのPASS/FAIL判定(booleanの
 * 組)が一致しているかを見る(生成テキストそのものの完全一致は求めない。自由文要約に対する
 * 「決定論性」は判定結果レベルで定義する設計判断)。
 */
export function evaluateDeterminismGate(records: readonly SummaryRunRecord[]): SummaryGateEntry {
  const evaluated = records.filter(isEvaluated);
  const byDoc = new Map<string, typeof evaluated>();
  for (const r of evaluated) {
    if (!byDoc.has(r.docId)) byDoc.set(r.docId, []);
    byDoc.get(r.docId)!.push(r);
  }
  const evaluableDocs = [...byDoc.entries()].filter(([, rs]) => rs.length >= 2);
  if (evaluableDocs.length === 0) {
    return { id: 'determinism', verdict: 'NOT_EVALUATED', detail: '2run以上評価できたdocがありません' };
  }
  const inconsistentDocs: string[] = [];
  for (const [docId, rs] of evaluableDocs) {
    const signatures = new Set(
      rs.map((r) => JSON.stringify([r.coverage?.passed, r.numeric?.passed, (r.fabrication?.fabricatedCount ?? 0) > 0]))
    );
    if (signatures.size > 1) inconsistentDocs.push(docId);
  }
  if (inconsistentDocs.length > 0) {
    return {
      id: 'determinism',
      verdict: 'FAIL',
      detail: `run間でカバー率/数値捏造/固有名詞捏造の判定が一致しないdoc: ${inconsistentDocs.join('、')}`,
    };
  }
  return { id: 'determinism', verdict: 'PASS', detail: `${evaluableDocs.length}doc全てでrun間の判定が一致` };
}

// ============================================================================
// レポート
// ============================================================================

export interface SummaryVerifyReport {
  schemaVersion: 1;
  startedAt: string;
  finishedAt: string | null;
  serviceUrl: string;
  serviceSnapshotStart: ServiceSnapshot | null;
  serviceSnapshotEnd: ServiceSnapshot | null;
  inconclusive: boolean;
  inconclusiveReason: string | null;
  runtimeContract: RuntimeContractCheck | null;
  records: SummaryRunRecord[];
  docsWithoutSuccessfulRun: string[];
  timedOutCount: number;
  /** budget超過・早期break等で1件も送信されなかった(doc,run)の一覧(`${docId}#${run}`形式)。 */
  skippedRuns: string[];
  gates: SummaryGateEntry[];
  crossEntityByDoc: Record<string, CrossEntityResult>;
  fatalError: string | null;
  notes: string[];
}

const REPORT_NOTES = [
  'v1プロンプト(本番summaryPromptBuilder.tsのbuildSummaryPrompt)を主対象とする。v2プロンプトはPR0の参考結果に留まりPR3で改めて判断する。',
  'D5〜D8はPR0で未実行のためmustCoverが暫定値のまま。初回実機実行はbaseline収集runとして扱い、正式gate runは基準確定後に別途実行する(6b節参照)。',
  'cross-entity判定(D8対象)は9ゲート表に含まれない。crossEntityByDocを参考情報として記録するに留める。',
  'determinismは生成テキストの完全一致ではなく、同一docの複数run間でカバー率/数値捏造/固有名詞捏造のPASS/FAIL判定が一致するかで評価する。',
];

export function buildReport(input: {
  serviceUrl: string;
  startedAt: string;
  finishedAt: string;
  serviceSnapshotStart: ServiceSnapshot | null;
  serviceSnapshotEnd: ServiceSnapshot | null;
  runtimeContract: RuntimeContractCheck | null;
  records: SummaryRunRecord[];
  metaByDoc: Record<string, SummaryScoreSpec>;
  /** 実行が要求されていたdoc一覧(`args.docs`)。budget超過等での早期打ち切り検知に使う。 */
  expectedDocs: readonly string[];
  /** doc毎に要求されていたrun数(`args.runs`)。 */
  expectedRunsPerDoc: number;
}): SummaryVerifyReport {
  const inconclusiveBySnapshot =
    input.serviceSnapshotStart === null ||
    input.serviceSnapshotEnd === null ||
    input.serviceSnapshotStart.revisionName !== input.serviceSnapshotEnd.revisionName ||
    input.serviceSnapshotStart.imageDigest !== input.serviceSnapshotEnd.imageDigest;

  // codex review指摘(P1): timeout/504はサーバ側で処理が継続中の可能性があり、以降のサンプルが
  // 汚染されうる(`scripts/paddle-ocr-verify.ts`の`inconclusiveByTimeout`と同じ考え方)。
  // 1件でもtimedOutがあればレポート全体をinconclusiveとする(そのdocに他の成功runがあっても
  // 「静かなPASS」にしない)。
  const timedOutCount = input.records.filter((r) => r.timedOut).length;
  const inconclusiveByTimeout = timedOutCount > 0;

  const docsWithoutSuccessfulRun = DOC_IDS.filter(
    (docId) => input.records.some((r) => r.docId === docId) && !input.records.some((r) => r.docId === docId && isEvaluated(r))
  );
  const inconclusiveByMissingDoc = docsWithoutSuccessfulRun.length > 0;

  // codex review指摘(P1): budget超過・例外による早期breakで要求された(doc,run)の一部が
  // 1回も送信されないまま終わった場合、`docsWithoutSuccessfulRun`はrecordsに存在するdocしか
  // 見ないため検知できず、「一部docだけの部分実行」がPASSしてしまう。要求された全(doc,run)の
  // 組が実際に送信(records化)されたかを直接突き合わせる。
  const attemptedKeys = new Set(input.records.map((r) => `${r.docId}#${r.run}`));
  const skippedRuns = input.expectedDocs.flatMap((docId) =>
    Array.from({ length: input.expectedRunsPerDoc }, (_, i) => `${docId}#${i + 1}`).filter((key) => !attemptedKeys.has(key))
  );
  const inconclusiveByBudget = skippedRuns.length > 0;

  const inconclusive = inconclusiveBySnapshot || inconclusiveByTimeout || inconclusiveByMissingDoc || inconclusiveByBudget;
  const inconclusiveReason = inconclusiveBySnapshot
    ? `計測開始時と終了時でサービススナップショットが一致しません(開始: ${JSON.stringify(input.serviceSnapshotStart)}, 終了: ${JSON.stringify(input.serviceSnapshotEnd)})`
    : inconclusiveByTimeout
      ? `${timedOutCount}件のリクエストがタイムアウトまたは504(サービス側で処理継続中)を検知しました。以降のリクエストのインスタンス割当が汚染されている可能性があります`
      : inconclusiveByMissingDoc
        ? `以下のdocで有効なrunが1件も得られませんでした: ${docsWithoutSuccessfulRun.join('、')}`
        : inconclusiveByBudget
          ? `実行時間予算の超過等により以下の(doc,run)が送信されませんでした: ${skippedRuns.join('、')}`
          : null;

  const runtimeContractEntry: SummaryGateEntry = input.runtimeContract
    ? {
        id: 'runtime-contract',
        verdict: runtimeContractOk(input.runtimeContract) ? 'PASS' : 'FAIL',
        detail: `build_info=${input.runtimeContract.actual.build_info ?? 'N/A'} model_alias=${
          input.runtimeContract.actual.model_alias ?? 'N/A'
        } n_ctx=${input.runtimeContract.actual.default_generation_settings?.n_ctx ?? 'N/A'} total_slots=${
          input.runtimeContract.actual.total_slots ?? 'N/A'
        }`,
      }
    : { id: 'runtime-contract', verdict: 'NOT_EVALUATED', detail: '/propsの取得に失敗しました' };

  const { entry: coverageAggregateEntry } = evaluateCoverageAggregateGate(input.records, input.metaByDoc);

  const gates: SummaryGateEntry[] = [
    runtimeContractEntry,
    evaluateFabricationGate(input.records),
    evaluateRecombinationGate(input.records),
    coverageAggregateEntry,
    evaluateCoveragePerDocGate(input.records),
    evaluateNumericFabricationGate(input.records),
    evaluateAmountAbsenceGate(input.records),
    evaluateDeterminismGate(input.records),
    evaluateOutputSanityGate(input.records),
  ];

  const crossEntityByDoc: Record<string, CrossEntityResult> = {};
  for (const r of input.records) {
    if (isEvaluated(r) && r.crossEntity && !crossEntityByDoc[r.docId]) {
      crossEntityByDoc[r.docId] = r.crossEntity;
    }
  }

  return {
    schemaVersion: 1,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    serviceUrl: input.serviceUrl,
    serviceSnapshotStart: input.serviceSnapshotStart,
    serviceSnapshotEnd: input.serviceSnapshotEnd,
    inconclusive,
    inconclusiveReason,
    runtimeContract: input.runtimeContract,
    records: input.records,
    docsWithoutSuccessfulRun,
    timedOutCount,
    skippedRuns,
    gates,
    crossEntityByDoc,
    fatalError: null,
    notes: REPORT_NOTES,
  };
}

const FAIL_CAPABLE_GATES: ReadonlySet<SummaryGateEntry['id']> = new Set([
  'runtime-contract',
  'fabrication',
  'coverage-aggregate',
  'coverage-per-doc',
  'numeric-fabrication',
  'determinism',
]);

/**
 * WARN専用ゲート(recombination/amount-absence/output-sanity)はexitCodeに影響しない。
 * FAIL可のゲートがFAILまたはNOT_EVALUATEDならexitCode=1(`scripts/paddle-ocr-verify.ts`の
 * `determineExitCode`と同じ「未評価も失敗condition」の設計)。
 */
export function determineExitCode(report: SummaryVerifyReport): 0 | 1 {
  const anyFatal = report.records.some((r) => r.fatal);
  const failCapableBad = report.gates.some(
    (g) => FAIL_CAPABLE_GATES.has(g.id) && (g.verdict === 'FAIL' || g.verdict === 'NOT_EVALUATED')
  );
  return report.inconclusive || anyFatal || failCapableBad ? 1 : 0;
}

export function buildStepSummaryMarkdown(report: SummaryVerifyReport): string {
  const lines: string[] = [];
  lines.push('## Sarashina要約 PR2b: 実機ゲートハーネス結果');
  lines.push('');
  lines.push(`- inconclusive: ${report.inconclusive}${report.inconclusiveReason ? ` (${report.inconclusiveReason})` : ''}`);
  lines.push(`- 評価対象run: ${report.records.filter(isEvaluated).length} / ${report.records.length}`);
  if (report.docsWithoutSuccessfulRun.length > 0) {
    lines.push(`- 有効runが0件だったdoc: ${report.docsWithoutSuccessfulRun.join('、')}`);
  }
  if (report.timedOutCount > 0) {
    lines.push(`- タイムアウト/504件数: ${report.timedOutCount}`);
  }
  if (report.skippedRuns.length > 0) {
    lines.push(`- 実行時間予算超過等で送信されなかった(doc,run): ${report.skippedRuns.join('、')}`);
  }
  lines.push('');
  lines.push('| ゲート | 判定 | 詳細 |');
  lines.push('|---|---|---|');
  for (const g of report.gates) {
    lines.push(`| ${g.id} | ${g.verdict} | ${g.detail} |`);
  }
  lines.push('');
  lines.push('WARN専用ゲート(recombination/amount-absence/output-sanity)はexitCodeに影響しない。');
  lines.push('');
  lines.push('### 注記');
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  return lines.join('\n');
}

export function emptyReportSkeleton(startedAt: string, finishedAt: string, serviceUrl: string, fatalError: string): SummaryVerifyReport {
  return {
    schemaVersion: 1,
    startedAt,
    finishedAt,
    serviceUrl,
    serviceSnapshotStart: null,
    serviceSnapshotEnd: null,
    inconclusive: true,
    inconclusiveReason: 'fatalErrorにより計測を完了できませんでした',
    runtimeContract: null,
    records: [],
    docsWithoutSuccessfulRun: [...DOC_IDS],
    timedOutCount: 0,
    skippedRuns: [],
    gates: [],
    crossEntityByDoc: {},
    fatalError,
    notes: REPORT_NOTES,
  };
}

// ============================================================================
// CLI引数
// ============================================================================

export interface CliArgs {
  url?: string;
  runs: number;
  temperature: number;
  maxTokens: number;
  out: string;
  budgetMs: number;
  docs: readonly string[];
}

export function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }

  const MAX_RUNS = 10;
  let runs = DEFAULT_RUNS_PER_DOC;
  if (args.runs !== undefined) {
    if (!/^\d+$/.test(args.runs)) {
      throw new Error(`--runs は1以上の整数を指定してください(got: ${args.runs})`);
    }
    runs = Number.parseInt(args.runs, 10);
    if (!Number.isSafeInteger(runs) || runs < 1 || runs > MAX_RUNS) {
      throw new Error(`--runs は1以上${MAX_RUNS}以下の整数を指定してください(got: ${args.runs})`);
    }
  }

  let temperature = DEFAULT_TEMPERATURE;
  if (args.temperature !== undefined) {
    temperature = Number(args.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new Error(`--temperature は0以上2以下の数値を指定してください(got: ${args.temperature})`);
    }
  }

  let maxTokens = DEFAULT_MAX_TOKENS;
  if (args['max-tokens'] !== undefined) {
    if (!/^\d+$/.test(args['max-tokens'])) {
      throw new Error(`--max-tokens は1以上の整数を指定してください(got: ${args['max-tokens']})`);
    }
    maxTokens = Number.parseInt(args['max-tokens'], 10);
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) {
      throw new Error(`--max-tokens は1以上の整数を指定してください(got: ${args['max-tokens']})`);
    }
  }

  let docs: readonly string[] = DOC_IDS;
  if (args.docs !== undefined) {
    docs = args.docs.split(',').map((d) => d.trim());
    for (const d of docs) {
      if (!DOC_IDS.includes(d)) {
        throw new Error(`--docs に未知のdoc "${d}" が含まれています(有効値: ${DOC_IDS.join(',')})`);
      }
    }
  }

  let budgetMs = DEFAULT_BUDGET_MS;
  if (args['budget-minutes'] !== undefined) {
    budgetMs = parsePositiveIntMinutesToMs(args['budget-minutes'], 'budget-minutes');
  }

  const out = args.out ?? path.join(process.cwd(), 'sarashina-summary-verify.json');

  return { url: args.url, runs, temperature, maxTokens, out, budgetMs, docs };
}

// ============================================================================
// fixture読込ヘルパ
// ============================================================================

export const META_PATH = path.join(DOCS_DIR, 'meta.json');

export function loadMetaRaw(): Record<string, { title?: string }> {
  return JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
}

export function loadMetaByDoc(): Record<string, SummaryScoreSpec> {
  return parseFixtureMeta(loadMetaRaw());
}

export function loadFullSourceText(docId: string): string {
  return fs.readFileSync(path.join(DOCS_DIR, `${docId}.txt`), 'utf-8');
}

export function sourceTextForScoring(fullText: string): string {
  return fullText.slice(0, MAX_SUMMARY_INPUT_LENGTH);
}

export function loadDocTitle(docId: string, metaRaw: Record<string, { title?: string }>): string {
  return metaRaw[docId]?.title ?? '';
}

/**
 * 本番`summaryPromptBuilder.ts`の`buildSummaryPrompt`をそのまま呼び出す(v1プロンプト、
 * 独自実装で再現しない。truncation・fallbackラベル等の文言ドリフトを構造的に防ぐ)。
 * 呼び出し元には切り詰め前の全文(`fullText`)を渡し、`buildSummaryPrompt`自身に
 * `MAX_SUMMARY_INPUT_LENGTH`での切り詰め+「...(以下省略)」付与をさせる(本番と同一の挙動)。
 */
export function buildPromptForDoc(docId: string, fullText: string, metaRaw: Record<string, { title?: string }>): string {
  return buildSummaryPrompt(fullText, loadDocTitle(docId, metaRaw));
}
