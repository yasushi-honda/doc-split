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
import { isQuotaErrorMessage } from '../utils/retry';
import { logError, safeLogError } from '../utils/errorLogger';
import {
  tryStartProcessing,
  processDocument,
  handleProcessingError,
  OcrProcessingResult,
} from './ocrProcessor';
import { OcrRunSupersededError } from './ocrRunGuard';
// 定数は side-effect-free な constants.ts から import (#196 test drift 防止)
import {
  MAX_RETRY_COUNT,
  STUCK_RESCUE_RETRY_AFTER_MS,
  STUCK_PROCESSING_THRESHOLD_MS,
  STUCK_RESCUE_PENDING_MESSAGE,
  STUCK_RESCUE_FATAL_MESSAGE_PREFIX,
  ERROR_RESCUE_THRESHOLD_MS,
  ERROR_RESCUE_RETRY_AFTER_MS,
  ERROR_RESCUE_SCAN_INTERVAL_MS,
  MAX_ERROR_RESCUE_COUNT,
  RESCUE_STATE_DOC_PATH,
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
  totalThinkingTokens: number;
  errors: number;
  skipped: number;
  /** OCR run が別の実行に所有権を奪われた/入力世代が変わったためabortした件数 (Issue #540) */
  superseded: number;
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
      totalThinkingTokens: 0,
      errors: 0,
      skipped: 0,
      superseded: 0,
    };

    try {
      // processing状態で長時間スタックしたドキュメントを救済
      await rescueStuckProcessingDocs();

      // 429 系 error 状態 doc を 1 時間ごとに rescue (backstop)
      // 主防御は handleProcessingError 内の 429 専用 retry policy。本 rescue は保険。
      await rescueErroredDocumentsIfDue();

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

        // 排他制御: 既に処理中ならスキップ。claim transaction内で読んだ最新dataとocrRunIdを
        // 受け取り、以降はポーリング時点の`data`ではなく`claimedData`を使う
        // (Issue #540 H1: pending一覧取得からclaim成立までの間隔でfileUrl等が変化していても
        // 最終チェックがclaim時点の実態と整合するようにする)。
        const claim = await tryStartProcessing(docId);
        if (!claim) {
          stats.skipped++;
          continue;
        }
        const { ocrRunId, docData: claimedData } = claim;

        try {
          // OCR処理実行
          const result: OcrProcessingResult = await processDocument(
            docId,
            claimedData,
            FUNCTION_NAME,
            ocrRunId
          );

          stats.documentsProcessed++;
          stats.pagesProcessed += result.pagesProcessed;
          stats.totalInputTokens += result.inputTokens;
          stats.totalOutputTokens += result.outputTokens;
          stats.totalThinkingTokens += result.thinkingTokens;
        } catch (error) {
          if (error instanceof OcrRunSupersededError) {
            // Issue #540: 別の実行に所有権が移った/入力世代が変わったための正常なabort。
            // retryCountを消費せずstatus:'error'化もしない。既に消費済みのGemini使用量は
            // コスト計測(trackGeminiUsage)から漏れないようstatsへ加算する。
            stats.superseded++;
            if (error.tokenUsage) {
              stats.pagesProcessed += error.tokenUsage.pagesProcessed;
              stats.totalInputTokens += error.tokenUsage.inputTokens;
              stats.totalOutputTokens += error.tokenUsage.outputTokens;
              stats.totalThinkingTokens += error.tokenUsage.thinkingTokens;
            }
            console.log(
              `Document ${docId} OCR run superseded (reason: ${error.reason}), skipping`
            );
            continue;
          }
          stats.errors++;
          const err = error instanceof Error ? error : new Error(String(error));
          await handleProcessingError(docId, err, FUNCTION_NAME, ocrRunId);
        }
      }

      // 使用量を追跡 (PR#550レビュー指摘: thinkingTokensのみ非ゼロのレアケースも計測対象に含める)
      if (
        stats.totalInputTokens > 0 ||
        stats.totalOutputTokens > 0 ||
        stats.totalThinkingTokens > 0
      ) {
        await trackGeminiUsage(
          stats.totalInputTokens,
          stats.totalOutputTokens,
          stats.totalThinkingTokens,
          'ocr'
        );
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

/**
 * processOCR scheduler の冒頭で呼び出す interval ガード。
 *
 * `meta/ocrRescueState` doc の lastErrorRescueAt を参照し、
 * `ERROR_RESCUE_SCAN_INTERVAL_MS` (1 時間) 経過時のみ scan 実行 + timestamp 更新。
 * 1 min cadence の processOCR で毎回 scan を走らせる過剰実行を防止。
 *
 * doc 不在 (初回起動) の場合は即時 scan、その後 timestamp 書き込み。
 *
 * NOTE: `processOCR` の `maxInstances: 1` を前提に non-transactional な read-then-write
 * で実装している。`maxInstances` を 2+ に変更する場合は state read/write を transaction
 * 化して並列 instance の同時 scan を防ぐこと (現状の実装では同時 scan が稀に発生しうる)。
 */
export async function rescueErroredDocumentsIfDue(): Promise<void> {
  const stateRef = db.doc(RESCUE_STATE_DOC_PATH);
  const stateSnap = await stateRef.get();
  const lastAt = (stateSnap.data()?.lastErrorRescueAt as admin.firestore.Timestamp | undefined)
    ?.toMillis?.();
  const now = Date.now();

  if (lastAt && now - lastAt < ERROR_RESCUE_SCAN_INTERVAL_MS) {
    return; // interval 未到達 → skip
  }

  try {
    await rescueErroredDocuments();
  } finally {
    // scan 失敗時も次回再試行を 1 時間後にずらす (storm 回避)。
    // 失敗を完全に隠さないよう内側で catch しない。
    await stateRef.set(
      { lastErrorRescueAt: admin.firestore.Timestamp.fromMillis(now) },
      { merge: true }
    );
  }
}

/**
 * 429 系 error 状態の doc を pending に戻す (backstop)。
 *
 * 主防御 (handleProcessingError 内の 429 専用 retry policy) を逃れて error 確定した doc を救済。
 * - 条件: status='error' AND updatedAt < (now - 1h) AND lastErrorMessage に 429 系キーワード AND errorRescueCount < 3
 * - 動作: status='pending', retryCount=0 リセット, retryAfter=now+10min, errorRescueCount++
 * - 永続ループ防止: errorRescueCount >= MAX_ERROR_RESCUE_COUNT で対象外 (手動介入)
 *
 * integration test から直接呼び出すため export している。
 */
export async function rescueErroredDocuments(): Promise<void> {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - ERROR_RESCUE_THRESHOLD_MS);

  const erroredDocs = await db
    .collection('documents')
    .where('status', '==', 'error')
    .where('updatedAt', '<', cutoff)
    .limit(BATCH_SIZE * 2) // 1 時間ごとなので多めに拾う
    .get();

  if (erroredDocs.empty) return;

  console.log(`Found ${erroredDocs.size} errored documents to evaluate for rescue`);

  let rescuedCount = 0;
  let skippedNon429 = 0;
  let skippedMaxRescue = 0;

  for (const docSnapshot of erroredDocs.docs) {
    const docId = docSnapshot.id;
    const data = docSnapshot.data();

    if (!isQuotaErrorMessage(data.lastErrorMessage as string | null | undefined)) {
      skippedNon429++;
      continue;
    }

    const rescueCount = (data.errorRescueCount as number) || 0;
    if (rescueCount >= MAX_ERROR_RESCUE_COUNT) {
      skippedMaxRescue++;
      continue;
    }

    const docRef = db.doc(`documents/${docId}`);
    try {
      // eslint-disable-next-line no-await-in-loop
      const rescued = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(docRef);
        const freshData = fresh.data();
        // 並列で他 worker が status を変えた場合は no-op (race condition 対策)
        if (freshData?.status !== 'error') return false;
        const currentRescueCount = (freshData?.errorRescueCount as number) || 0;
        if (currentRescueCount >= MAX_ERROR_RESCUE_COUNT) return false;

        tx.update(docRef, {
          status: 'pending',
          retryCount: 0,
          retryAfter: admin.firestore.Timestamp.fromMillis(
            Date.now() + ERROR_RESCUE_RETRY_AFTER_MS
          ),
          errorRescueCount: currentRescueCount + 1,
          lastRescuedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });

      if (rescued) {
        rescuedCount++;
        console.log(
          `Rescued errored ${docId} (rescueCount: ${rescueCount + 1}/${MAX_ERROR_RESCUE_COUNT}, ` +
            `retryAfter: ${ERROR_RESCUE_RETRY_AFTER_MS / 60000}min)`
        );
      }
    } catch (err) {
      console.error(`Failed to rescue errored document ${docId}:`, err);
      // eslint-disable-next-line no-await-in-loop
      await safeLogError({
        error: err instanceof Error ? err : new Error(String(err)),
        source: 'ocr',
        functionName: FUNCTION_NAME,
        documentId: docId,
      });
    }
  }

  console.log(
    `Error rescue summary: rescued=${rescuedCount}, skipped_non429=${skippedNon429}, ` +
      `skipped_max_rescue=${skippedMaxRescue}`
  );
}
