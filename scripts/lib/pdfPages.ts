/**
 * PDFのページ分割 (ADR-0027 PR-E で geminiOcrCompare.ts から切り出し)
 *
 * `functions/src/ocr/ocrProcessor.ts` の `extractPdfPage` と同ロジック(本番側は非exportのため
 * 複製)。Gemini SDKに依存しない。現役の `paddle-ocr-verify.ts`(load モード)と
 * `fixtures/paddleOcrGoldenFixtures.ts`(ゴールデンPDF生成)が動的importで使う。
 */

import { PDFDocument } from 'pdf-lib';

/** functions/src/ocr/ocrProcessor.ts の extractPdfPage と同ロジック */
export async function extractPdfPage(pdfBuffer: Buffer, pageIndex: number): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const newPdf = await PDFDocument.create();
  const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageIndex]);
  newPdf.addPage(copiedPage);
  const pdfBytes = await newPdf.save();
  return Buffer.from(pdfBytes);
}

/**
 * 同一PDFの全ページを抽出する。ページ数はロード済みPDFの`getPageCount()`から取得する
 * (functions/src/ocr/ocrProcessor.ts の processDocument() と同じ方式。Firestore保存済みの
 * totalPagesとの乖離で一部ページだけが処理される静かな歪みを避けるため、実PDFから直接取得する)。
 * extractPdfPage()をページ数分呼ぶと`PDFDocument.load()`(PDF全体のパース)がページ数だけ
 * 繰り返されるため、全ページを一度だけロードして抽出するバッチ版を使う。
 */
export async function extractAllPdfPages(pdfBuffer: Buffer): Promise<Buffer[]> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  const pages: Buffer[] = [];
  for (let i = 0; i < totalPages; i++) {
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
    newPdf.addPage(copiedPage);
    const pdfBytes = await newPdf.save();
    pages.push(Buffer.from(pdfBytes));
  }
  return pages;
}
