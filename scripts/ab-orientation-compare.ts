#!/usr/bin/env ts-node
/**
 * 向き補正あり・なしの対照実験(同一の元PDFを、補正なしの旧リビジョンと補正ありの現行で読み比べる)。PIIなし。
 *
 * 背景: ADR-0031。向き補正が未判定を減らしたのかを、同じ書類で「補正なし/あり」を並べて確かめる。
 * 書類は書き換えない(Firestore/Storageは読み取りのみ)。認識テキスト・書類名・IDは出力せず、件数と帯のみ。
 *
 * 使い方(GitHub Actions: Run Operations Script):
 *   ab-orientation-compare --since 2026-11-01 --group undetermined --limit 10
 *   ab-orientation-compare --since 2026-10-01 --group reprocessed --cutoff 2026-11-04T18:30 --limit 100
 *     (reprocessed = 補正反映前に取り込まれ、反映後に読み直された書類。現在の状態だけで選ぶと"解消しなかったもの"に偏るため、この選び方が補正の効果測定の本命)
 *   ab-orientation-compare --control golden   (PDF固定を0/90/180/270°に回した対照。書類は読まない)
 * 補正ありのURLは現行のpaddle-ocr、補正なしのURLはタグ`orientoff`(旧リビジョン、トラフィック0)から、ワークフローが取得して渡す。
 *
 * 補正なし側は2回実行し、OCR自体のゆらぎ(2回の判定の食い違い)も測る。
 * 注意: 書類種別の判定は、本番の処理と同じ全文照合(extractDocumentTypeEnhanced)のみ。候補による補助(空)は同じ。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { PDFDocument, degrees } from 'pdf-lib';
import { ocrWithPaddle } from '../functions/src/ocr/paddleOcrClient';
import { extractDocumentTypeEnhanced, type DocumentMaster } from '../functions/src/utils/extractors';
import { MASTER_PATHS } from '../functions/src/utils/masterPaths';
import { sanitizeDocumentMasters } from '../functions/src/utils/sanitizeMasterData';
import { parseSinceArg } from './lib/undeterminedSummary';
import { parseJstDateTime } from './lib/rateWindows';
import { bucketDocumentType, bucketStatus } from './lib/unknownCustomerDiagnosis';
import { isDetermined, japaneseRatio, summarizePairs, type PairRow } from './lib/abCompare';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const offUrl = getArg('--off-url') ?? process.env.AB_OFF_URL;
const onUrl = getArg('--on-url') ?? process.env.AB_ON_URL;
if (!offUrl || !onUrl || !/^https:\/\//.test(offUrl) || !/^https:\/\//.test(onUrl)) {
  console.error('補正なし/ありのURL(--off-url/--on-url または AB_OFF_URL/AB_ON_URL)を https:// で指定してください');
  process.exit(1);
}
const control = getArg('--control');
const limit = Number(getArg('--limit') ?? '10');
if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
  console.error('--limit は 1〜200 の整数で指定してください');
  process.exit(1);
}
const maxPages = Number(getArg('--max-pages') ?? '5');
const timeBoxMin = Number(getArg('--time-box-min') ?? '40');
const REQUEST_TIMEOUT_MS = 120_000;

admin.initializeApp({ projectId, storageBucket: process.env.STORAGE_BUCKET });
const db = admin.firestore();

// Cloud Runのタグ付きURLでも、IDトークンの宛先は正規のサービスURL(補正ありのURL)にする
const authHeaders = async (): Promise<Record<string, string>> => {
  const { GoogleAuth } = await import('google-auth-library');
  const audience = (onUrl as string).replace(/\/+$/, '');
  const client = await new GoogleAuth().getIdTokenClient(audience);
  return (await client.getRequestHeaders()) as unknown as Record<string, string>;
};

async function ocrPdfPages(pages: Buffer[], serviceUrl: string): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const r = await ocrWithPaddle(pages[i], 'application/pdf', i + 1, {
      config: { serviceUrl, requestTimeoutMs: REQUEST_TIMEOUT_MS },
      getAuthHeaders: authHeaders,
    });
    parts.push(`--- Page ${i + 1} ---\n${r.text}`);
  }
  return parts.join('\n\n');
}

async function splitPages(pdfBytes: Buffer, rotate = 0): Promise<Buffer[]> {
  const src = await PDFDocument.load(pdfBytes);
  const out: Buffer[] = [];
  for (let i = 0; i < src.getPageCount(); i++) {
    const doc = await PDFDocument.create();
    const [p] = await doc.copyPages(src, [i]);
    if (rotate) p.setRotation(degrees((p.getRotation().angle + rotate) % 360));
    doc.addPage(p);
    out.push(Buffer.from(await doc.save()));
  }
  return out;
}

async function judge(text: string, documents: DocumentMaster[]): Promise<boolean> {
  return isDetermined(extractDocumentTypeEnhanced(text, documents).documentType);
}

async function comparePages(pages: Buffer[], documents: DocumentMaster[]): Promise<PairRow> {
  const off1Text = await ocrPdfPages(pages, offUrl as string);
  const off2Text = await ocrPdfPages(pages, offUrl as string);
  const onText = await ocrPdfPages(pages, onUrl as string);
  return {
    off1: await judge(off1Text, documents),
    off2: await judge(off2Text, documents),
    on: await judge(onText, documents),
    offJpRatio: japaneseRatio(off1Text),
    onJpRatio: japaneseRatio(onText),
  };
}

function report(label: string, rows: PairRow[], skipped: number, failed: number): void {
  const s = summarizePairs(rows);
  console.log(`\n[${label}] 比較できた: ${s.total}件 / 対象外(PDF以外・ページ過多): ${skipped}件 / 失敗: ${failed}件`);
  console.log(`  両方判定: ${s.both} / 補正ありのみ判定: ${s.onOnly} / 補正なしのみ判定: ${s.offOnly} / どちらも未判定: ${s.neither}`);
  console.log(`  補正なし2回の食い違い(ゆらぎ): ${s.noiseDisagree}件`);
  console.log(`  日本語文字の割合の帯 補正なし: ${JSON.stringify(s.offJpBands)} 補正あり: ${JSON.stringify(s.onJpBands)}`);
}

async function main(): Promise<void> {
  // 書類種別のマスターのみ読む。loadMasterDataは不正なマスターのIDを公開ログに出すため使わない(本スクリプトは件数のみ出力)
  const docMasterSnap = await db.collection(MASTER_PATHS.documents).get();
  const masters = {
    documents: sanitizeDocumentMasters(
      docMasterSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as DocumentMaster)
    ).items,
  };
  const deadline = Date.now() + timeBoxMin * 60_000;

  if (control) {
    // 対照: PDFを既知の角度で回して読み比べる(書類は読まない)。補正ありが全角度で判定でき、
    // 補正なしは回転ありで外れ、回転なしでは両者が一致する、が期待。
    const dir = path.join(__dirname, 'fixtures', 'paddle-ocr-golden');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pdf') && !f.includes('multipage'));
    const rotations = (getArg('--rotations') ?? '0,90,180,270').split(',').map(Number);
    for (const rot of rotations) {
      if (![0, 90, 180, 270].includes(rot)) {
        console.error('--rotations は 0,90,180,270 から選んでください');
        process.exit(1);
      }
      const rows: PairRow[] = [];
      let failed = 0;
      for (const f of files) {
        try {
          rows.push(await comparePages(await splitPages(fs.readFileSync(path.join(dir, f)), rot), masters.documents));
        } catch {
          failed++;
        }
      }
      report(`対照 回転${rot}°`, rows, 0, failed);
    }
    return;
  }

  const sinceMs = parseSinceArg(getArg('--since'));
  const group = getArg('--group');
  if (sinceMs === null || (group !== 'undetermined' && group !== 'determined' && group !== 'reprocessed')) {
    console.error('--since YYYY-MM-DD と --group undetermined|determined|reprocessed を指定してください');
    process.exit(1);
  }
  const cutoffMs = parseJstDateTime(getArg('--cutoff'));
  if (group === 'reprocessed' && cutoffMs === null) {
    console.error('--group reprocessed には --cutoff YYYY-MM-DDTHH:mm(JST)が必要です');
    process.exit(1);
  }
  const query =
    group === 'undetermined'
      ? db.collection('documents').where('documentType', '==', '未判定')
      : db.collection('documents').where('status', '==', 'processed');
  const snap = await query
    .select('status', 'processedAt', 'verified', 'documentType', 'fileUrl', 'mimeType', 'totalPages', 'ocrExtraction.extractedAt')
    .limit(20000)
    .get();
  const toMs = (v: unknown): number | null => (v && typeof (v as admin.firestore.Timestamp).toMillis === 'function' ? (v as admin.firestore.Timestamp).toMillis() : null);
  const targets = snap.docs
    .filter((d) => {
      const x = d.data();
      const ms = toMs(x.processedAt);
      if (bucketStatus(x.status) !== 'processed' || x.verified === true || ms === null || ms < sinceMs) return false;
      if (group === 'reprocessed') {
        // 取り込みは補正反映前、OCRの読み直しは反映後
        const extractedMs = toMs(x.ocrExtraction?.extractedAt);
        return extractedMs !== null && ms < (cutoffMs as number) && extractedMs >= (cutoffMs as number);
      }
      return group === 'undetermined' ? bucketDocumentType(x.documentType) === 'undetermined' : bucketDocumentType(x.documentType) !== 'undetermined';
    })
    .slice(0, limit);
  console.log(`対象の書類: ${targets.length}件(上限${limit})`);

  const bucket = admin.storage().bucket();
  const rows: PairRow[] = [];
  let skipped = 0;
  let failed = 0;
  for (const d of targets) {
    if (Date.now() > deadline) {
      console.log('時間枠に達したため中断します');
      break;
    }
    const x = d.data();
    const fileUrl = x.fileUrl as string;
    if (x.mimeType !== 'application/pdf' || typeof fileUrl !== 'string' || (x.totalPages ?? 0) > maxPages) {
      skipped++;
      continue;
    }
    try {
      const [buf] = await bucket.file(fileUrl.replace(`gs://${bucket.name}/`, '')).download();
      rows.push(await comparePages(await splitPages(buf), masters.documents));
    } catch {
      failed++;
    }
  }
  report(`書類 ${group}`, rows, skipped, failed);
}

main().catch(() => {
  console.error('ERROR: 実行に失敗しました(詳細は個人情報を含み得るため出力しません)');
  process.exit(1);
});
