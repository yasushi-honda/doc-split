#!/usr/bin/env ts-node
/**
 * ADR-0025 PR4c Stage 3: 負荷試験(load)用フィクスチャ。
 *
 * `scripts/fixtures/paddle-ocr-golden/`(Stage1/2、精度スクリーニング用)とは目的が異なる:
 * golden はテキスト完全一致を検証するため単一ページPDFに分割済みで保存するが、load は
 * 処理時間のみを計測するため「結合PDF1本(1/20/71/160ページ)」のまま保存し、
 * `scripts/paddle-ocr-verify.ts`が実行時に`extractAllPdfPages`(本番の
 * `functions/src/ocr/ocrProcessor.ts`の`extractPdfPage`と同ロジック)で分割してから
 * 1ページずつ逐次送信する。これにより252個の単一ページPDFをgitに置かずに済み、
 * かつ本番と同じ「1文書ロード→実行時ページ分割」という経路を再現する。
 *
 * golden fixture(1ページあたり3行)は`REPORT_NOTES`で「楽観側の下限」と自認されている
 * ため、load fixtureは1ページあたりタイトル1行+本文12行程度(利用者名・事業所名・日付・
 * サービス明細・ページ番号を巡回)で実運用寄りの密度にする。全て合成データのみ使用
 * (実クライアント文書は不使用、本リポジトリはpublicのためADR-0025の既存方針を踏襲)。
 *
 * PDF fixture 再生成(ローカル専用、macOS開発機のみ。日本語フォントが必要なためGHAでは
 * 実行しない。Linux用フォント候補は意図的に追加しない: `applyDeterminism()`は日付・ID等の
 * メタデータ固定のみでフォント差によるバイト列変化・OCR難易度変化までは吸収できず、GHA側に
 * apt導入ステップも無いため、追加した経路が一度もCIで実行されない死んだコードになるため):
 *   npx ts-node scripts/fixtures/paddleOcrLoadFixtures.ts --generate-pdfs
 *   → scripts/fixtures/paddle-ocr-load/*.pdf を再生成(git commit対象)。
 *
 * 再生成後は必ず`EXPECTED_LOAD_FIXTURE_SHA256`(scripts/lib/paddleOcrLoad.ts)を
 * 実ファイルの新しいSHA-256で更新すること。golden側の`manifest.json`のような自動突合は
 * load側には無い(用途が処理時間計測のみでテキスト完全一致検証を行わないため)ので、
 * この定数がfixture世代混在を検知する唯一の砦になる。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PDFDocument as PDFDocumentType } from 'pdf-lib';
import { LOAD_TIERS, type LoadTier } from '../lib/paddleOcrLoad';

const FIXTURE_DIR = path.join(__dirname, 'paddle-ocr-load');

/** macOS開発機専用固定(理由は本ファイル冒頭コメント参照)。golden/seed-dev-dataと同一候補。 */
const FONT_CANDIDATES = ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf'];

// LOAD_TIERS/LoadTierの単一情報源は scripts/lib/paddleOcrLoad.ts
// (code-reviewer指摘、2026-09-18: 以前は本ファイルで独立再宣言しており、将来tier表を
// 変更した際に構造的型付けにより検知されずサイレントに乖離しうる状態だった)。
export { LOAD_TIERS, type LoadTier };

export function loadFixturePath(tier: LoadTier): string {
  return path.join(FIXTURE_DIR, `load_${tier}p.pdf`);
}

interface LoadPageSpec {
  title: string;
  lines: string[];
}

/** 巡回させる合成データ(架空、実クライアント文書とは無関係)。golden同様の命名規則を踏襲。 */
const SYNTHETIC_CUSTOMERS = ['田中花子', '渡辺健一', '斎藤光', '山田太郎', '額田花子', '櫻井正夫'];
const SYNTHETIC_OFFICES = ['あおぞらデイサービスセンター', 'ひまわり訪問介護ステーション', '訪問介護センター中央'];
const SERVICE_ITEMS = [
  '訪問介護(身体介護)',
  '訪問介護(生活援助)',
  '通所介護(デイサービス)',
  '短期入所生活介護',
  '福祉用具貸与',
  '居宅療養管理指導',
  '訪問看護',
];

/**
 * ページ数可変の合成PDFページ内容を生成する。1ページあたりタイトル1行+本文12行程度
 * (利用者名・事業所名・日付・サービス明細7行・ページ番号)で、goldenより実運用寄りの
 * 文字密度にする。テキスト内容の正確性は検証しない(処理時間計測専用のため)。
 */
export function buildLoadPageSpecs(tier: LoadTier): LoadPageSpec[] {
  return Array.from({ length: tier }, (_, i) => {
    const customer = SYNTHETIC_CUSTOMERS[i % SYNTHETIC_CUSTOMERS.length];
    const office = SYNTHETIC_OFFICES[i % SYNTHETIC_OFFICES.length];
    const day = (i % 28) + 1;
    const lines = [
      `利用者: ${customer} 様`,
      `事業所: ${office}`,
      `作成日: 2026年${((i % 12) + 1).toString().padStart(2, '0')}月${day.toString().padStart(2, '0')}日`,
      '',
      'サービス提供明細:',
      ...Array.from({ length: 7 }, (_, li) => {
        const item = SERVICE_ITEMS[(i + li) % SERVICE_ITEMS.length];
        return `  ${li + 1}. ${item} — 実施時間 ${30 + ((i + li) % 6) * 15}分`;
      }),
      `ページ ${i + 1} / ${tier}`,
    ];
    return { title: 'ADR-0025 Stage3負荷試験用合成書類(架空データ)', lines };
  });
}

/** 2026-01-01T00:00:00Zを固定化(paddleOcrGoldenFixtures.tsと同じ決定論化パターン)。 */
const FIXED_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
const FIXED_ID_HEX = '00112233445566778899AABBCCDDEEFF';

async function generateFixtures(): Promise<void> {
  const { PDFArray, PDFDocument, PDFHexString, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;

  function applyDeterminism(pdf: PDFDocumentType): void {
    pdf.setCreationDate(FIXED_DATE);
    pdf.setModificationDate(FIXED_DATE);
    pdf.setProducer('docsplit-paddle-ocr-load-fixtures');
    pdf.setCreator('docsplit-paddle-ocr-load-fixtures');
    const idArray = PDFArray.withContext(pdf.context);
    idArray.push(PDFHexString.of(FIXED_ID_HEX));
    idArray.push(PDFHexString.of(FIXED_ID_HEX));
    pdf.context.trailerInfo.ID = idArray;
  }

  const fontPath = FONT_CANDIDATES.find((p) => fs.existsSync(p));
  if (!fontPath) {
    throw new Error(
      `日本語対応フォントが見つかりません。候補: ${FONT_CANDIDATES.join(', ')}\n` +
        'CJK グリフを含む TTF のパスを FONT_CANDIDATES に追加してください(macOS開発機専用)。'
    );
  }
  const fontBytes = fs.readFileSync(fontPath);

  console.log(`📄 PaddleOCR load fixture(Stage3) 生成 → ${FIXTURE_DIR}`);
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  for (const tier of LOAD_TIERS) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true });
    const specs = buildLoadPageSpecs(tier);

    specs.forEach((spec, i) => {
      const page = pdf.addPage([595.28, 841.89]); // A4
      const { height } = page.getSize();
      page.drawText(spec.title, { x: 50, y: height - 70, size: 14, font, color: rgb(0.1, 0.1, 0.1) });
      spec.lines.forEach((line, li) => {
        page.drawText(line, { x: 50, y: height - 110 - li * 22, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
      });
      page.drawText(`${i + 1} / ${specs.length}`, { x: 270, y: 30, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
    });

    applyDeterminism(pdf);
    const bytes = await pdf.save();
    const fname = `load_${tier}p.pdf`;
    fs.writeFileSync(path.join(FIXTURE_DIR, fname), bytes);
    const sha256 = (await import('crypto')).createHash('sha256').update(bytes).digest('hex');
    console.log(`  ✅ ${fname} (${tier}p, ${(bytes.length / 1024).toFixed(0)}KB, sha256=${sha256})`);
  }
  console.log(
    '✅ 生成完了。git add scripts/fixtures/paddle-ocr-load/*.pdf でコミットし、' +
      'scripts/lib/paddleOcrLoad.ts の EXPECTED_LOAD_FIXTURE_SHA256 を上記sha256値で更新してください。'
  );
}

if (require.main === module) {
  if (process.argv.includes('--generate-pdfs')) {
    generateFixtures().catch((err) => {
      console.error(`ERROR: ${(err as Error).stack ?? err}`);
      process.exit(1);
    });
  } else {
    console.error('使用方法: npx ts-node scripts/fixtures/paddleOcrLoadFixtures.ts --generate-pdfs');
    process.exit(1);
  }
}
