/**
 * OCR処理 Cloud Function
 *
 * トリガー: Cloud Scheduler（5分間隔）
 *
 * 処理フロー:
 * 1. Firestore → status: pending のドキュメントを取得
 * 2. Cloud Storage → ファイル取得
 * 3. PDF分割 (pdf-lib)
 * 4. Vertex AI Gemini 2.5 Flash → OCR
 * 5. 書類名・顧客名・事業所名抽出
 * 6. ファイルリネーム
 * 7. Firestore → documents記録
 * 8. エラー時 → errors記録
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { VertexAI } from '@google-cloud/vertexai';
import { PDFDocument } from 'pdf-lib';
import { withRetry, RETRY_CONFIGS } from '../utils/retry';
import { logError } from '../utils/errorLogger';
import { getRateLimiter, trackGeminiUsage } from '../utils/rateLimiter';
import {
  extractDocumentType,
  extractCustomerName,
  extractOfficeName,
  extractDate,
} from '../utils/similarity';

const db = admin.firestore();
const storage = admin.storage();

// Vertex AI設定
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'asia-northeast1';
const MODEL_ID = 'gemini-2.5-flash-preview-05-20';

const FUNCTION_NAME = 'processOCR';

// 定数
const BATCH_SIZE = 5; // 同時処理ドキュメント数
const OCR_RESULT_MAX_LENGTH = 100000; // Firestoreに直接保存する最大長

/** ページ単位OCR結果 */
interface PageOcrResult {
  pageNumber: number;
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** 処理統計 */
interface ProcessingStats {
  documentsProcessed: number;
  pagesProcessed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  errors: number;
}

/**
 * 定期実行: pending状態のドキュメントをOCR処理
 */
export const processOCR = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: 'asia-northeast1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async () => {
    console.log('Starting OCR processing...');
    const stats: ProcessingStats = {
      documentsProcessed: 0,
      pagesProcessed: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      errors: 0,
    };

    try {
      // pending状態のドキュメントを取得
      const pendingDocs = await db
        .collection('documents')
        .where('status', '==', 'pending')
        .orderBy('processedAt', 'asc')
        .limit(BATCH_SIZE)
        .get();

      console.log(`Found ${pendingDocs.size} pending documents`);

      for (const docSnapshot of pendingDocs.docs) {
        try {
          const result = await processDocument(docSnapshot.id, docSnapshot.data());
          stats.documentsProcessed++;
          stats.pagesProcessed += result.pagesProcessed;
          stats.totalInputTokens += result.inputTokens;
          stats.totalOutputTokens += result.outputTokens;
        } catch (error) {
          stats.errors++;
          const err = error instanceof Error ? error : new Error(String(error));
          console.error(`Error processing document ${docSnapshot.id}:`, err.message);

          await logError({
            error: err,
            source: 'ocr',
            functionName: FUNCTION_NAME,
            documentId: docSnapshot.id,
          });

          // ドキュメントをエラー状態に更新
          await db.doc(`documents/${docSnapshot.id}`).update({
            status: 'error',
            lastErrorMessage: err.message,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      // 使用量を追跡
      if (stats.totalInputTokens > 0 || stats.totalOutputTokens > 0) {
        await trackGeminiUsage(stats.totalInputTokens, stats.totalOutputTokens);
      }

      console.log('OCR processing completed', stats);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Fatal error in processOCR:', err.message);

      await logError({
        error: err,
        source: 'ocr',
        functionName: FUNCTION_NAME,
      });

      throw error;
    }
  }
);

/**
 * ドキュメントをOCR処理
 */
async function processDocument(
  docId: string,
  docData: FirebaseFirestore.DocumentData
): Promise<{ pagesProcessed: number; inputTokens: number; outputTokens: number }> {
  console.log(`Processing document: ${docId}`);

  // ステータスを processing に更新
  await db.doc(`documents/${docId}`).update({
    status: 'processing',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ファイル取得
  const fileUrl = docData.fileUrl as string;
  const bucket = storage.bucket();
  const filePath = fileUrl.replace(`gs://${bucket.name}/`, '');
  const file = bucket.file(filePath);

  const [buffer] = await withRetry(
    () => file.download(),
    RETRY_CONFIGS.storage
  );
  const mimeType = docData.mimeType as string;

  let pageResults: PageOcrResult[] = [];
  let totalPages = 1;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  if (mimeType === 'application/pdf') {
    // PDFの場合は各ページをOCR
    const pdfDoc = await PDFDocument.load(buffer);
    totalPages = pdfDoc.getPageCount();

    console.log(`PDF has ${totalPages} pages`);

    for (let i = 0; i < totalPages; i++) {
      const pageNumber = i + 1;
      console.log(`Processing page ${pageNumber}/${totalPages}`);

      const pageBuffer = await extractPdfPage(buffer, i);
      const result = await ocrWithGemini(pageBuffer, 'application/pdf', pageNumber);

      pageResults.push({
        pageNumber,
        text: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });

      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
    }
  } else {
    // 画像の場合は直接OCR
    const result = await ocrWithGemini(buffer, mimeType);
    pageResults.push({
      pageNumber: 1,
      text: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    totalInputTokens = result.inputTokens;
    totalOutputTokens = result.outputTokens;
  }

  // OCR結果を結合
  const ocrResult = pageResults
    .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
    .join('\n\n');

  // マスターデータ取得
  const [documentMasters, customerMasters, officeMasters] = await Promise.all([
    db.collection('masters/documents/items').get(),
    db.collection('masters/customers/items').get(),
    db.collection('masters/offices/items').get(),
  ]);

  // 情報抽出（類似度マッチング）
  const docMasterData = documentMasters.docs.map((d) => d.data() as { name: string; category?: string; dateMarker?: string });
  const custMasterData = customerMasters.docs.map((d) => d.data() as { name: string; isDuplicate?: boolean; furigana?: string });
  const officeMasterData = officeMasters.docs.map((d) => d.data() as { name: string });

  const documentTypeResult = extractDocumentType(ocrResult, docMasterData);
  const customerResult = extractCustomerName(ocrResult, custMasterData);
  const officeResult = extractOfficeName(ocrResult, officeMasterData);

  // 日付抽出（書類マスターの dateMarker を使用）
  const matchedDocMaster = docMasterData.find((d) => d.name === documentTypeResult.documentType);
  const fileDate = extractDate(ocrResult, matchedDocMaster?.dateMarker);

  // OCR結果が長い場合はCloud Storageに保存
  let ocrResultUrl: string | null = null;
  let savedOcrResult = ocrResult;

  if (ocrResult.length > OCR_RESULT_MAX_LENGTH) {
    ocrResultUrl = await saveOcrResult(docId, ocrResult);
    savedOcrResult = ''; // Firestoreには保存しない
  }

  // ドキュメント更新
  await db.doc(`documents/${docId}`).update({
    ocrResult: savedOcrResult,
    ocrResultUrl,
    documentType: documentTypeResult.documentType || '未判定',
    customerName: customerResult.customerName || '不明顧客',
    officeName: officeResult.officeName || '未判定',
    fileDate: fileDate || null,
    isDuplicateCustomer: customerResult.isDuplicate,
    allCustomerCandidates: customerResult.allCandidates.join(','),
    totalPages,
    category: documentTypeResult.category || null,
    status: 'processed',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    // 詳細情報
    extractionScores: {
      documentType: documentTypeResult.score,
      customerName: customerResult.score,
      officeName: officeResult.score,
    },
  });

  console.log(`Document ${docId} processed: ${documentTypeResult.documentType}, ${customerResult.customerName}`);

  return {
    pagesProcessed: totalPages,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}

/**
 * PDFから単一ページを抽出
 */
async function extractPdfPage(pdfBuffer: Buffer, pageIndex: number): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const newPdf = await PDFDocument.create();
  const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageIndex]);
  newPdf.addPage(copiedPage);
  const pdfBytes = await newPdf.save();
  return Buffer.from(pdfBytes);
}

/**
 * Gemini 2.5 FlashでOCR処理
 */
async function ocrWithGemini(
  buffer: Buffer,
  mimeType: string,
  pageNumber?: number
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const rateLimiter = getRateLimiter();

  // レート制限を待機
  await rateLimiter.acquire();

  const vertexai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  const model = vertexai.getGenerativeModel({ model: MODEL_ID });

  const base64Data = buffer.toString('base64');

  const prompt = `
この画像/PDFの内容をOCRしてください。

【指示】
- テキストをそのまま正確に抽出してください
- 表がある場合は、構造を保ってテキスト化してください
- 手書き文字も可能な限り読み取ってください
- 読み取れない部分は[判読不能]と記載してください
- 余計な説明は不要です。抽出したテキストのみを出力してください
${pageNumber ? `\nこれは${pageNumber}ページ目です。` : ''}
`;

  const response = await withRetry(
    async () => {
      return await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              { text: prompt },
            ],
          },
        ],
      });
    },
    RETRY_CONFIGS.gemini
  );

  const result = response.response;
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // トークン使用量を取得
  const usageMetadata = result.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;

  console.log(`OCR completed: ${text.length} chars, tokens: ${inputTokens}/${outputTokens}`);

  return { text, inputTokens, outputTokens };
}

/**
 * 長いOCR結果をCloud Storageに保存
 */
async function saveOcrResult(docId: string, ocrResult: string): Promise<string> {
  const bucket = storage.bucket();
  const file = bucket.file(`ocr-results/${docId}.txt`);

  await withRetry(
    () =>
      file.save(ocrResult, {
        contentType: 'text/plain; charset=utf-8',
        metadata: {
          documentId: docId,
          createdAt: new Date().toISOString(),
        },
      }),
    RETRY_CONFIGS.storage
  );

  return `gs://${bucket.name}/ocr-results/${docId}.txt`;
}
