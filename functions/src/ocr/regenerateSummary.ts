/**
 * AI要約の再生成
 *
 * 既存ドキュメントに対してAI要約を再生成するCallable関数。
 * Issue #214 で Vertex AI 呼び出しロジックは summaryGenerator.generateSummaryCore に集約。
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { GCP_CONFIG } from '../utils/config';
import type { CappedText } from '../utils/pageTextCap';
import { buildSummaryFields } from './summaryRequestBuilder';
import {
  generateSummaryCore,
  MIN_OCR_LENGTH_FOR_SUMMARY,
  DEFAULT_DOCUMENT_TYPE_LABEL,
} from './summaryGenerator';

const LOCATION = GCP_CONFIG.location;

const db = admin.firestore();

interface RegenerateSummaryRequest {
  docId: string;
}

/**
 * AI要約を再生成
 */
export const regenerateSummary = functions.https.onCall(
  {
    region: LOCATION,
    memory: '512MiB',
    timeoutSeconds: 60,
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

    // ドキュメント取得
    const docRef = db.doc(`documents/${docId}`);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'ドキュメントが見つかりません');
    }

    const docData = docSnap.data()!;
    const ocrResult = docData.ocrResult as string | undefined;
    const documentType = (docData.documentType as string) || DEFAULT_DOCUMENT_TYPE_LABEL;

    if (!ocrResult || ocrResult.length < MIN_OCR_LENGTH_FOR_SUMMARY) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'OCR結果が短すぎるため要約を生成できません'
      );
    }

    // 要約生成 (Issue #214: 共通コアに委譲。本経路は error を rethrow して onCall の internal error 化)
    let summary: CappedText;
    try {
      summary = await generateSummaryCore(ocrResult, documentType);
    } catch (error) {
      console.error('Failed to generate summary:', error);
      throw error;
    }

    if (!summary.text) {
      throw new functions.https.HttpsError('internal', '要約の生成に失敗しました');
    }

    // ドキュメント更新（Issue #209: 切り詰めメタデータも保存し後追い検出を可能にする）
    await docRef.update({ ...buildSummaryFields(summary) });

    console.log(`Summary regenerated for ${docId}: ${summary.text.length} chars`);

    return { success: true, summary: summary.text };
  }
);
