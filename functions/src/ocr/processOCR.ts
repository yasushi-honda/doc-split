/**
 * OCR処理 Cloud Function（メイン処理パス）
 *
 * トリガー: Cloud Scheduler（1分間隔）
 * 用途: OCR処理の唯一のエントリーポイント（ADR-0010）
 *
 * 処理フロー:
 * 1. Firestore → status: pending のドキュメントを取得
 * 2. processing状態で長時間スタックしたドキュメントを救済
 * 3. 排他制御（status: processingに更新）
 * 4. 共通OCR処理を呼び出し
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { trackGeminiUsage } from '../utils/rateLimiter';
import { logError, safeLogError } from '../utils/errorLogger';
import {
  tryStartProcessing,
  processDocument,
  handleProcessingError,
  OcrProcessingResult,
} from './ocrProcessor';
// 定数は side-effect-free な constants.ts から import (#196 test drift 防止)
import {
  MAX_RETRY_COUNT,
  STUCK_RESCUE_RETRY_AFTER_MS,
  STUCK_PROCESSING_THRESHOLD_MS,
  STUCK_RESCUE_PENDING_MESSAGE,
  STUCK_RESCUE_FATAL_MESSAGE_PREFIX,
} from './constants';

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
 * 定期実行: pending状態のドキュメントをOCR処理（メイン処理パス）
 *
 * processOCROnCreate廃止後の唯一のOCR処理エントリーポイント。
 * processing状態で長時間スタックしたドキュメントも救済する。
 */
export const processOCR = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'asia-northeast1',
    timeoutSeconds: 540,
    memory: '1GiB',
    maxInstances: 1,
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
      // processing状態で長時間スタックしたドキュメントを救済
      await rescueStuckProcessingDocs();

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
        const data = docSnapshot.data();

        // retryAfter未到達のドキュメントはスキップ（配額リセット待ち）
        const retryAfter = data.retryAfter?.toMillis?.() || 0;
        if (retryAfter > Date.now()) {
          console.log(`Skipping ${docId}: retryAfter not reached (${new Date(retryAfter).toISOString()})`);
          stats.skipped++;
          continue;
        }

        // ドキュメント間遅延（Vertex AI配額消費を分散）
        if (stats.documentsProcessed > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

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
            data,
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

/**
 * processing状態で長時間スタックしたドキュメントをpendingに戻す
 *
 * Functionタイムアウト（540秒）等でprocessing状態のまま放置されたドキュメントを救済。
 * updatedAtが10分以上前のprocessingドキュメントを対象とする。
 *
 * #360: per-doc を runTransaction 化して handleProcessingError と整合させ、
 * per-doc catch でも safeLogError を呼んで silent failure を観測可能にする。
 * integration test から直接呼び出すため export している (AC2/AC3/AC4 検証に必要)。
 */
export async function rescueStuckProcessingDocs(): Promise<void> {
  const threshold = new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS);

  const stuckDocs = await db
    .collection('documents')
    .where('status', '==', 'processing')
    .where('updatedAt', '<', admin.firestore.Timestamp.fromDate(threshold))
    .limit(BATCH_SIZE)
    .get();

  if (stuckDocs.empty) return;

  console.log(`Found ${stuckDocs.size} stuck processing documents, resetting to pending`);

  // per-doc 逐次処理: 並列化は runTransaction optimistic retry を誘発する上、
  // BATCH_SIZE=5 では全体 ~1s 未満で cron 間隔 60s に対し無視できる。
  // ループ内の各 await には個別に eslint-disable を付けている。
  for (const docSnapshot of stuckDocs.docs) {
    const docId = docSnapshot.id;
    const docRef = db.doc(`documents/${docId}`);

    try {
      // maxInstances=1 現状でも tx で retryCount を最新値から読む必要がある:
      // rescue 実行中に handleProcessingError が同一 doc を更新するケースで、
      // stale な retryCount を元に +1 すると MAX_RETRY_COUNT check が off-by-one で超過可能。
      // eslint-disable-next-line no-await-in-loop
      const fatalReached = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(docRef);
        const currentRetryCount = (fresh.data()?.retryCount as number) || 0;
        const newRetryCount = currentRetryCount + 1;

        if (newRetryCount >= MAX_RETRY_COUNT) {
          // #196: 無制限 pending 復帰で rescue ループが止まらなかった問題を MAX 到達で error 確定。
          // 古い retryAfter は fix-stuck-documents --include-errors で復帰時の即スキップを招くため delete。
          tx.update(docRef, {
            status: 'error',
            retryCount: newRetryCount,
            retryAfter: admin.firestore.FieldValue.delete(),
            lastErrorMessage: `${STUCK_RESCUE_FATAL_MESSAGE_PREFIX} (${newRetryCount}/${MAX_RETRY_COUNT})`,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return true;
        }
        // retryAfter を設定しないと 429 救済直後に再処理されて連鎖する (#196)。
        tx.update(docRef, {
          status: 'pending',
          retryCount: newRetryCount,
          retryAfter: admin.firestore.Timestamp.fromMillis(Date.now() + STUCK_RESCUE_RETRY_AFTER_MS),
          lastErrorMessage: STUCK_RESCUE_PENDING_MESSAGE,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return false;
      });

      if (fatalReached) {
        console.error(`Marked stuck document ${docId} as error (>= ${MAX_RETRY_COUNT} retries)`);
        // #196 silent-failure-hunter C1: errors/ に記録しないと ErrorsPage から不可視。
        // rules/error-handling.md 「状態復旧 > ログ記録」順で tx commit 後に呼ぶ。
        // #360 silent-failure-hunter I1: この safeLogError の失敗は outer catch に
        // 伝播させない。伝播すると outer catch 内の safeLogError が再度呼ばれ、
        // 同一 docId に対する errors/ 書き込みが重複する。
        try {
          // eslint-disable-next-line no-await-in-loop
          await safeLogError({
            error: new Error(`Rescue max retries exceeded for stuck processing > ${STUCK_PROCESSING_THRESHOLD_MS / 60000}min`),
            source: 'ocr',
            functionName: FUNCTION_NAME,
            documentId: docId,
          });
        } catch (logErr) {
          console.error(`safeLogError failed for ${docId} (fatal branch):`, logErr);
        }
      } else {
        console.log(`Reset stuck document ${docId} to pending (retryAfter: ${STUCK_RESCUE_RETRY_AFTER_MS / 1000}s)`);
      }
    } catch (err) {
      // #360 silent-failure-hunter I1: per-doc DB error を console.error のみで swallow すると
      // partial failure で残りドキュメントが silent に未処理になる。errors/ に記録で観測可能化。
      console.error(`Failed to reset stuck document ${docId}:`, err);
      // eslint-disable-next-line no-await-in-loop
      await safeLogError({
        error: err instanceof Error ? err : new Error(String(err)),
        source: 'ocr',
        functionName: FUNCTION_NAME,
        documentId: docId,
      });
    }
  }
}
