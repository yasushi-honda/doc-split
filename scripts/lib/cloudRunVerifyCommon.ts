/**
 * ADR-0027 PR2b: Cloud Run実機ゲートハーネス共通ロジック(認証・env解析・リトライ分類・
 * 統計・ゲート判定のうち、サービス非依存な部分のみ)。`scripts/paddle-ocr-verify.ts`
 * (ADR-0025 PR4c)からの抽出。
 *
 * `/plan-crossreview`(codex High指摘)で「ロジック変更ゼロの移動のみ」という当初の説明は
 * 実態と合わないと指摘された: `paddle-ocr-verify.ts`の`getServiceSnapshot`/`resolveServiceUrl`
 * /`sendOcrWithRetries`/`makeOcrRequestFn`はPaddleOCR固有の値(サービス名`paddle-ocr`、
 * `IMAGE_DIGEST`環境変数、`PADDLE_OCR_URL`環境変数キー、PDF Buffer payload、OCR用の
 * timeout/retry方針)を型・実装に埋め込んでおり、素直に共通化すると実質的なAPI再設計が
 * 必要になる。そのため本モジュールは「サービス名・payload型・URLキーを一切知らない、
 * 構造的にサービス非依存だと保証できる関数」のみを対象に抽出する。以下は**意図的に**
 * 抽出対象から外している(各ハーネス側で独自実装する):
 * - `getServiceSnapshot`(サービス名・env変数名がPaddleOCR固有)
 * - `resolveServiceUrl`(環境変数キー`PADDLE_OCR_URL`が固定埋め込み)
 * - `sendOcrWithRetries`/`makeOcrRequestFn`(PDF Buffer payload・OCR用retry方針が固定埋め込み。
 *   Sarashina側はtimeout/504を再送しないという別の安全方針を持つため、そのまま流用すると
 *   OCR方針が無自覚に混入する)
 *
 * `scripts/paddle-ocr-verify.ts`側はこのモジュールから再importする形に書き換え、
 * 既存`scripts/lib/paddleOcrVerify.test.ts`(1388行、117テスト)が無改変で緑のまま
 * であることを確認してから次のステップへ進む(単独コミット、実装知見・受入条件の詳細は
 * `~/.claude/plans/logical-baking-lighthouse.md`「6b. PR2b詳細設計」節参照)。
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { percentile } from './confirmedReplayStats';

const execFileAsync = promisify(execFile);

/**
 * gcloud呼び出しのタイムアウト(60秒)。silent-failure-hunter指摘(paddle-ocr-verify.ts側で
 * 反映済み): gcloudがネットワーク不調・認証状態異常等でハングすると、例外にすらならず
 * 無限に待ち続け、「main()のトップレベルcatchでも必ずレポートを書き出す」という設計全体が
 * 発動する機会すら得られないまま、GitHub Actionsのjob timeout-minutesでジョブごと
 * 強制終了される(この場合`if: always()`のartifactアップロードすら実行されない)。
 */
export const GCLOUD_SUBPROCESS_TIMEOUT_MS = 60_000;

// ============================================================================
// env ファイル解析(deploy-*.yml の resolve_field() と同じプレースホルダー判定)
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

// ============================================================================
// ファイルハッシュ
// ============================================================================

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ============================================================================
// IDトークン管理(JWT expデコードによる遅延更新)
// ============================================================================

/**
 * JWTペイロード(base64url)をデコードしてexp(epoch秒)を読み取る。自己発行トークンの
 * 読み取りのみのため署名検証は行わない。デコードに失敗した場合はnullを返し、
 * 呼び出し側はキャッシュせず都度再取得する(安全側に倒す)。
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

export async function mintIdToken(audience: string): Promise<string> {
  const { stdout } = await execFileAsync('gcloud', ['auth', 'print-identity-token', '--audiences', audience], {
    timeout: GCLOUD_SUBPROCESS_TIMEOUT_MS,
  });
  return stdout.trim();
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

// ============================================================================
// サービススナップショット比較(取得自体〔getServiceSnapshot〕はサービス固有のため
// 各ハーネス側の責務。型と比較関数のみ共通化する)
// ============================================================================

export interface ServiceSnapshot {
  revisionName: string;
  imageDigest: string | null;
}

export function snapshotsMatch(a: ServiceSnapshot, b: ServiceSnapshot): boolean {
  return a.revisionName === b.revisionName && a.imageDigest === b.imageDigest;
}

// ============================================================================
// リトライ対象エラー分類
// ============================================================================

export type RequestFailureKind = 'networkError' | 'timeout' | 'httpStatus';

/**
 * リトライ対象はネットワークエラー・429・5xx系のみ。timeoutの扱い(即timedOutとして
 * リトライしないか、リトライするか)は呼び出し側のRetryPolicyが決める(サービスごとに
 * 安全方針が異なるため、本関数はHTTPステータス/エラー種別からの機械的な分類のみを担う)。
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

// ============================================================================
// ゲート判定
// ============================================================================

export type GateVerdict = 'PASS' | 'FAIL' | 'NOT_EVALUATED';

export function gateVerdict(actualSeconds: number | null, thresholdSeconds: number): GateVerdict {
  if (actualSeconds === null) return 'NOT_EVALUATED';
  return actualSeconds <= thresholdSeconds ? 'PASS' : 'FAIL';
}

// ============================================================================
// 汎用ユーティリティ
// ============================================================================

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parsePositiveIntMinutesToMs(raw: string, flagName: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${flagName} は1以上の整数(分)を指定してください(got: ${raw})`);
  }
  const minutes = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(minutes) || minutes < 1) {
    throw new Error(`--${flagName} は1以上の整数(分)を指定してください(got: ${raw})`);
  }
  return minutes * 60 * 1000;
}
