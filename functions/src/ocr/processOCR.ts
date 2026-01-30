/**
 * OCR処理 Cloud Function
 *
 * トリガー: Cloud Scheduler（1分間隔）
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
  extractDocumentTypeEnhanced,
  extractCustomerCandidates,
  extractOfficeNameEnhanced,
  extractOfficeCandidates,
  extractDateEnhanced,
  extractFilenameInfo,
  normalizeForMatching,
  CustomerMaster,
  DocumentMaster,
  OfficeMaster,
} from '../utils/extractors';

const db = admin.firestore();
const storage = admin.storage();

// Vertex AI設定
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'asia-northeast1';
const MODEL_ID = 'gemini-2.5-flash';

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
    schedule: 'every 1 minutes',
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

  // マスターデータを型付きで変換
  const docMasterData: DocumentMaster[] = documentMasters.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    category: d.data().category as string | undefined,
    keywords: d.data().keywords as string[] | undefined,
  }));

  const custMasterData: CustomerMaster[] = customerMasters.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    furigana: d.data().furigana as string | undefined,
    isDuplicate: d.data().isDuplicate as boolean | undefined,
    careManagerName: d.data().careManagerName as string | undefined,
    notes: d.data().notes as string | undefined,
  }));

  const officeMasterData: OfficeMaster[] = officeMasters.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    shortName: d.data().shortName as string | undefined,
    isDuplicate: d.data().isDuplicate as boolean | undefined,
    notes: d.data().notes as string | undefined,
  }));

  // 情報抽出（強化版エクストラクター使用）
  const documentTypeResult = extractDocumentTypeEnhanced(ocrResult, docMasterData);
  const customerResult = extractCustomerCandidates(ocrResult, custMasterData);

  // ファイル名から事業所情報を抽出（OCRマッチング精度向上のため）
  const fileName = docData.fileName as string | undefined;
  const filenameInfo = fileName ? extractFilenameInfo(fileName) : undefined;
  console.log(`Filename info: ${JSON.stringify(filenameInfo)}`);

  // 事業所候補抽出（同名対応 + ファイル名参照）
  const officeResult = extractOfficeCandidates(ocrResult, officeMasterData, { filenameInfo });
  // 後方互換: 単一事業所抽出（extractionScores用）
  const officeResultLegacy = extractOfficeNameEnhanced(ocrResult, officeMasterData);

  // ファイル名からの事業所登録提案
  // 条件: ファイル名が事業所名タイプ + OCRテキストにも存在 + マスター未登録
  let suggestedNewOffice: string | null = null;
  if (filenameInfo?.prefixType === 'office_name' && filenameInfo.normalizedPrefix) {
    const ocrTextNormalized = normalizeForMatching(ocrResult);
    const existsInOcrText = ocrTextNormalized.includes(filenameInfo.normalizedPrefix);
    const noGoodMatch = !officeResult.bestMatch || officeResult.bestMatch.score < 80;

    if (existsInOcrText && noGoodMatch) {
      suggestedNewOffice = filenameInfo.prefix;
      console.log(`Suggested new office from filename: ${suggestedNewOffice}`);
    }
  }

  // 日付抽出（書類マスターの dateMarker を使用）
  const matchedDocMaster = documentMasters.docs.find((d) => d.data().name === documentTypeResult.documentType);
  const dateMarker = matchedDocMaster?.data().dateMarker as string | undefined;
  const dateResult = extractDateEnhanced(ocrResult, dateMarker);

  // OCR結果が長い場合はCloud Storageに保存
  let ocrResultUrl: string | null = null;
  let savedOcrResult = ocrResult;

  if (ocrResult.length > OCR_RESULT_MAX_LENGTH) {
    ocrResultUrl = await saveOcrResult(docId, ocrResult);
    savedOcrResult = ''; // Firestoreには保存しない
  }

  // 顧客候補リスト（最大5件）
  const customerCandidateNames = customerResult.candidates
    .slice(0, 5)
    .map((c) => c.name);

  // ドキュメント更新
  await db.doc(`documents/${docId}`).update({
    ocrResult: savedOcrResult,
    ocrResultUrl,
    // ページごとのOCR結果（PDF分割時の自動検出で使用）
    pageResults,
    documentType: documentTypeResult.documentType || '未判定',
    customerName: customerResult.bestMatch?.name || '不明顧客',
    customerId: customerResult.bestMatch?.id || null,
    // 顧客に紐づくケアマネを設定
    careManager: customerResult.bestMatch?.careManagerName || null,
    officeName: officeResult.bestMatch?.name || '未判定',
    officeId: officeResult.bestMatch?.id || null,
    fileDate: dateResult.date || null,
    fileDateFormatted: dateResult.formattedDate || null,
    isDuplicateCustomer: customerResult.bestMatch?.isDuplicate || false,
    needsManualCustomerSelection: customerResult.needsManualSelection,
    // Phase 7: 顧客確定フィールド
    customerConfirmed: !customerResult.needsManualSelection,
    confirmedBy: null,   // システム自動処理のためnull
    confirmedAt: null,   // システム自動処理のためnull
    allCustomerCandidates: customerCandidateNames.join(','),
    // Phase 7: customerCandidates 新スキーマ
    customerCandidates: customerResult.candidates.slice(0, 5).map((c) => ({
      customerId: c.id,
      customerName: c.name,
      isDuplicate: c.isDuplicate || false,
      score: c.score,
      matchType: c.matchType,
      careManagerName: c.careManagerName || null,
    })),
    // 事業所確定フィールド
    officeConfirmed: !officeResult.needsManualSelection,
    officeConfirmedBy: null,   // システム自動処理のためnull
    officeConfirmedAt: null,   // システム自動処理のためnull
    // officeCandidates 新スキーマ
    officeCandidates: officeResult.candidates.slice(0, 5).map((o) => ({
      officeId: o.id,
      officeName: o.name,
      shortName: o.shortName,
      isDuplicate: o.isDuplicate || false,
      score: o.score,
      matchType: o.matchType,
    })),
    // ファイル名から抽出された事業所名（マスター未登録時の登録提案用）
    suggestedNewOffice,
    totalPages,
    category: documentTypeResult.category || null,
    status: 'processed',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    // 詳細情報（強化版）
    extractionScores: {
      documentType: documentTypeResult.score,
      customerName: customerResult.bestMatch?.score || 0,
      officeName: officeResultLegacy.score,
      date: dateResult.confidence,
    },
    extractionDetails: {
      documentMatchType: documentTypeResult.matchType,
      documentKeywords: documentTypeResult.keywords,
      customerMatchType: customerResult.bestMatch?.matchType || 'none',
      officeMatchType: officeResultLegacy.matchType,
      datePattern: dateResult.pattern,
      dateSource: dateResult.source,
    },
    // Phase 9: OCR抽出スナップショット（正解フィードバック用）
    ocrExtraction: {
      version: MODEL_ID,  // "gemini-2.5-flash"
      extractedAt: admin.firestore.FieldValue.serverTimestamp(),
      customer: {
        suggestedValue: customerResult.bestMatch?.name || '不明顧客',
        suggestedId: customerResult.bestMatch?.id || null,
        confidence: customerResult.bestMatch?.score || 0,
        matchType: customerResult.bestMatch?.matchType || 'none',
      },
      office: {
        suggestedValue: officeResult.bestMatch?.name || '未判定',
        suggestedId: officeResult.bestMatch?.id || null,
        confidence: officeResult.bestMatch?.score || 0,
        matchType: officeResult.bestMatch?.matchType || 'none',
      },
      documentType: {
        suggestedValue: documentTypeResult.documentType || '未判定',
        suggestedId: null,  // 書類種別はID不要
        confidence: documentTypeResult.score,
        matchType: documentTypeResult.matchType,
      },
    },
  });

  console.log(`Document ${docId} processed: ${documentTypeResult.documentType}, ${customerResult.bestMatch?.name || '不明'}`);

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
