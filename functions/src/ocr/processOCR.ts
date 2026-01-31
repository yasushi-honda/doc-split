/**
 * OCR処理 Cloud Function（ポーリング版）
 *
 * トリガー: Cloud Scheduler（1分間隔）
 * 用途: Firestoreトリガーのリカバリー網として機能
 *
 * 処理フロー:
 * 1. Firestore → status: pending のドキュメントを取得
 * 2. 排他制御（status: processingに更新）
 * 3. 共通OCR処理を呼び出し
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { trackGeminiUsage } from '../utils/rateLimiter';
import { logError } from '../utils/errorLogger';
import {
  tryStartProcessing,
  processDocument,
  handleProcessingError,
  OcrProcessingResult,
} from './ocrProcessor';

const db = admin.firestore();

const FUNCTION_NAME = 'processOCR';
const BATCH_SIZE = 5;

/** 処理統計 */
interface ProcessingStats {
  documentsProcessed: number;
  pagesProcessed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  errors: number;
  skipped: number;
}

/**
 * 定期実行: pending状態のドキュメントをOCR処理
 * Firestoreトリガーのリカバリー網として機能
 */
export const processOCR = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'asia-northeast1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async () => {
    console.log('Starting OCR processing (polling)...');
    const stats: ProcessingStats = {
      documentsProcessed: 0,
      pagesProcessed: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      errors: 0,
      skipped: 0,
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
        const docId = docSnapshot.id;

        try {
          // 排他制御: 既に処理中ならスキップ
          const acquired = await tryStartProcessing(docId);
          if (!acquired) {
            stats.skipped++;
            continue;
          }

          // OCR処理実行
          const result: OcrProcessingResult = await processDocument(
            docId,
            docSnapshot.data(),
            FUNCTION_NAME
          );

          stats.documentsProcessed++;
          stats.pagesProcessed += result.pagesProcessed;
          stats.totalInputTokens += result.inputTokens;
          stats.totalOutputTokens += result.outputTokens;
        } catch (error) {
          stats.errors++;
          const err = error instanceof Error ? error : new Error(String(error));
          await handleProcessingError(docId, err, FUNCTION_NAME);
        }
      }

      // 使用量を追跡
      if (stats.totalInputTokens > 0 || stats.totalOutputTokens > 0) {
        await trackGeminiUsage(stats.totalInputTokens, stats.totalOutputTokens);
      }

      console.log('OCR processing (polling) completed', stats);
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
