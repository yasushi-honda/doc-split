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
import { classifySummaryError, mapSummaryErrorToHttpsError } from './summaryErrorClassification';
import { resolveDetailFields, readDocWithDetail } from './documentDetail';

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
    // ADR-0018 Phase D (#6): getOcrText と同じ transactional paired-read
    // (根拠は readDocWithDetail の doc comment 参照)。fieldMask で転送を要約に必要な
    // フィールドに限定
    const docRef = db.doc(`documents/${docId}`);
    const [docSnap, detailSnap] = await readDocWithDetail(db, docRef, [
      'ocrResult',
      'documentType',
    ]);

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

    // 要約生成 (Issue #214: 共通コアに委譲。本経路は error を rethrow して onCall の HttpsError 化)
    // Issue #266: rethrow 前に safeLogError で errors collection + 通知による検知を確保。
    // 順序根拠 (rules/error-handling.md § 1): 本経路は "状態復旧なし + 即 rethrow" のため、
    // ログ記録 → rethrow の順を採る。safeLogError は内部で try/catch 済、caller に波及しない。
    // onCall 呼出の client 側タイムアウトは Firebase 標準 70s、logError Firestore 書込 ~500ms で影響軽微。
    // Issue #251 Scope3: 空/ブロック応答は generateSummaryCore が SummaryBlockedError を throw するため
    // (finishReason/safetyRatings を保持したまま)、ここで !summary.text を再チェックする必要はない。
    // quota/transient/blocked をエラー種別で HttpsError コードへ細分化し、client 側の再試行判断を助ける。
    // console.error(error) はここで先に実行する (rules/error-handling.md § 1「最低限のconsole.error
    // はtry-catch外で先に実行」)。safeLogError内部のconsole.errorはerrorCode/message等の flat summary
    // のみでスタックトレースを含まないため (/code-review指摘)、Cloud Logging上のstack可視性はこちらが担う。
    // classifySummaryErrorには生のerror(catch句の引数)をそのまま渡す。console.error/safeLogError用に
    // 作る `new Error(String(error))` ラップ値を渡すと、is429Error/isTransientErrorが読む
    // .code/.status/.cause.codeが失われ'unknown'に落ちるため (/code-review指摘)。
    let summary: SummaryField;
    try {
      summary = await generateSummaryCore(ocrResult, documentType);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Failed to generate summary:', err);
      await safeLogError({
        error: err,
        source: 'ocr',
        functionName: 'regenerateSummary',
        documentId: docId,
      });
      const mapping = mapSummaryErrorToHttpsError(classifySummaryError(error));
      if (mapping) {
        throw new functions.https.HttpsError(mapping.code, mapping.message);
      }
      throw err;
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
