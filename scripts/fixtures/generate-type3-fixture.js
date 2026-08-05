#!/usr/bin/env node
/**
 * Issue #794 検証用フィクスチャ生成スクリプト(read-only調査、個人情報不使用)
 *
 * kanameone本番PDFで確認された「Type3フォントで描画された記入文字だけが
 * 消える」不具合(罫線はパス描画のため常に表示される)を、個人情報を含まない
 * 合成PDFで再現するためのフィクスチャを生成する。
 *
 * pdf-libの高レベルAPIはType3フォント埋め込みをサポートしないため、
 * PDFContextの低レベルAPI(PDFDict/PDFRawStream/PDFRef)でPDF構文を直接構築する。
 *
 * 生成物:
 *   - with-type3-font.pdf   : Type3フォント + /FontDescriptorに/FontNameを
 *                             意図的に欠落させたPDF(mozilla/pdf.js#19954と
 *                             同一条件。pdfjs-dist 4.8.69ではグリフが描画されず、
 *                             5.4.296で修正#19955により解消される想定)
 *   - with-standard-font.pdf: 同じトークンを標準フォント(Helvetica)で描いた
 *                             対照群(常に正常描画される)
 *
 * 使い方:
 *   node scripts/fixtures/generate-type3-fixture.js
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } = require('pdf-lib');

const TOKEN = 'TESTCASE4821';
const UNIQUE_CHARS = [...new Set(TOKEN.split(''))];

// 5x7ドットマトリクス字形(判読可能な字形が必要: OCR判定(Phase 0-3)では単なる
// 塗りつぶし矩形だと「文字として読めない画像」になり、Type3の不具合とは無関係に
// 常にOCR失敗するため、機械的な描画有無判定(Phase 0-2)用途にも共用できる
// 最小限の判読可能字形に統一する)
const GLYPH_BITMAPS = {
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  A: ['..#..', '.#.#.', '#...#', '#####', '#...#', '#...#', '#...#'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
};
const CELL_SIZE = 100; // 5列x7行 = 500x700 unit(FontBBox/Widthsの700枠内に収まる)

function textBytes(str) {
  return Uint8Array.from(Buffer.from(str, 'latin1'));
}

/** 5x7ビットマップを d1 + 矩形塗りつぶしのCharProcストリームへ変換する */
function buildGlyphContent(bitmap) {
  const lines = ['700 0 0 0 700 700 d1'];
  bitmap.forEach((row, rowIndex) => {
    const y = (bitmap.length - 1 - rowIndex) * CELL_SIZE; // PDF座標系は下が原点のため上下反転
    row.split('').forEach((cell, colIndex) => {
      if (cell === '#') {
        const x = colIndex * CELL_SIZE;
        lines.push(`${x} ${y} ${CELL_SIZE} ${CELL_SIZE} re`);
      }
    });
  });
  lines.push('f', '');
  return lines.join('\n');
}

async function buildType3Fixture() {
  const pdfDoc = await PDFDocument.create();
  const context = pdfDoc.context;
  const page = pdfDoc.addPage([612, 792]);

  // 各グリフは5x7ドットマトリクスの判読可能な字形
  const glyphNameForChar = {};
  const charProcsEntries = {};
  UNIQUE_CHARS.forEach((ch, i) => {
    const glyphName = `g${i + 1}`;
    glyphNameForChar[ch] = glyphName;
    const bitmap = GLYPH_BITMAPS[ch];
    if (!bitmap) throw new Error(`GLYPH_BITMAPSに文字'${ch}'の字形定義がありません`);
    const charProcContent = buildGlyphContent(bitmap);
    const streamRef = context.register(PDFRawStream.of(context.obj({}), textBytes(charProcContent)));
    charProcsEntries[glyphName] = streamRef;
  });
  const charProcsDict = context.obj(charProcsEntries);

  // Encoding: 文字コード1..NをCharProcsのグリフ名に対応付け
  const differences = [1, ...UNIQUE_CHARS.map((ch) => glyphNameForChar[ch])];
  const encodingDict = context.obj({ Type: 'Encoding', Differences: differences });

  // FontDescriptorは意図的に /FontName を欠落させる
  // (mozilla/pdf.js#19954: 「/FontDescriptorは存在するが/FontNameを欠く」ケースが
  //  pdfjs-dist 4.8.69時点で未対応。PR#19955で対応・5.4.296で解消)
  const fontDescriptorRef = context.register(
    context.obj({
      Type: 'FontDescriptor',
      Flags: 4,
      ItalicAngle: 0,
      Ascent: 800,
      Descent: -200,
      CapHeight: 700,
      StemV: 80,
      FontBBox: [0, 0, 1000, 1000],
    })
  );

  const widths = UNIQUE_CHARS.map(() => 700);

  const fontDictRef = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type3',
      FontBBox: [0, 0, 1000, 1000],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: charProcsDict,
      Encoding: encodingDict,
      FirstChar: 1,
      LastChar: UNIQUE_CHARS.length,
      Widths: widths,
      FontDescriptor: fontDescriptorRef,
      Resources: context.obj({}),
    })
  );

  page.node.setFontDictionary(PDFName.of('F1'), fontDictRef);

  const codeForChar = {};
  UNIQUE_CHARS.forEach((ch, i) => {
    codeForChar[ch] = i + 1;
  });
  const hexString = TOKEN.split('')
    .map((ch) => codeForChar[ch].toString(16).padStart(2, '0'))
    .join('');

  // 罫線相当(パス描画、常に正常表示される想定)+ Type3文字列(消失が疑われる箇所)
  const pageContent = [
    'q',
    '0 0 0 RG',
    '2 w',
    '50 650 500 80 re',
    'S',
    'Q',
    'BT',
    '/F1 36 Tf',
    '0 0 0 rg',
    '70 670 Td',
    `<${hexString}> Tj`,
    'ET',
    '',
  ].join('\n');
  const contentStreamRef = context.register(PDFRawStream.of(context.obj({}), textBytes(pageContent)));
  page.node.addContentStream(contentStreamRef);

  // オブジェクトストリーム圧縮を無効化し、PRレビュー時に辞書構造を平文で
  // 目視確認できるようにする(fixtureは小さいため圧縮の実利は無い)
  return pdfDoc.save({ useObjectStreams: false });
}

async function buildStandardFixture() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({
    x: 50,
    y: 650,
    width: 500,
    height: 80,
    borderColor: rgb(0, 0, 0),
    borderWidth: 2,
  });
  page.drawText(TOKEN, { x: 70, y: 670, size: 36, font, color: rgb(0, 0, 0) });

  return pdfDoc.save({ useObjectStreams: false });
}

async function main() {
  const outDir = __dirname;

  const type3Bytes = await buildType3Fixture();
  fs.writeFileSync(path.join(outDir, 'with-type3-font.pdf'), type3Bytes);

  const standardBytes = await buildStandardFixture();
  fs.writeFileSync(path.join(outDir, 'with-standard-font.pdf'), standardBytes);

  console.log('生成完了: with-type3-font.pdf, with-standard-font.pdf');
  console.log(`既知トークン: ${TOKEN}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
