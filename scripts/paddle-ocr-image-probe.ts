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

export function parseSizes(raw: string): ProbeSize[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error('--sizes が空です(例: 3000x2250,4080x3060)');
  }
  return parts.map((p) => {
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

function bucketOf(results: ProbeResult[]): ProbeBucket {
  const ok = results.filter((r) => r.status === 200).length;
  const rejected = results.filter((r) => r.status !== null && r.status >= 400 && r.status < 500).length;
  return { total: results.length, ok, failed: results.length - ok - rejected, rejected };
}

export function summarizeProbe(results: ProbeResult[]): {
  atOrBelow4000: ProbeBucket;
  above4000: ProbeBucket;
  verdict: ProbeVerdict;
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
  return { atOrBelow4000: low, above4000: high, verdict };
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
    const r = await probeOne(serviceUrl, token, file, size);
    console.log(`${size.width}x${size.height}: status=${r.status} wallMs=${r.wallMs} errorCode=${r.errorCode}`);
    results.push(r);
  }

  const summary = summarizeProbe(results);
  console.log(`verdict=${summary.verdict}`, JSON.stringify(summary));
  fs.writeFileSync(args.out, JSON.stringify({ schemaVersion: 1, serviceUrl, results, summary }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
