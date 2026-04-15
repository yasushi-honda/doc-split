/**
 * Vertex AI 要約生成リクエスト/Firestore 書き込みペイロードのビルダー
 *
 * Issue #213: ocrProcessor / regenerateSummary 双方の generateContent 呼び出しと
 * Firestore update payload を共通化し、リファクタやtypoで maxOutputTokens 防御
 * (Issue #209) や summaryTruncated/summaryOriginalLength の出力 (#178教訓) が
 * 失われる回帰を pure function テストで検出する。
 */

import { GEMINI_CONFIG } from '../utils/config';
import type { CappedText } from '../utils/pageTextCap';

/**
 * Vertex AI Gemini に渡す GenerateContentRequest を構築。
 * `generationConfig.maxOutputTokens` の付与漏れを呼び出し元から構造的に排除する。
 */
export function buildSummaryGenerationRequest(prompt: string): {
  contents: Array<{ role: 'user'; parts: Array<{ text: string }> }>;
  generationConfig: { maxOutputTokens: number };
} {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: GEMINI_CONFIG.maxOutputTokens },
  };
}

/**
 * Firestore documents/{docId} の summary 関連フィールド更新ペイロード。
 * truncated / originalLength を併せて書き込まないと FE で切り詰めバナーが
 * 表示できないため (#178 教訓)、3フィールドをセットで構築する。
 */
export function buildSummaryFields(summary: CappedText): {
  summary: string;
  summaryTruncated: boolean;
  summaryOriginalLength: number;
} {
  return {
    summary: summary.text,
    summaryTruncated: summary.truncated,
    summaryOriginalLength: summary.originalLength,
  };
}
