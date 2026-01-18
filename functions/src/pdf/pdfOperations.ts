/**
 * PDF編集操作 Cloud Function
 *
 * 機能:
 * - PDF分割（分割位置サジェスト + 実行）
 * - PDF回転（ページ単位）
 * - 分割候補の検出（OCR結果から顧客/書類の変化点を検出）
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { PDFDocument, degrees } from 'pdf-lib';

const db = admin.firestore();
const storage = admin.storage();

// ============================================
// 分割候補検出
// ============================================

interface PageOcrResult {
  pageNumber: number;
  text: string;
  detectedDocumentType: string | null;
  detectedCustomerName: string | null;
  detectedOfficeName: string | null;
  matchScore: number;
}

interface SplitSuggestion {
  afterPageNumber: number;
  reason: 'new_customer' | 'new_document_type' | 'content_break';
  confidence: number;
  newDocumentType: string | null;
  newCustomerName: string | null;
}

/**
 * 分割候補を検出（GASロジックの移植）
 */
export const detectSplitPoints = onCall(
  {
    region: 'asia-northeast1',
    memory: '512MiB',
  },
  async (request) => {
    const { documentId } = request.data;

    if (!documentId) {
      throw new HttpsError('invalid-argument', 'documentId is required');
    }

    // ドキュメント取得
    const docRef = db.doc(`documents/${documentId}`);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }

    const docData = docSnapshot.data()!;
    const pageResults: PageOcrResult[] = docData.pageResults || [];

    if (pageResults.length === 0) {
      return { suggestions: [] };
    }

    // 分割候補を検出
    const suggestions: SplitSuggestion[] = [];
    let prevCustomer = pageResults[0]?.detectedCustomerName;
    let prevDocType = pageResults[0]?.detectedDocumentType;

    for (let i = 1; i < pageResults.length; i++) {
      const current = pageResults[i]!;
      const customerChanged =
        current.detectedCustomerName &&
        current.detectedCustomerName !== prevCustomer;
      const docTypeChanged =
        current.detectedDocumentType &&
        current.detectedDocumentType !== prevDocType;

      if (customerChanged) {
        suggestions.push({
          afterPageNumber: i, // 前のページの後で分割
          reason: 'new_customer',
          confidence: current.matchScore,
          newDocumentType: current.detectedDocumentType,
          newCustomerName: current.detectedCustomerName,
        });
      } else if (docTypeChanged) {
        suggestions.push({
          afterPageNumber: i,
          reason: 'new_document_type',
          confidence: current.matchScore,
          newDocumentType: current.detectedDocumentType,
          newCustomerName: current.detectedCustomerName,
        });
      }

      // 次のループ用に更新
      if (current.detectedCustomerName) {
        prevCustomer = current.detectedCustomerName;
      }
      if (current.detectedDocumentType) {
        prevDocType = current.detectedDocumentType;
      }
    }

    // Firestoreに保存
    await docRef.update({ splitSuggestions: suggestions });

    return { suggestions };
  }
);

// ============================================
// PDF分割実行
// ============================================

interface SplitRequest {
  documentId: string;
  splitPoints: number[]; // 分割位置（ページ番号の配列）
  segments: Array<{
    startPage: number;
    endPage: number;
    documentType: string;
    customerName: string;
    officeName: string;
  }>;
}

/**
 * PDFを分割して新しいドキュメントを作成
 */
export const splitPdf = onCall(
  {
    region: 'asia-northeast1',
    memory: '1GiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    const { documentId, splitPoints, segments } = request.data as SplitRequest;

    if (!documentId || !splitPoints || !segments) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    // 元ドキュメント取得
    const docRef = db.doc(`documents/${documentId}`);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }

    const docData = docSnapshot.data()!;
    const fileUrl = docData.fileUrl as string;

    // PDFファイルをダウンロード
    const bucket = storage.bucket();
    const filePath = fileUrl.replace(`gs://${bucket.name}/`, '');
    const file = bucket.file(filePath);
    const [buffer] = await file.download();

    // PDFを読み込み
    const pdfDoc = await PDFDocument.load(buffer);

    const createdDocIds: string[] = [];

    // 各セグメントを分割
    for (const segment of segments) {
      const { startPage, endPage, documentType, customerName, officeName } =
        segment;

      // 新しいPDFを作成
      const newPdf = await PDFDocument.create();
      const pageIndices = Array.from(
        { length: endPage - startPage + 1 },
        (_, i) => startPage - 1 + i
      );
      const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
      copiedPages.forEach((page) => newPdf.addPage(page));

      // PDFをバイト配列に変換
      const newPdfBytes = await newPdf.save();

      // ファイル名生成
      const timestamp = Date.now();
      const fileName = generateFileName({
        customerName,
        documentType,
        timestamp,
        startPage,
        endPage,
      });

      // Cloud Storageに保存
      const newFilePath = `processed/${fileName}`;
      const newFile = bucket.file(newFilePath);
      await newFile.save(Buffer.from(newPdfBytes), {
        metadata: { contentType: 'application/pdf' },
      });

      // 新しいドキュメントをFirestoreに作成
      const newDocRef = db.collection('documents').doc();
      await newDocRef.set({
        id: newDocRef.id,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        fileId: newDocRef.id,
        fileName,
        mimeType: 'application/pdf',
        ocrResult: extractOcrResultForPages(
          docData.pageResults || [],
          startPage,
          endPage
        ),
        documentType,
        customerName,
        officeName,
        fileUrl: `gs://${bucket.name}/${newFilePath}`,
        fileDate: docData.fileDate,
        isDuplicateCustomer: false,
        totalPages: endPage - startPage + 1,
        targetPageNumber: 1,
        status: 'processed',
        parentDocumentId: documentId,
        splitFromPages: { start: startPage, end: endPage },
      });

      createdDocIds.push(newDocRef.id);
    }

    // 元ドキュメントのステータスを更新（分割済みフラグ）
    await docRef.update({
      splitInto: createdDocIds,
      status: 'split',
    });

    return {
      success: true,
      createdDocuments: createdDocIds,
    };
  }
);

// ============================================
// PDF回転
// ============================================

interface RotateRequest {
  documentId: string;
  rotations: Array<{
    pageNumber: number;
    degrees: 90 | 180 | 270;
  }>;
}

/**
 * PDFページを回転
 */
export const rotatePdfPages = onCall(
  {
    region: 'asia-northeast1',
    memory: '512MiB',
  },
  async (request) => {
    const { documentId, rotations } = request.data as RotateRequest;

    if (!documentId || !rotations) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    // ドキュメント取得
    const docRef = db.doc(`documents/${documentId}`);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }

    const docData = docSnapshot.data()!;
    const fileUrl = docData.fileUrl as string;

    // PDFファイルをダウンロード
    const bucket = storage.bucket();
    const filePath = fileUrl.replace(`gs://${bucket.name}/`, '');
    const file = bucket.file(filePath);
    const [buffer] = await file.download();

    // PDFを読み込み
    const pdfDoc = await PDFDocument.load(buffer);

    // 各ページを回転
    for (const { pageNumber, degrees: deg } of rotations) {
      const page = pdfDoc.getPage(pageNumber - 1); // 0-indexed
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees(currentRotation + deg));
    }

    // 保存
    const newPdfBytes = await pdfDoc.save();
    await file.save(Buffer.from(newPdfBytes), {
      metadata: { contentType: 'application/pdf' },
    });

    // 回転情報をFirestoreに記録
    const existingRotations = docData.pageRotations || [];
    const updatedRotations = [...existingRotations];

    for (const { pageNumber, degrees: deg } of rotations) {
      const existing = updatedRotations.find(
        (r: { pageNumber: number }) => r.pageNumber === pageNumber
      );
      if (existing) {
        existing.rotation = ((existing.rotation + deg) % 360) as 0 | 90 | 180 | 270;
      } else {
        updatedRotations.push({ pageNumber, rotation: deg as 0 | 90 | 180 | 270 });
      }
    }

    await docRef.update({ pageRotations: updatedRotations });

    return { success: true };
  }
);

// ============================================
// ヘルパー関数
// ============================================

function generateFileName(params: {
  customerName: string;
  documentType: string;
  timestamp: number;
  startPage: number;
  endPage: number;
}): string {
  const { customerName, documentType, timestamp, startPage, endPage } = params;
  const date = new Date(timestamp);
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const sanitizedCustomer = sanitize(customerName || '不明顧客');
  const sanitizedDocType = sanitize(documentType || '不明文書');
  const pageRange = startPage === endPage ? `p${startPage}` : `p${startPage}-${endPage}`;

  return `${dateStr}_${sanitizedCustomer}_${sanitizedDocType}_${pageRange}.pdf`;
}

function sanitize(str: string): string {
  return str
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\s\u3000]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function extractOcrResultForPages(
  pageResults: PageOcrResult[],
  startPage: number,
  endPage: number
): string {
  return pageResults
    .filter((p) => p.pageNumber >= startPage && p.pageNumber <= endPage)
    .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
    .join('\n\n');
}
