/**
 * PDFのページ寸法・画素数の測定(read-only診断用)。
 *
 * paddle-ocr の `signal 9` 調査(2026-10-15 kanameone)で、失敗したページと成功したページの
 * 寸法を比較するために作った。`functions/src/ocr/ocrProcessor.ts` と同じく1ページずつ抽出した
 * 後のPDFを測るため、Pagesツリーから継承したMediaBox等が抽出で失われる場合も反映される。
 *
 * 画素数は `services/paddle-ocr/raster.py` の式(幅・高さを個別に切り捨ててから掛ける)に合わせる。
 * ただし本番のレンダラ(pypdfium2)がUserUnitを反映するかは確認していないため、UserUnitは
 * 値だけ記録し、画素数の計算には使わない。
 */

import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

export interface PageDimensions {
  mediaWidthPt: number;
  mediaHeightPt: number;
  hasCropBox: boolean;
  /** CropBoxとMediaBoxの交差(CropBoxが無ければMediaBox) */
  effectiveWidthPt: number;
  effectiveHeightPt: number;
  rotation: number;
  /** /UserUnit。無ければnull。画素数の計算には使わない */
  userUnit: number | null;
  pixels: number;
  /** 1ページに抽出した後のPDFのバイト数(本番がpaddle-ocrへ送る内容に相当) */
  singlePageBytes: number;
}

export interface PdfDimensionsResult {
  pageCount: number;
  pages: PageDimensions[];
  maxPixels: number;
}

const MAX_DOC_IDS = 10;
const DOC_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** raster.py の `int(width_pt * scale) * int(height_pt * scale)` と同じ */
export function pixelsAtDpi(widthPt: number, heightPt: number, dpi: number): number {
  const scale = dpi / 72;
  return Math.floor(widthPt * scale) * Math.floor(heightPt * scale);
}

/** 本番(functions/src/ocr/ocrProcessor.ts の extractPdfPage)と同じ方法で、ロード済みPDFから1ページを抽出する */
async function extractSinglePage(source: PDFDocument, pageIndex: number): Promise<Buffer> {
  const single = await PDFDocument.create();
  const [copied] = await single.copyPages(source, [pageIndex]);
  single.addPage(copied);
  return Buffer.from(await single.save());
}

async function measureSinglePagePdf(singlePage: Buffer, dpi: number): Promise<PageDimensions> {
  const doc = await PDFDocument.load(singlePage);
  const page = doc.getPage(0);
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const hasCropBox =
    crop.x !== media.x || crop.y !== media.y || crop.width !== media.width || crop.height !== media.height;

  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  const effectiveWidthPt = Math.max(0, right - left);
  const effectiveHeightPt = Math.max(0, top - bottom);

  const userUnitObj = page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber);

  return {
    mediaWidthPt: media.width,
    mediaHeightPt: media.height,
    hasCropBox,
    effectiveWidthPt,
    effectiveHeightPt,
    rotation: page.getRotation().angle,
    userUnit: userUnitObj ? userUnitObj.asNumber() : null,
    pixels: pixelsAtDpi(effectiveWidthPt, effectiveHeightPt, dpi),
    singlePageBytes: singlePage.length,
  };
}

export async function measurePdfPages(pdfBuffer: Buffer, dpi: number): Promise<PdfDimensionsResult> {
  const source = await PDFDocument.load(pdfBuffer);
  const pageCount = source.getPageCount();
  if (pageCount === 0) {
    throw new Error('PDFにページが含まれていません');
  }
  const pages: PageDimensions[] = [];
  for (let i = 0; i < pageCount; i++) {
    // 共有画像が各ページに複製されるため、全ページ分を保持せず1ページずつ抽出して測る
    pages.push(await measureSinglePagePdf(await extractSinglePage(source, i), dpi));
  }
  return {
    pageCount: pages.length,
    pages,
    maxPixels: Math.max(...pages.map((p) => p.pixels)),
  };
}

/** カンマ区切りのdocId(1〜10件、英数字/_/-のみ)。重複は除き入力順を保つ */
export function parseDocIds(csv: string): string[] {
  const parts = csv.split(',');
  if (parts.some((p) => !DOC_ID_PATTERN.test(p))) {
    throw new Error('doc-idsは英数字/_/-のみのIDをカンマ区切りで指定してください(空要素不可)');
  }
  const unique = [...new Set(parts)];
  if (unique.length > MAX_DOC_IDS) {
    throw new Error(`doc-idsは最大${MAX_DOC_IDS}件です(指定: ${unique.length})`);
  }
  return unique;
}
