/**
 * OCR処理 Cloud Function（Firestoreトリガー版）
 *
 * トリガー: documents コレクションへの新規ドキュメント作成
 * 用途: 即時OCR処理（メイン処理パス）
 *
 * 処理フロー:
 * 1. status: pending のドキュメント作成を検知
 * 2. 排他制御（status: processingに更新）
 * 3. 共通OCR処理を呼び出し
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { trackGeminiUsage } from '../utils/rateLimiter';
import { logError } from '../utils/errorLogger';
import {
  tryStartProcessing,
  processDocument,
  handleProcessingError,
} from './ocrProcessor';

const FUNCTION_NAME = 'processOCROnCreate';

/**
 * Firestoreトリガー: documents作成時に即座にOCR処理
 */
export const processOCROnCreate = onDocumentCreated(
  {
    document: 'documents/{docId}',
    region: 'asia-northeast1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (event) => {
    const docId = event.params.docId;
    const docData = event.data?.data();

    if (!docData) {
      console.log(`Document ${docId} has no data, skipping`);
      return;
    }

    const status = docData.status;

    // pending以外は処理しない
    if (status !== 'pending') {
      console.log(`Document ${docId} is not pending (status: ${status}), skipping`);
      return;
    }

    console.log(`Processing document on create: ${docId}`);

    try {
      // 排他制御: 既に処理中ならスキップ
      const acquired = await tryStartProcessing(docId);
      if (!acquired) {
        console.log(`Document ${docId} already being processed, skipping`);
        return;
      }

      // OCR処理実行
      const result = await processDocument(docId, docData, FUNCTION_NAME);

      // 使用量を追跡
      if (result.inputTokens > 0 || result.outputTokens > 0) {
        await trackGeminiUsage(result.inputTokens, result.outputTokens);
      }

      console.log(`Document ${docId} processed successfully via trigger`, {
        pagesProcessed: result.pagesProcessed,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`Error processing document ${docId}:`, err.message);

      await handleProcessingError(docId, err, FUNCTION_NAME);

      await logError({
        error: err,
        source: 'ocr',
        functionName: FUNCTION_NAME,
        documentId: docId,
      });
    }
  }
);
