/**
 * PaddleOCR PDFページ寸法プローブ(dev専用、合成PDFのみ使用)
 *
 * 目的: kanameoneで1ページ目だけがA3横(1191x842pt、200dpiで約773万画素)のPDFで
 * `paddle-ocr` が signal 9(HTTP 503)になった事象を、実データを使わずdevで再現できるか確認する。
 * 画像入力には長辺2500pxへの縮小があるがPDFには無い(services/paddle-ocr/raster.py)ため、
 * PDFでも画素数に応じて落ちるかを見る。
 *
 * 入力: `--dir` 配下の `<W>x<H>pt.pdf`(ワークフロー側でPillowにより生成。1ページ目がWxH pt、
 * 以降はA4)を `--cases`(1ページ目の寸法pt)の順に1つずつ `/ocr` へ送る。
 * 出力は寸法・画素数・HTTPステータス・所要時間・エラーコードのみ(本文・OCR結果は記録しない)。
 *
 * 実行は GitHub Actions(.github/workflows/paddle-ocr-pdf-probe.yml)経由が前提。
 * ローカルの個人認証ではIDトークンを得られない(paddle-ocr-verify.ts冒頭参照)。
 */

import * as fs from 'fs';
import * as path from 'path';
import { IdTokenProvider, requireEnvField } from './lib/cloudRunVerifyCommon';
import { resolveServiceUrl, DEV_ENV_PATH } from './paddle-ocr-verify';
import { hasAccessError, parseSizes, probeOne, shouldRetry, type ProbeResult, type ProbeSize } from './paddle-ocr-image-probe';

export interface PdfProbeArgs {
  dir: string;
  /** 1ページ目の寸法(pt)。ProbeSize の width/height は画像プローブではpx、ここではptの意味で流用している。長辺→面積の昇順 */
  cases: ProbeSize[];
  out: string;
  url?: string;
}

export type PdfProbeVerdict = 'NO_FAILURE' | 'FAILURES' | 'INCONCLUSIVE';

export interface PdfProbeCase {
  /** 1ページ目の寸法(pt) */
  firstPagePt: string;
  /** 1ページ目の画素数。ワークフローが生成する画像の画素数と一致する(寸法を200dpiの整数pxへ切り捨てて生成。PDFiumの描画はfloat誤差で±1px差が出うる) */
  pixelsAt200dpi: number;
  status: number | null;
  wallMs: number;
  errorCode: string | null;
  attempts: number;
  /** recovered: 1回目が失敗(503等)し、再試行で成功した。コンテナが落ちて再起動した兆候なので、再現の証拠として数える */
  outcome: 'ok' | 'recovered' | 'failed' | 'rejected';
}

const RENDER_DPI = 200;
const RETRY_WAIT_MS = 30_000;
const INPUT_REJECTION_STATUSES = new Set([400, 413, 415, 422]);

/** services/paddle-ocr/raster.py のレンダリングと同じ画素数計算(int(幅pt*scale)*int(高さpt*scale)) */
export function pixelsAtDpi(widthPt: number, heightPt: number, dpi = RENDER_DPI): number {
  const scale = dpi / 72;
  return Math.trunc(widthPt * scale) * Math.trunc(heightPt * scale);
}

export function parsePdfProbeArgs(argv: string[]): PdfProbeArgs {
  const known = new Set(['dir', 'cases', 'out', 'url']);
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
  if (values.cases === undefined) {
    throw new Error('--cases は必須です');
  }
  return {
    dir: values.dir,
    cases: parseSizes(values.cases),
    out: values.out || 'paddle-ocr-pdf-probe.json',
    url: values.url || undefined,
  };
}

export function toPdfProbeCase(r: ProbeResult): PdfProbeCase {
  const attempts = r.attempts ?? 1;
  const outcome: PdfProbeCase['outcome'] =
    r.status === 200
      ? attempts > 1
        ? 'recovered'
        : 'ok'
      : r.status !== null && INPUT_REJECTION_STATUSES.has(r.status)
        ? 'rejected'
        : 'failed';
  return {
    firstPagePt: `${r.width}x${r.height}`,
    pixelsAt200dpi: pixelsAtDpi(r.width, r.height),
    status: r.status,
    wallMs: r.wallMs,
    errorCode: r.errorCode,
    attempts,
    outcome,
  };
}

export function summarizePdfProbe(cases: PdfProbeCase[]): {
  verdict: PdfProbeVerdict;
  failedCases: string[];
  recoveredCases: string[];
  rejectedCases: string[];
  caveat: string;
} {
  if (cases.length === 0) {
    throw new Error('プローブ結果が空です');
  }
  const pick = (outcome: PdfProbeCase['outcome']) => cases.filter((c) => c.outcome === outcome).map((c) => c.firstPagePt);
  const failedCases = pick('failed');
  const recoveredCases = pick('recovered');
  const rejectedCases = pick('rejected');
  const hasFailure = failedCases.length > 0 || recoveredCases.length > 0;
  // 初回で成功した対照が無いと、画素数起因の失敗か、サービス自体の不調かを区別できない(画像プローブと同じ扱い)。
  // 入力拒否(4xx)のケースもOCRが走っていないため、対照が成功していても「全ケースで失敗なし」とは言えない。
  const hasControl = cases.some((c) => c.outcome === 'ok');
  let verdict: PdfProbeVerdict;
  if (hasFailure) {
    verdict = hasControl ? 'FAILURES' : 'INCONCLUSIVE';
  } else {
    verdict = rejectedCases.length > 0 || !hasControl ? 'INCONCLUSIVE' : 'NO_FAILURE';
  }
  const caveat =
    '合成PDF(画像化した疎な数字列)での結果。NO_FAILUREは「この合成PDFでは再現せず」の意味で、画素数起因でないことの証明ではない。' +
    'FAILURES(失敗または再試行で復旧したケースあり)は同時刻のpaddle-ocrログ(signal 9)と突き合わせて確定する。' +
    'INCONCLUSIVEは、初回成功の対照が無い、または入力拒否のケースがあり、判定できない。';
  return { verdict, failedCases, recoveredCases, rejectedCases, caveat };
}

async function main(): Promise<void> {
  const args = parsePdfProbeArgs(process.argv.slice(2));
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
  for (const size of args.cases) {
    const file = path.join(args.dir, `${size.width}x${size.height}pt.pdf`);
    if (!fs.existsSync(file)) {
      throw new Error(`入力PDFがありません: ${file}`);
    }
    let r = await probeOne(serviceUrl, await tokenProvider.getToken(), file, size, 'application/pdf');
    r.attempts = 1;
    if (shouldRetry(r)) {
      console.log(`${size.width}x${size.height}pt: 1回目 status=${r.status} errorCode=${r.errorCode}。${RETRY_WAIT_MS / 1000}秒待って再試行`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
      r = await probeOne(serviceUrl, await tokenProvider.getToken(), file, size, 'application/pdf');
      r.attempts = 2;
    }
    console.log(`${size.width}x${size.height}pt: status=${r.status} wallMs=${r.wallMs} errorCode=${r.errorCode} attempts=${r.attempts}`);
    results.push(r);
  }

  const cases = results.map(toPdfProbeCase);
  const summary = summarizePdfProbe(cases);
  console.log(`verdict=${summary.verdict}`, JSON.stringify(summary));
  fs.writeFileSync(args.out, JSON.stringify({ schemaVersion: 1, serviceUrl, cases, summary }, null, 2));
  if (hasAccessError(results)) {
    throw new Error('認証または設定の不備(401/403/404)を検出しました。プローブ自体が機能していないため、判定は無効です');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
