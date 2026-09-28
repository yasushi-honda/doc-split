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
 * PR #1081 codex review(P1) + pr-review-toolkit code-reviewer指摘の反映:
 *   1. (Critical/P1) 当初案はGHA実行時(`run-ops-script.yml`、runs-on: ubuntu-latest)に
 *      macOS専用フォントパスしか候補になく`--execute`が確実に失敗する設計ミスがあった。
 *      seed-dev-data.tsの二段階設計(`--generate-pdfs`はローカル専用でfixtureを生成・コミット、
 *      投入モードはコミット済みPDFを読むだけでpdf-lib/fontkit非依存)を完全に踏襲し解消した。
 *   2. (Important) 当初案は親docへ`ocrResult`を直接書き込んでおり、ADR-0018 Phase Eの
 *      dual-write契約(`documents/{id}/detail/main`への同時書込みMUST、親には値を持たせない)
 *      に違反していた。`buildPendingDoc()`投入ループ(scripts/seed-dev-data.ts:656-668)と同型の
 *      `{ ocrResult, ...parentData }`分離+同一batch内dual-writeへ修正した。
 *   3. (P2) 上記2の修正により、`--force`再投入時も`detail/main`が同一batchで再初期化される
 *      ため、古いOCRテキストが残存する問題も解消される。
 *
 * 安全策:
 *   - ALLOWED_PROJECT_ID='doc-split-dev'固定(誤って他環境へ投入するのを防ぐ、seed-dev-data.ts
 *     と同型のガード)
 *   - 書込対象は`sarashina-canary-D{n}`固定IDのみ(既存データには触れない)
 *   - 既定はdry-run、--executeで実書込み
 *   - 冪等性: 既存docがあれば--forceなしではスキップ(誤って再アップロードしOCR再課金するのを防ぐ)
 *
 * PDF fixture 再生成(ローカル専用。日本語フォントが必要なためGHAでは実行しない):
 *   npx ts-node scripts/upload-sarashina-canary-fixtures.ts --generate-pdfs
 *   → scripts/fixtures/sarashina-summary-golden/canary-pdfs/*.pdf を再生成(git commit対象)。
 *      投入モードはコミット済みfixtureを読むだけなのでフォント・pdf-lib不要。
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

const ALLOWED_PROJECT_ID = 'doc-split-dev';
const FIXTURE_DOCS_DIR = path.join(__dirname, 'fixtures', 'sarashina-summary-golden', 'docs');
const CANARY_PDF_DIR = path.join(__dirname, 'fixtures', 'sarashina-summary-golden', 'canary-pdfs');
const DOC_IDS = Array.from({ length: 10 }, (_, i) => `D${i + 1}`);

const dryRun = process.argv.includes('--dry-run');
const execute = process.argv.includes('--execute');
const force = process.argv.includes('--force');
const generatePdfs = process.argv.includes('--generate-pdfs');

if (!generatePdfs && !dryRun && !execute) {
  console.error('--generate-pdfs / --dry-run / --execute のいずれかを指定してください');
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

function canaryPdfPath(docId: string): string {
  return path.join(CANARY_PDF_DIR, `sarashina-canary-${docId}.pdf`);
}

// ============================================
// PDF fixture 生成 (--generate-pdfs、ローカル専用)
// ============================================

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
];

/**
 * fixtureテキストからA4 PDFを生成する。1行あたり最大40文字で折り返す(日本語フォントの
 * 実測幅に対し安全側、seed-dev-data.tsのbuildPdf()と同じ簡易折返し方針)。
 * pdf-lib/fontkitは生成時のみ必要なためdynamic importにする(投入経路をPDF生成依存の
 * 解決可否から切り離す、seed-dev-data.tsと同じ設計意図)。
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

async function generateFixturePdfs(): Promise<void> {
  console.log(`📄 PDF fixture 生成 → ${CANARY_PDF_DIR}`);
  fs.mkdirSync(CANARY_PDF_DIR, { recursive: true });

  for (const docId of DOC_IDS) {
    const fixturePath = path.join(FIXTURE_DOCS_DIR, `${docId}.txt`);
    const text = fs.readFileSync(fixturePath, 'utf8');
    const pages = splitIntoPages(text);
    const bytes = await buildPdfFromText(pages);
    fs.writeFileSync(canaryPdfPath(docId), bytes);
    console.log(`  ✅ sarashina-canary-${docId}.pdf (${pages.length}p, ${(bytes.length / 1024).toFixed(0)}KB)`);
  }
  console.log('✅ 生成完了。git add scripts/fixtures/sarashina-summary-golden/canary-pdfs/ でコミットしてください。');
}

function readFixturePdf(docId: string): Buffer {
  const p = canaryPdfPath(docId);
  if (!fs.existsSync(p)) {
    throw new Error(
      `PDF fixtureが見つかりません: ${p}\n` +
        'ローカルで `npx ts-node scripts/upload-sarashina-canary-fixtures.ts --generate-pdfs` を実行してコミットしてください。'
    );
  }
  return fs.readFileSync(p);
}

// ============================================
// 投入 (--dry-run / --execute)
// ============================================

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

async function seed(): Promise<void> {
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

  const storageBucket = resolveStorageBucket();
  console.log(`環境: dev (project: ${projectId}, bucket: ${storageBucket})`);
  console.log(`対象: ${DOC_IDS.map((id) => `sarashina-canary-${id}`).join(', ')}`);

  if (dryRun) {
    for (const docId of DOC_IDS) {
      const bytes = readFixturePdf(docId);
      console.log(`  sarashina-canary-${docId}: ${(bytes.length / 1024).toFixed(0)}KB (fixture PDF確認済み)`);
    }
    console.log('\n✅ DRY RUN 完了(書込みなし)。実行するには --execute を指定してください。');
    return;
  }

  const admin = await import('firebase-admin');
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

    const pdfBytes = readFixturePdf(docId);
    const storagePath = `original/${canaryId}.pdf`;
    await bucket.file(storagePath).save(pdfBytes, { contentType: 'application/pdf' });
    console.log(`  📄 ${storagePath} (${(pdfBytes.length / 1024).toFixed(0)}KB)`);

    // buildPendingDoc()+投入ループ(scripts/seed-dev-data.ts:656-668)と同型: uploadPdf.tsの
    // payload形状を踏襲しつつ、ADR-0018 Phase EのMUST(ocrResultは親docへ直接書かず
    // detail/mainへ同一batch内でdual-write)に準拠する(codex review/code-reviewer指摘反映)。
    const parentData = {
      id: canaryId,
      processedAt: admin.firestore.Timestamp.now(),
      fileId: canaryId,
      fileName: `sarashina-canary-${docId}.pdf`,
      mimeType: 'application/pdf',
      documentType: '',
      customerName: '',
      officeName: '',
      fileUrl: `gs://${storageBucket}/${storagePath}`,
      fileDate: null,
      isDuplicateCustomer: false,
      totalPages: 0,
      targetPageNumber: 1,
      status: 'pending' as const,
      sourceType: 'upload' as const,
    };
    const batch = db.batch();
    batch.set(docRef, parentData);
    batch.set(docRef.collection('detail').doc('main'), { ocrResult: '' });
    await batch.commit();
    console.log(`  ✅ ${canaryId}: status=pending で投入完了(親+detail/main dual-write)`);
  }

  console.log('\n✅ 投入完了。processOCR(1分間隔)が自動的にOCR処理する。');
  console.log('数分後、documents/{sarashina-canary-D*}/detail/main の ocrResult を確認すること。');
}

async function main(): Promise<void> {
  if (generatePdfs) {
    await generateFixturePdfs();
    return;
  }
  await seed();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  });
