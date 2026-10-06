/**
 * pdfPages.ts (PDF 1ページ分割) テスト (ADR-0027 PR-E)
 *
 * 旧 geminiOcrCompare.ts から切り出した分割関数が、移設前と同じ挙動(全ページを1ページずつの
 * PDFへ分割し、ページ数・各ページの内容=ここではページ寸法で識別・順序を保つ)であることを
 * 実PDFで確認する。現役の paddle-ocr-verify(load モード)とゴールデンPDF生成の動的 import 先。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { extractAllPdfPages, extractPdfPage } from './pdfPages';

/** ページごとに幅を変えた n ページのPDF(寸法でページを識別する) */
async function makePdf(widths: number[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 200]);
  return Buffer.from(await doc.save());
}

async function pageWidths(buf: Buffer): Promise<number[]> {
  const doc = await PDFDocument.load(buf);
  return doc.getPages().map((p) => p.getWidth());
}

test('extractAllPdfPages: 全ページを1ページずつのPDFに分割し、順序と内容(寸法)を保つ', async () => {
  const pages = await extractAllPdfPages(await makePdf([100, 200, 300]));
  assert.equal(pages.length, 3);
  for (const [i, expectedWidth] of [100, 200, 300].entries()) {
    assert.deepEqual(await pageWidths(pages[i]), [expectedWidth]);
  }
});

test('extractAllPdfPages: 1ページのPDFは1件を返す(境界値: 最小)', async () => {
  const pages = await extractAllPdfPages(await makePdf([150]));
  assert.equal(pages.length, 1);
  assert.deepEqual(await pageWidths(pages[0]), [150]);
});

test('extractAllPdfPages: PDFとして不正な入力は例外になる(異常系: 空・不正バイト列)', async () => {
  await assert.rejects(() => extractAllPdfPages(Buffer.alloc(0)));
  await assert.rejects(() => extractAllPdfPages(Buffer.from('not a pdf')));
});

test('extractPdfPage: 指定ページだけを抜き出す(先頭・末尾の境界)', async () => {
  const pdf = await makePdf([100, 200, 300]);
  assert.deepEqual(await pageWidths(await extractPdfPage(pdf, 0)), [100]);
  assert.deepEqual(await pageWidths(await extractPdfPage(pdf, 2)), [300]);
});

test('extractPdfPage: 範囲外のページ指定は例外になる(異常系)', async () => {
  const pdf = await makePdf([100, 200]);
  await assert.rejects(() => extractPdfPage(pdf, 2));
  await assert.rejects(() => extractPdfPage(pdf, -1));
});
