/**
 * PDFのページ寸法・画素数の測定(read-only診断用)。
 *
 * paddle-ocr の `signal 9`(2026-10-15 kanameone)調査で、失敗したページと成功したページの
 * 寸法を比較するために作った。`functions/src/ocr/ocrProcessor.ts` と同じく1ページずつ抽出した
 * 後のPDFを測るため、Pagesツリーから継承したMediaBox等が抽出で失われる場合も反映される。
 *
 * 画素数は `services/paddle-ocr/raster.py` の式(幅・高さを個別に切り捨ててから掛ける)に合わせる。
 * ただし本番のレンダラ(pypdfium2)がUserUnitを反映するかは確認していないため、UserUnitは
 * 値だけ記録し、画素数の計算には使わない。
 *
 * 診断なので「見かけ上の成功」を作らない: 寸法が不正なページ(幅/高さが0・負・NaN、
 * CropBoxがMediaBoxと交差しない等)は pixels=0 の正常値にせず failures に入れる。
 * 1ページが失敗しても、測れたページの結果は残す。
 */

import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

export interface PageDimensions {
  /** 1始まり */
  pageNumber: number;
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

export type MeasureStage = 'load' | 'extract' | 'measure';

export interface PageFailure {
  pageNumber: number;
  stage: MeasureStage;
  /** 例外クラス名(メッセージは書類名・パスを含みうるため持たない) */
  kind: string;
  /** 数値のみの補足(退化ページの生の寸法など)。PIIを含まない */
  detail?: string;
}

export interface PdfDimensionsResult {
  pageCount: number;
  /** 測れたページだけ */
  pages: PageDimensions[];
  failures: PageFailure[];
  /** 測れたページの最大画素数。測れたページが無ければ0 */
  maxPixels: number;
}

/** どの段階で失敗したかを呼び出し側へ伝える(メッセージは公開ログに出さない前提) */
export class MeasureError extends Error {
  constructor(
    message: string,
    readonly stage: MeasureStage
  ) {
    super(message);
    this.name = 'MeasureError';
  }
}

class DegeneratePageError extends Error {
  constructor(readonly detail: string) {
    super('degenerate page');
    this.name = 'DegeneratePage';
  }
}

const MAX_DOC_IDS = 10;
const DOC_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;

/** raster.py の `int(width_pt * scale) * int(height_pt * scale)` と同じ */
export function pixelsAtDpi(widthPt: number, heightPt: number, dpi: number): number {
  const scale = dpi / 72;
  return Math.floor(widthPt * scale) * Math.floor(heightPt * scale);
}

/** 公開ログに出してよい形(英数字・_・.・-のみ40文字以内)の例外名だけを返す */
export function safeErrorKind(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  return SAFE_NAME_PATTERN.test(name) ? name : 'Unknown';
}

/** 本番(functions/src/ocr/ocrProcessor.ts の extractPdfPage)と同じ方法で、ロード済みPDFから1ページを抽出する */
async function extractSinglePage(source: PDFDocument, pageIndex: number): Promise<Buffer> {
  const single = await PDFDocument.create();
  const [copied] = await single.copyPages(source, [pageIndex]);
  single.addPage(copied);
  return Buffer.from(await single.save());
}

async function measureSinglePagePdf(singlePage: Buffer, pageNumber: number, dpi: number): Promise<PageDimensions> {
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
  const effectiveWidthPt = right - left;
  const effectiveHeightPt = top - bottom;

  // 幅/高さが0・負・NaNのページは、pixels=0の正常値にせず失敗として扱う
  if (!(Number.isFinite(effectiveWidthPt) && Number.isFinite(effectiveHeightPt)) || effectiveWidthPt <= 0 || effectiveHeightPt <= 0) {
    throw new DegeneratePageError(
      `mediaPt=${media.width}x${media.height} effectivePt=${effectiveWidthPt}x${effectiveHeightPt} cropBox=${hasCropBox}`
    );
  }

  const userUnitObj = page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber);

  return {
    pageNumber,
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

/**
 * PDFを1ページずつ抽出して測る。1ページの失敗は failures に記録して続行する。
 * PDF全体を読み込めない・ページ数が0の場合は、全体の失敗として MeasureError(stage='load') を投げる。
 */
export async function measurePdfPages(pdfBuffer: Buffer, dpi: number): Promise<PdfDimensionsResult> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(pdfBuffer);
  } catch (err) {
    throw Object.assign(new MeasureError('PDFを読み込めません', 'load'), { cause: err });
  }
  const pageCount = source.getPageCount();
  if (pageCount === 0) {
    throw new MeasureError('PDFにページが含まれていません', 'load');
  }

  const pages: PageDimensions[] = [];
  const failures: PageFailure[] = [];
  for (let i = 0; i < pageCount; i++) {
    const pageNumber = i + 1;
    let stage: MeasureStage = 'extract';
    try {
      // 共有画像が各ページに複製されるため、全ページ分を保持せず1ページずつ抽出して測る
      const single = await extractSinglePage(source, i);
      stage = 'measure';
      pages.push(await measureSinglePagePdf(single, pageNumber, dpi));
    } catch (err) {
      failures.push({
        pageNumber,
        stage,
        kind: safeErrorKind(err),
        ...(err instanceof DegeneratePageError ? { detail: err.detail } : {}),
      });
    }
  }
  return {
    pageCount,
    pages,
    failures,
    maxPixels: pages.length > 0 ? Math.max(...pages.map((p) => p.pixels)) : 0,
  };
}

/** カンマ区切りのdocId(1〜10件、英数字/_/-のみ)。重複は除き入力順を保つ。上限は重複除去後の件数で判定する */
export function parseDocIds(csv: string): string[] {
  const parts = csv.split(',');
  if (parts.some((p) => !DOC_ID_PATTERN.test(p))) {
    throw new Error('target-idsは英数字/_/-のみのIDをカンマ区切りで指定してください(空要素不可)');
  }
  const unique = [...new Set(parts)];
  if (unique.length > MAX_DOC_IDS) {
    throw new Error(`target-idsは最大${MAX_DOC_IDS}件です(指定: ${unique.length})`);
  }
  return unique;
}
