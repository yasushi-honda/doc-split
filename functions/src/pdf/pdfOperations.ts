/**
 * PDF編集操作 Cloud Function
 *
 * 機能:
 * - PDF分割（分割位置サジェスト + 実行）
 * - PDF回転（ページ単位）
 * - 分割候補の検出（OCR結果から顧客/書類の変化点を検出）
 *
 * Phase 6D: pdfAnalyzer統合
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  analyzePdf,
  generateSplitSummary,
  PageOcrData,
  MasterData,
} from '../utils/pdfAnalyzer';
import { CustomerMaster, DocumentMaster, OfficeMaster } from '../utils/extractors';

const db = admin.firestore();
const storage = admin.storage();

// ============================================
// 分割候補検出（Phase 6D: pdfAnalyzer統合）
// ============================================

interface PageOcrResult {
  pageNumber: number;
  text: string;
  detectedDocumentType: string | null;
  detectedCustomerName: string | null;
  detectedOfficeName: string | null;
  matchScore: number;
}

/**
 * 分割候補を検出（強化版 - pdfAnalyzer使用）
 */
export const detectSplitPoints = onCall(
  {
    region: 'asia-northeast1',
    memory: '512MiB',
  },
  async (request) => {
    const { documentId, useEnhanced = true } = request.data;
    console.log(`detectSplitPoints called: documentId=${documentId}, useEnhanced=${useEnhanced}`);

    if (!documentId) {
      throw new HttpsError('invalid-argument', 'documentId is required');
    }

    // ドキュメント取得
    const docRef = db.doc(`documents/${documentId}`);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      console.log(`Document not found: ${documentId}`);
      throw new HttpsError('not-found', 'Document not found');
    }

    const docData = docSnapshot.data()!;
    const pageResults: PageOcrResult[] = docData.pageResults || [];
    console.log(`pageResults count: ${pageResults.length}`);

    if (pageResults.length === 0) {
      console.log('No pageResults, returning empty');
      return { suggestions: [], segments: [], shouldSplit: false };
    }

    // 強化版分析を使用
    if (useEnhanced) {
      // マスターデータ取得
      const [documentMasters, customerMasters, officeMasters] = await Promise.all([
        db.collection('masters/documents/items').get(),
        db.collection('masters/customers/items').get(),
        db.collection('masters/offices/items').get(),
      ]);

      const masters: MasterData = {
        documents: documentMasters.docs.map((d) => ({
          id: d.id,
          name: d.data().name as string,
          category: d.data().category as string | undefined,
          keywords: d.data().keywords as string[] | undefined,
          aliases: d.data().aliases as string[] | undefined,
        })) as DocumentMaster[],
        customers: customerMasters.docs.map((d) => ({
          id: d.id,
          name: d.data().name as string,
          furigana: d.data().furigana as string | undefined,
          isDuplicate: d.data().isDuplicate as boolean | undefined,
          aliases: d.data().aliases as string[] | undefined,
          careManagerName: d.data().careManagerName as string | undefined,
          notes: d.data().notes as string | undefined,
        })) as CustomerMaster[],
        offices: officeMasters.docs.map((d) => ({
          id: d.id,
          name: d.data().name as string,
          shortName: d.data().shortName as string | undefined,
          isDuplicate: d.data().isDuplicate as boolean | undefined,
          aliases: d.data().aliases as string[] | undefined,
          notes: d.data().notes as string | undefined,
        })) as OfficeMaster[],
      };

      // ページデータを変換
      const pages: PageOcrData[] = pageResults.map((p) => ({
        pageNumber: p.pageNumber,
        text: p.text,
        detectedDocumentType: p.detectedDocumentType,
        detectedCustomerName: p.detectedCustomerName,
        detectedOfficeName: p.detectedOfficeName,
      }));

      // 強化版分析を実行
      console.log('Running analyzePdf...');
      const analysisResult = analyzePdf(pages, masters);
      console.log(`Analysis result: suggestions=${analysisResult.splitSuggestions.length}, segments=${analysisResult.segments.length}, shouldSplit=${analysisResult.shouldSplit}`);
      const summary = generateSplitSummary(analysisResult);

      // Firestoreに保存（undefinedを除外）
      console.log('Saving to Firestore...');
      await docRef.update({
        splitSuggestions: analysisResult.splitSuggestions,
        splitSegments: analysisResult.segments.map((seg) => ({
          id: seg.id,
          startPage: seg.startPage,
          endPage: seg.endPage,
          documentType: seg.documentType,
          customerName: seg.customerName,
          customerId: seg.customerId,
          officeName: seg.officeName,
          suggestedFileName: seg.suggestedFileName.fileName,
          confidence: seg.confidence,
        })),
        shouldSplit: analysisResult.shouldSplit,
        splitReason: analysisResult.splitReason || null,
      });
      console.log('Firestore update complete, returning result');

      return {
        suggestions: analysisResult.splitSuggestions,
        segments: analysisResult.segments,
        shouldSplit: analysisResult.shouldSplit,
        splitReason: analysisResult.splitReason || null,
        summary,
      };
    }

    // レガシー分析（後方互換性のため維持）
    const suggestions: Array<{
      afterPageNumber: number;
      reason: string;
      confidence: number;
      newDocumentType: string | null;
      newCustomerName: string | null;
    }> = [];

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
          afterPageNumber: i,
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

      if (current.detectedCustomerName) {
        prevCustomer = current.detectedCustomerName;
      }
      if (current.detectedDocumentType) {
        prevDocType = current.detectedDocumentType;
      }
    }

    await docRef.update({ splitSuggestions: suggestions });

    return { suggestions, segments: [], shouldSplit: suggestions.length > 0 };
  }
);

// ============================================
// PDF分割実行
// ============================================

interface SplitSegment {
  startPage: number;
  endPage: number;
  documentType: string;
  customerName: string;
  customerId?: string | null;
  officeName: string;
  officeId?: string | null;
  /** 顧客候補リスト */
  customerCandidates?: Array<{
    id: string;
    name: string;
    score: number;
    isDuplicate: boolean;
    careManagerName?: string;
  }>;
  /** 事業所候補リスト */
  officeCandidates?: Array<{
    id: string;
    name: string;
    score: number;
    isDuplicate: boolean;
  }>;
  /** 手動選択が必要か（顧客） */
  needsManualCustomerSelection?: boolean;
  /** 手動選択が必要か（事業所） */
  needsManualOfficeSelection?: boolean;
  /** 同姓同名の顧客か */
  isDuplicateCustomer?: boolean;
  /** 担当ケアマネ名 */
  careManagerName?: string | null;
}

interface SplitRequest {
  documentId: string;
  splitPoints: number[]; // 分割位置（ページ番号の配列）
  segments: SplitSegment[];
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
      const {
        startPage,
        endPage,
        documentType,
        customerName,
        customerId,
        officeName,
        officeId,
        customerCandidates,
        officeCandidates,
        // needsManualCustomerSelection, needsManualOfficeSelectionは
        // 分割UIで選択済みのため常にfalseになる
        isDuplicateCustomer,
        careManagerName,
      } = segment;

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

      // 分割後のページ結果を抽出
      const segmentPageResults = (docData.pageResults || []).filter(
        (p: PageOcrResult) => p.pageNumber >= startPage && p.pageNumber <= endPage
      );

      // ocrExtractionスナップショットを構築
      // 元ドキュメントのocrExtractionがあれば継承、なければsplit-legacyとして生成
      const parentOcrExtraction = docData.ocrExtraction;
      const ocrExtraction = parentOcrExtraction
        ? {
            ...parentOcrExtraction,
            splitFrom: {
              documentId,
              pages: { start: startPage, end: endPage },
            },
          }
        : {
            version: 'split-legacy',
            extractedAt: admin.firestore.FieldValue.serverTimestamp(),
            customer: {
              name: customerName,
              id: customerId || null,
              candidates: customerCandidates || [],
            },
            office: {
              name: officeName,
              id: officeId || null,
              candidates: officeCandidates || [],
            },
            documentType: {
              name: documentType,
            },
            splitFrom: {
              documentId,
              pages: { start: startPage, end: endPage },
            },
          };

      // 新しいドキュメントをFirestoreに作成
      // ユーザーが分割UIで選択した値は常にconfirmed=true
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
        // 書類種別
        documentType,
        // 顧客関連
        customerName,
        customerId: customerId || null,
        customerCandidates: customerCandidates || [],
        customerConfirmed: true, // 分割UIで選択したため確定済み
        needsManualCustomerSelection: false, // 分割UIで確定したため手動選択不要
        isDuplicateCustomer: isDuplicateCustomer || false,
        careManagerName: careManagerName || null,
        confirmedBy: request.auth?.uid || null,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
        // 事業所関連
        officeName,
        officeId: officeId || null,
        officeCandidates: officeCandidates || [],
        officeConfirmed: true, // 分割UIで選択したため確定済み
        officeConfirmedBy: request.auth?.uid || null,
        officeConfirmedAt: admin.firestore.FieldValue.serverTimestamp(),
        // OCR抽出スナップショット
        ocrExtraction,
        // ページ結果（再OCR不要にするため保存）
        pageResults: segmentPageResults.map((p: PageOcrResult, index: number) => ({
          ...p,
          pageNumber: index + 1, // 分割後の新しいページ番号
          originalPageNumber: p.pageNumber, // 元のページ番号
        })),
        // ファイル情報
        fileUrl: `gs://${bucket.name}/${newFilePath}`,
        fileDate: docData.fileDate,
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
    console.log('rotatePdfPages called:', { documentId, rotations });

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
    console.log('Processing file:', fileUrl);

    // PDFファイルをダウンロード
    const bucket = storage.bucket();
    const filePath = fileUrl.replace(`gs://${bucket.name}/`, '');
    const file = bucket.file(filePath);
    const [buffer] = await file.download();
    console.log('Downloaded PDF, size:', buffer.length);

    // PDFを読み込み
    const pdfDoc = await PDFDocument.load(buffer);
    console.log('PDF loaded, pages:', pdfDoc.getPageCount());

    // 各ページを回転
    for (const { pageNumber, degrees: deg } of rotations) {
      if (pageNumber < 1 || pageNumber > pdfDoc.getPageCount()) {
        console.error(`Invalid page number: ${pageNumber}, total pages: ${pdfDoc.getPageCount()}`);
        continue;
      }
      const page = pdfDoc.getPage(pageNumber - 1); // 0-indexed
      const currentRotation = page.getRotation().angle;
      const newRotation = (currentRotation + deg) % 360;
      console.log(`Page ${pageNumber}: current rotation ${currentRotation}, adding ${deg}, new rotation ${newRotation}`);
      page.setRotation(degrees(newRotation));
      // 検証
      const afterRotation = page.getRotation().angle;
      console.log(`Page ${pageNumber}: rotation after setRotation: ${afterRotation}`);
    }

    // 保存
    const newPdfBytes = await pdfDoc.save();
    console.log('PDF saved in memory, size:', newPdfBytes.length);

    // 元のファイルサイズを記録
    const originalSize = buffer.length;
    console.log('Original file size:', originalSize, 'New file size:', newPdfBytes.length);

    // CDNキャッシュを完全に回避するため、新しいパスに保存
    const timestamp = Date.now();
    const newFilePath = filePath.replace(/\.pdf$/i, `_r${timestamp}.pdf`);
    const newFile = bucket.file(newFilePath);

    await newFile.save(Buffer.from(newPdfBytes), {
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'no-cache, no-store, must-revalidate',
      },
    });
    console.log('PDF uploaded to new path:', newFilePath);

    // 古いファイルを削除（エラーは無視）
    try {
      await file.delete();
      console.log('Old file deleted:', filePath);
    } catch (deleteErr) {
      console.log('Could not delete old file (may not exist):', deleteErr);
    }

    // 新しいファイルURLを構築
    const newFileUrl = `gs://${bucket.name}/${newFilePath}`;
    console.log('New file URL:', newFileUrl);

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

    await docRef.update({
      fileUrl: newFileUrl, // 新しいファイルURLに更新
      pageRotations: updatedRotations,
      rotatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Firestore updated');

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
