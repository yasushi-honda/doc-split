import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PDFArray, PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib';
import { measurePdfPages, parseDocIds, pixelsAtDpi } from './pdfPageDimensions';

async function buildPdf(sizes: Array<[number, number]>, tweak?: (doc: PDFDocument) => void): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w, h]);
  tweak?.(doc);
  return Buffer.from(await doc.save());
}

test('pixelsAtDpi: raster.pyと同じく幅・高さを個別に切り捨ててから掛ける', () => {
  // A4(595x842)@200dpi = 1652 x 2338
  assert.equal(pixelsAtDpi(595, 842, 200), 1652 * 2338);
  // A3(842x1191)@200dpi = 2338 x 3308 (約7.7Mpx)
  assert.equal(pixelsAtDpi(842, 1191, 200), 2338 * 3308);
  assert.equal(pixelsAtDpi(0, 0, 200), 0);
});

test('measurePdfPages: ページごとに寸法と画素数を返す(A4とA3の混在)', async () => {
  const pdf = await buildPdf([[595, 842], [842, 1191]]);
  const result = await measurePdfPages(pdf, 200);
  assert.equal(result.pageCount, 2);
  assert.equal(result.pages[0].effectiveWidthPt, 595);
  assert.equal(result.pages[0].pixels, 1652 * 2338);
  assert.equal(result.pages[1].pixels, 2338 * 3308);
  assert.equal(result.maxPixels, 2338 * 3308);
  assert.ok(result.pages.every((p) => p.singlePageBytes > 0));
});

test('measurePdfPages: 回転は画素数を変えず、角度を記録する', async () => {
  const pdf = await buildPdf([[595, 842]], (doc) => doc.getPage(0).setRotation(degrees(90)));
  const { pages } = await measurePdfPages(pdf, 200);
  assert.equal(pages[0].rotation, 90);
  assert.equal(pages[0].pixels, 1652 * 2338);
});

test('measurePdfPages: CropBoxがMediaBoxより小さければCropBoxで測る', async () => {
  const pdf = await buildPdf([[842, 1191]], (doc) => doc.getPage(0).setCropBox(0, 0, 595, 842));
  const { pages } = await measurePdfPages(pdf, 200);
  assert.equal(pages[0].mediaWidthPt, 842);
  assert.equal(pages[0].effectiveWidthPt, 595);
  assert.equal(pages[0].hasCropBox, true);
  assert.equal(pages[0].pixels, 1652 * 2338);
});

test('measurePdfPages: CropBoxがMediaBoxからはみ出す場合は交差部分で測る', async () => {
  const pdf = await buildPdf([[595, 842]], (doc) => doc.getPage(0).setCropBox(-100, -100, 1000, 1000));
  const { pages } = await measurePdfPages(pdf, 200);
  assert.equal(pages[0].effectiveWidthPt, 595);
  assert.equal(pages[0].effectiveHeightPt, 842);
});

test('measurePdfPages: UserUnitがあれば記録する(画素数は計算しない値と区別できる)', async () => {
  const pdf = await buildPdf([[595, 842]], (doc) =>
    doc.getPage(0).node.set(PDFName.of('UserUnit'), PDFNumber.of(2))
  );
  const { pages } = await measurePdfPages(pdf, 200);
  assert.equal(pages[0].userUnit, 2);
});

test('measurePdfPages: Pagesツリーから継承したMediaBoxも、本番と同じ1ページ抽出後に測る', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  page.node.delete(PDFName.of('MediaBox'));
  const pages = doc.catalog.Pages();
  pages.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, 842, 1191]) as PDFArray);
  const pdf = Buffer.from(await doc.save());
  const result = await measurePdfPages(pdf, 200);
  assert.equal(result.pages[0].mediaWidthPt, 842);
  assert.equal(result.pages[0].pixels, 2338 * 3308);
});

test('measurePdfPages: ページ数0やPDFでないバイト列は例外', async () => {
  await assert.rejects(() => measurePdfPages(Buffer.from('not a pdf'), 200));
});

test('parseDocIds: 1〜10件のカンマ区切り英数字/_/-のみ。重複は除去して入力順を保つ', () => {
  assert.deepEqual(parseDocIds('a,b-1,c_2'), ['a', 'b-1', 'c_2']);
  assert.deepEqual(parseDocIds('a,a,b'), ['a', 'b']);
});

test('parseDocIds: 空・11件・不正文字・空要素は拒否(境界値)', () => {
  assert.throws(() => parseDocIds(''));
  assert.throws(() => parseDocIds('a,,b'));
  assert.throws(() => parseDocIds('a/b'));
  assert.throws(() => parseDocIds('a b'));
  const ten = Array.from({ length: 10 }, (_, i) => `d${i}`).join(',');
  assert.equal(parseDocIds(ten).length, 10);
  assert.throws(() => parseDocIds(`${ten},d10`));
});

test('ワークフロー契約: 測定スクリプトの引数は汎用の--doc-id分岐(部分一致)に当たらない名前である', () => {
  const workflow = readFileSync(join(__dirname, '../../.github/workflows/run-ops-script.yml'), 'utf8');
  const options = workflow.split('\n').filter((l) => l.trim().startsWith('- measure-pdf-page-dimensions'));
  assert.ok(options.length > 0, '測定スクリプトの選択肢がワークフローに登録されている');
  for (const line of options) {
    assert.ok(!line.includes('--doc-id'), `汎用--doc-id分岐に部分一致する: ${line.trim()}`);
  }
});
