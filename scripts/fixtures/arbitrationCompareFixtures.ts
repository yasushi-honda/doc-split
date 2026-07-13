#!/usr/bin/env ts-node
/**
 * OCR突合精度向上ミッション（GOAL.md タスクF）専用フィクスチャ。
 *
 * scripts/seed-dev-data.ts の MIXED_FAX_PDFS(複数書類混在FAX、書類種別/顧客/事業所/日付の
 * ground truth持ち)は既に「FAX/複数ページ/複数人名(文書間)」の層化をカバーしているため
 * 読み取り専用で再利用する(seed-dev-data.ts自体は本番dev環境への実データ投入スクリプトの
 * ため無改修とし、新規フィクスチャは本ファイルに独立させて意図しない副作用を避ける)。
 *
 * 本ファイルは、1文書内に複数の人名/日付が言及されるケース(層化抽出の残りの観点:
 * 「複数人名」「複数日付」の文書内共起)を追加する。合成PDFのため「手書き」原稿の再現は
 * 対象外(実スキャン原稿が必要、既知の限界としてGOAL.mdへ記録済み)。
 *
 * PDF fixture 再生成 (ローカル専用。日本語フォントが必要なため GHA では実行しない):
 *   npx ts-node scripts/fixtures/arbitrationCompareFixtures.ts --generate-pdfs
 *   → scripts/fixtures/arbitration/*.pdf を再生成 (git commit 対象)。
 */

import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_DIR = path.join(__dirname, 'arbitration');

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
];

export interface ArbitrationDistractorDoc {
  id: string;
  fixture: string;
  /** 事業所推定のfilenameInfo生成用 (functions/src/ocr/ocrProcessor.ts と同じ経路) */
  fileName: string;
  docType: string;
  customer: string;
  office: string;
  /** YYYY/MM/DD形式 (functions/src/utils/textNormalizer.ts formatDateString() と同じ書式) */
  expectedDate: string;
  /** 正解の利用者/事業所/日付に加えて文書本文へ書き込む、紛らわしい別名・別日付の記載行 */
  distractorLines: string[];
  title: string;
  bodyLines: string[];
}

/**
 * 「複数人名」「複数日付」層化用の新規フィクスチャ2件。
 * 顧客名はscripts/seed-dev-data.tsのCUSTOMERS(masters/customersにマスター登録済みの
 * 名前一覧)から、既存MIXED_FAX_PDFSで未使用の名前を使う(ground truthとdistractorの
 * 両方が実在マスター名であることで、「無関係な文字列」ではなく「別の実在候補との
 * 混同」という本来のarbitration頑健性テストになる)。
 */
export const ARBITRATION_DISTRACTOR_DOCS: ArbitrationDistractorDoc[] = [
  {
    id: 'arb-distractor-multiname-01',
    fixture: 'arb_multiname_01.pdf',
    fileName: 'arb_複数人名_訪問看護報告書.pdf',
    docType: '訪問看護報告書',
    customer: '内田健三',
    office: 'ひまわり訪問介護ステーション',
    expectedDate: '2026/07/05',
    title: '訪問看護報告書',
    bodyLines: ['利用者: 内田健三 様', '事業所: ひまわり訪問介護ステーション', '報告日: 2026年7月5日'],
    distractorLines: ['ご家族(同居): 大野正雄 様', '前回訪問時の記録者: 森さくら'],
  },
  {
    id: 'arb-distractor-multidate-01',
    fixture: 'arb_multidate_01.pdf',
    fileName: 'arb_複数日付_ケアプラン.pdf',
    docType: 'ケアプラン',
    customer: '斎藤光',
    office: 'あおぞらデイサービスセンター',
    expectedDate: '2026/07/18',
    title: 'ケアプラン',
    bodyLines: ['利用者: 斎藤光 様', '事業所: あおぞらデイサービスセンター', '作成日: 2026年7月18日'],
    distractorLines: ['前回作成日: 2026年5月18日', '有効期限: 2026年10月17日'],
  },
];

export function readArbitrationFixture(fixture: string): Buffer {
  const p = path.join(FIXTURE_DIR, fixture);
  if (!fs.existsSync(p)) {
    throw new Error(
      `PDF fixture が見つかりません: ${p}\n` +
        'ローカルで `npx ts-node scripts/fixtures/arbitrationCompareFixtures.ts --generate-pdfs` を実行してコミットしてください。'
    );
  }
  return fs.readFileSync(p);
}

/**
 * pdf-lib / fontkit は fixture 生成時のみ必要なため dynamic import にする
 * (scripts/seed-dev-data.ts generateFixtures() と同じ設計意図)。
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

  console.log(`📄 arbitration compare fixture 生成 → ${FIXTURE_DIR}`);
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  for (const doc of ARBITRATION_DISTRACTOR_DOCS) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true });
    const lines = [...doc.bodyLines, '', ...doc.distractorLines];

    const page = pdf.addPage([595.28, 841.89]); // A4
    const { height } = page.getSize();
    page.drawText(doc.title, { x: 50, y: height - 80, size: 20, font, color: rgb(0.1, 0.1, 0.1) });
    lines.forEach((line, li) => {
      page.drawText(line, { x: 50, y: height - 130 - li * 26, size: 13, font, color: rgb(0.2, 0.2, 0.2) });
    });

    const bytes = await pdf.save();
    fs.writeFileSync(path.join(FIXTURE_DIR, doc.fixture), bytes);
    console.log(`  ✅ ${doc.fixture} (1p, ${(bytes.length / 1024).toFixed(0)}KB)`);
  }
  console.log('✅ 生成完了。git add scripts/fixtures/arbitration/ でコミットしてください。');
}

if (require.main === module) {
  if (process.argv.includes('--generate-pdfs')) {
    generateFixtures().catch((err) => {
      console.error(`ERROR: ${(err as Error).stack ?? err}`);
      process.exit(1);
    });
  } else {
    console.error('使用方法: npx ts-node scripts/fixtures/arbitrationCompareFixtures.ts --generate-pdfs');
    process.exit(1);
  }
}
