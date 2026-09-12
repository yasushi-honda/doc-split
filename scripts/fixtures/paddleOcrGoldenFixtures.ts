#!/usr/bin/env ts-node
/**
 * ADR-0025 PR4前提: PaddleOCR抽出/仲裁ロジック回帰テスト用フィクスチャ(Layer A)。
 *
 * PoCで使ったpaddleocr_all_results.json・24文書はいずれもリポジトリ外の一時ファイルで
 * 消失している。5モデル比較の意思決定自体はADR-0025でAccepted済みのため再現不要と判断し、
 * PaddleOCR単体の抽出/仲裁ロジック回帰テストにスコープを絞った(詳細:
 * ~/.claude/plans/fuzzy-moseying-book.md v5)。
 *
 * 本ファイルはscripts/fixtures/arbitrationCompareFixtures.tsと同じパターンで、
 * pdf-lib + 日本語フォントによる決定論的PDFを生成する(Layer A、5文書)。生成したPDFに
 * 対してPaddleOCRを実際に1回実行した結果を scripts/generate-paddle-ocr-golden-text.py が
 * scripts/fixtures/paddle-ocr-golden/*.expected.txt / *.pages.json として記録し、
 * functions/test/paddleOcrArbitrationRegression.test.ts がその記録済みテキストを
 * 抽出/仲裁ロジックに通して回帰を検知する(CI側はPython/PaddleOCRに依存しない)。
 *
 * Layer B(人工的なOCR誤読テキストによるPass2無効時ベースライン抽出安全性テスト、
 * PaddleOCR実行不要)は本ファイルの対象外。functions/test/paddleOcrArbitrationRegression.test.ts
 * 内にインライン文字列として直接定義する。
 *
 * PDF fixture 再生成 (ローカル専用。日本語フォントが必要なため GHA では実行しない):
 *   npx ts-node scripts/fixtures/paddleOcrGoldenFixtures.ts --generate-pdfs
 *   → scripts/fixtures/paddle-ocr-golden/*.pdf を再生成 (git commit 対象)。
 *
 * 複数ページのfixture(golden-multipage-01)は、本番のPDF分割経路
 * (functions/src/ocr/ocrProcessor.ts の非exportな extractPdfPage と同ロジック、
 * scripts/lib/geminiOcrCompare.ts の extractAllPdfPages を再利用)で1ページずつの
 * 独立したPDFへ分割してから保存する。本番実装との重複は既知の限界として受け入れる
 * (geminiOcrCompare.ts冒頭コメント参照。本タスクでは本番コードの共有モジュール化は
 * スコープ外、~/.claude/plans/fuzzy-moseying-book.md v5参照)。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CustomerMaster, OfficeMaster, DocumentMaster } from '../../shared/types';

const FIXTURE_DIR = path.join(__dirname, 'paddle-ocr-golden');

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
];

/**
 * Layer A / Layer B共用のgolden fixture専用マスターデータ。本番マスターとは完全に独立
 * (実顧客データ不使用)。旧字体異体字・簡体字置換リスク文字・重複事業所名を意図的に含む。
 */
export const GOLDEN_DOCUMENT_MASTERS: DocumentMaster[] = [
  { id: 'gdoc1', name: 'ケアプラン', dateMarker: '作成日', keywords: ['計画', 'ケアプラン'] },
  { id: 'gdoc2', name: '請求書', dateMarker: '発行日', keywords: ['請求', '金額'] },
];

export const GOLDEN_CUSTOMER_MASTERS: CustomerMaster[] = [
  { id: 'gcust1', name: '田中花子', furigana: 'たなかはなこ' },
  { id: 'gcust2', name: '渡辺健一', aliases: ['渡邊健一', '渡邉健一'] },
  { id: 'gcust3', name: '斎藤光', aliases: ['齋藤光', '齊藤光'] },
  { id: 'gcust4', name: '山田太郎' },
  // Layer B risk-simplified-01用: ADR-0025記載の実際の誤読「金額」→「金额」を
  // 顧客名フィールドの文脈で再現するため、額の字を含む顧客名を用意する。
  { id: 'gcust5', name: '額田花子' },
  // Layer B risk-simplified-02用: ADR-0025記載の実際の誤読「櫻井」→「樱井」をそのまま再現。
  { id: 'gcust6', name: '櫻井正夫' },
];

export const GOLDEN_OFFICE_MASTERS: OfficeMaster[] = [
  { id: 'goff1', name: 'あおぞらデイサービスセンター', shortName: 'あおぞら' },
  { id: 'goff2', name: 'ひまわり訪問介護ステーション', shortName: 'ひまわり' },
  // Layer B risk-confusable-office-01用: 同名の重複事業所(bug-masters.tsと同型のパターン)。
  { id: 'goff3', name: '訪問介護センター中央', isDuplicate: true },
  { id: 'goff4', name: '訪問介護センター中央', isDuplicate: true },
];

/** フィールドごとの期待値。requiredはLayer A(通常ケース、退行は即fail)、allowedはLayer B(risk系)用 */
export type FieldExpectation<T> =
  | { kind: 'required'; value: T }
  | { kind: 'allowed'; values: Array<T | null>; forbidden: T[] };

export function required<T>(value: T): FieldExpectation<T> {
  return { kind: 'required', value };
}

export interface GoldenFixtureDoc {
  id: string;
  /** 生成されるPDFファイル名の接頭辞(拡張子・ページ番号なし) */
  fixtureBase: string;
  /** filenameInfo用のファイル名(実際にPDFとして保存するのは`${fixtureBase}.pdf`または`${fixtureBase}-pN.pdf`) */
  fileName: string;
  title: string;
  /** ページごとの本文行。要素数=ページ数 */
  pages: string[][];
  docType: FieldExpectation<string>;
  customer: FieldExpectation<string>;
  office: FieldExpectation<string>;
  date: FieldExpectation<string>;
}

export const GOLDEN_FIXTURES: GoldenFixtureDoc[] = [
  {
    id: 'golden-plain-01',
    fixtureBase: 'golden_plain_01',
    fileName: 'golden_plain_01_ケアプラン.pdf',
    title: 'ケアプラン',
    pages: [['利用者: 田中花子 様', '事業所: あおぞらデイサービスセンター', '作成日: 2026年8月1日']],
    docType: required('ケアプラン'),
    customer: required('gcust1'),
    office: required('goff1'),
    date: required('2026/08/01'),
  },
  {
    id: 'golden-plain-02',
    fixtureBase: 'golden_plain_02',
    fileName: 'golden_plain_02_請求書.pdf',
    title: '請求書',
    pages: [['利用者: 山田太郎 様', '事業所: ひまわり訪問介護ステーション', '発行日: 2026年8月5日']],
    docType: required('請求書'),
    customer: required('gcust4'),
    office: required('goff2'),
    date: required('2026/08/05'),
  },
  {
    id: 'golden-oldkanji-01',
    fixtureBase: 'golden_oldkanji_01',
    fileName: 'golden_oldkanji_01_ケアプラン.pdf',
    title: 'ケアプラン',
    // 本文はマスター登録名(渡辺健一)ではなく旧字体異体字(渡邊健一)で記載する
    pages: [['利用者: 渡邊健一 様', '事業所: あおぞらデイサービスセンター', '作成日: 2026年8月10日']],
    docType: required('ケアプラン'),
    customer: required('gcust2'),
    office: required('goff1'),
    date: required('2026/08/10'),
  },
  {
    id: 'golden-oldkanji-02',
    fixtureBase: 'golden_oldkanji_02',
    fileName: 'golden_oldkanji_02_請求書.pdf',
    title: '請求書',
    // マスター登録名(斎藤光)ではなく旧字体異体字(齋藤光)で記載する
    pages: [['利用者: 齋藤光 様', '事業所: ひまわり訪問介護ステーション', '発行日: 2026年8月12日']],
    docType: required('請求書'),
    customer: required('gcust3'),
    office: required('goff2'),
    date: required('2026/08/12'),
  },
  {
    id: 'golden-multipage-01',
    fixtureBase: 'golden_multipage_01',
    fileName: 'golden_multipage_01_ケアプラン.pdf',
    title: 'ケアプラン',
    // 2ページ文書。1ページ目に正解の日付、2ページ目にdistractorの日付を配置し、
    // extractDateEnhancedのfirstPageText優先経路(ocrProcessor.ts:434)を検証する。
    pages: [
      ['利用者: 山田太郎 様', '事業所: あおぞらデイサービスセンター', '作成日: 2026年8月20日'],
      ['次回見直し予定: 2026年11月20日'],
    ],
    docType: required('ケアプラン'),
    customer: required('gcust4'),
    office: required('goff1'),
    date: required('2026/08/20'),
  },
];

export function readGoldenFixturePdf(fixtureFileName: string): Buffer {
  const p = path.join(FIXTURE_DIR, fixtureFileName);
  if (!fs.existsSync(p)) {
    throw new Error(
      `PDF fixture が見つかりません: ${p}\n` +
        'ローカルで `npx ts-node scripts/fixtures/paddleOcrGoldenFixtures.ts --generate-pdfs` を実行してコミットしてください。'
    );
  }
  return fs.readFileSync(p);
}

/**
 * pdf-lib / fontkit は fixture 生成時のみ必要なため dynamic import にする
 * (scripts/fixtures/arbitrationCompareFixtures.ts と同じ設計意図)。
 */
async function generateFixtures(): Promise<void> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;

  const fontPath = FONT_CANDIDATES.find((p) => fs.existsSync(p));
  if (!fontPath) {
    throw new Error(
      `日本語対応フォントが見つかりません。候補: ${FONT_CANDIDATES.join(', ')}\n` +
        'CJK グリフを含む TTF のパスを FONT_CANDIDATES に追加してください。'
    );
  }
  const fontBytes = fs.readFileSync(fontPath);

  console.log(`📄 PaddleOCR golden fixture (Layer A) 生成 → ${FIXTURE_DIR}`);
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  for (const doc of GOLDEN_FIXTURES) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true });

    for (const pageLines of doc.pages) {
      const page = pdf.addPage([595.28, 841.89]); // A4
      const { height } = page.getSize();
      page.drawText(doc.title, { x: 50, y: height - 80, size: 20, font, color: rgb(0.1, 0.1, 0.1) });
      pageLines.forEach((line, li) => {
        page.drawText(line, { x: 50, y: height - 130 - li * 26, size: 13, font, color: rgb(0.2, 0.2, 0.2) });
      });
    }

    const combinedBytes = await pdf.save();

    if (doc.pages.length === 1) {
      const fname = `${doc.fixtureBase}.pdf`;
      fs.writeFileSync(path.join(FIXTURE_DIR, fname), combinedBytes);
      console.log(`  ✅ ${fname} (1p, ${(combinedBytes.length / 1024).toFixed(0)}KB)`);
    } else {
      // 本番と同じ1ページ分割ロジック(scripts/lib/geminiOcrCompare.tsのextractAllPdfPages、
      // functions/src/ocr/ocrProcessor.tsのextractPdfPageと同ロジック)で分割してから保存する。
      // 動的importにするのは、この関数(PDF生成時のみ実行)以外からこのファイルの
      // フィクスチャ定義をimportした際に、geminiOcrCompare.ts経由で@google/genai等の
      // 無関係な重い依存を引き込まないようにするため(functions/test/からの利用を想定)。
      const { extractAllPdfPages } = await import('../lib/geminiOcrCompare');
      const pageBuffers = await extractAllPdfPages(Buffer.from(combinedBytes));
      pageBuffers.forEach((buf, i) => {
        const fname = `${doc.fixtureBase}-p${i + 1}.pdf`;
        fs.writeFileSync(path.join(FIXTURE_DIR, fname), buf);
        console.log(`  ✅ ${fname} (分割済み単一ページ ${i + 1}/${pageBuffers.length}, ${(buf.length / 1024).toFixed(0)}KB)`);
      });
    }
  }
  console.log('✅ 生成完了。git add scripts/fixtures/paddle-ocr-golden/*.pdf でコミットしてください。');
}

if (require.main === module) {
  if (process.argv.includes('--generate-pdfs')) {
    generateFixtures().catch((err) => {
      console.error(`ERROR: ${(err as Error).stack ?? err}`);
      process.exit(1);
    });
  } else {
    console.error('使用方法: npx ts-node scripts/fixtures/paddleOcrGoldenFixtures.ts --generate-pdfs');
    process.exit(1);
  }
}
