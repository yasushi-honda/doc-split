/**
 * Issue #432 PR-C: parent PDF + splitFromPages から child PDF を再生成
 *
 * functions/src/pdf/pdfOperations.ts:307-316 splitPdf の partial copy ロジックを
 * scripts 用に独立実装 (Functions 変更ゼロ制約)。
 *
 * 重要: 親 PDF が rotate 後形式 (`_r{timestamp}.pdf`) の場合、再生成された child は
 * 「事故当時の child bytes」とは byte-for-byte 一致しない可能性がある (rotate 後ページが入る)。
 * この点は runbook の repair policy で明示し、operator が承知の上で repair する設計。
 */

import { PDFDocument } from 'pdf-lib';

/**
 * parent PDF buffer + page range から child PDF buffer を生成する。
 *
 * @param parentPdfBuffer parent doc の現在 fileUrl が指す PDF bytes (rotate 済みなら rotate 後)
 * @param startPage 1-indexed inclusive
 * @param endPage 1-indexed inclusive
 * @returns child PDF bytes
 */
export async function regenerateChildPdf(
  parentPdfBuffer: Buffer,
  startPage: number,
  endPage: number
): Promise<Buffer> {
  if (startPage < 1 || endPage < startPage) {
    throw new Error(
      `invalid page range: startPage=${startPage}, endPage=${endPage}`
    );
  }

  const parentPdf = await PDFDocument.load(parentPdfBuffer);
  const totalPages = parentPdf.getPageCount();

  if (endPage > totalPages) {
    throw new Error(
      `page range out of bounds: endPage=${endPage} > parent totalPages=${totalPages}`
    );
  }

  const newPdf = await PDFDocument.create();
  const pageIndices = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage - 1 + i
  );
  const copiedPages = await newPdf.copyPages(parentPdf, pageIndices);
  copiedPages.forEach((page) => newPdf.addPage(page));

  const newPdfBytes = await newPdf.save();
  return Buffer.from(newPdfBytes);
}
