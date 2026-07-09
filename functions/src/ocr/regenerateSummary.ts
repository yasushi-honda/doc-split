/**
 * AI要約の再生成
 *
 * 既存ドキュメントに対してAI要約を再生成するCallable関数。
 * Issue #214 で Vertex AI 呼び出しロジックは summaryGenerator.generateSummaryCore に集約。
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { GCP_CONFIG } from '../utils/config';
import { safeLogError } from '../utils/errorLogger';
import type { SummaryField } from '../../../shared/types';
import { buildSummaryFields } from './summaryRequestBuilder';
import { generateSummaryCore, MIN_OCR_LENGTH_FOR_SUMMARY } from './summaryGenerator';
import { resolveDetailFields } from './documentDetail';

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
    // ADR-0018 Phase D (#6): getOcrText と同じ transactional paired-read で
    // 親 + detail/main を同一スナップショットとして読む(不整合な組合せの防止)
    const docRef = db.doc(`documents/${docId}`);
    const detailRef = docRef.collection('detail').doc('main');
    const [docSnap, detailSnap] = await db.runTransaction(
      async (tx) => tx.getAll(docRef, detailRef),
      { readOnly: true }
    );

    if (!docSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'ドキュメントが見つかりません');
    }

    const docData = docSnap.data()!;
    const { ocrResult } = resolveDetailFields(detailSnap.data(), docData);
    // 空/未定義はそのまま core に渡し、core 内の DEFAULT_DOCUMENT_TYPE_LABEL で一本化。
    const documentType = (docData.documentType as string | undefined) ?? '';

    if (!ocrResult || ocrResult.length < MIN_OCR_LENGTH_FOR_SUMMARY) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'OCR結果が短すぎるため要約を生成できません'
      );
    }

    // 要約生成 (Issue #214: 共通コアに委譲。本経路は error を rethrow して onCall の internal error 化)
    // Issue #266: rethrow 前に safeLogError で errors collection + 通知による検知を確保。
    // 順序根拠 (rules/error-handling.md § 1): 本経路は "状態復旧なし + 即 rethrow" のため、
    // ログ記録 → rethrow の順を採る。safeLogError は内部で try/catch 済、caller に波及しない。
    // onCall 呼出の client 側タイムアウトは Firebase 標準 70s、logError Firestore 書込 ~500ms で影響軽微。
    let summary: SummaryField;
    try {
      summary = await generateSummaryCore(ocrResult, documentType);
    } catch (error) {
      console.error('Failed to generate summary:', error);
      await safeLogError({
        error: error instanceof Error ? error : new Error(String(error)),
        source: 'ocr',
        functionName: 'regenerateSummary',
        documentId: docId,
      });
      throw error;
    }

    if (!summary.text) {
      throw new functions.https.HttpsError('internal', '要約の生成に失敗しました');
    }

    // ドキュメント更新（Issue #209: 切り詰めメタデータも保存し後追い検出を可能にする）
    // Issue #215: summary は discriminated union ネスト型で書き込み、
    // 旧フラット3フィールド (summaryTruncated / summaryOriginalLength) は削除。
    await docRef.update({
      summary: buildSummaryFields(summary),
      summaryTruncated: admin.firestore.FieldValue.delete(),
      summaryOriginalLength: admin.firestore.FieldValue.delete(),
    });

    console.log(`Summary regenerated for ${docId}: ${summary.text.length} chars`);

    return { success: true, summary: summary.text };
  }
);
