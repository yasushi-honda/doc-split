#!/usr/bin/env ts-node
/**
 * ADR-0025 PR4c Stage 1/3: PaddleOCR Cloud Run実機の一次スクリーニング(golden再現性検証)+
 * 実データ規模の負荷試験(load)。
 *
 * 背景: 承認済み計画(~/.claude/plans/fuzzy-moseying-book.md §4)は「6〜8秒/ページ」
 * (ローカルMac arm64のPoC実測)を前提にフル負荷試験を設計していたが、plan mode中の実測で
 * dev Cloud Run実機の`/ocr`実績が96.6秒/ページ(1桁の乖離)であることが判明した。本スクリプトは
 * その乖離の実力値を安価に確認するStage 1(`~/.claude/plans/enumerated-gliding-bengio.md`)の
 * 実装として`golden`モードを持つ。`--mode=load`はStage 3
 * (`~/.claude/plans/peaceful-strolling-squid.md`、2026-09-18)の実装で、1/20/71/160ページの
 * 実データ規模でwarm/cold系列を実測しゲート判定する。pngモード・独立したcoldモード単体コマンドは
 * 未実装のまま(loadモード内の`--series=cold`で代替)。
 *
 * 重要な限界(plan-crossreview: grip自白 + codex 2パスで検証済み、詳細は上記計画ファイル参照):
 * - Cloud Runは逐次リクエストでも同一インスタンスへのルーティングを保証しないため、
 *   1件目(firstRequestMs)・2件目以降(subsequentRequestsMs)のいずれも「真のcold/warm確定」
 *   ではない。本スクリプトが提供するのは一次スクリーニングであり、PR6着手のGo判定ではない。
 * - ローカルMacのユーザー認証(個人Owner権限)では実行できない
 *   (`gcloud auth print-identity-token --audiences=` がユーザー認証情報で非対応、
 *   impersonationも`iam.serviceAccounts.getAccessToken`がOwnerロールに含まれずPERMISSION_DENIED
 *   で失敗することを実機確認済み)。サービスアカウント資格情報、または
 *   `roles/iam.serviceAccountTokenCreator`を伴う許可済みimpersonationがあれば実行可能。
 *   Stage 1では追加のIAM付与を行わず、GitHub Actions(.github/workflows/paddle-ocr-verify.yml、
 *   デプロイSA docsplit-cloud-build@<project>の既存roles/run.adminを利用)経由での実行を前提とする。
 *
 * 実行例:
 *   npx ts-node scripts/paddle-ocr-verify.ts --mode=golden --repeat=3
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { percentile } from './lib/confirmedReplayStats';
import { loadFixturePath } from './fixtures/paddleOcrLoadFixtures';
import {
  LOAD_TIERS,
  type LoadTier,
  LOAD_GATES,
  WARM_TRIALS_FULL,
  COLD_BURSTS_FULL,
  COLD_BURST_SIZE,
  QUICK_PARAMS,
  CIRCUIT_BREAK_THRESHOLD,
  COOLDOWN_AFTER_FAILURE_MS,
  LOAD_MAX_RETRIES,
  LOAD_INITIAL_BACKOFF_MS,
  LOAD_REQUEST_TIMEOUT_MS,
  initialTrialState,
  reduceTrialOutcome,
  finalizeTrialFailedPageCount,
  trialSucceeded,
  initialCircuitState,
  reduceCircuitState,
  checkLoadContract,
  loadContractOk,
  EXPECTED_LOAD_FIXTURE_SHA256,
  buildLoadReport,
  emptyLoadReportSkeleton,
  determineLoadExitCode,
  buildLoadStepSummaryMarkdown,
  type LoadSeries,
  type LoadIntensity,
  type LoadTrialRecord,
  type ColdBurstRecord,
  type LoadPageRecord,
  type LoadReport,
  type LoadServiceSnapshot,
  type PageFailureKind,
} from './lib/paddleOcrLoad';

const execFileAsync = promisify(execFile);

// ============================================================================
// 定数
// ============================================================================

export const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'paddle-ocr-golden');
export const MANIFEST_PATH = path.join(FIXTURE_DIR, 'manifest.json');
export const DEV_ENV_PATH = path.join(__dirname, 'clients', 'dev.env');

const SERVICE_NAME = 'paddle-ocr';
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2_000;
const MIN_SUBSEQUENT_SAMPLES = 10;
/**
 * silent-failure-hunter指摘(Medium、pr-review-toolkit): `/ocr`本体は`AbortController`で
 * 明示的に180秒の上限を設けているのに対し、同じ理由で外部プロセスに依存する`gcloud`呼び出し
 * (トークン発行・サービススナップショット取得)には従来タイムアウトがなかった。gcloudが
 * ネットワーク不調・認証状態異常等でハングすると、例外にすらならず無限に待ち続け、
 * 「main()のトップレベルcatchでも必ずレポートを書き出す」という設計全体が発動する機会すら
 * 得られないまま、GitHub Actionsのjob timeout-minutes(240分)でジョブごと強制終了される
 * (この場合`if: always()`のartifactアップロードすら実行されない)。妥当な上限を設け、
 * 既存のtry/catch機構に正しく捕捉させる。
 */
const GCLOUD_SUBPROCESS_TIMEOUT_MS = 60_000;
/**
 * codex review(8周目)指摘(P2): `--repeat`の上限(20)だけでは、429/5xxの再試行が繰り返し
 * 発生するケースで `.github/workflows/paddle-ocr-verify.yml` の `timeout-minutes: 240` を
 * 超過しうる(1ケース最悪約734秒×多数ケース)。ケース数の上限だけに頼らず、実行時間そのものを
 * 監視し、安全マージンを残してレポート書き出しに戻れるようにする。200分(12,000,000ms)は
 * 240分ジョブタイムアウトからsetup(checkout/auth/npm ci等)+最終スナップショット取得+
 * レポート書き出しの時間を差し引いた安全な内側の予算。
 */
const RUN_BUDGET_MS = 200 * 60 * 1000;

/**
 * loadモードの`--budget-minutes`既定値(tier別)。71ページwarm系列は見込み154〜175分+
 * リトライで200分(golden既定のRUN_BUDGET_MS)を超過しうるため、tier別に出し分ける
 * (ADR-0025 PR4c Stage3、2026-09-18 Fable 5.1レビュー指摘M4反映)。
 */
const LOAD_BUDGET_MINUTES_DEFAULT: Record<LoadTier | 'all', number> = {
  1: 80,
  20: 80,
  71: 320,
  160: 80,
  all: 60,
};

/**
 * 71ページ(必須ゲート)・20ページ・1ページの合格基準(秒)。
 * 出典: ~/.claude/plans/shiny-knitting-flamingo.md 184-187行目(decision-maker確定済み)。
 */
export const GATE_THRESHOLDS_SECONDS = {
  p1: 30,
  p20: 400,
  p71: 850,
} as const;

/**
 * fixture対応表(固定、文字列組み立てをしない)。
 * manifest.jsonのfixturesキーはハイフン区切り、PDFファイル名はアンダースコア区切り、
 * 期待値は<id>.pages.jsonのページ別配列と、命名規則が3通り混在しているため、
 * 文字列変換で導出せず定数テーブルとしてハードコードする(codex pass1指摘)。
 */
export interface GoldenCase {
  readonly manifestId: string;
  readonly pdfFile: string;
  readonly pagesJsonFile: string;
  readonly pageIndex: number;
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { manifestId: 'golden-plain-01', pdfFile: 'golden_plain_01.pdf', pagesJsonFile: 'golden-plain-01.pages.json', pageIndex: 0 },
  { manifestId: 'golden-plain-02', pdfFile: 'golden_plain_02.pdf', pagesJsonFile: 'golden-plain-02.pages.json', pageIndex: 0 },
  { manifestId: 'golden-oldkanji-01', pdfFile: 'golden_oldkanji_01.pdf', pagesJsonFile: 'golden-oldkanji-01.pages.json', pageIndex: 0 },
  { manifestId: 'golden-oldkanji-02', pdfFile: 'golden_oldkanji_02.pdf', pagesJsonFile: 'golden-oldkanji-02.pages.json', pageIndex: 0 },
  { manifestId: 'golden-multipage-01', pdfFile: 'golden_multipage_01-p1.pdf', pagesJsonFile: 'golden-multipage-01.pages.json', pageIndex: 0 },
  { manifestId: 'golden-multipage-01', pdfFile: 'golden_multipage_01-p2.pdf', pagesJsonFile: 'golden-multipage-01.pages.json', pageIndex: 1 },
];

// ============================================================================
// env ファイル解析(deploy-paddle-ocr.yml の resolve_field() と同じプレースホルダー判定)
// ============================================================================

const PLACEHOLDER_VALUES = new Set([
  '', '<TBD>', 'TBD', 'tbd', '<TODO>', 'TODO', 'todo', '<FIXME>', 'FIXME', 'fixme',
  'null', 'NULL', 'undefined', 'UNDEFINED', 'xxx', 'XXX', '<PLACEHOLDER>',
]);

export function parseEnvField(content: string, key: string): string | null {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const match = content.match(re);
  if (!match) return null;
  return match[1].replace(/["']/g, '').trim();
}

export function requireEnvField(content: string, key: string, envFilePathForError: string): string {
  const val = parseEnvField(content, key);
  if (val === null || PLACEHOLDER_VALUES.has(val)) {
    throw new Error(`${key} が ${envFilePathForError} に設定されていません(値: ${val === null ? '未検出' : val})`);
  }
  return val;
}

/**
 * サービスURLを解決する。優先順位: --url > 環境変数 PADDLE_OCR_URL > scripts/clients/dev.env。
 * 解決したURLのホストが dev.env の値と一致しない場合は即エラーにする(将来kanameone/cocoroにも
 * PADDLE_OCR_URLが設定された後の誤爆防止。PR4c(Stage 1/3、golden/loadいずれのモードも)は
 * dev環境専用のため常にdev.envと一致するはず)。
 */
export function resolveServiceUrl(opts: {
  explicitUrl?: string;
  envVarUrl?: string;
  devEnvContent: string;
  devEnvPathForError: string;
}): string {
  const devUrl = requireEnvField(opts.devEnvContent, 'PADDLE_OCR_URL', opts.devEnvPathForError);
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
      `解決したサービスURL(${candidate})のホストが ${opts.devEnvPathForError} の PADDLE_OCR_URL(${devUrl})と一致しません。` +
        'PR4c(Stage 1/3)はdev環境専用です。誤って他環境を指定していないか確認してください。'
    );
  }
  return candidate;
}

// ============================================================================
// golden fixture 整合性チェック
// ============================================================================

export interface GoldenManifest {
  fixtures: Record<string, { sourcePdfSha256: Record<string, string>; pageCount: number }>;
  textDetectionModelFileHashes: Record<string, string>;
  textRecognitionModelFileHashes: Record<string, string>;
}

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * manifest.jsonのsourcePdfSha256と実ファイルのSHA-256を突合する。
 * 世代混在防止(functions/test/paddleOcrArbitrationRegression.test.tsと同じ防御)。
 */
export function verifyGoldenManifestHashes(
  manifest: GoldenManifest,
  fixtureDir: string
): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const checked = new Set<string>();
  for (const c of GOLDEN_CASES) {
    if (checked.has(c.pdfFile)) continue;
    checked.add(c.pdfFile);
    const fixture = manifest.fixtures[c.manifestId];
    if (!fixture) {
      mismatches.push(`${c.manifestId}: manifest.jsonのfixturesに存在しません`);
      continue;
    }
    const expected = fixture.sourcePdfSha256[c.pdfFile];
    if (!expected) {
      mismatches.push(`${c.pdfFile}: manifest.jsonにsourcePdfSha256エントリがありません`);
      continue;
    }
    const actual = sha256File(path.join(fixtureDir, c.pdfFile));
    if (actual !== expected) {
      mismatches.push(`${c.pdfFile}: SHA-256不一致(expected=${expected}, actual=${actual})`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * manifest.jsonのモデル重みハッシュ先頭12文字から期待modelVersionを組み立てる。
 * services/paddle-ocr/ocr_engine.py の model_version 組み立てロジックと同じ規則。
 */
export function deriveExpectedModelVersion(manifest: GoldenManifest): string {
  const det = manifest.textDetectionModelFileHashes['inference.pdiparams'];
  const rec = manifest.textRecognitionModelFileHashes['inference.pdiparams'];
  if (!det || !rec) {
    throw new Error('manifest.jsonにtextDetection/textRecognitionModelFileHashes["inference.pdiparams"]が見つかりません');
  }
  return `PP-OCRv6_medium/det:${det.slice(0, 12)}/rec:${rec.slice(0, 12)}`;
}

// ============================================================================
// IDトークン管理(JWT expデコードによる遅延更新、pass2でエッジケース追記)
// ============================================================================

/**
 * JWTペイロード(base64url)をデコードしてexp(epoch秒)を読み取る。自己発行トークンの
 * 読み取りのみのため署名検証は行わない。デコードに失敗した場合はnullを返し、
 * 呼び出し側はキャッシュせず都度再取得する(pass2指摘、実機でのペイロード形式は未検証のため
 * 安全側に倒す)。
 */
export function decodeJwtExpSeconds(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const base64url = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export class IdTokenProvider {
  private cachedToken: string | null = null;
  private cachedExpSeconds: number | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly audience: string,
    private readonly mintFn: (audience: string) => Promise<string> = mintIdToken
  ) {}

  /** 有効期限まで300秒を切っている、またはexpデコード不能なら再取得する。 */
  async getToken(forceRefresh = false): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const stillValid =
      !forceRefresh &&
      this.cachedToken !== null &&
      this.cachedExpSeconds !== null &&
      nowSeconds < this.cachedExpSeconds - 300;
    if (stillValid) {
      return this.cachedToken as string;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.mint();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async mint(): Promise<string> {
    const token = await this.mintFn(this.audience);
    this.cachedToken = token;
    this.cachedExpSeconds = decodeJwtExpSeconds(token);
    return token;
  }
}

async function mintIdToken(audience: string): Promise<string> {
  const { stdout } = await execFileAsync('gcloud', ['auth', 'print-identity-token', '--audiences', audience], {
    timeout: GCLOUD_SUBPROCESS_TIMEOUT_MS,
  });
  return stdout.trim();
}

// ============================================================================
// サービススナップショット(Cloud Run control-plane APIのみ、HTTPは叩かない)
// ============================================================================

export interface ServiceSnapshot {
  revisionName: string;
  imageDigest: string | null;
}

/**
 * codex pass2 High指摘の反映: 当初案は`GET /health`でスナップショットを取得していたが、
 * min-instances=0のCloud Runではこの呼び出し自体がインスタンス起動・モデルロードを誘発し、
 * 直後に送る1件目のgoldenリクエスト(firstRequestMs)を意図せずwarm化してしまう。
 * そのため本関数はCloud Run control-plane API(`gcloud run services describe`)のみを使い、
 * サービスのHTTPエンドポイントには一切リクエストしない。modelVersionは1件目のgolden
 * レスポンス自体から検証する(別途/healthを叩かない)。
 */
export async function getServiceSnapshot(projectId: string, region: string): Promise<ServiceSnapshot> {
  const { stdout: revisionRaw } = await execFileAsync('gcloud', [
    'run', 'services', 'describe', SERVICE_NAME,
    '--project', projectId,
    '--region', region,
    '--format', 'value(status.latestReadyRevisionName)',
  ], { timeout: GCLOUD_SUBPROCESS_TIMEOUT_MS });
  const { stdout: envJsonRaw } = await execFileAsync('gcloud', [
    'run', 'services', 'describe', SERVICE_NAME,
    '--project', projectId,
    '--region', region,
    '--format', 'json(spec.template.spec.containers[0].env)',
  ], { timeout: GCLOUD_SUBPROCESS_TIMEOUT_MS });
  const parsed = JSON.parse(envJsonRaw) as {
    spec?: { template?: { spec?: { containers?: Array<{ env?: Array<{ name: string; value?: string }> }> } } };
  };
  const envList = parsed.spec?.template?.spec?.containers?.[0]?.env ?? [];
  const imageDigestEntry = envList.find((e) => e.name === 'IMAGE_DIGEST');
  return {
    revisionName: revisionRaw.trim(),
    imageDigest: imageDigestEntry?.value ?? null,
  };
}

export function snapshotsMatch(a: ServiceSnapshot, b: ServiceSnapshot): boolean {
  return a.revisionName === b.revisionName && a.imageDigest === b.imageDigest;
}

// ============================================================================
// リトライ分類(codex pass1/pass2反映)
// ============================================================================

export type RequestFailureKind = 'networkError' | 'timeout' | 'httpStatus';

/**
 * リトライ対象はネットワークエラー・429・5xx系のみ。400/413/415/422等の4xxおよび
 * クライアントタイムアウト(180秒)は即fatal/timedOutとしリトライしない。
 *
 * タイムアウトをリトライしない理由(codex pass2 High指摘): アプリ内上限は240秒・Cloud Run
 * timeoutは300秒のため、クライアントが180秒で諦めて再送しても、サーバ側OCRは継続しうる。
 * maxScale=3の下で再送が別インスタンスへ回ると並行処理が発生し、subsequentRequestsMs系列の
 * 「逐次実行」という前提そのものを汚染する。
 */
export function classifyFailure(kind: RequestFailureKind, httpStatus: number | null): 'retryable' | 'fatal' | 'timeout' {
  if (kind === 'timeout') return 'timeout';
  if (kind === 'networkError') return 'retryable';
  // kind === 'httpStatus'
  if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500 && httpStatus <= 599)) {
    return 'retryable';
  }
  return 'fatal';
}

// ============================================================================
// 統計量(既存 confirmedReplayStats.ts の percentile を再利用、nearest-rank法)
// ============================================================================

export interface LatencySummary {
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  n: number;
}

export function summarizeLatencies(valuesMs: number[]): LatencySummary {
  const sorted = [...valuesMs].sort((a, b) => a - b);
  return {
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    minMs: sorted.length > 0 ? sorted[0] : 0,
    maxMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    n: sorted.length,
  };
}

/** ページ数換算(ミリ秒/ページ → 秒)。71/20/1ページゲート判定の基礎。 */
export function projectToSeconds(perPageMs: number, pages: number): number {
  return (perPageMs * pages) / 1000;
}

export type GateVerdict = 'PASS' | 'FAIL' | 'NOT_EVALUATED';

export function gateVerdict(actualSeconds: number | null, thresholdSeconds: number): GateVerdict {
  if (actualSeconds === null) return 'NOT_EVALUATED';
  return actualSeconds <= thresholdSeconds ? 'PASS' : 'FAIL';
}

// ============================================================================
// テキスト完全一致検証
// ============================================================================

export interface TextDiffResult {
  exactMatch: boolean;
  firstDiffAt?: number;
  expectedLength: number;
  actualLength: number;
  context?: string;
}

export function compareGoldenText(expected: string, actual: string): TextDiffResult {
  if (expected === actual) {
    return { exactMatch: true, expectedLength: expected.length, actualLength: actual.length };
  }
  const minLen = Math.min(expected.length, actual.length);
  let firstDiffAt = minLen;
  for (let i = 0; i < minLen; i++) {
    if (expected[i] !== actual[i]) {
      firstDiffAt = i;
      break;
    }
  }
  const contextStart = Math.max(0, firstDiffAt - 20);
  const context =
    `expected: ...${expected.slice(contextStart, firstDiffAt + 20)}...\n` +
    `actual:   ...${actual.slice(contextStart, firstDiffAt + 20)}...`;
  return {
    exactMatch: false,
    firstDiffAt,
    expectedLength: expected.length,
    actualLength: actual.length,
    context,
  };
}

// ============================================================================
// 契約検証(pageCount/engine/renderDpi/modelVersion、実測値を構造化して保持する)
// ============================================================================

export interface ContractCheck {
  pageCountOk: boolean;
  engineOk: boolean;
  renderDpiOk: boolean;
  modelVersionMatch: boolean;
  /**
   * codex review(12周目)指摘(P2): 従来`pages[0]`のみをgolden textと突合しており、
   * レスポンスのトップレベル`text`フィールド(services/paddle-ocr/app.py:302の
   * `"\n\n".join(pages)`、本番Functions側が実際に消費するフィールド)が欠落・古い値・
   * `pages`と乖離した値を返しても検知できなかった。1ページ入力では`text`は`pages[0]`と
   * 完全一致するはずであり、これを見逃すと契約回帰(response-contract regression)が
   * 未検知のままworkflowが緑になりうる。
   */
  textFieldOk: boolean;
  actualPageCount?: number;
  actualEngine?: string;
  actualRenderDpi?: number;
  actualModelVersion?: string;
  actualTextField?: string;
}

export function checkContract(
  parsed: { pageCount?: number; engine?: string; renderDpi?: number; modelVersion?: string; text?: string },
  expectedModelVersion: string,
  expectedText: string
): ContractCheck {
  return {
    pageCountOk: parsed.pageCount === 1,
    engineOk: parsed.engine === 'paddleocr',
    renderDpiOk: parsed.renderDpi === 200,
    modelVersionMatch: parsed.modelVersion === expectedModelVersion,
    textFieldOk: parsed.text === expectedText,
    actualPageCount: parsed.pageCount,
    actualEngine: parsed.engine,
    actualRenderDpi: parsed.renderDpi,
    actualModelVersion: parsed.modelVersion,
    actualTextField: parsed.text,
  };
}

export function contractOk(c: ContractCheck): boolean {
  return c.pageCountOk && c.engineOk && c.renderDpiOk && c.modelVersionMatch && c.textFieldOk;
}

// ============================================================================
// レポート型・Markdown生成
// ============================================================================

export interface GoldenRequestRecord {
  manifestId: string;
  pdfFile: string;
  round: number;
  order: number;
  wallMs: number;
  processingMs: number | null;
  clientObservedExcessMs: number | null;
  httpStatus: number | null;
  retriedCount: number;
  authRetried: boolean;
  timedOut: boolean;
  /**
   * silent-failure-hunter指摘(High、pr-review-toolkit): 従来`timedOut: true`の3要因
   * (クライアント180秒タイムアウト/サーバ504/networkError)が最終レコードで区別不能だった。
   * JSON artifact・Step Summaryが decision-maker にとって唯一の一次情報源であるため、
   * 再実行なしで「サーバがハングしているのか」「単なるネットワーク瞬断か」を切り分けられるよう、
   * `timedOut: true` の場合は必ずこのフィールドを持つ。
   */
  failureKind?: 'clientTimeout' | 'serverTimeout504' | 'networkError';
  /** silent-failure-hunter指摘: networkError発生時の元例外情報(err.name/err.message)を保持する */
  errorDetail?: string;
  fatal: boolean;
  fatalReason?: string;
  textCheck?: TextDiffResult;
  contractCheck?: ContractCheck;
}

export interface GateReportEntry {
  id: 'p1' | 'p20' | 'p71';
  pages: number;
  thresholdSeconds: number;
  actualSeconds: number | null;
  basis: 'p50' | 'p95';
  verdict: GateVerdict;
}

export interface Report {
  schemaVersion: 1;
  startedAt: string;
  finishedAt: string | null;
  serviceUrl: string;
  serviceSnapshotStart: ServiceSnapshot | null;
  serviceSnapshotEnd: ServiceSnapshot | null;
  inconclusive: boolean;
  inconclusiveReason: string | null;
  requests: GoldenRequestRecord[];
  firstRequestMs: number | null;
  subsequent: LatencySummary | null;
  successRateSubsequent: number | null;
  timedOutCount: number;
  status503Count: number;
  gates: GateReportEntry[];
  goldenMatchSummary: { total: number; matched: number };
  fatalError: string | null;
  notes: string[];
}

const REPORT_NOTES = [
  'golden fixtureはpdf-lib生成の合成テキストPDF(1ページ数行)であり、実運用のFAX/スキャン文書より文字密度が低い。本計測は実運用レイテンシの楽観側の下限として扱う。',
  '「firstRequestMs」「subsequentRequestsMs」はいずれも真のcold/warm確定ではない一次スクリーニングに過ぎない(Cloud Runは逐次リクエストでも同一インスタンスへのルーティングを保証しない)。',
  'golden一致検証は「amd64実機での再現性・モデル同一性の検証」であり、FAX・罫線・ノイズ・手書き等を含む実運用OCR精度そのものの検証ではない。',
  '71/20ページの projected PASS/FAIL は「Stage 3の実データ負荷試験へ進めてよいか」の判断材料であり、PR6着手のGo判定そのものではない。',
];

export function buildReport(input: {
  serviceUrl: string;
  startedAt: string;
  finishedAt: string;
  /**
   * codex review指摘(P2): 終了時スナップショット取得(gcloud呼び出し)が計測完了後に
   * 一時的に失敗した場合でも、それまでに収集した`requests`を捨てずにinconclusiveな
   * レポートとして残せるよう、開始/終了スナップショットはnullを許容する。
   */
  serviceSnapshotStart: ServiceSnapshot | null;
  serviceSnapshotEnd: ServiceSnapshot | null;
  requests: GoldenRequestRecord[];
}): Report {
  const inconclusiveBySnapshot =
    input.serviceSnapshotStart === null ||
    input.serviceSnapshotEnd === null ||
    !snapshotsMatch(input.serviceSnapshotStart, input.serviceSnapshotEnd);
  const [first, ...rest] = input.requests;

  // code-reviewer指摘(High): 1件目(first)がfatal/timedOutの場合、そのwallMsをそのまま
  // p1ゲートに使うと「失敗した1件目のレイテンシがたまたま短かった」だけでPASS判定になりうる
  // (subsequent系列で既に対策済みだったのと同種の見落とし)。firstValidを介して判定する。
  const firstValid = first && !first.fatal && !first.timedOut ? first : null;

  const validSubsequent = rest.filter((r) => !r.fatal && !r.timedOut);
  const subsequentLatencies = validSubsequent.map((r) => r.wallMs);
  const subsequent = subsequentLatencies.length > 0 ? summarizeLatencies(subsequentLatencies) : null;

  const timedOutCount = input.requests.filter((r) => r.timedOut).length;
  const status503Count = input.requests.filter((r) => r.httpStatus === 503).length;
  const successRateSubsequent = rest.length > 0 ? validSubsequent.length / rest.length : null;

  // codex review指摘(P1): subsequentが null(=有効サンプル0件、全件timedOut/fatal)の場合、
  // `subsequent !== null && ...` は false になり「標本数不足」を検知できずconclusive扱いに
  // なってしまう(全件タイムアウトでもワークフローが緑になるバグ)。null自体も不足として扱う。
  const inconclusiveBySampleSize = subsequent === null || subsequent.n < MIN_SUBSEQUENT_SAMPLES;
  // codex review(7周目)指摘(P2): timedOut(クライアントタイムアウト・504とも)はサーバ側で
  // OCR処理がバックグラウンド継続する設計であり、その直後に送った以降のリクエストが
  // 同一インスタンスのロック待ちや異なるインスタンスへの回り込みで汚染されている可能性がある。
  // 特定の1件(p1ゲート等)だけの問題ではなく、それ以降のsubsequent系列全体の逐次性が
  // 保証できなくなるため、1件でもtimedOutがあればレポート全体をinconclusiveとする。
  const inconclusiveByTimeout = timedOutCount > 0;
  const inconclusive = inconclusiveBySnapshot || inconclusiveByTimeout || inconclusiveBySampleSize;
  const inconclusiveReason = inconclusiveBySnapshot
    ? input.serviceSnapshotStart === null || input.serviceSnapshotEnd === null
      ? `サービススナップショットの取得に失敗しました(開始: ${JSON.stringify(input.serviceSnapshotStart)}, 終了: ${JSON.stringify(input.serviceSnapshotEnd)})。gcloud呼び出しの一時的な失敗の可能性があるため再計測を検討してください`
      : `計測開始時と終了時でサービススナップショットが一致しない(開始: ${JSON.stringify(input.serviceSnapshotStart)}, 終了: ${JSON.stringify(input.serviceSnapshotEnd)})`
    : inconclusiveByTimeout
      ? `${timedOutCount}件のリクエストがタイムアウトまたは504(サービス側で処理継続中)を検知した。以降のリクエストのインスタンス割当が汚染されている可能性があり、subsequent系列全体を信頼できない`
      : inconclusiveBySampleSize
        ? `subsequentRequestsMsの標本数が不足(n=${subsequent?.n ?? 0} < ${MIN_SUBSEQUENT_SAMPLES})`
        : null;

  const gates: GateReportEntry[] = inconclusive
    ? []
    : [
        {
          id: 'p1',
          pages: 1,
          thresholdSeconds: GATE_THRESHOLDS_SECONDS.p1,
          actualSeconds: firstValid ? firstValid.wallMs / 1000 : null,
          basis: 'p50',
          verdict: gateVerdict(firstValid ? firstValid.wallMs / 1000 : null, GATE_THRESHOLDS_SECONDS.p1),
        },
        {
          id: 'p20',
          pages: 20,
          thresholdSeconds: GATE_THRESHOLDS_SECONDS.p20,
          actualSeconds: subsequent ? projectToSeconds(subsequent.p95Ms, 20) : null,
          basis: 'p95',
          verdict: gateVerdict(subsequent ? projectToSeconds(subsequent.p95Ms, 20) : null, GATE_THRESHOLDS_SECONDS.p20),
        },
        {
          id: 'p71',
          pages: 71,
          thresholdSeconds: GATE_THRESHOLDS_SECONDS.p71,
          actualSeconds: subsequent ? projectToSeconds(subsequent.p95Ms, 71) : null,
          basis: 'p95',
          verdict: gateVerdict(subsequent ? projectToSeconds(subsequent.p95Ms, 71) : null, GATE_THRESHOLDS_SECONDS.p71),
        },
      ];

  const matched = input.requests.filter((r) => r.textCheck?.exactMatch === true).length;

  return {
    schemaVersion: 1,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    serviceUrl: input.serviceUrl,
    serviceSnapshotStart: input.serviceSnapshotStart,
    serviceSnapshotEnd: input.serviceSnapshotEnd,
    inconclusive,
    inconclusiveReason,
    requests: input.requests,
    firstRequestMs: first ? first.wallMs : null,
    subsequent,
    successRateSubsequent,
    timedOutCount,
    status503Count,
    gates,
    goldenMatchSummary: { total: input.requests.length, matched },
    fatalError: null,
    notes: REPORT_NOTES,
  };
}

/**
 * pr-test-analyzer指摘(High、pr-review-toolkit): このスクリプトが最終的にGitHub Actionsの
 * 赤/緑を左右する唯一の判定ロジックがmain()末尾にインライン化されており、88件のテストの
 * どこからも到達しなかった(「全て健全→0のまま」というハッピーパスすら未検証)。純関数として
 * 抽出し、決定ロジックを直接テスト可能にする。
 *
 * codex review指摘(P1、effort=high): ゲートFAILでもexitCodeが0のままだと、明確に不合格の
 * 性能スクリーニング結果がGitHub Actions上は緑のまま終わってしまう(実装レビューで指摘され、
 * 「PR4c自体の完了」と「CIジョブの成否シグナル」を混同していたplan段階の判断を訂正した)。
 * さらにcodex review(3周目)指摘: timedOutは`fatal`ではなく統計から除外されるだけの扱いの
 * ため、fatalの有無だけでは「1件目がタイムアウトしp1ゲートがNOT_EVALUATEDのまま」でも
 * 緑になってしまう。タイムアウトの発生自体、および未評価ゲートの存在も失敗条件に含める。
 */
export function determineExitCode(report: Report, requests: readonly GoldenRequestRecord[]): 0 | 1 {
  const anyFatal = requests.some((r) => r.fatal);
  const anyTimedOut = requests.some((r) => r.timedOut);
  const anyGateFailOrUnevaluated = report.gates.some((g) => g.verdict === 'FAIL' || g.verdict === 'NOT_EVALUATED');
  return report.inconclusive || anyFatal || anyTimedOut || anyGateFailOrUnevaluated ? 1 : 0;
}

export function buildStepSummaryMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push('## PaddleOCR PR4c Stage 1: golden一次スクリーニング結果');
  lines.push('');
  lines.push(
    `**統計的表現の注意**: これはPR6着手前の実用性スクリーニングであり統計的証明ではない。golden fixtureは合成テキストPDFであり実運用文書より楽観側。`
  );
  lines.push('');
  lines.push(`- golden再現性: ${report.goldenMatchSummary.matched}/${report.goldenMatchSummary.total} exact match`);
  lines.push(`- inconclusive: ${report.inconclusive}${report.inconclusiveReason ? ` (${report.inconclusiveReason})` : ''}`);
  lines.push(`- firstRequestMs(真のcold確証なし): ${report.firstRequestMs ?? 'N/A'}`);
  if (report.subsequent) {
    lines.push(
      `- subsequentRequestsMs(真のwarm確証なし): p50=${report.subsequent.p50Ms}ms p95=${report.subsequent.p95Ms}ms n=${report.subsequent.n}`
    );
  } else {
    lines.push('- subsequentRequestsMs: 有効サンプルなし(全件fatal/timedOut)');
  }
  lines.push(`- 成功率(subsequent): ${report.successRateSubsequent !== null ? `${(report.successRateSubsequent * 100).toFixed(1)}%` : 'N/A'}`);
  lines.push(`- タイムアウト件数: ${report.timedOutCount} / 503件数: ${report.status503Count}`);
  lines.push('');
  if (report.gates.length > 0) {
    lines.push('| ゲート | ページ数 | 基準(秒) | 実測換算(秒) | 判定 |');
    lines.push('|---|---|---|---|---|');
    for (const g of report.gates) {
      lines.push(
        `| ${g.id} | ${g.pages} | ${g.thresholdSeconds} | ${g.actualSeconds !== null ? g.actualSeconds.toFixed(1) : 'N/A'} | projected ${g.verdict} |`
      );
    }
    lines.push('');
    lines.push('「PASS」は「Stage 3の実データ負荷試験へ進めてよい」という意味であり、PR6のGo判定そのものではない。');
  } else {
    lines.push('ゲート判定なし(inconclusiveのため。再計測が必要)。');
  }
  lines.push('');
  lines.push('### 注記');
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  return lines.join('\n');
}

// ============================================================================
// CLI引数
// ============================================================================

const LOAD_TIER_STRINGS = ['1', '20', '71', '160', 'all'] as const;
type LoadTierArg = LoadTier | 'all';

export interface CliArgs {
  mode: 'golden' | 'load';
  url?: string;
  /** golden専用。load時は未使用(常に3のまま残るが読まれない)。 */
  repeat: number;
  out: string;
  /** 実行時間予算(ミリ秒)。golden既定はRUN_BUDGET_MS、load既定はtier別(LOAD_BUDGET_MINUTES_DEFAULT)。 */
  budgetMs: number;
  /** load専用フィールド(golden時はundefined)。 */
  tier?: LoadTierArg;
  series?: LoadSeries | 'both';
  intensity?: LoadIntensity;
  /** quick検証用のfault injection。指定したページ番号(1始まり)で強制的にhttpFatalを発生させる。 */
  injectFailureAtPage?: number;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  const mode = args.mode ?? 'golden';
  if (mode !== 'golden' && mode !== 'load') {
    throw new Error(`--mode=${mode} は未対応です(golden|load のみ対応。pngはStage判断待ち)`);
  }

  const out = args.out ?? path.join(process.cwd(), `paddle-ocr-verify-${mode}.json`);

  if (mode === 'golden') {
    // mode不一致のオプション併用はfail-loud(2026-09-18 Fable 5.1レビュー指摘反映: 誤設定のまま
    // 3時間の負荷試験を回してしまう事故を防ぐ)。
    for (const key of ['tier', 'series', 'intensity', 'inject-failure-at-page']) {
      if (args[key] !== undefined) {
        throw new Error(`--mode=golden では --${key} は指定できません`);
      }
    }
    // codex review(7周目)指摘(P2): 100(=600リクエスト)は`.github/workflows/paddle-ocr-verify.yml`の
    // `timeout-minutes: 240`に対して非現実的に大きい。実測97秒/リクエスト前提で600件は約16時間を要し、
    // GHAのジョブタイムアウトでスクリプト自身がレポートを書き出す前にジョブごと強制終了される
    // (せっかくの「失敗時も必ずレポートを残す」設計が無効化される)。20周=120リクエストなら
    // 約110秒/件換算で約3.7時間(220分)に収まり、setup(checkout/auth/npm ci等)の
    // オーバーヘッドを差し引いても240分ジョブタイムアウト内に収まる安全な上限とする。
    const MAX_REPEAT = 20;
    let repeat = 3;
    if (args.repeat !== undefined) {
      // codex review指摘(P2): Number.parseIntは"3.5"や"3junk"のような数値プレフィックスを
      // 無言で受理してしまう。この値は標本数(送信ページ数)を直接左右するため、厳密な整数文字列
      // のみを許容する。
      if (!/^\d+$/.test(args.repeat)) {
        throw new Error(`--repeat は1以上の整数を指定してください(got: ${args.repeat})`);
      }
      repeat = Number.parseInt(args.repeat, 10);
      // codex review指摘(P2、4周目): 数字のみの文字列でも桁数が多いとNumber.parseIntが
      // Infinityへオーバーフローしうる(例: "9"を300個)。forループが`round < repeat`で
      // 終了しなくなりGHAのtimeout-minutesまでジョブを消費してレポートも出せなくなるため、
      // 安全な整数範囲かつ実用上の上限内であることを検証する。
      if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) {
        throw new Error(`--repeat は1以上${MAX_REPEAT}以下の整数を指定してください(got: ${args.repeat})`);
      }
    }
    let budgetMs = RUN_BUDGET_MS;
    if (args['budget-minutes'] !== undefined) {
      budgetMs = parsePositiveIntMinutesToMs(args['budget-minutes'], 'budget-minutes');
    }
    return { mode, url: args.url, repeat, out, budgetMs };
  }

  // mode === 'load'
  if (args.repeat !== undefined) {
    throw new Error('--mode=load では --repeat は指定できません(tier別の試行回数はWARM_TRIALS_FULLで確定済みです)');
  }
  if (args.tier === undefined || !(LOAD_TIER_STRINGS as readonly string[]).includes(args.tier)) {
    throw new Error(`--mode=load では --tier=${LOAD_TIER_STRINGS.join('|')} の指定が必須です(got: ${args.tier})`);
  }
  const tier: LoadTierArg = args.tier === 'all' ? 'all' : (Number(args.tier) as LoadTier);

  const series = (args.series ?? 'both') as LoadSeries | 'both';
  if (series !== 'warm' && series !== 'cold' && series !== 'both') {
    throw new Error(`--series は warm|cold|both のいずれかを指定してください(got: ${args.series})`);
  }

  const intensity = (args.intensity ?? 'full') as LoadIntensity;
  if (intensity !== 'full' && intensity !== 'quick') {
    throw new Error(`--intensity は full|quick のいずれかを指定してください(got: ${args.intensity})`);
  }

  if (tier === 'all' && intensity !== 'quick') {
    throw new Error('--tier=all は --intensity=quick でのみ指定できます(全tier fullを1ジョブに詰め込む事故防止)');
  }

  // quality-gate-evaluator指摘(2026-09-18): metric=coldMaxのtier(現状tier1のみ)は
  // page完了率(pageCompletionRate)をwarm trialの実行結果から算出する設計のため、
  // --series=cold単独でintensity=fullを評価しようとすると、latencyは測れても
  // completionOkが常にfalse(pageCompletionRate=null)になり恒久的にFAILし続ける
  // (H1修正で標本数不足チェック自体はすり抜けるようになったが、この根本問題は残る)。
  // 承認済み計画のゲート数値・完了率算出方式自体は変更せず、CLI側でこの矛盾した
  // 組み合わせをfail-loudにする(Phase B計画でもtier1はseries=bothで1回のdispatchに
  // まとめる想定であり、実害はない)。
  if (tier !== 'all' && intensity === 'full' && series !== 'both' && LOAD_GATES[tier as LoadTier].metric === 'coldMax') {
    throw new Error(
      `--tier=${tier}はmetric=coldMaxのゲートのため、--intensity=fullでは--series=bothでのみ実行できます` +
        `(page完了率の算出にwarm系列の実行結果が必要です)。個別series実行は--intensity=quickでの疎通確認にのみ使用してください(got: series=${series})`
    );
  }

  let injectFailureAtPage: number | undefined;
  if (args['inject-failure-at-page'] !== undefined) {
    if (!/^\d+$/.test(args['inject-failure-at-page'])) {
      throw new Error(`--inject-failure-at-page は1以上の整数を指定してください(got: ${args['inject-failure-at-page']})`);
    }
    injectFailureAtPage = Number.parseInt(args['inject-failure-at-page'], 10);
    if (!Number.isSafeInteger(injectFailureAtPage) || injectFailureAtPage < 1) {
      throw new Error(`--inject-failure-at-page は1以上の整数を指定してください(got: ${args['inject-failure-at-page']})`);
    }
  }

  let budgetMs: number;
  if (args['budget-minutes'] !== undefined) {
    budgetMs = parsePositiveIntMinutesToMs(args['budget-minutes'], 'budget-minutes');
  } else {
    budgetMs = LOAD_BUDGET_MINUTES_DEFAULT[tier] * 60 * 1000;
  }

  return { mode, url: args.url, repeat: 3, out, budgetMs, tier, series, intensity, injectFailureAtPage };
}

function parsePositiveIntMinutesToMs(raw: string, flagName: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${flagName} は1以上の整数(分)を指定してください(got: ${raw})`);
  }
  const minutes = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(minutes) || minutes < 1) {
    throw new Error(`--${flagName} は1以上の整数(分)を指定してください(got: ${raw})`);
  }
  return minutes * 60 * 1000;
}

// ============================================================================
// OCRリクエスト実行(注入可能、テスト時はフェイクに差し替える)
// ============================================================================

export interface OcrAttemptResult {
  status: number | null;
  body: string | null;
  wallMs: number;
  kind: 'success' | 'timeout' | 'networkError';
  /** silent-failure-hunter指摘: networkError時に元の例外情報を握り潰さないため保持する */
  errorDetail?: string;
}

export type OcrRequestFn = (serviceUrl: string, pdfBuffer: Buffer, token: string) => Promise<OcrAttemptResult>;

/**
 * codex review(13周目)指摘(P2): `resolveServiceUrl`は末尾スラッシュ付きURL(`--url`や
 * `PADDLE_OCR_URL`経由)を明示的に許容しているが、従来`${serviceUrl}/ocr`の単純な文字列連結
 * だったため`//ocr`という不正パスになり、Cloud Run/FastAPI側では404になって全リクエストが
 * 失敗しうる(pr912-code-reviewer指摘時は`paddle-ocr-verify.yml`が常に末尾スラッシュなしの
 * dev.env値のみを使う経路のため実害なしと判断したが、`--url`手動指定時には実害がある)。
 */
export function buildOcrEndpoint(serviceUrl: string): string {
  return `${serviceUrl.replace(/\/+$/, '')}/ocr`;
}

/**
 * `OcrRequestFn`のファクトリ(タイムアウト値を注入可能にする)。golden(180秒)とload
 * (250秒、本番`RETRY_CONFIGS.paddleOcr`の`requestTimeoutMs`と同値)でタイムアウトが
 * 異なるため、2026-09-18のADR-0025 PR4c Stage3実装でファクトリ化した(挙動は不変、
 * `defaultOcrRequestFn`は従来通り`REQUEST_TIMEOUT_MS`固定のエイリアス)。
 */
export function makeOcrRequestFn(timeoutMs: number): OcrRequestFn {
  return async function ocrRequestFn(serviceUrl: string, pdfBuffer: Buffer, token: string): Promise<OcrAttemptResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(buildOcrEndpoint(serviceUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', Authorization: `Bearer ${token}` },
        body: pdfBuffer,
        signal: controller.signal,
      });
      // codex review(5周目)指摘(P2): fetch()はレスポンスヘッダ受信時点で解決するため、
      // res.text()より前にwallMsを確定するとtime-to-first-byteしか計測できず、レスポンス
      // ボディ転送が遅いケースで実際のレイテンシを過小評価してしまう。ボディ読了後に確定する。
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

export const defaultOcrRequestFn: OcrRequestFn = makeOcrRequestFn(REQUEST_TIMEOUT_MS);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// OCR送信リトライの汎用コア(golden/load共有、2026-09-18 ADR-0025 PR4c Stage3で抽出)
// ============================================================================

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  /**
   * true: 504・クライアントタイムアウト・networkErrorもリトライ対象に含める(load方針、
   * 本番`functions/src/utils/retry.ts`の`RETRY_CONFIGS.paddleOcr`と整合させる。
   * 完了率ゲートの目的は「本番が完走するか」であり、本番が救済するケースをハーネスが
   * 誤って失敗カウントしないため)。
   * false: 即座にtimedOut扱いにしリトライしない(golden方針、逐次系列
   * `subsequentRequestsMs`の統計的純度を守るため、既存の挙動を変えない)。
   */
  retryOnTimeoutLike: boolean;
}

export type RawSendResult =
  | { kind: 'timedOut'; failureKind: 'clientTimeout' | 'serverTimeout504' | 'networkError'; httpStatus: number | null; errorDetail?: string }
  | { kind: 'fatal'; httpStatus: number | null; fatalReason: string }
  | { kind: 'success'; httpStatus: 200; body: string };

export interface RawSendOutcome {
  elapsedMs: number;
  retriedCount: number;
  authRetried: boolean;
  result: RawSendResult;
}

/**
 * 1リクエスト分のOCR送信をリトライ込みで実行する汎用コア。fixture読込・golden text/契約
 * 検証等の呼び出し元固有の後処理は含まない(`sendGoldenCaseWithRetries`が薄いラッパとして
 * 呼び出す)。ロジック自体は従来の`sendGoldenCaseWithRetries`と完全に同一(golden方針=
 * `retryOnTimeoutLike:false`で呼ぶ限り既存88テストが無改変で緑であることを確認済み)。
 */
export async function sendOcrWithRetries(opts: {
  pdfBuffer: Buffer;
  serviceUrl: string;
  tokenProvider: IdTokenProvider;
  policy: RetryPolicy;
  requestFn?: OcrRequestFn;
  nowFn?: () => number;
}): Promise<RawSendOutcome> {
  const requestFn = opts.requestFn ?? defaultOcrRequestFn;
  const nowFn = opts.nowFn ?? Date.now;
  let retriedCount = 0;
  let authRetried = false;
  let caseStarted: number | undefined;

  for (;;) {
    const token = await opts.tokenProvider.getToken();
    if (caseStarted === undefined) {
      caseStarted = nowFn();
    }
    const attempt = await requestFn(opts.serviceUrl, opts.pdfBuffer, token);
    const elapsedMs = nowFn() - caseStarted;

    if (attempt.kind === 'timeout') {
      if (opts.policy.retryOnTimeoutLike && retriedCount < opts.policy.maxRetries) {
        retriedCount++;
        await sleep(opts.policy.backoffMs * 2 ** (retriedCount - 1));
        continue;
      }
      return { elapsedMs, retriedCount, authRetried, result: { kind: 'timedOut', failureKind: 'clientTimeout', httpStatus: null } };
    }

    if (attempt.kind === 'networkError') {
      if (opts.policy.retryOnTimeoutLike && retriedCount < opts.policy.maxRetries) {
        retriedCount++;
        await sleep(opts.policy.backoffMs * 2 ** (retriedCount - 1));
        continue;
      }
      return {
        elapsedMs,
        retriedCount,
        authRetried,
        result: { kind: 'timedOut', failureKind: 'networkError', httpStatus: null, errorDetail: attempt.errorDetail },
      };
    }

    // kind === 'success'(HTTPレスポンスは受信できた。ステータスは200とは限らない)
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
        result: {
          kind: 'fatal',
          httpStatus: attempt.status,
          fatalReason: `トークン再発行後も${attempt.status}が続きました(認可設定の不備の疑い)`,
        },
      };
    }

    if (attempt.status === 504) {
      if (opts.policy.retryOnTimeoutLike && retriedCount < opts.policy.maxRetries) {
        retriedCount++;
        await sleep(opts.policy.backoffMs * 2 ** (retriedCount - 1));
        continue;
      }
      return {
        elapsedMs,
        retriedCount,
        authRetried,
        result: {
          kind: 'timedOut',
          failureKind: 'serverTimeout504',
          httpStatus: 504,
          errorDetail: attempt.body?.slice(0, 500),
        },
      };
    }

    const failureClass = attempt.status !== null && attempt.status !== 200 ? classifyFailure('httpStatus', attempt.status) : null;

    if (failureClass === 'retryable' && retriedCount < opts.policy.maxRetries) {
      retriedCount++;
      await sleep(opts.policy.backoffMs * 2 ** (retriedCount - 1));
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

// ============================================================================
// GoldenRequestRecord ファクトリ(code-reviewer指摘: 7箇所の重複return literalを解消)
// ============================================================================

interface RecordBase {
  manifestId: string;
  pdfFile: string;
  round: number;
  order: number;
}

function baseRecord(c: GoldenCase, round: number, order: number): RecordBase {
  return { manifestId: c.manifestId, pdfFile: c.pdfFile, round, order };
}

// code-reviewer指摘(Important、pr-review-toolkit): 位置引数(特に`number`型が複数連続する)は
// 呼び出し側で誤発注してもTypeScriptの型検査を通過してしまう。以下3つのファクトリは
// named fieldsのoptionsオブジェクトで受け取る。
function makeTimedOutRecord(
  base: RecordBase,
  opts: {
    wallMs: number;
    retriedCount: number;
    authRetried: boolean;
    /**
     * silent-failure-hunter指摘(High、pr-review-toolkit): クライアントタイムアウト/サーバ504/
     * networkErrorの3要因を最終レコードで区別できるようにする。
     */
    failureKind: 'clientTimeout' | 'serverTimeout504' | 'networkError';
    httpStatus?: number | null;
    errorDetail?: string;
  }
): GoldenRequestRecord {
  return {
    ...base,
    wallMs: opts.wallMs,
    processingMs: null,
    clientObservedExcessMs: null,
    httpStatus: opts.httpStatus ?? null,
    retriedCount: opts.retriedCount,
    authRetried: opts.authRetried,
    timedOut: true,
    failureKind: opts.failureKind,
    errorDetail: opts.errorDetail,
    fatal: false,
  };
}

function makeFatalRecord(
  base: RecordBase,
  opts: {
    wallMs: number;
    httpStatus: number | null;
    retriedCount: number;
    authRetried: boolean;
    fatalReason: string;
  }
): GoldenRequestRecord {
  return {
    ...base,
    wallMs: opts.wallMs,
    processingMs: null,
    clientObservedExcessMs: null,
    httpStatus: opts.httpStatus,
    retriedCount: opts.retriedCount,
    authRetried: opts.authRetried,
    timedOut: false,
    fatal: true,
    fatalReason: opts.fatalReason,
  };
}

function makeResponseRecord(
  base: RecordBase,
  opts: {
    wallMs: number;
    httpStatus: number;
    retriedCount: number;
    authRetried: boolean;
    processingMs: number | null;
    clientObservedExcessMs: number | null;
    textCheck: TextDiffResult;
    contractCheck: ContractCheck;
    fatal: boolean;
    fatalReason?: string;
  }
): GoldenRequestRecord {
  return {
    ...base,
    wallMs: opts.wallMs,
    processingMs: opts.processingMs,
    clientObservedExcessMs: opts.clientObservedExcessMs,
    httpStatus: opts.httpStatus,
    retriedCount: opts.retriedCount,
    authRetried: opts.authRetried,
    timedOut: false,
    fatal: opts.fatal,
    fatalReason: opts.fatalReason,
    textCheck: opts.textCheck,
    contractCheck: opts.contractCheck,
  };
}

// ============================================================================
// 1ケース分のOCR送信(リトライ・認証再試行を内包)
// ============================================================================

export async function sendGoldenCaseWithRetries(
  c: GoldenCase,
  round: number,
  order: number,
  serviceUrl: string,
  expectedModelVersion: string,
  tokenProvider: IdTokenProvider,
  requestFn: OcrRequestFn = defaultOcrRequestFn,
  /** テスト用に注入可能(既定は本番値)。リトライ上限までの実時間待機を避けるため。 */
  backoffMs: number = INITIAL_BACKOFF_MS,
  /** テスト用に注入可能な時計。累積経過時間(elapsedMs)の計算を決定論的にテストするため。 */
  nowFn: () => number = Date.now
): Promise<GoldenRequestRecord> {
  const base = baseRecord(c, round, order);
  const pdfBuffer = fs.readFileSync(path.join(FIXTURE_DIR, c.pdfFile));
  const expectedPages = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, c.pagesJsonFile), 'utf-8')) as string[];
  const expectedText = expectedPages[c.pageIndex];

  // 2026-09-18 ADR-0025 PR4c Stage3実装で`sendOcrWithRetries`(汎用コア)へ抽出した。
  // golden方針(retryOnTimeoutLike:false)で呼ぶ限り、504・クライアントタイムアウト・
  // networkErrorは即座にtimedOut扱いになり、429/5xx(504除く)はMAX_RETRIESまでリトライする
  // という従来の挙動と完全に同一(既存88テストで確認済み)。
  const outcome = await sendOcrWithRetries({
    pdfBuffer,
    serviceUrl,
    tokenProvider,
    policy: { maxRetries: MAX_RETRIES, backoffMs, retryOnTimeoutLike: false },
    requestFn,
    nowFn,
  });

  if (outcome.result.kind === 'timedOut') {
    return makeTimedOutRecord(base, {
      wallMs: outcome.elapsedMs,
      retriedCount: outcome.retriedCount,
      authRetried: outcome.authRetried,
      failureKind: outcome.result.failureKind,
      httpStatus: outcome.result.httpStatus,
      errorDetail: outcome.result.errorDetail,
    });
  }

  if (outcome.result.kind === 'fatal') {
    return makeFatalRecord(base, {
      wallMs: outcome.elapsedMs,
      httpStatus: outcome.result.httpStatus,
      retriedCount: outcome.retriedCount,
      authRetried: outcome.authRetried,
      fatalReason: outcome.result.fatalReason,
    });
  }

  // 200 OK: 契約検証
  let parsed: {
    pages?: string[];
    text?: string;
    pageCount?: number;
    engine?: string;
    renderDpi?: number;
    modelVersion?: string;
    processingMs?: number;
  };
  try {
    parsed = JSON.parse(outcome.result.body);
  } catch {
    // silent-failure-hunter指摘: 非200時はレスポンス本文を含めているのに、JSON parse失敗時は
    // 含めていなかった非対称性を解消する(200 OKでも不正JSONが返るケースこそ原因調査が必要)。
    return makeFatalRecord(base, {
      wallMs: outcome.elapsedMs,
      httpStatus: 200,
      retriedCount: outcome.retriedCount,
      authRetried: outcome.authRetried,
      fatalReason: `レスポンスがJSONとしてパースできませんでした: ${outcome.result.body.slice(0, 500)}`,
    });
  }

  const actualText = parsed.pages?.[0] ?? '';
  const textCheck = compareGoldenText(expectedText, actualText);
  const contractCheck = checkContract(parsed, expectedModelVersion, expectedText);

  const processingMs = typeof parsed.processingMs === 'number' ? parsed.processingMs : null;
  // clientObservedExcessMsもリトライ込みの累積時間基準にする(リトライがあった場合、
  // その分の超過が正直に反映される)。
  const clientObservedExcessMs = processingMs !== null ? outcome.elapsedMs - processingMs : null;

  const fatal = !textCheck.exactMatch || !contractOk(contractCheck);
  const fatalReason = !textCheck.exactMatch
    ? 'golden textと不一致'
    : !contractOk(contractCheck)
      ? `契約検証(pageCount/engine/renderDpi/modelVersion)に失敗: ${JSON.stringify(contractCheck)}`
      : undefined;

  return makeResponseRecord(base, {
    wallMs: outcome.elapsedMs,
    httpStatus: 200,
    retriedCount: outcome.retriedCount,
    authRetried: outcome.authRetried,
    processingMs,
    clientObservedExcessMs,
    textCheck,
    contractCheck,
    fatal,
    fatalReason,
  });
}

// ============================================================================
// CLIオーケストレーション(require.main === module でのみ実行)
// ============================================================================

function emptyReportSkeleton(startedAt: string, finishedAt: string, serviceUrl: string, fatalError: string): Report {
  return {
    schemaVersion: 1,
    startedAt,
    finishedAt,
    serviceUrl,
    serviceSnapshotStart: null,
    serviceSnapshotEnd: null,
    inconclusive: true,
    inconclusiveReason: null,
    requests: [],
    firstRequestMs: null,
    subsequent: null,
    successRateSubsequent: null,
    timedOutCount: 0,
    status503Count: 0,
    gates: [],
    goldenMatchSummary: { total: 0, matched: 0 },
    fatalError,
    notes: REPORT_NOTES,
  };
}

// ============================================================================
// load モード(ADR-0025 PR4c Stage3、2026-09-18実装)のI/Oオーケストレーション。
// 純ロジック(ゲート判定・統計・reducer)は scripts/lib/paddleOcrLoad.ts に隔離済み。
// ============================================================================

/** 前バーストの余剰インスタンス終了を待つための間隔(承認済み設計、バースト方式のcold測定)。 */
const COLD_BURST_COOLDOWN_MS = 180_000;
/** trial失敗後のクールダウン中、/healthのポーリング間隔・最大待機時間。 */
const HEALTH_POLL_INTERVAL_MS = 5_000;
const HEALTH_POLL_MAX_WAIT_MS = 600_000;

async function sendLoadPage(opts: {
  series: LoadSeries;
  trial: number;
  pageIndex: number;
  pdfBuffer: Buffer;
  serviceUrl: string;
  tokenProvider: IdTokenProvider;
  expectedModelVersion: string;
  requestFn?: OcrRequestFn;
  nowFn?: () => number;
  /** fault injection(quick検証専用): trueならHTTP送信自体を行わず強制的にfatal扱いにする。 */
  forceFailure?: boolean;
}): Promise<LoadPageRecord> {
  const baseFields = { series: opts.series, trial: opts.trial, pageIndex: opts.pageIndex };

  if (opts.forceFailure) {
    return {
      ...baseFields,
      wallMs: 0,
      serviceProcessingMs: null,
      clientObservedExcessMs: null,
      httpStatus: null,
      retriedCount: 0,
      authRetried: false,
      timedOut: false,
      fatal: true,
      fatalReason: 'fault injection(--inject-failure-at-page)による強制失敗(quickモードの経路検証専用)',
    };
  }

  // silent-failure-hunter指摘(Critical、2026-09-18): sendOcrWithRetries内部(特に
  // tokenProvider.getToken()のgcloudサブプロセス呼び出し)が例外を投げた場合、これを
  // 無保護のまま呼び出し元(runWarmTrial/runColdBurst)へ伝播させると、Promise.all等が
  // 丸ごと失敗しそれまでに収集した実データが失われる。golden側の
  // sendGoldenCaseWithRetries呼び出し箇所(main()内)と同じ「ケース単位の例外境界」を
  // ここに設け、常にLoadPageRecordを返す(例外を投げない)関数にする。
  try {
    const outcome = await sendOcrWithRetries({
      pdfBuffer: opts.pdfBuffer,
      serviceUrl: opts.serviceUrl,
      tokenProvider: opts.tokenProvider,
      policy: { maxRetries: LOAD_MAX_RETRIES, backoffMs: LOAD_INITIAL_BACKOFF_MS, retryOnTimeoutLike: true },
      requestFn: opts.requestFn,
      nowFn: opts.nowFn,
    });

    const withRetryMeta = { ...baseFields, retriedCount: outcome.retriedCount, authRetried: outcome.authRetried };

    if (outcome.result.kind === 'timedOut') {
      return {
        ...withRetryMeta,
        wallMs: outcome.elapsedMs,
        serviceProcessingMs: null,
        clientObservedExcessMs: null,
        httpStatus: outcome.result.httpStatus,
        timedOut: true,
        failureKind: outcome.result.failureKind,
        errorDetail: outcome.result.errorDetail,
        fatal: false,
      };
    }
    if (outcome.result.kind === 'fatal') {
      return {
        ...withRetryMeta,
        wallMs: outcome.elapsedMs,
        serviceProcessingMs: null,
        clientObservedExcessMs: null,
        httpStatus: outcome.result.httpStatus,
        timedOut: false,
        fatal: true,
        fatalReason: outcome.result.fatalReason,
      };
    }

    // success: 200 OK
    let parsed: { pages?: string[]; text?: string; pageCount?: number; engine?: string; renderDpi?: number; modelVersion?: string; processingMs?: number };
    try {
      parsed = JSON.parse(outcome.result.body);
    } catch (parseErr) {
      return {
        ...withRetryMeta,
        wallMs: outcome.elapsedMs,
        serviceProcessingMs: null,
        clientObservedExcessMs: null,
        httpStatus: 200,
        timedOut: false,
        fatal: true,
        fatalReason: `レスポンスがJSONとしてパースできませんでした(${parseErr instanceof Error ? parseErr.message : String(parseErr)}): ${outcome.result.body.slice(0, 500)}`,
      };
    }
    const contractCheck = checkLoadContract(parsed, opts.expectedModelVersion);
    const processingMs = typeof parsed.processingMs === 'number' ? parsed.processingMs : null;
    const clientObservedExcessMs = processingMs !== null ? outcome.elapsedMs - processingMs : null;
    const fatal = !loadContractOk(contractCheck);

    return {
      ...withRetryMeta,
      wallMs: outcome.elapsedMs,
      serviceProcessingMs: processingMs,
      clientObservedExcessMs,
      httpStatus: 200,
      timedOut: false,
      contractCheck,
      fatal,
      fatalReason: fatal ? `契約検証(pageCount/engine/renderDpi/modelVersion/textSelfConsistent/nonEmptyText)に失敗: ${JSON.stringify(contractCheck)}` : undefined,
    };
  } catch (err) {
    return {
      ...baseFields,
      wallMs: 0,
      serviceProcessingMs: null,
      clientObservedExcessMs: null,
      httpStatus: null,
      retriedCount: 0,
      authRetried: false,
      timedOut: false,
      fatal: true,
      fatalReason: `ページ送信中に想定外の例外が発生しました(gcloudサブプロセス失敗等の疑い): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function pollHealthUntilOk(serviceUrl: string, tokenProvider: IdTokenProvider): Promise<void> {
  const deadline = Date.now() + HEALTH_POLL_MAX_WAIT_MS;
  for (;;) {
    try {
      const token = await tokenProvider.getToken();
      const res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/health`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) return;
    } catch {
      // 無視して再試行(ネットワーク瞬断・503等)
    }
    if (Date.now() > deadline) {
      console.warn(`/healthのポーリングが${HEALTH_POLL_MAX_WAIT_MS / 60000}分でタイムアウトしました。次trialへ進みます。`);
      return;
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
}

/**
 * 承認済み仕様の緩和(golden側は「1件でも全体inconclusive」のまま無改変):
 * page単位で失敗検知したらtrialを打ち切り、300秒+/healthポーリングでクールダウンしてから
 * 次trialへ進む。本番と同じ「1ページずつ逐次送信」を再現する。
 */
async function runWarmTrial(opts: {
  tier: LoadTier;
  trialIndex: number;
  pageBuffers: Buffer[];
  serviceUrl: string;
  tokenProvider: IdTokenProvider;
  expectedModelVersion: string;
  requestFn: OcrRequestFn;
  injectFailureAtPage?: number;
}): Promise<LoadTrialRecord> {
  const startedAt = new Date().toISOString();
  const trialStartMs = Date.now();
  let state = initialTrialState(opts.tier, opts.trialIndex, opts.pageBuffers.length);
  let totalWallMs = 0;
  let totalServiceProcessingMs = 0;
  let hasServiceProcessingMs = false;

  for (let i = 0; i < opts.pageBuffers.length; i++) {
    const forceFailure = opts.injectFailureAtPage !== undefined && i + 1 === opts.injectFailureAtPage;
    const page = await sendLoadPage({
      series: 'warm',
      trial: opts.trialIndex,
      pageIndex: i,
      pdfBuffer: opts.pageBuffers[i],
      serviceUrl: opts.serviceUrl,
      tokenProvider: opts.tokenProvider,
      expectedModelVersion: opts.expectedModelVersion,
      requestFn: opts.requestFn,
      forceFailure,
    });

    if (page.timedOut || page.fatal) {
      const kind: PageFailureKind = page.timedOut ? (page.failureKind ?? 'networkError') : 'httpFatal';
      state = reduceTrialOutcome(state, { type: 'pageFailure', pageIndex: i, kind, detail: page.errorDetail ?? page.fatalReason });
      break;
    }
    totalWallMs += page.wallMs;
    if (page.serviceProcessingMs !== null) {
      totalServiceProcessingMs += page.serviceProcessingMs;
      hasServiceProcessingMs = true;
    }
    state = reduceTrialOutcome(state, { type: 'pageSuccess', pageIndex: i, wallMs: page.wallMs });
  }

  const finishedAt = new Date().toISOString();
  const completed = trialSucceeded(state);

  return {
    series: 'warm',
    trial: opts.trialIndex,
    pagesPlanned: opts.pageBuffers.length,
    pagesSent: state.pagesSent,
    totalWallMs,
    trialWallClockMs: Date.now() - trialStartMs,
    totalServiceProcessingMs: hasServiceProcessingMs ? totalServiceProcessingMs : null,
    completed,
    failedPageCount: completed ? 0 : finalizeTrialFailedPageCount(state),
    firstFailure: state.firstFailure,
    startedAt,
    finishedAt,
  };
}

async function runWarmSeries(opts: {
  tier: LoadTier;
  expectedWarmTrials: number;
  pageBuffers: Buffer[];
  serviceUrl: string;
  tokenProvider: IdTokenProvider;
  expectedModelVersion: string;
  requestFn: OcrRequestFn;
  budgetDeadlineMs: number;
  injectFailureAtPage?: number;
}): Promise<{ trials: LoadTrialRecord[]; abortedReason: 'budgetExceeded' | 'consecutiveTrialFailures' | null }> {
  const trials: LoadTrialRecord[] = [];
  let circuit = initialCircuitState();

  // warm系列1trial目はmin-instances=0により実質cold startを含むため、統計から除外する
  // 破棄用ウォームアップリクエストを1件送る(成否は問わない)。sendLoadPage自体は例外を
  // 投げない設計だが、万一の想定外例外にも備えて.catchは残しつつ、silent-failure-hunter
  // 指摘(Medium)を踏まえログだけは残す(完全な無言破棄は早期診断シグナルを失うため)。
  const warmupResult = await sendLoadPage({
    series: 'warm',
    trial: -1,
    pageIndex: 0,
    pdfBuffer: opts.pageBuffers[0],
    serviceUrl: opts.serviceUrl,
    tokenProvider: opts.tokenProvider,
    expectedModelVersion: opts.expectedModelVersion,
    requestFn: opts.requestFn,
  }).catch((err) => {
    console.warn('破棄用ウォームアップリクエストが想定外の例外で失敗しました(統計には影響しません):', err);
    return undefined;
  });
  if (warmupResult?.fatal || warmupResult?.timedOut) {
    console.warn(
      `破棄用ウォームアップリクエストが失敗しました(統計には影響しません): fatal=${warmupResult.fatal} timedOut=${warmupResult.timedOut} reason=${warmupResult.fatalReason ?? warmupResult.errorDetail ?? 'unknown'}`
    );
  }

  for (let trialIndex = 0; trialIndex < opts.expectedWarmTrials; trialIndex++) {
    if (Date.now() > opts.budgetDeadlineMs) {
      console.warn(`実行時間の予算を超過したため、残りのtrialを打ち切ります。収集済み${trials.length}件のtrialでレポートを生成します。`);
      return { trials, abortedReason: 'budgetExceeded' };
    }
    const trial = await runWarmTrial({
      tier: opts.tier,
      trialIndex,
      pageBuffers: opts.pageBuffers,
      serviceUrl: opts.serviceUrl,
      tokenProvider: opts.tokenProvider,
      expectedModelVersion: opts.expectedModelVersion,
      requestFn: opts.requestFn,
      injectFailureAtPage: trialIndex === 0 ? opts.injectFailureAtPage : undefined,
    });
    trials.push(trial);
    console.log(
      `[warm ${trialIndex + 1}/${opts.expectedWarmTrials}] tier=${opts.tier} completed=${trial.completed} ` +
        `totalWallMs=${trial.totalWallMs} failedPageCount=${trial.failedPageCount}`
    );

    circuit = reduceCircuitState(circuit, trial.completed);
    if (!trial.completed) {
      console.warn(`trial失敗を検知したためクールダウンへ入ります(次trial前にサービス復旧を待つ)。`);
      await sleep(COOLDOWN_AFTER_FAILURE_MS);
      await pollHealthUntilOk(opts.serviceUrl, opts.tokenProvider);
    }
    if (circuit.broken) {
      console.warn(`連続${CIRCUIT_BREAK_THRESHOLD}回のtrial失敗によりサーキットブレークしました。`);
      return { trials, abortedReason: 'consecutiveTrialFailures' };
    }
  }
  return { trials, abortedReason: null };
}

async function runColdBurst(opts: {
  burstIndex: number;
  pageBuffer: Buffer;
  serviceUrl: string;
  tokenProvider: IdTokenProvider;
  expectedModelVersion: string;
  requestFn: OcrRequestFn;
}): Promise<ColdBurstRecord> {
  const sendOne = (i: number) =>
    sendLoadPage({
      series: 'cold',
      trial: opts.burstIndex,
      pageIndex: i,
      pdfBuffer: opts.pageBuffer,
      serviceUrl: opts.serviceUrl,
      tokenProvider: opts.tokenProvider,
      expectedModelVersion: opts.expectedModelVersion,
      requestFn: opts.requestFn,
    });
  // concurrency=1のため、既存インスタンスで捌けない分は新規起動(真のcold start)を強制する
  // (2026-09-18再設計、詳細は計画書「cold測定の再設計」節参照)。sendLoadPageは例外を
  // 投げない設計だが、defense-in-depthとしてPromise.allSettledを使う(silent-failure-hunter
  // 指摘: Promise.allだと1件の異常拒否で残り2件の実測結果が失われる)。
  const settled = await Promise.allSettled(Array.from({ length: COLD_BURST_SIZE }, (_, i) => sendOne(i)));
  const pages = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : ({
          series: 'cold' as const,
          trial: opts.burstIndex,
          pageIndex: i,
          wallMs: 0,
          serviceProcessingMs: null,
          clientObservedExcessMs: null,
          httpStatus: null,
          retriedCount: 0,
          authRetried: false,
          timedOut: false,
          fatal: true,
          fatalReason: `バースト内リクエストが想定外の例外で拒否されました: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
        } satisfies LoadPageRecord)
  );
  // Fable 5.1レビュー指摘(M2、2026-09-18): バースト内に失敗ページがあるまま
  // Math.max(wallMs)を取ると、失敗が速く返った場合にcoldCandidateMsが実態より小さく
  // 見え、tier1ゲート(coldMax<=30秒)が誤ってPASSしうる。失敗ページが1件でもあれば
  // +Infinityとして扱う(warm系列p95の右側打ち切りと同じ思想)。
  const anyFailed = pages.some((p) => p.fatal || p.timedOut);
  const coldCandidateMs = anyFailed ? Number.POSITIVE_INFINITY : Math.max(...pages.map((p) => p.wallMs));
  return { burstIndex: opts.burstIndex, pages, coldCandidateMs };
}

async function runColdSeries(opts: {
  expectedColdBursts: number;
  pageBuffer: Buffer;
  serviceUrl: string;
  tokenProvider: IdTokenProvider;
  expectedModelVersion: string;
  requestFn: OcrRequestFn;
  budgetDeadlineMs: number;
}): Promise<ColdBurstRecord[]> {
  const bursts: ColdBurstRecord[] = [];
  for (let i = 0; i < opts.expectedColdBursts; i++) {
    // silent-failure-hunter指摘(High、2026-09-18): warm系列がtier別budget-minutesの
    // 大半を消費した場合、runColdSeriesに打ち切り判定が無いとGHAのtimeout-minutes自体で
    // 強制SIGKILLされ、レポートが一切書き出されないまま終わる(runWarmSeriesには
    // 既に同種のbudgetDeadlineMsチェックがある)。
    if (Date.now() > opts.budgetDeadlineMs) {
      console.warn(`実行時間の予算を超過したため、残りのcoldバーストを打ち切ります。収集済み${bursts.length}件のバーストでレポートを生成します。`);
      return bursts;
    }
    if (i > 0) {
      await sleep(COLD_BURST_COOLDOWN_MS);
    }
    const burst = await runColdBurst({
      burstIndex: i,
      pageBuffer: opts.pageBuffer,
      serviceUrl: opts.serviceUrl,
      tokenProvider: opts.tokenProvider,
      expectedModelVersion: opts.expectedModelVersion,
      requestFn: opts.requestFn,
    });
    bursts.push(burst);
    console.log(`[cold burst ${i + 1}/${opts.expectedColdBursts}] coldCandidateMs=${burst.coldCandidateMs}`);
  }
  return bursts;
}

async function runLoadModeSingleTier(opts: {
  tier: LoadTier;
  seriesArg: LoadSeries | 'both';
  intensity: LoadIntensity;
  injectFailureAtPage: number | undefined;
  budgetDeadlineMs: number;
  projectId: string;
  region: string;
  serviceUrl: string;
  expectedModelVersion: string;
}): Promise<LoadReport> {
  const startedAt = new Date().toISOString();
  const fixturePath = loadFixturePath(opts.tier);
  const combinedBuffer = fs.readFileSync(fixturePath);
  const fixtureSha256 = sha256File(fixturePath);
  const expectedSha256 = EXPECTED_LOAD_FIXTURE_SHA256[opts.tier];
  if (fixtureSha256 !== expectedSha256) {
    throw new Error(
      `load fixture整合性エラー(世代混在の疑い): ${path.basename(fixturePath)} のSHA-256が期待値と不一致です` +
        `(expected=${expectedSha256}, actual=${fixtureSha256})。fixtureを再生成した場合は` +
        `scripts/lib/paddleOcrLoad.ts の EXPECTED_LOAD_FIXTURE_SHA256 も更新してください。`
    );
  }
  const { extractAllPdfPages } = await import('./lib/geminiOcrCompare');
  const pageBuffers = await extractAllPdfPages(combinedBuffer);

  const tokenProvider = new IdTokenProvider(opts.serviceUrl);
  const requestFn = makeOcrRequestFn(LOAD_REQUEST_TIMEOUT_MS);

  const warmTrialsExpected = opts.intensity === 'quick' ? QUICK_PARAMS.warmTrials : WARM_TRIALS_FULL[opts.tier];
  const coldBurstsExpected = opts.intensity === 'quick' ? QUICK_PARAMS.coldBursts : COLD_BURSTS_FULL;
  const effectivePageBuffers =
    opts.intensity === 'quick' ? pageBuffers.slice(0, Math.min(pageBuffers.length, QUICK_PARAMS.maxPagesPerTrial)) : pageBuffers;

  const seriesExecuted: LoadSeries[] = [];
  let warmTrials: LoadTrialRecord[] = [];
  let coldBursts: ColdBurstRecord[] = [];
  let abortedReason: 'budgetExceeded' | 'consecutiveTrialFailures' | null = null;
  let serviceSnapshotWarmStart: LoadServiceSnapshot | null = null;
  let serviceSnapshotWarmEnd: LoadServiceSnapshot | null = null;

  if (opts.seriesArg === 'warm' || opts.seriesArg === 'both') {
    seriesExecuted.push('warm');
    serviceSnapshotWarmStart = await getServiceSnapshot(opts.projectId, opts.region);
    const result = await runWarmSeries({
      tier: opts.tier,
      expectedWarmTrials: warmTrialsExpected,
      pageBuffers: effectivePageBuffers,
      serviceUrl: opts.serviceUrl,
      tokenProvider,
      expectedModelVersion: opts.expectedModelVersion,
      requestFn,
      budgetDeadlineMs: opts.budgetDeadlineMs,
      injectFailureAtPage: opts.injectFailureAtPage,
    });
    warmTrials = result.trials;
    abortedReason = result.abortedReason;
    try {
      serviceSnapshotWarmEnd = await getServiceSnapshot(opts.projectId, opts.region);
    } catch (snapshotErr) {
      console.error('終了時スナップショットの取得に失敗しました:', snapshotErr);
    }
  }

  if ((opts.seriesArg === 'cold' || opts.seriesArg === 'both') && abortedReason === null) {
    seriesExecuted.push('cold');
    coldBursts = await runColdSeries({
      expectedColdBursts: coldBurstsExpected,
      pageBuffer: effectivePageBuffers[0],
      serviceUrl: opts.serviceUrl,
      tokenProvider,
      expectedModelVersion: opts.expectedModelVersion,
      requestFn,
      budgetDeadlineMs: opts.budgetDeadlineMs,
    });
  }

  const finishedAt = new Date().toISOString();
  return buildLoadReport({
    tier: opts.tier,
    intensity: opts.intensity,
    seriesExecuted,
    startedAt,
    finishedAt,
    serviceUrl: opts.serviceUrl,
    fixtureFile: path.basename(fixturePath),
    fixtureSha256,
    fixturePageCount: pageBuffers.length,
    expectedModelVersion: opts.expectedModelVersion,
    serviceSnapshotWarmStart,
    serviceSnapshotWarmEnd,
    warmTrials,
    coldBursts,
    // Fable 5.1レビュー指摘(H1、2026-09-18): ここを0にすると evaluateLoadGate の
    // hasSufficientWarmSamples(= warmTrialsForStats.length >= expectedWarmTrials)が
    // 0>=0でtrueになり、「標本数不足→NOT_EVALUATED」判定を素通りしてしまう
    // (--series=cold単独・intensity=fullでtier1のcoldMaxが基準内でも誤ってFAILになる)。
    // 常に実測の期待値を渡す。「--series=cold単独時にtrialCompletionRateが0%と誤解を招く
    // 表示になる」問題は computeTrialCompletionRate 側で trials.length===0 を早期return null
    // する形で解消する(ゲート判定のsufficiency計算には影響しない)。
    expectedWarmTrials: warmTrialsExpected,
    expectedColdBursts: coldBurstsExpected,
    abortedReason,
  });
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  let exitCode = 0;
  // code-reviewer指摘(High)・codex pass2指摘(P2): parseArgs/env読込/URL解決がtryの外にあると、
  // これらの失敗時にレポートJSON/Step Summaryが一切生成されない(ワークフローの
  // 「if: always()で必ず測定結果を回収する」という設計意図に反する)。全てtry内へ移す。
  let args: CliArgs | undefined;

  const writeJsonAndSummary = (reportJson: unknown, summaryMarkdown: string | null, outPath: string) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(reportJson, null, 2));
    console.log(`レポートを書き出しました: ${outPath}`);
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath && summaryMarkdown !== null) {
      fs.appendFileSync(summaryPath, summaryMarkdown + '\n');
    }
    process.exitCode = exitCode;
  };

  try {
    args = parseArgs(process.argv.slice(2));

    if (args.mode === 'load') {
      const devEnvContent = fs.readFileSync(DEV_ENV_PATH, 'utf-8');
      const projectId = requireEnvField(devEnvContent, 'PROJECT_ID', DEV_ENV_PATH);
      const region = requireEnvField(devEnvContent, 'CLOUD_RUN_LOCATION', DEV_ENV_PATH);
      const serviceUrl = resolveServiceUrl({
        explicitUrl: args.url,
        envVarUrl: process.env.PADDLE_OCR_URL,
        devEnvContent,
        devEnvPathForError: DEV_ENV_PATH,
      });
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as GoldenManifest;
      const expectedModelVersion = deriveExpectedModelVersion(manifest);
      const budgetDeadlineMs = Date.now() + args.budgetMs;
      const seriesArg = args.series ?? 'both';

      if (args.tier === 'all') {
        // quick専用: 4tier全てを1ジョブで疎通確認する(Phase A step4相当)。
        // pr-test-analyzer指摘(2026-09-18): このループの外側で例外を投げると、main()の
        // トップレベルcatchは`args.tier !== 'all'`をload skeletonの条件にしているため
        // tier=allのrunはgolden用の空レポート形状で書き出されてしまう(「if: always()で
        // 必ず測定結果を回収する」という設計意図に反する)。ループ全体を専用try/catchで囲み、
        // 既に収集済みのtierレポートを保持したまま、正しい形状(mode:'load')で書き出す。
        const tierReports = {} as Partial<Record<LoadTier, LoadReport>>;
        try {
          for (const t of LOAD_TIERS) {
            tierReports[t] = await runLoadModeSingleTier({
              tier: t,
              seriesArg,
              intensity: 'quick',
              injectFailureAtPage: args.injectFailureAtPage,
              budgetDeadlineMs,
              projectId,
              region,
              serviceUrl,
              expectedModelVersion,
            });
          }
        } catch (tierErr) {
          exitCode = 1;
          const fatalError = tierErr instanceof Error ? `${tierErr.message}\n${tierErr.stack ?? ''}` : String(tierErr);
          const completedTiers = LOAD_TIERS.filter((t) => tierReports[t] !== undefined);
          const md =
            `## PaddleOCR PR4c Stage 3: load tier=all(quick)が途中で失敗しました\n\n` +
            `完了済みtier: ${completedTiers.join(', ') || 'なし'}\n\nエラー: ${fatalError}`;
          writeJsonAndSummary({ schemaVersion: 1, mode: 'load', intensity: 'quick', tiers: tierReports, fatalError }, md, args.out);
          return;
        }
        exitCode = Math.max(...LOAD_TIERS.map((t) => determineLoadExitCode(tierReports[t] as LoadReport))) as 0 | 1;
        const combinedMd = LOAD_TIERS.map((t) => buildLoadStepSummaryMarkdown(tierReports[t] as LoadReport)).join('\n\n---\n\n');
        writeJsonAndSummary({ schemaVersion: 1, mode: 'load', intensity: 'quick', tiers: tierReports }, combinedMd, args.out);
        return;
      }

      const report = await runLoadModeSingleTier({
        tier: args.tier as LoadTier,
        seriesArg,
        intensity: args.intensity ?? 'full',
        injectFailureAtPage: args.injectFailureAtPage,
        budgetDeadlineMs,
        projectId,
        region,
        serviceUrl,
        expectedModelVersion,
      });
      exitCode = determineLoadExitCode(report);
      writeJsonAndSummary(report, buildLoadStepSummaryMarkdown(report), args.out);
      return;
    }

    // mode === 'golden'
    const devEnvContent = fs.readFileSync(DEV_ENV_PATH, 'utf-8');
    const projectId = requireEnvField(devEnvContent, 'PROJECT_ID', DEV_ENV_PATH);
    const region = requireEnvField(devEnvContent, 'CLOUD_RUN_LOCATION', DEV_ENV_PATH);
    const serviceUrl = resolveServiceUrl({
      explicitUrl: args.url,
      envVarUrl: process.env.PADDLE_OCR_URL,
      devEnvContent,
      devEnvPathForError: DEV_ENV_PATH,
    });

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as GoldenManifest;
    const hashCheck = verifyGoldenManifestHashes(manifest, FIXTURE_DIR);
    if (!hashCheck.ok) {
      throw new Error(`fixture整合性エラー(世代混在の疑い): ${hashCheck.mismatches.join('; ')}`);
    }
    const expectedModelVersion = deriveExpectedModelVersion(manifest);

    const serviceSnapshotStart = await getServiceSnapshot(projectId, region);
    console.log('開始時スナップショット:', serviceSnapshotStart);

    const tokenProvider = new IdTokenProvider(serviceUrl);

    const requests: GoldenRequestRecord[] = [];
    let order = 0;
    const loopStartedAt = Date.now();
    // codex review(7周目)指摘(P2): timedOut(クライアントタイムアウト・504)発生時に何も
    // せず次のケースへ進むと、サーバ側で継続中のバックグラウンド処理と後続リクエストの
    // インスタンス割当が絡み合い、以降のsubsequentRequestsMsサンプルを汚染しうる。
    // 検知したら残りのケース送信を打ち切る(buildReport側でも1件でもtimedOutがあれば
    // report全体をinconclusiveとする、二重の防御)。
    requestLoop: for (let round = 0; round < args.repeat; round++) {
      for (const c of GOLDEN_CASES) {
        // codex review(8周目)指摘(P2): 429/5xxの再試行が繰り返し発生すると、`--repeat`の
        // ケース数上限だけではジョブのtimeout-minutesを超過しうる。実行時間そのものを監視し、
        // 予算超過ならレポートを書き出す時間を残して打ち切る。
        if (Date.now() - loopStartedAt > args.budgetMs) {
          console.warn(
            `実行時間の予算(${args.budgetMs / 60000}分)を超過したため、残りのケース送信を打ち切ります。` +
              `収集済み${requests.length}件のデータでレポートを生成します。`
          );
          break requestLoop;
        }
        // silent-failure-hunter指摘(High): sendGoldenCaseWithRetries内のgetToken()呼び出しや
        // fixtureファイル読み込みが無保護のまま外側へ例外を伝播すると、1ケースの一時的な失敗
        // (gcloud呼び出し失敗・fixtureファイル破損等)でそれまでに収集した全計測データが
        // main()のトップレベルcatchで捨てられてしまう。ケース単位で例外境界を設け、
        // そのケースだけをfatalレコードとして記録しループを継続する。
        let record: GoldenRequestRecord;
        try {
          record = await sendGoldenCaseWithRetries(c, round, order, serviceUrl, expectedModelVersion, tokenProvider);
        } catch (caseErr) {
          record = makeFatalRecord(baseRecord(c, round, order), {
            wallMs: 0,
            httpStatus: null,
            retriedCount: 0,
            authRetried: false,
            fatalReason: `ケース処理中に想定外の例外が発生しました: ${caseErr instanceof Error ? caseErr.message : String(caseErr)}`,
          });
        }
        requests.push(record);
        console.log(
          `[${order + 1}/${args.repeat * GOLDEN_CASES.length}] ${c.pdfFile} round=${round} wallMs=${record.wallMs} ` +
            `fatal=${record.fatal} timedOut=${record.timedOut} exactMatch=${record.textCheck?.exactMatch ?? 'N/A'}`
        );
        order++;
        if (record.timedOut) {
          console.warn(
            `タイムアウト/504を検知したため、残りのケース送信を打ち切ります(サーバ側処理継続中の疑いがあり、以降のサンプルが汚染されうるため)。` +
              `order=${record.order} pdfFile=${record.pdfFile}`
          );
          break requestLoop;
        }
      }
    }

    // codex review指摘(P2): 全リクエスト完了後にここが例外を投げると、無保護のままでは
    // main()のトップレベルcatchに落ち、それまでに収集した`requests`が空スケルトンで
    // 上書きされ失われる。ケース単位の防御(上記try/catch)と同じ思想で、終了時スナップ
    // ショット取得の失敗もここで吸収し、収集済みデータを保持したままinconclusiveとして
    // 報告する。
    let serviceSnapshotEnd: ServiceSnapshot | null;
    try {
      serviceSnapshotEnd = await getServiceSnapshot(projectId, region);
      console.log('終了時スナップショット:', serviceSnapshotEnd);
    } catch (snapshotErr) {
      serviceSnapshotEnd = null;
      console.error('終了時スナップショットの取得に失敗しました:', snapshotErr);
    }

    const finishedAt = new Date().toISOString();
    const report = buildReport({
      serviceUrl,
      startedAt,
      finishedAt,
      serviceSnapshotStart,
      serviceSnapshotEnd,
      requests,
    });

    exitCode = determineExitCode(report, requests);

    writeJsonAndSummary(report, buildStepSummaryMarkdown(report), args.out);
  } catch (err) {
    exitCode = 1;
    const fatalError = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    if (args?.mode === 'load' && args.tier !== undefined && args.tier !== 'all') {
      const outPath = args.out;
      const report = emptyLoadReportSkeleton({
        tier: args.tier as LoadTier,
        intensity: args.intensity ?? 'full',
        startedAt,
        finishedAt: new Date().toISOString(),
        serviceUrl: args.url ?? 'unresolved',
        fatalError,
      });
      writeJsonAndSummary(report, buildLoadStepSummaryMarkdown(report), outPath);
    } else {
      const outPath = args?.out ?? path.join(process.cwd(), 'paddle-ocr-verify-golden.json');
      const report = emptyReportSkeleton(startedAt, new Date().toISOString(), args?.url ?? 'unresolved', fatalError);
      writeJsonAndSummary(report, buildStepSummaryMarkdown(report), outPath);
    }
    console.error(err);
  }
}

if (require.main === module) {
  main().catch((err) => {
    // 最終防波堤: writeAndExit自体が失敗した場合(ディスク書き込み失敗等)のみここに到達する。
    console.error('main()が予期せぬ形で失敗しました(レポート書き出し自体が失敗した可能性があります):', err);
    process.exitCode = 1;
  });
}
