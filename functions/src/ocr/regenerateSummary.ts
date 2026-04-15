/**
 * AI要約の再生成
 *
 * 既存ドキュメントに対してAI要約を再生成するCallable関数
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { VertexAI } from '@google-cloud/vertexai';
import { getRateLimiter, trackGeminiUsage } from '../utils/rateLimiter';
import { withRetry, RETRY_CONFIGS } from '../utils/retry';
import { GCP_CONFIG, GEMINI_CONFIG } from '../utils/config';
import { capPageText, MAX_SUMMARY_LENGTH, type CappedText } from '../utils/pageTextCap';
import { buildSummaryGenerationRequest, buildSummaryFields } from './summaryRequestBuilder';

const PROJECT_ID = GCP_CONFIG.projectId;
const LOCATION = GCP_CONFIG.location;
const MODEL_ID = GEMINI_CONFIG.modelId;

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
    const documentType = docData.documentType as string || '書類';

    if (!ocrResult || ocrResult.length < 100) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'OCR結果が短すぎるため要約を生成できません'
      );
    }

    // 要約生成
    const summary = await generateSummaryInternal(ocrResult, documentType);

    if (!summary.text) {
      throw new functions.https.HttpsError('internal', '要約の生成に失敗しました');
    }

    // ドキュメント更新（Issue #209: 切り詰めメタデータも保存し後追い検出を可能にする）
    await docRef.update(buildSummaryFields(summary));

    console.log(`Summary regenerated for ${docId}: ${summary.text.length} chars`);

    return { success: true, summary: summary.text };
  }
);

/**
 * OCR結果からAI要約を生成（内部関数, Issue #209）
 * @returns CappedText - text(切り詰め後summary), originalLength(元文字数), truncated(切り詰めフラグ)
 */
async function generateSummaryInternal(
  ocrResult: string,
  documentType: string
): Promise<CappedText> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.acquire();

  const vertexai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  const model = vertexai.getGenerativeModel({ model: MODEL_ID });

  // 入力が長すぎる場合は切り詰め
  const maxInputLength = 8000;
  const truncatedText =
    ocrResult.length > maxInputLength
      ? ocrResult.slice(0, maxInputLength) + '...(以下省略)'
      : ocrResult;

  const prompt = `
以下は「${documentType || '書類'}」のOCR結果です。この書類の内容を3〜5行で要約してください。

【要約のポイント】
- 書類の主な目的・内容
- 重要な日付や金額があれば含める
- 関係者（顧客名、事業所名など）の記載があれば含める
- 専門用語は平易に言い換える

【OCR結果】
${truncatedText}

【要約】
`;

  try {
    const response = await withRetry(
      async () => {
        return await model.generateContent(buildSummaryGenerationRequest(prompt));
      },
      RETRY_CONFIGS.gemini
    );

    const result = response.response;
    const rawSummary = (result.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    // トークン使用量を記録
    const usageMetadata = result.usageMetadata;
    trackGeminiUsage(
      usageMetadata?.promptTokenCount || 0,
      usageMetadata?.candidatesTokenCount || 0
    );

    // Issue #209: 二重防御。maxOutputTokens を抜けた異常応答も Firestore 1 MiB 超過前に切り詰め。
    const capped = capPageText(rawSummary, MAX_SUMMARY_LENGTH);
    if (capped.truncated) {
      console.warn(
        `[Summary] truncated: ${capped.originalLength} → ${capped.text.length} chars (cap=${MAX_SUMMARY_LENGTH})`
      );
    } else {
      console.log(`Summary generated: ${capped.text.length} chars`);
    }
    return capped;
  } catch (error) {
    console.error('Failed to generate summary:', error);
    throw error;
  }
}
