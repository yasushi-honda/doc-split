/**
 * PaddleOCR 画像寸法プローブ(dev専用、合成JPEGのみ使用)
 *
 * 目的: kanameoneで長辺4000px超のJPEG(4080x3060)が `paddle-ocr` を signal 9 で落とした事象
 * (PaddleOCRが「exceeds max_side_limit of 4000. Resizing」を出した約2秒後にコンテナ終了、
 * HTTP 503)を、実データを使わずにdevで再現できるか確認する。
 *
 * 入力: `--dir` 配下の `<W>x<H>.jpg`(ワークフロー側でPillowにより生成)を `--sizes` の順に1枚ずつ
 * `/ocr` へ送る。出力は寸法・HTTPステータス・所要時間・エラーコードのみ(本文・OCR結果は記録しない)。
 *
 * 実行は GitHub Actions(.github/workflows/paddle-ocr-image-probe.yml)経由が前提。
 * ローカルの個人認証ではIDトークンを得られない(paddle-ocr-verify.ts冒頭参照)。
 */

import * as fs from 'fs';
import * as path from 'path';
import { IdTokenProvider, requireEnvField } from './lib/cloudRunVerifyCommon';
import { buildOcrEndpoint, resolveServiceUrl, DEV_ENV_PATH } from './paddle-ocr-verify';

export interface ProbeSize {
  width: number;
  height: number;
}

export interface ProbeArgs {
  dir: string;
  sizes: ProbeSize[];
  out: string;
  url?: string;
}

export interface ProbeResult {
  width: number;
  height: number;
  /** 試行回数(再試行した場合は2)。単発の503等と再現性のある失敗を区別するための記録。 */
  attempts?: number;
  /** HTTPステータス。ネットワーク断・タイムアウト時は null。 */
  status: number | null;
  wallMs: number;
  errorCode: string | null;
}

export type ProbeVerdict = 'NOT_REPRODUCED' | 'FAILS_ONLY_ABOVE_4000' | 'FAILS_ALSO_AT_OR_BELOW_4000' | 'INCONCLUSIVE';

export interface ProbeBucket {
  total: number;
  ok: number;
  /** 処理失敗(5xx・ネットワーク断・タイムアウト)。OCRが実行された/しようとして落ちたもの。 */
  failed: number;
  /** サービスの入力拒否(4xx、例: 422 PIXEL_LIMIT_EXCEEDED)。OCRが走っていないため評価対象外。 */
  rejected: number;
}

const MAX_SIDE_LIMIT = 4000;
const REQUEST_TIMEOUT_MS = 250_000;
const RETRY_WAIT_MS = 30_000;
/** 1件あたり最大(250秒+待機30秒+250秒)×MAX_SIZES がワークフローのジョブ時間枠に近づくが、通常は数秒〜数十秒。最悪でも約53分でジョブ上限(75分)に収まる。 */
export const MAX_SIZES = 6;
/** サービスが入力検証で返すステータス(OCR未実行)。401/403/404等の認証・設定不備は含めない。 */
const INPUT_REJECTION_STATUSES = new Set([400, 413, 415, 422]);
const ACCESS_ERROR_STATUSES = new Set([401, 403, 404]);

export function parseSizes(raw: string): ProbeSize[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error('--sizes が空です(例: 3000x2250,4080x3060)');
  }
  if (parts.length > MAX_SIZES) {
    throw new Error(`--sizes は最大${MAX_SIZES}件までです(got: ${parts.length}、ジョブ時間枠の上限)`);
  }
  const parsed = parts.map((p) => {
    const m = /^(\d+)[xX](\d+)$/.exec(p);
    if (!m) {
      throw new Error(`--sizes の形式が不正です: "${p}"(WxH、正の整数)`);
    }
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (width <= 0 || height <= 0) {
      throw new Error(`--sizes の寸法は正の整数である必要があります: "${p}"`);
    }
    return { width, height };
  });
  // 重複(先頭ゼロ・大文字Xの表記ゆれ含む)を除き、長辺→面積の昇順に並べる。先に大きい画像でコンテナが
  // 落ちると、再起動中の503で後続の小さい画像が巻き添え失敗し、判定を誤読させるため。
  const unique = new Map<string, ProbeSize>();
  for (const sz of parsed) {
    unique.set(`${sz.width}x${sz.height}`, sz);
  }
  return [...unique.values()].sort(
    (a, b) => Math.max(a.width, a.height) - Math.max(b.width, b.height) || a.width * a.height - b.width * b.height
  );
}

export function parseProbeArgs(argv: string[]): ProbeArgs {
  const known = new Set(['dir', 'sizes', 'out', 'url']);
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!m || !known.has(m[1])) {
      throw new Error(`未知のオプションです: ${arg}`);
    }
    values[m[1]] = m[2];
  }
  if (!values.dir) {
    throw new Error('--dir は必須です');
  }
  if (values.sizes === undefined) {
    throw new Error('--sizes は必須です');
  }
  return {
    dir: values.dir,
    sizes: parseSizes(values.sizes),
    out: values.out || 'paddle-ocr-image-probe.json',
    url: values.url || undefined,
  };
}

/** 単発の503/429/タイムアウト(コールドスタートや再起動起因)を、再現性のある失敗と区別するための再試行判定。 */
export function shouldRetry(r: ProbeResult): boolean {
  return r.status === null || r.status === 429 || r.status >= 500;
}

/** 認証・設定不備(401/403/404)があれば、プローブ自体が壊れているので判定せず失敗させる。 */
export function hasAccessError(results: ProbeResult[]): boolean {
  return results.some((r) => r.status !== null && ACCESS_ERROR_STATUSES.has(r.status));
}

function bucketOf(results: ProbeResult[]): ProbeBucket {
  const ok = results.filter((r) => r.status === 200).length;
  const rejected = results.filter((r) => r.status !== null && INPUT_REJECTION_STATUSES.has(r.status)).length;
  return { total: results.length, ok, failed: results.length - ok - rejected, rejected };
}

export function summarizeProbe(results: ProbeResult[]): {
  atOrBelow4000: ProbeBucket;
  above4000: ProbeBucket;
  verdict: ProbeVerdict;
  caveat: string;
} {
  if (results.length === 0) {
    throw new Error('プローブ結果が空です');
  }
  const low = bucketOf(results.filter((r) => Math.max(r.width, r.height) <= MAX_SIDE_LIMIT));
  const high = bucketOf(results.filter((r) => Math.max(r.width, r.height) > MAX_SIDE_LIMIT));

  let verdict: ProbeVerdict;
  if (low.failed > 0) {
    verdict = 'FAILS_ALSO_AT_OR_BELOW_4000';
  } else if (high.failed > 0) {
    // 閾値依存と言えるのは、4000px以下で成功した対照がある場合だけ。
    verdict = low.ok > 0 ? 'FAILS_ONLY_ABOVE_4000' : 'INCONCLUSIVE';
  } else if (high.ok === 0) {
    // 4000px超でOCRが実行されていない(未送信、または全て入力拒否)ため、再現有無を言えない。
    verdict = 'INCONCLUSIVE';
  } else {
    verdict = 'NOT_REPRODUCED';
  }
  const caveat =
    '合成JPEG(疎な数字列)での結果。NOT_REPRODUCEDは「この合成画像では再現せず」の意味で、サイズ起因でないことの証明ではない。' +
    'FAILS_*は同時刻のpaddle-ocrログ(signal 9 / max_side_limit)と突き合わせて確定する。';
  return { atOrBelow4000: low, above4000: high, verdict, caveat };
}

async function probeOne(serviceUrl: string, token: string, file: string, size: ProbeSize): Promise<ProbeResult> {
  const body = fs.readFileSync(file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(buildOcrEndpoint(serviceUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${token}` },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    let errorCode: string | null = null;
    if (res.status !== 200) {
      // 本文はOCR結果を含みうるため、成功時は読み捨て。失敗時もerror.codeのみ抽出する。
      try {
        errorCode = (JSON.parse(text) as { error?: { code?: string } }).error?.code ?? null;
      } catch {
        errorCode = null;
      }
    }
    return { ...size, status: res.status, wallMs: Date.now() - started, errorCode };
  } catch (err) {
    const name = (err as { name?: string }).name;
    return { ...size, status: null, wallMs: Date.now() - started, errorCode: name === 'AbortError' ? 'CLIENT_TIMEOUT' : 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const args = parseProbeArgs(process.argv.slice(2));
  const devEnvContent = fs.readFileSync(DEV_ENV_PATH, 'utf-8');
  requireEnvField(devEnvContent, 'PROJECT_ID', DEV_ENV_PATH);
  const serviceUrl = resolveServiceUrl({
    explicitUrl: args.url,
    envVarUrl: process.env.PADDLE_OCR_URL,
    devEnvContent,
    devEnvPathForError: DEV_ENV_PATH,
  });
  const tokenProvider = new IdTokenProvider(serviceUrl);

  const results: ProbeResult[] = [];
  for (const size of args.sizes) {
    const file = path.join(args.dir, `${size.width}x${size.height}.jpg`);
    if (!fs.existsSync(file)) {
      throw new Error(`入力JPEGがありません: ${file}`);
    }
    const token = await tokenProvider.getToken();
    let r = await probeOne(serviceUrl, token, file, size);
    r.attempts = 1;
    if (shouldRetry(r)) {
      // コンテナ再起動(startup probe含む)を待ってから1回だけ再試行する。2回とも失敗した場合だけ失敗と数える。
      console.log(`${size.width}x${size.height}: 1回目 status=${r.status} errorCode=${r.errorCode}。${RETRY_WAIT_MS / 1000}秒待って再試行`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
      r = await probeOne(serviceUrl, await tokenProvider.getToken(), file, size);
      r.attempts = 2;
    }
    console.log(`${size.width}x${size.height}: status=${r.status} wallMs=${r.wallMs} errorCode=${r.errorCode} attempts=${r.attempts}`);
    results.push(r);
  }

  const summary = summarizeProbe(results);
  console.log(`verdict=${summary.verdict}`, JSON.stringify(summary));
  fs.writeFileSync(args.out, JSON.stringify({ schemaVersion: 1, serviceUrl, results, summary }, null, 2));
  if (hasAccessError(results)) {
    // 認証・設定不備のままINCONCLUSIVEで正常終了すると壊れたプローブを見逃すため、レポート出力後に失敗させる。
    throw new Error('認証または設定の不備(401/403/404)を検出しました。プローブ自体が機能していないため、判定は無効です');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
