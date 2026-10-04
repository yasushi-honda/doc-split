/**
 * AI要約の手動依頼
 *
 * 既存ドキュメントのAI要約を「作る/作り直す」依頼を受け付けるCallable関数。
 *
 * PR-C(2026-10-04、「要約は手動を基本・自動は見送り」)で、同期生成(Gemini固定、60秒以内)から
 * 「キューへの登録だけ」に変えた。生成そのものは`generateSummaryBatch`が1分ごとに直列で実行し、
 * 画面はFirestoreの更新で完了を知る(Sarashinaはコールドスタートを含め数分かかり、onCallの
 * 同期処理では収まらない。また同時実行1のため、生成の入口をバッチ1本に絞る必要がある)。
 * 登録の詳細・ゲート(L1/L2)・冪等性は`summaryManualRequest.ts`を参照。
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { GCP_CONFIG } from '../utils/config';
import { safeLogError } from '../utils/errorLogger';
import { enqueueManualSummary, ManualSummaryRejectedError } from './summaryManualRequest';

const LOCATION = GCP_CONFIG.location;

const db = admin.firestore();

interface RegenerateSummaryRequest {
  docId: string;
}

/**
 * AI要約を依頼する(登録のみ。生成は完了を待たない)
 */
export const regenerateSummary = functions.https.onCall(
  {
    region: LOCATION,
    memory: '256MiB',
    timeoutSeconds: 30,
    cors: true,
  },
  async (request) => {
    // 認証チェック
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', '認証が必要です');
    }
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('permission-denied', 'User not in whitelist');
    }

    const { docId } = request.data as RegenerateSummaryRequest;

    if (!docId) {
      throw new functions.https.HttpsError('invalid-argument', 'docIdが必要です');
    }

    // 拒否理由のメッセージはPIIを含まない固定文(画面にそのまま表示される、callFunction.ts)。
    try {
      const { alreadyQueued } = await enqueueManualSummary({ firestore: db, docId });
      return { success: true, queued: true, alreadyQueued };
    } catch (error) {
      if (error instanceof ManualSummaryRejectedError) {
        throw new functions.https.HttpsError(error.reason === 'not-found' ? 'not-found' : 'failed-precondition', error.message);
      }
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Failed to enqueue manual summary:', err);
      await safeLogError({ error: err, source: 'ocr', functionName: 'regenerateSummary', documentId: docId });
      throw err;
    }
  }
);
