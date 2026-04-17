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
import type { CappedText } from '../utils/textCap';
import type { SummaryField } from '../../../shared/types';

export interface SummaryGenerationRequest {
  contents: Array<{ role: 'user'; parts: Array<{ text: string }> }>;
  generationConfig: { maxOutputTokens: number };
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
 * Firestore documents/{docId}.summary に書き込む discriminated union ペイロード。
 *
 * #215 で旧フラット3フィールド (summary / summaryTruncated / summaryOriginalLength) を
 * 廃止し、不変条件 (truncated=true ⟹ originalLength 必須) を型レベル保証する
 * SummaryField ネスト型に統一。#178 教訓の「派生フィールドの書き込み漏れで
 * FE 表示が壊れる」問題は union の tag (truncated) で構造的に排除される。
 */
export function buildSummaryFields(summary: CappedText): SummaryField {
  if (summary.truncated) {
    return {
      text: summary.text,
      truncated: true,
      originalLength: summary.originalLength,
    };
  }
  return { text: summary.text, truncated: false };
}
