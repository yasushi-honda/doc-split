#!/usr/bin/env ts-node
/**
 * ADR-0025 PR4c Stage 1: PaddleOCR Cloud Run実機の一次スクリーニング + golden再現性検証。
 *
 * 背景: 承認済み計画(~/.claude/plans/fuzzy-moseying-book.md §4)は「6〜8秒/ページ」
 * (ローカルMac arm64のPoC実測)を前提にフル負荷試験を設計していたが、plan mode中の実測で
 * dev Cloud Run実機の`/ocr`実績が96.6秒/ページ(1桁の乖離)であることが判明した。本スクリプトは
 * その乖離の実力値を安価に確認するStage 1(`~/.claude/plans/enumerated-gliding-bengio.md`)の
 * 実装であり、`golden`モードのみを対象とする。png/load/coldモードは未実装(Stage 2/3判断待ち)。
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
 * PADDLE_OCR_URLが設定された後の誤爆防止。Stage 1はdev環境専用のため常にdev.envと一致するはず)。
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
        'Stage 1 はdev環境専用です。誤って他環境を指定していないか確認してください。'
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
  const { stdout } = await execFileAsync('gcloud', ['auth', 'print-identity-token', '--audiences', audience]);
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
  ]);
  const { stdout: envJsonRaw } = await execFileAsync('gcloud', [
    'run', 'services', 'describe', SERVICE_NAME,
    '--project', projectId,
    '--region', region,
    '--format', 'json(spec.template.spec.containers[0].env)',
  ]);
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
  fatal: boolean;
  fatalReason?: string;
  textCheck?: TextDiffResult;
  modelVersionMatch?: boolean;
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
  serviceSnapshotStart: ServiceSnapshot;
  serviceSnapshotEnd: ServiceSnapshot;
  requests: GoldenRequestRecord[];
}): Report {
  const inconclusiveBySnapshot = !snapshotsMatch(input.serviceSnapshotStart, input.serviceSnapshotEnd);
  const [first, ...rest] = input.requests;

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
  const inconclusive = inconclusiveBySnapshot || inconclusiveBySampleSize;
  const inconclusiveReason = inconclusiveBySnapshot
    ? `計測開始時と終了時でサービススナップショットが一致しない(開始: ${JSON.stringify(input.serviceSnapshotStart)}, 終了: ${JSON.stringify(input.serviceSnapshotEnd)})`
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
          actualSeconds: first ? first.wallMs / 1000 : null,
          basis: 'p50',
          verdict: gateVerdict(first ? first.wallMs / 1000 : null, GATE_THRESHOLDS_SECONDS.p1),
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
  }
  lines.push(`- 成功率(subsequent): ${report.successRateSubsequent !== null ? `${(report.successRateSubsequent * 100).toFixed(1)}%` : 'N/A'}`);
  lines.push(`- タイムアウト件数: ${report.timedOutCount} / 503件数: ${report.status503Count}`);
  lines.push('');
  lines.push('| ゲート | ページ数 | 基準(秒) | 実測換算(秒) | 判定 |');
  lines.push('|---|---|---|---|---|');
  for (const g of report.gates) {
    lines.push(
      `| ${g.id} | ${g.pages} | ${g.thresholdSeconds} | ${g.actualSeconds !== null ? g.actualSeconds.toFixed(1) : 'N/A'} | projected ${g.verdict} |`
    );
  }
  lines.push('');
  lines.push('「PASS」は「Stage 3の実データ負荷試験へ進めてよい」という意味であり、PR6のGo判定そのものではない。');
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

export interface CliArgs {
  mode: string;
  url?: string;
  repeat: number;
  out: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  const repeat = args.repeat ? Number.parseInt(args.repeat, 10) : 3;
  if (!Number.isFinite(repeat) || repeat < 1) {
    throw new Error(`--repeat は1以上の整数を指定してください(got: ${args.repeat})`);
  }
  return {
    mode: args.mode ?? 'golden',
    url: args.url,
    repeat,
    out: args.out ?? path.join(process.cwd(), 'paddle-ocr-verify-golden.json'),
  };
}

// ============================================================================
// CLIオーケストレーション(require.main === module でのみ実行)
// ============================================================================

async function sendGoldenRequestOnce(
  serviceUrl: string,
  pdfBuffer: Buffer,
  tokenProvider: IdTokenProvider
): Promise<{ status: number | null; body: string | null; wallMs: number; kind: 'success' | 'timeout' | 'networkError' }> {
  const token = await tokenProvider.getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${serviceUrl}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', Authorization: `Bearer ${token}` },
      body: pdfBuffer,
      signal: controller.signal,
    });
    const wallMs = Date.now() - started;
    const body = await res.text();
    return { status: res.status, body, wallMs, kind: 'success' };
  } catch (err) {
    const wallMs = Date.now() - started;
    if ((err as { name?: string }).name === 'AbortError') {
      return { status: null, body: null, wallMs, kind: 'timeout' };
    }
    return { status: null, body: null, wallMs, kind: 'networkError' };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendGoldenCaseWithRetries(
  c: GoldenCase,
  round: number,
  order: number,
  serviceUrl: string,
  expectedModelVersion: string,
  tokenProvider: IdTokenProvider
): Promise<GoldenRequestRecord> {
  const pdfBuffer = fs.readFileSync(path.join(FIXTURE_DIR, c.pdfFile));
  const expectedPages = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, c.pagesJsonFile), 'utf-8')) as string[];
  const expectedText = expectedPages[c.pageIndex];

  let retriedCount = 0;
  let authRetried = false;

  for (;;) {
    const attempt = await sendGoldenRequestOnce(serviceUrl, pdfBuffer, tokenProvider);

    if (attempt.kind === 'timeout') {
      return {
        manifestId: c.manifestId,
        pdfFile: c.pdfFile,
        round,
        order,
        wallMs: attempt.wallMs,
        processingMs: null,
        clientObservedExcessMs: null,
        httpStatus: null,
        retriedCount,
        authRetried,
        timedOut: true,
        fatal: false,
      };
    }

    if (attempt.kind === 'networkError') {
      const failureClass = classifyFailure('networkError', null);
      if (failureClass === 'retryable' && retriedCount < MAX_RETRIES) {
        retriedCount++;
        await sleep(INITIAL_BACKOFF_MS * 2 ** (retriedCount - 1));
        continue;
      }
      return {
        manifestId: c.manifestId,
        pdfFile: c.pdfFile,
        round,
        order,
        wallMs: attempt.wallMs,
        processingMs: null,
        clientObservedExcessMs: null,
        httpStatus: null,
        retriedCount,
        authRetried,
        timedOut: false,
        fatal: true,
        fatalReason: 'ネットワークエラーがリトライ上限まで解消しませんでした',
      };
    }

    // kind === 'success'
    if ((attempt.status === 401 || attempt.status === 403) && !authRetried) {
      authRetried = true;
      await tokenProvider.getToken(true);
      continue;
    }
    if ((attempt.status === 401 || attempt.status === 403) && authRetried) {
      return {
        manifestId: c.manifestId,
        pdfFile: c.pdfFile,
        round,
        order,
        wallMs: attempt.wallMs,
        processingMs: null,
        clientObservedExcessMs: null,
        httpStatus: attempt.status,
        retriedCount,
        authRetried,
        timedOut: false,
        fatal: true,
        fatalReason: `トークン再発行後も${attempt.status}が続きました(認可設定の不備の疑い)`,
      };
    }

    const failureClass = attempt.status !== null && attempt.status !== 200
      ? classifyFailure('httpStatus', attempt.status)
      : null;

    if (failureClass === 'retryable' && retriedCount < MAX_RETRIES) {
      retriedCount++;
      await sleep(INITIAL_BACKOFF_MS * 2 ** (retriedCount - 1));
      continue;
    }

    if (attempt.status !== 200) {
      return {
        manifestId: c.manifestId,
        pdfFile: c.pdfFile,
        round,
        order,
        wallMs: attempt.wallMs,
        processingMs: null,
        clientObservedExcessMs: null,
        httpStatus: attempt.status,
        retriedCount,
        authRetried,
        timedOut: false,
        fatal: true,
        fatalReason: `HTTP ${attempt.status}: ${attempt.body?.slice(0, 500) ?? ''}`,
      };
    }

    // 200 OK: 契約検証
    let parsed: { text?: string; pages?: string[]; pageCount?: number; engine?: string; renderDpi?: number; modelVersion?: string; processingMs?: number };
    try {
      parsed = JSON.parse(attempt.body ?? '');
    } catch {
      return {
        manifestId: c.manifestId,
        pdfFile: c.pdfFile,
        round,
        order,
        wallMs: attempt.wallMs,
        processingMs: null,
        clientObservedExcessMs: null,
        httpStatus: attempt.status,
        retriedCount,
        authRetried,
        timedOut: false,
        fatal: true,
        fatalReason: 'レスポンスがJSONとしてパースできませんでした',
      };
    }

    const actualText = parsed.pages?.[0] ?? '';
    const textCheck = compareGoldenText(expectedText, actualText);
    const modelVersionMatch = parsed.modelVersion === expectedModelVersion;
    const contractOk =
      parsed.pageCount === 1 && parsed.engine === 'paddleocr' && parsed.renderDpi === 200 && modelVersionMatch;

    const processingMs = typeof parsed.processingMs === 'number' ? parsed.processingMs : null;
    const clientObservedExcessMs = processingMs !== null ? attempt.wallMs - processingMs : null;

    if (!textCheck.exactMatch || !contractOk) {
      return {
        manifestId: c.manifestId,
        pdfFile: c.pdfFile,
        round,
        order,
        wallMs: attempt.wallMs,
        processingMs,
        clientObservedExcessMs,
        httpStatus: attempt.status,
        retriedCount,
        authRetried,
        timedOut: false,
        fatal: true,
        fatalReason: !textCheck.exactMatch ? 'golden textと不一致' : '契約検証(pageCount/engine/renderDpi/modelVersion)に失敗',
        textCheck,
        modelVersionMatch,
      };
    }

    return {
      manifestId: c.manifestId,
      pdfFile: c.pdfFile,
      round,
      order,
      wallMs: attempt.wallMs,
      processingMs,
      clientObservedExcessMs,
      httpStatus: attempt.status,
      retriedCount,
      authRetried,
      timedOut: false,
      fatal: false,
      textCheck,
      modelVersionMatch,
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode !== 'golden') {
    throw new Error(`--mode=${args.mode} はStage 1では未実装です(golden のみ対応。png/load/coldはStage 2/3判断待ち)`);
  }

  const devEnvContent = fs.readFileSync(DEV_ENV_PATH, 'utf-8');
  const projectId = requireEnvField(devEnvContent, 'PROJECT_ID', DEV_ENV_PATH);
  const region = requireEnvField(devEnvContent, 'CLOUD_RUN_LOCATION', DEV_ENV_PATH);
  const serviceUrl = resolveServiceUrl({
    explicitUrl: args.url,
    envVarUrl: process.env.PADDLE_OCR_URL,
    devEnvContent,
    devEnvPathForError: DEV_ENV_PATH,
  });

  const startedAt = new Date().toISOString();
  let exitCode = 0;

  const writeAndExit = (report: Partial<Report> & { fatalError: string | null }) => {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.log(`レポートを書き出しました: ${args.out}`);
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath && report.schemaVersion === 1) {
      fs.appendFileSync(summaryPath, buildStepSummaryMarkdown(report as Report) + '\n');
    }
    process.exitCode = exitCode;
  };

  try {
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
    for (let round = 0; round < args.repeat; round++) {
      for (const c of GOLDEN_CASES) {
        const record = await sendGoldenCaseWithRetries(c, round, order, serviceUrl, expectedModelVersion, tokenProvider);
        requests.push(record);
        console.log(
          `[${order + 1}/${args.repeat * GOLDEN_CASES.length}] ${c.pdfFile} round=${round} wallMs=${record.wallMs} ` +
            `fatal=${record.fatal} timedOut=${record.timedOut} exactMatch=${record.textCheck?.exactMatch ?? 'N/A'}`
        );
        order++;
      }
    }

    const serviceSnapshotEnd = await getServiceSnapshot(projectId, region);
    console.log('終了時スナップショット:', serviceSnapshotEnd);

    const finishedAt = new Date().toISOString();
    const report = buildReport({
      serviceUrl,
      startedAt,
      finishedAt,
      serviceSnapshotStart,
      serviceSnapshotEnd,
      requests,
    });

    const anyFatal = requests.some((r) => r.fatal);
    if (report.inconclusive || anyFatal) {
      exitCode = 1;
    }

    writeAndExit(report);
  } catch (err) {
    exitCode = 1;
    writeAndExit({
      schemaVersion: 1,
      startedAt,
      finishedAt: new Date().toISOString(),
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
      fatalError: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
      notes: REPORT_NOTES,
    });
    console.error(err);
  }
}

if (require.main === module) {
  main();
}
