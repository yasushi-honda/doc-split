import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PDFArray, PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib';
import { MeasureError, measurePdfPages, parseDocIds, pixelsAtDpi, safeErrorKind } from './pdfPageDimensions';

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
  // 小数ptは個別に切り捨てる(実在のA4は595.276x841.89pt)。期待値はraster.pyの式をPythonで実測した値
  assert.equal(pixelsAtDpi(595.276, 841.89, 200), 1653 * 2338);
  // ちょうど整数になる境界(72pt@200dpi=200px)。浮動小数の誤差で199にならないこと(Python実測も40000)
  assert.equal(pixelsAtDpi(72, 72, 200), 200 * 200);
  // 72dpiではscale=1なので幅*高さの個別切り捨て
  assert.equal(pixelsAtDpi(100.5, 200.5, 72), 100 * 200);
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

test('measurePdfPages: 画素数はPDFium同様float32相当の寸法で計算する(40Mpx上限付近でdouble計算と食い違うページ)', async () => {
  // 1890.73 x 2742.12 pt @200dpi: doubleだと5252x7616=39,999,232だが、float32では5252x7617=40,004,484(上限超え)。
  // 期待値はraster.pyの式をfloat32の寸法でPython実測した値
  const { pages, maxPixels } = await measurePdfPages(await buildPdf([[1890.73, 2742.12]]), 200);
  assert.equal(pages[0].pixels, 5252 * 7617);
  assert.equal(maxPixels, 40_004_484);
  assert.ok(maxPixels > 40_000_000);
  // 表示用の寸法は元の値のまま(float32の誤差を見せない)
  assert.equal(pages[0].effectiveWidthPt, 1890.73);
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

test('measurePdfPages: PDFでないバイト列はstage=loadのMeasureError', async () => {
  await assert.rejects(
    () => measurePdfPages(Buffer.from('not a pdf'), 200),
    (err: unknown) => err instanceof MeasureError && err.stage === 'load'
  );
});

test('measurePdfPages: ページ数0のPDFはstage=loadのMeasureError(raster.pyもINVALID_PDFで拒否する)', async () => {
  // save()は既定でページ0枚に空白ページを足すため、addDefaultPage:falseで本当に0ページのPDFを作る
  const empty = Buffer.from(await (await PDFDocument.create()).save({ addDefaultPage: false }));
  await assert.rejects(
    () => measurePdfPages(empty, 200),
    (err: unknown) => err instanceof MeasureError && err.stage === 'load' && /ページが含まれていません/.test(err.message)
  );
});

test('measurePdfPages: 本番と同じ1ページ抽出後のPDFを測る(1ページ分のバイト数は元の複数ページPDFより小さい)', async () => {
  const pdf = await buildPdf([[595, 842], [595, 842], [595, 842]]);
  const { pages } = await measurePdfPages(pdf, 200);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map((p) => p.pageNumber), [1, 2, 3]);
  for (const p of pages) assert.ok(p.singlePageBytes < pdf.length, '1ページ抽出後は元PDF全体より小さい');
});

test('measurePdfPages: 通常ページはhasCropBox=false・userUnit=null・failuresなし', async () => {
  const result = await measurePdfPages(await buildPdf([[595, 842]]), 200);
  assert.equal(result.pages[0].hasCropBox, false);
  assert.equal(result.pages[0].userUnit, null);
  assert.deepEqual(result.failures, []);
});

test('measurePdfPages: UserUnitがあっても画素数は変えない(式に使わない設計判断の固定)', async () => {
  const pdf = await buildPdf([[595, 842]], (doc) => doc.getPage(0).node.set(PDFName.of('UserUnit'), PDFNumber.of(2)));
  const { pages } = await measurePdfPages(pdf, 200);
  assert.equal(pages[0].userUnit, 2);
  assert.equal(pages[0].pixels, 1652 * 2338);
});

test('measurePdfPages: MediaBoxの原点が非ゼロでも幅・高さで測る', async () => {
  const pdf = await buildPdf([[595, 842]], (doc) => doc.getPage(0).setMediaBox(100, 100, 595, 842));
  const { pages } = await measurePdfPages(pdf, 200);
  assert.equal(pages[0].effectiveWidthPt, 595);
  assert.equal(pages[0].pixels, 1652 * 2338);
});

test('measurePdfPages: CropBoxが片側だけはみ出す場合は重なる部分で測る', async () => {
  // Media 0..595 x 0..842、Crop 295..895 x 0..842 → 重なりは幅300
  const pdf = await buildPdf([[595, 842]], (doc) => doc.getPage(0).setCropBox(295, 0, 600, 842));
  const { pages } = await measurePdfPages(pdf, 200);
  assert.equal(pages[0].effectiveWidthPt, 300);
  assert.equal(pages[0].effectiveHeightPt, 842);
  assert.equal(pages[0].hasCropBox, true);
});

test('measurePdfPages: 回転0/180/270を記録する', async () => {
  const pdf = await buildPdf([[595, 842], [595, 842], [595, 842]], (doc) => {
    doc.getPage(1).setRotation(degrees(180));
    doc.getPage(2).setRotation(degrees(270));
  });
  const { pages } = await measurePdfPages(pdf, 200);
  assert.deepEqual(pages.map((p) => p.rotation), [0, 180, 270]);
});

test('measurePdfPages: maxPixelsは先頭でも末尾でもない最大ページの値(A4,A3,A4)', async () => {
  const pdf = await buildPdf([[595, 842], [842, 1191], [595, 842]]);
  const result = await measurePdfPages(pdf, 200);
  assert.equal(result.maxPixels, 2338 * 3308);
});

test('measurePdfPages: dpiを変えると画素数が変わる(150dpiのA4)', async () => {
  const { pages } = await measurePdfPages(await buildPdf([[595, 842]]), 150);
  assert.equal(pages[0].pixels, 2173206);
});

test('measurePdfPages: CropBoxがMediaBoxと交差しないページはpixels=0の成功にせず、failuresに入れる', async () => {
  const pdf = await buildPdf([[595, 842]], (doc) => doc.getPage(0).setCropBox(2000, 2000, 100, 100));
  const result = await measurePdfPages(pdf, 200);
  assert.equal(result.pages.length, 0);
  assert.equal(result.maxPixels, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].pageNumber, 1);
  assert.equal(result.failures[0].stage, 'measure');
  assert.equal(result.failures[0].kind, 'DegeneratePage');
  assert.match(result.failures[0].detail ?? '', /effectivePt=/);
});

test('measurePdfPages: 幅0のMediaBoxも失敗に入れ、他ページの結果は残す(部分失敗)', async () => {
  const pdf = await buildPdf([[595, 842], [100, 100], [842, 1191]], (doc) => doc.getPage(1).setMediaBox(0, 0, 0, 100));
  const result = await measurePdfPages(pdf, 200);
  assert.deepEqual(result.pages.map((p) => p.pageNumber), [1, 3]);
  assert.deepEqual(result.failures.map((f) => f.pageNumber), [2]);
  assert.equal(result.pageCount, 3);
  assert.equal(result.maxPixels, 2338 * 3308);
});

test('safeErrorKind: 公開ログに出してよい形の例外名だけを返し、それ以外はUnknown', () => {
  assert.equal(safeErrorKind(new TypeError('x')), 'TypeError');
  const weird = new Error('x');
  weird.name = 'bad name/with:chars';
  assert.equal(safeErrorKind(weird), 'Unknown');
  assert.equal(safeErrorKind('文字列'), 'Unknown');
  assert.equal(safeErrorKind(undefined), 'Unknown');
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
  assert.throws(() => parseDocIds('a,'));
  assert.throws(() => parseDocIds(',a'));
  assert.throws(() => parseDocIds('a,b '));
  assert.throws(() => parseDocIds('a\n'));
  assert.throws(() => parseDocIds('ａ'));
  const ten = Array.from({ length: 10 }, (_, i) => `d${i}`).join(',');
  assert.equal(parseDocIds(ten).length, 10);
  assert.throws(() => parseDocIds(`${ten},d10`));
  // 上限は重複除去後の件数で判定する(raw 11件でもuniqueが10件なら受理)
  assert.equal(parseDocIds(`${ten},d0`).length, 10);
});

test('ワークフロー契約: 測定スクリプトの引数は汎用の--doc-id分岐(部分一致)に当たらない名前である', () => {
  const workflow = readFileSync(join(__dirname, '../../.github/workflows/run-ops-script.yml'), 'utf8');
  const options = workflow.split('\n').filter((l) => l.trim().startsWith('- measure-pdf-page-dimensions'));
  assert.ok(options.length > 0, '測定スクリプトの選択肢がワークフローに登録されている');
  for (const line of options) {
    assert.ok(!line.includes('--doc-id'), `汎用--doc-id分岐に部分一致する: ${line.trim()}`);
  }
});
