/**
 * OCR処理 Cloud Function
 *
 * トリガー: Cloud Scheduler（checkGmailAttachments後に実行）
 *          または Pub/Sub（ocr-queue）
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

const db = admin.firestore();
const storage = admin.storage();

// Vertex AI設定
const PROJECT_ID = process.env.GCLOUD_PROJECT || '';
const LOCATION = 'asia-northeast1';
const MODEL_ID = 'gemini-2.5-flash';

// 定数
const DOCUMENT_NAME_SEARCH_RANGE_CHARS = 200;

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

    try {
      // pending状態のドキュメントを取得（最大10件）
      const pendingDocs = await db
        .collection('documents')
        .where('status', '==', 'pending')
        .orderBy('processedAt', 'asc')
        .limit(10)
        .get();

      console.log(`Found ${pendingDocs.size} pending documents`);

      for (const docSnapshot of pendingDocs.docs) {
        try {
          await processDocument(docSnapshot.id, docSnapshot.data());
        } catch (error) {
          console.error(`Error processing document ${docSnapshot.id}:`, error);
          await recordError(docSnapshot.id, docSnapshot.data(), error);
        }
      }

      console.log('OCR processing completed');
    } catch (error) {
      console.error('Error in processOCR:', error);
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
): Promise<void> {
  console.log(`Processing document: ${docId}`);

  // ステータスを processing に更新
  await db.doc(`documents/${docId}`).update({ status: 'processing' });

  // ファイル取得
  const fileUrl = docData.fileUrl as string;
  const bucket = storage.bucket();
  const filePath = fileUrl.replace(`gs://${bucket.name}/`, '');
  const file = bucket.file(filePath);

  const [buffer] = await file.download();
  const mimeType = docData.mimeType as string;

  let ocrResult = '';
  let totalPages = 1;

  if (mimeType === 'application/pdf') {
    // PDFの場合は分割してOCR
    const pdfDoc = await PDFDocument.load(buffer);
    totalPages = pdfDoc.getPageCount();

    const results: string[] = [];
    for (let i = 0; i < totalPages; i++) {
      const pageResult = await ocrWithGemini(buffer, mimeType, i + 1);
      results.push(`--- Page ${i + 1} ---\n${pageResult}`);
    }
    ocrResult = results.join('\n\n');
  } else {
    // 画像の場合は直接OCR
    ocrResult = await ocrWithGemini(buffer, mimeType);
  }

  // マスターデータ取得
  const [documentMasters, customerMasters, officeMasters] = await Promise.all([
    db.collection('masters/documents/items').get(),
    db.collection('masters/customers/items').get(),
    db.collection('masters/offices/items').get(),
  ]);

  // 情報抽出
  const documentType = extractDocumentType(
    ocrResult,
    documentMasters.docs.map((d) => d.data())
  );
  const { customerName, isDuplicate } = extractCustomerName(
    ocrResult,
    customerMasters.docs.map((d) => d.data())
  );
  const officeName = extractOfficeName(
    ocrResult,
    officeMasters.docs.map((d) => d.data())
  );
  const fileDate = extractDate(ocrResult, documentType, documentMasters);

  // ドキュメント更新
  await db.doc(`documents/${docId}`).update({
    ocrResult: ocrResult.length > 100000 ? '' : ocrResult, // 長い場合は別途保存
    ocrResultUrl:
      ocrResult.length > 100000
        ? await saveOcrResult(docId, ocrResult)
        : null,
    documentType: documentType || '未判定',
    customerName: customerName || '不明顧客',
    officeName: officeName || '未判定',
    fileDate: fileDate || null,
    isDuplicateCustomer: isDuplicate,
    totalPages,
    status: 'processed',
  });

  console.log(`Document ${docId} processed successfully`);
}

/**
 * Gemini 2.5 FlashでOCR処理
 */
async function ocrWithGemini(
  buffer: Buffer,
  mimeType: string,
  pageNumber?: number
): Promise<string> {
  const vertexai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  const model = vertexai.getGenerativeModel({ model: MODEL_ID });

  const base64Data = buffer.toString('base64');

  const prompt = `
この画像/PDFの内容をOCRしてください。
- テキストをそのまま抽出してください
- 表がある場合は、構造を保ってテキスト化してください
- 読み取れない部分は[判読不能]と記載してください
${pageNumber ? `- これは${pageNumber}ページ目です` : ''}
`;

  const response = await model.generateContent({
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

  const result = response.response;
  return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * 書類名を抽出
 */
function extractDocumentType(
  ocrResult: string,
  masters: FirebaseFirestore.DocumentData[]
): string | null {
  const searchText = ocrResult.slice(0, DOCUMENT_NAME_SEARCH_RANGE_CHARS);

  for (const master of masters) {
    if (searchText.includes(master.name)) {
      return master.name;
    }
  }

  return null;
}

/**
 * 顧客名を抽出
 */
function extractCustomerName(
  ocrResult: string,
  masters: FirebaseFirestore.DocumentData[]
): { customerName: string | null; isDuplicate: boolean } {
  // 類似度マッチング（簡易版）
  for (const master of masters) {
    if (ocrResult.includes(master.name)) {
      return {
        customerName: master.name,
        isDuplicate: master.isDuplicate || false,
      };
    }
  }

  return { customerName: null, isDuplicate: false };
}

/**
 * 事業所名を抽出
 */
function extractOfficeName(
  ocrResult: string,
  masters: FirebaseFirestore.DocumentData[]
): string | null {
  for (const master of masters) {
    if (ocrResult.includes(master.name)) {
      return master.name;
    }
  }

  return null;
}

/**
 * 日付を抽出
 */
function extractDate(
  ocrResult: string,
  documentType: string | null,
  documentMasters: FirebaseFirestore.QuerySnapshot
): Date | null {
  // 書類マスターから日付マーカーを取得
  const masterDoc = documentMasters.docs.find(
    (d) => d.data().name === documentType
  );
  const dateMarker = masterDoc?.data()?.dateMarker;

  if (dateMarker) {
    const markerIndex = ocrResult.indexOf(dateMarker);
    if (markerIndex !== -1) {
      const searchArea = ocrResult.slice(markerIndex, markerIndex + 50);
      const dateMatch = searchArea.match(
        /(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/
      );
      if (dateMatch) {
        return new Date(
          parseInt(dateMatch[1]!),
          parseInt(dateMatch[2]!) - 1,
          parseInt(dateMatch[3]!)
        );
      }
    }
  }

  // 一般的な日付パターンを検索
  const dateMatch = ocrResult.match(
    /(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/
  );
  if (dateMatch) {
    return new Date(
      parseInt(dateMatch[1]!),
      parseInt(dateMatch[2]!) - 1,
      parseInt(dateMatch[3]!)
    );
  }

  return null;
}

/**
 * 長いOCR結果をCloud Storageに保存
 */
async function saveOcrResult(docId: string, ocrResult: string): Promise<string> {
  const bucket = storage.bucket();
  const file = bucket.file(`ocr-results/${docId}.txt`);
  await file.save(ocrResult, { contentType: 'text/plain' });
  return `gs://${bucket.name}/ocr-results/${docId}.txt`;
}

/**
 * エラーを記録
 */
async function recordError(
  docId: string,
  docData: FirebaseFirestore.DocumentData,
  error: unknown
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  await db.collection('errors').add({
    errorDate: admin.firestore.FieldValue.serverTimestamp(),
    errorType: 'システムエラー',
    fileName: docData.fileName,
    fileId: docId,
    totalPages: docData.totalPages || 0,
    successPages: 0,
    failedPages: docData.totalPages || 0,
    failedPageNumbers: [],
    errorDetails: errorMessage,
    fileUrl: docData.fileUrl,
    status: '未対応',
  });

  await db.doc(`documents/${docId}`).update({ status: 'error' });
}
