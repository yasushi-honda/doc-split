/**
 * PaddleOCR 画像縮小の精度確認(dev専用、goldenのPDFから作った画像のみ使用・実データなし)
 *
 * 目的: 長辺3000pxを超える画像をOCR入力前に縮小する対策(MAX_IMAGE_LONG_SIDE)が、読み取り精度を
 * 落とさないかを確認する。`--dir` 配下の `<fixtureId>__<variant>.jpg`(ワークフロー側でgoldenのPDFを
 * 画像化して生成)を `/ocr` へ送り、`scripts/fixtures/paddle-ocr-golden/<fixtureId>.expected.txt` と
 * 文字単位の類似度で照合する。
 *
 * 同じ画像を、縮小あり/なしの2設定のdevサービスへ送って比較する(設定の切替は本スクリプトの外)。
 * 出力は variant 別の類似度・失敗件数のみ(OCR本文は記録しない)。
 *
 * 限界: goldenは各約63〜66文字と短く、1文字で約1.5%動く。判定力は粗い。
 * 実行は GitHub Actions(.github/workflows/paddle-ocr-downscale-accuracy.yml)経由が前提。
 */

import * as fs from 'fs';
import * as path from 'path';
import { IdTokenProvider, requireEnvField } from './lib/cloudRunVerifyCommon';
import { charSimilarity } from './lib/ocrTextSimilarity';
import { buildOcrEndpoint, resolveServiceUrl, DEV_ENV_PATH } from './paddle-ocr-verify';

export interface AccuracyRecord {
  fixtureId: string;
  variant: string;
  status: number | null;
  wallMs: number;
  similarity: number;
  expectedLength: number;
  actualLength: number;
}

export interface VariantSummary {
  count: number;
  mean: number;
  min: number;
  failed: number;
}

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'paddle-ocr-golden');
const REQUEST_TIMEOUT_MS = 250_000;
const RETRY_WAIT_MS = 30_000;
/** 全体の実行時間の予算。超えたら残りを送らず、途中までの結果を書いて失敗終了する(ジョブ上限で強制終了され報告が残らないのを避ける)。 */
const TOTAL_BUDGET_MS = 80 * 60 * 1000;

/** `.pages.json`(配列)の先頭ページのテキスト。`.expected.txt`にはPDF用の`--- Page N ---`見出しがあり、画像のOCR結果には無いため使わない。 */
export function pageTextFromPagesJson(json: unknown): string {
  if (!Array.isArray(json) || json.length === 0 || typeof json[0] !== 'string') {
    throw new Error('pages.json は文字列の配列(1ページ以上)である必要があります');
  }
  return json[0];
}

export function isOverBudget(elapsedMs: number, budgetMs: number): boolean {
  return elapsedMs > budgetMs;
}

export function parseImageName(fileName: string): { fixtureId: string; variant: string } {
  const m = /^([A-Za-z0-9-]+)__([A-Za-z0-9-]+)\.jpg$/.exec(fileName);
  if (!m) {
    throw new Error(`画像ファイル名の形式が不正です(<fixtureId>__<variant>.jpg): ${fileName}`);
  }
  return { fixtureId: m[1], variant: m[2] };
}

export function summarizeAccuracy(records: AccuracyRecord[]): Record<string, VariantSummary> {
  if (records.length === 0) {
    throw new Error('精度確認の結果が空です');
  }
  const byVariant = new Map<string, AccuracyRecord[]>();
  for (const r of records) {
    byVariant.set(r.variant, [...(byVariant.get(r.variant) ?? []), r]);
  }
  const out: Record<string, VariantSummary> = {};
  for (const [variant, rs] of byVariant) {
    // 失敗(200以外)は類似度0として含める(落ちたことを「精度が良い」と読まないため)。
    const sims = rs.map((r) => (r.status === 200 ? r.similarity : 0));
    out[variant] = {
      count: rs.length,
      mean: sims.reduce((a, b) => a + b, 0) / sims.length,
      min: Math.min(...sims),
      failed: rs.filter((r) => r.status !== 200).length,
    };
  }
  return out;
}

async function postImage(
  serviceUrl: string,
  token: string,
  file: string
): Promise<{ status: number | null; text: string; wallMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(buildOcrEndpoint(serviceUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${token}` },
      body: fs.readFileSync(file),
      signal: controller.signal,
    });
    const body = await res.text();
    let text = '';
    if (res.status === 200) {
      text = (JSON.parse(body) as { text?: string }).text ?? '';
    }
    return { status: res.status, text, wallMs: Date.now() - started };
  } catch {
    return { status: null, text: '', wallMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!m || !['dir', 'out', 'label'].includes(m[1])) {
      throw new Error(`未知のオプションです: ${arg}`);
    }
    values[m[1]] = m[2];
  }
  if (!values.dir) throw new Error('--dir は必須です');
  const out = values.out || 'paddle-ocr-downscale-accuracy.json';

  const devEnvContent = fs.readFileSync(DEV_ENV_PATH, 'utf-8');
  requireEnvField(devEnvContent, 'PROJECT_ID', DEV_ENV_PATH);
  const serviceUrl = resolveServiceUrl({
    envVarUrl: process.env.PADDLE_OCR_URL,
    devEnvContent,
    devEnvPathForError: DEV_ENV_PATH,
  });
  const tokenProvider = new IdTokenProvider(serviceUrl);

  const files = fs.readdirSync(values.dir).filter((f) => f.endsWith('.jpg')).sort();
  if (files.length === 0) throw new Error(`画像がありません: ${values.dir}`);

  const records: AccuracyRecord[] = [];
  const startedAt = Date.now();
  let budgetExceeded = false;
  for (const f of files) {
    if (isOverBudget(Date.now() - startedAt, TOTAL_BUDGET_MS)) {
      budgetExceeded = true;
      console.error(`実行時間の予算(${TOTAL_BUDGET_MS / 60000}分)を超えたため、残りの画像は送らず終了します`);
      break;
    }
    const { fixtureId, variant } = parseImageName(f);
    const pagesPath = path.join(GOLDEN_DIR, `${fixtureId}.pages.json`);
    if (!fs.existsSync(pagesPath)) throw new Error(`期待テキスト(pages.json)がありません: ${pagesPath}`);
    const expected = pageTextFromPagesJson(JSON.parse(fs.readFileSync(pagesPath, 'utf-8')));

    let r = await postImage(serviceUrl, await tokenProvider.getToken(), path.join(values.dir, f));
    if (r.status === null || r.status >= 500) {
      // コンテナ再起動を待って1回だけ再試行する(精度ではなく可用性の揺れを除くため)。
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
      r = await postImage(serviceUrl, await tokenProvider.getToken(), path.join(values.dir, f));
    }
    const record: AccuracyRecord = {
      fixtureId,
      variant,
      status: r.status,
      wallMs: r.wallMs,
      similarity: r.status === 200 ? charSimilarity(expected, r.text) : 0,
      expectedLength: Array.from(expected.replace(/\s+/g, '')).length,
      actualLength: Array.from(r.text.replace(/\s+/g, '')).length,
    };
    console.log(
      `${fixtureId} ${variant}: status=${record.status} similarity=${record.similarity.toFixed(3)} wallMs=${record.wallMs}`
    );
    records.push(record);
  }

  const summary = summarizeAccuracy(records);
  console.log('summary', JSON.stringify(summary));
  fs.writeFileSync(
    out,
    JSON.stringify({ schemaVersion: 1, label: values.label ?? null, serviceUrl, incomplete: budgetExceeded, records, summary }, null, 2)
  );
  if (budgetExceeded) {
    throw new Error('実行時間の予算を超えたため、結果は一部の画像のみです(incomplete=true)');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
