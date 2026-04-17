/**
 * OCR結果から Vertex AI Gemini で要約を生成する共通コア関数 (Issue #214)
 *
 * ocrProcessor.ts / regenerateSummary.ts に分散していた重複実装
 * (generateSummary / generateSummaryInternal) を集約。
 * 関数本体は完全同一で、差分は呼び出し元のエラー処理 (catch 返却 vs throw) のみ。
 * エラー伝搬は caller 側の try/catch で差別化する。
 *
 * 関連:
 * - Issue #205: GEMINI_CONFIG.maxOutputTokens=8192 (Vertex AI 暴走対策)
 * - Issue #209: summary 経路にも適用 + capPageText で二段防御
 * - #178 教訓: 派生フィールド (truncated/originalLength) の一括書込みは
 *   呼び出し元で buildSummaryFields() を使い Firestore 更新するパターンを維持
 */

import { VertexAI } from '@google-cloud/vertexai';
import { GCP_CONFIG, GEMINI_CONFIG } from '../utils/config';
import { getRateLimiter, trackGeminiUsage } from '../utils/rateLimiter';
import { withRetry, RETRY_CONFIGS } from '../utils/retry';
import { capPageText, MAX_SUMMARY_LENGTH, type CappedText } from '../utils/pageTextCap';
import { buildSummaryGenerationRequest } from './summaryRequestBuilder';

const PROJECT_ID = GCP_CONFIG.projectId;
const LOCATION = GCP_CONFIG.location;
const MODEL_ID = GEMINI_CONFIG.modelId;

const MAX_SUMMARY_INPUT_LENGTH = 8000;

// 要約生成を行う最小 OCR 文字数。caller 側 (ocrProcessor / regenerateSummary) で
// 閾値同期漏れが起きないよう単一定数化。
export const MIN_OCR_LENGTH_FOR_SUMMARY = 100;

// documentType が空の場合のフォールバック表示名 (prompt 文言に差し込まれる)。
export const DEFAULT_DOCUMENT_TYPE_LABEL = '書類';

function buildSummaryPrompt(ocrResult: string, documentType: string): string {
  const truncatedText =
    ocrResult.length > MAX_SUMMARY_INPUT_LENGTH
      ? ocrResult.slice(0, MAX_SUMMARY_INPUT_LENGTH) + '...(以下省略)'
      : ocrResult;

  return `
以下は「${documentType || DEFAULT_DOCUMENT_TYPE_LABEL}」のOCR結果です。この書類の内容を3〜5行で要約してください。

【要約のポイント】
- 書類の主な目的・内容
- 重要な日付や金額があれば含める
- 関係者（顧客名、事業所名など）の記載があれば含める
- 専門用語は平易に言い換える

【OCR結果】
${truncatedText}

【要約】
`;
}

/**
 * OCR結果から AI 要約を生成する共通コア関数。
 *
 * - 呼び出し前提: `ocrResult` は非空文字列。短文ガード (例: `length < 100`) は caller 責任。
 * - エラー時: throw する (catch は caller 責任)。
 *   - ocrProcessor: empty CappedText を返して後続処理を継続
 *   - regenerateSummary: console.error 後 rethrow し onCall handler が internal error 化
 */
export async function generateSummaryCore(
  ocrResult: string,
  documentType: string
): Promise<CappedText> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.acquire();

  const vertexai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  const model = vertexai.getGenerativeModel({ model: MODEL_ID });

  const prompt = buildSummaryPrompt(ocrResult, documentType);

  const response = await withRetry(
    async () => model.generateContent(buildSummaryGenerationRequest(prompt)),
    RETRY_CONFIGS.gemini
  );

  const result = response.response;
  const rawSummary = (result.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

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
}
