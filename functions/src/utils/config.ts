/**
 * 共通設定
 *
 * プロジェクト全体で使用する設定値を一元管理
 */

// GCP設定
export const GCP_CONFIG = {
  /** プロジェクトID */
  projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '',
  /** リージョン */
  location: 'asia-northeast1',
} as const;

// Vertex AI / Gemini設定
export const GEMINI_CONFIG = {
  /** 使用するGeminiモデルID */
  modelId: 'gemini-2.5-flash',
  /** モデルのリージョン */
  location: GCP_CONFIG.location,
  /**
   * generateContent の maxOutputTokens 上限 (Issue #205, #209)
   * Vertex AI のハルシネーション/暴走で1.1M chars を返す事故への根本対策。
   * OCR 経路・summary 経路の両方で必須設定。
   */
  maxOutputTokens: 8192,
} as const;
