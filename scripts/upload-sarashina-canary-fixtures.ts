#!/usr/bin/env ts-node
/**
 * ADR-0027 PR5 S4: sarashina-summary-golden fixture(D1〜D10)をdevへ実文書として投入する
 *
 * S0実機ゲート検証(scripts/lib/sarashinaSummaryVerify.ts)は`scripts/fixtures/sarashina-summary-golden/
 * docs/*.txt`をテキストとして直接Sarashinaへ送るが、documentsコレクションには一切書き込まない。
 * S4(canary文書選定)はプラン上「既存のdev処理済み文書から選ぶ」設計だったが、dev実機調査
 * (2026-09-28)の結果、既存のprocessed文書は全て意味のないseed/テスト用ダミーテキスト
 * (ローマ字プレースホルダー・汎用プレースホルダー文言等)であり、canaryとして使える実質的な
 * 内容を持つ文書が1件も存在しないことが判明した。
 *
 * decision-maker承認(2026-09-28): 既にSarashina実機で内容検証済みのD1〜D10 fixtureを、
 * `scripts/seed-dev-data.ts`のPDF生成+実Storageアップロード+status:'pending'投入パターン
 * (E用pending書類、`processOCR`〔Cloud Scheduler、1分間隔〕が実OCRパイプラインで処理する)
 * を踏襲してdevへ新規アップロードし、実文書化してからcanary候補として選定する。
 *
 * seed-dev-data.tsを直接改修しない理由: 同スクリプトは冪等な全体シード(マスター+処理済み+
 * pending)の単一責務を持つ安定資産であり、本スクリプトはADR-0027 PR5固有の一時的な投入作業
 * (S4完了後は再実行しない想定)のため、責務混在を避け別ファイルとして新設する。
 *
 * 安全策:
 *   - ALLOWED_PROJECT_ID='doc-split-dev'固定(誤って他環境へ投入するのを防ぐ、seed-dev-data.ts
 *     と同型のガード)
 *   - 書込対象は`sarashina-canary-D{n}`固定IDのみ(既存データには触れない)
 *   - 既定はdry-run、--executeで実書込み
 *   - 冪等性: 既存docがあれば--forceなしではスキップ(誤って再アップロードしOCR再課金するのを防ぐ)
 *
 * 使用方法(推奨: GitHub Actions経由、ADC不要):
 *   Actions → "Run Operations Script" → environment: dev / script:
 *   upload-sarashina-canary-fixtures を選択して実行
 *
 * ローカル実行(ADC認証が必要な場合のフォールバック):
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/upload-sarashina-canary-fixtures.ts --dry-run
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/upload-sarashina-canary-fixtures.ts --execute
 */

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';

const ALLOWED_PROJECT_ID = 'doc-split-dev';
const FIXTURE_DOCS_DIR = path.join(__dirname, 'fixtures', 'sarashina-summary-golden', 'docs');
const DOC_IDS = Array.from({ length: 10 }, (_, i) => `D${i + 1}`);

const dryRun = process.argv.includes('--dry-run');
const execute = process.argv.includes('--execute');
const force = process.argv.includes('--force');

if (!dryRun && !execute) {
  console.error('--dry-run または --execute のいずれかを指定してください');
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}
if (projectId !== ALLOWED_PROJECT_ID) {
  console.error(
    `ERROR: FIREBASE_PROJECT_ID="${projectId}" はdev専用スクリプトの対象外です(許可: ${ALLOWED_PROJECT_ID})。`
  );
  console.error('S4のfixture投入はdevのみを対象とする(本番環境への誤投入防止)。');
  process.exit(1);
}

/**
 * fixtureテキスト(`--- Page N ---`区切り)をPDFページ構造へ変換する。
 * D1〜D10.txtは全てこの区切り記法で書かれている(scripts/fixtures/sarashina-summary-golden/
 * docs/README.md参照)。
 */
function splitIntoPages(text: string): string[] {
  const pages = text.split(/^--- Page \d+ ---$/m).map((p) => p.trim());
  return pages.filter((p) => p.length > 0);
}

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
];

/**
 * fixtureテキストからA4 PDFを生成する。1行あたり最大40文字で折り返す(日本語フォントの
 * 実測幅に対し安全側、seed-dev-data.tsのbuildPdf()と同じ簡易折返し方針)。
 */
async function buildPdfFromText(pages: string[]): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;

  const fontPath = FONT_CANDIDATES.find((p) => fs.existsSync(p));
  if (!fontPath) {
    throw new Error(
      `日本語対応フォントが見つかりません。候補: ${FONT_CANDIDATES.join(', ')}\n` +
        'CJKグリフを含むTTFのパスをFONT_CANDIDATESに追加してください。'
    );
  }
  const fontBytes = fs.readFileSync(fontPath);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });

  const MAX_CHARS_PER_LINE = 40;
  const LINE_HEIGHT = 20;
  const MAX_LINES_PER_PAGE = 36;

  function wrapLine(line: string): string[] {
    if (line.length === 0) return [''];
    const out: string[] = [];
    for (let i = 0; i < line.length; i += MAX_CHARS_PER_LINE) {
      out.push(line.slice(i, i + MAX_CHARS_PER_LINE));
    }
    return out;
  }

  for (const pageText of pages) {
    const rawLines = pageText.split('\n');
    const wrapped = rawLines.flatMap(wrapLine);
    for (let i = 0; i < wrapped.length; i += MAX_LINES_PER_PAGE) {
      const chunk = wrapped.slice(i, i + MAX_LINES_PER_PAGE);
      const page = doc.addPage([595.28, 841.89]); // A4
      const { height } = page.getSize();
      chunk.forEach((line, li) => {
        page.drawText(line, {
          x: 50,
          y: height - 60 - li * LINE_HEIGHT,
          size: 11,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
      });
    }
  }

  return doc.save();
}

function resolveStorageBucket(): string {
  const fromEnv = process.env.STORAGE_BUCKET;
  if (fromEnv) return fromEnv;
  const envPath = path.join(__dirname, 'clients', 'dev.env');
  const content = fs.readFileSync(envPath, 'utf8');
  const m = content.match(/^STORAGE_BUCKET=["']?([^"'\r\n]+)["']?/m);
  if (!m) {
    throw new Error(`STORAGE_BUCKET を ${envPath} から解決できません`);
  }
  return m[1];
}

async function main(): Promise<void> {
  const storageBucket = resolveStorageBucket();
  console.log(`環境: dev (project: ${projectId}, bucket: ${storageBucket})`);
  console.log(`対象: ${DOC_IDS.map((id) => `sarashina-canary-${id}`).join(', ')}`);

  if (dryRun) {
    for (const docId of DOC_IDS) {
      const fixturePath = path.join(FIXTURE_DOCS_DIR, `${docId}.txt`);
      const text = fs.readFileSync(fixturePath, 'utf8');
      const pages = splitIntoPages(text);
      console.log(`  ${docId}: ${text.length}文字, ${pages.length}ページ`);
    }
    console.log('\n✅ DRY RUN 完了(書込みなし)。実行するには --execute を指定してください。');
    return;
  }

  admin.initializeApp({ projectId, storageBucket });
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  for (const docId of DOC_IDS) {
    const canaryId = `sarashina-canary-${docId}`;
    const docRef = db.collection('documents').doc(canaryId);
    const existing = await docRef.get();
    if (existing.exists && !force) {
      console.log(`  ⏭  ${canaryId}: 既存のため skip(--force で再投入)`);
      continue;
    }

    const fixturePath = path.join(FIXTURE_DOCS_DIR, `${docId}.txt`);
    const text = fs.readFileSync(fixturePath, 'utf8');
    const pages = splitIntoPages(text);

    const pdfBytes = await buildPdfFromText(pages);
    const storagePath = `original/${canaryId}.pdf`;
    await bucket.file(storagePath).save(Buffer.from(pdfBytes), { contentType: 'application/pdf' });
    console.log(`  📄 ${storagePath} (${(pdfBytes.length / 1024).toFixed(0)}KB)`);

    // buildPendingDoc()(scripts/seed-dev-data.ts)と同型: uploadPdf.tsのpayload形状を踏襲し、
    // processOCR(Cloud Scheduler、1分間隔)が実OCRパイプラインで処理する。
    await docRef.set({
      id: canaryId,
      processedAt: admin.firestore.Timestamp.now(),
      fileId: canaryId,
      fileName: `sarashina-canary-${docId}.pdf`,
      mimeType: 'application/pdf',
      ocrResult: '',
      documentType: '',
      customerName: '',
      officeName: '',
      fileUrl: `gs://${storageBucket}/${storagePath}`,
      fileDate: null,
      isDuplicateCustomer: false,
      totalPages: 0,
      targetPageNumber: 1,
      status: 'pending',
      sourceType: 'upload',
    });
    console.log(`  ✅ ${canaryId}: status=pending で投入完了`);
  }

  console.log('\n✅ 投入完了。processOCR(1分間隔)が自動的にOCR処理する。');
  console.log('数分後、documents/{sarashina-canary-D*}/detail/main の ocrResult を確認すること。');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  });
