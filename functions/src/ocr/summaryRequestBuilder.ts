/**
 * Vertex AI 要約生成リクエスト/Firestore 書き込みペイロードのビルダー
 *
 * リファクタや typo で `maxOutputTokens` 防御や 3点セット書き込みが
 * 失われる回帰を pure function テストで検出可能にする。
 *
 * 関連経緯:
 * - Issue #205: GEMINI_CONFIG.maxOutputTokens=8192 を導入 (OCR経路の暴走対策)
 * - Issue #209: summary 経路にも適用 + capPageText で二段防御
 * - #178 教訓: 派生フィールド (truncated/originalLength) を一括で書き込まないとFE側マッピングが破壊される
 */

import type { GenerateContentRequest } from '@google-cloud/vertexai';
import { GEMINI_CONFIG } from '../utils/config';
import type { CappedText } from '../utils/pageTextCap';

export interface SummaryGenerationRequest {
  contents: Array<{ role: 'user'; parts: Array<{ text: string }> }>;
  generationConfig: { maxOutputTokens: number };
}

export interface SummaryUpdatePayload {
  summary: string;
  summaryTruncated: boolean;
  summaryOriginalLength: number;
}

/**
 * Vertex AI Gemini に渡す GenerateContentRequest を構築。
 * `generationConfig.maxOutputTokens` の付与漏れを呼び出し元から構造的に排除する。
 * `satisfies GenerateContentRequest` で SDK 型変更時にコンパイルエラーで検知。
 */
export function buildSummaryGenerationRequest(prompt: string): SummaryGenerationRequest {
  const request = {
    contents: [{ role: 'user' as const, parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: GEMINI_CONFIG.maxOutputTokens },
  } satisfies GenerateContentRequest;
  return request;
}

/**
 * Firestore documents/{docId} の summary 関連フィールド更新ペイロード。
 * truncated / originalLength を併せて書き込まないと FE で切り詰めバナーが
 * 表示できないため (#178 教訓)、3フィールドをセットで構築する。
 */
export function buildSummaryFields(summary: CappedText): SummaryUpdatePayload {
  return {
    summary: summary.text,
    summaryTruncated: summary.truncated,
    summaryOriginalLength: summary.originalLength,
  };
}
