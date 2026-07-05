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

/**
 * OCR転記用thinkingBudgetを環境変数から解決する (Issue #546)。
 *
 * 既定は0(thinking無効化、コスト削減)。dev deploy後にOCR転記精度への影響が
 * 確認された場合、環境変数 `GEMINI_OCR_THINKING_BUDGET` を`-1`(dynamic thinkingで
 * 従来挙動に戻す)に設定してfunctionsを再deployするだけでコード変更・PRなしに
 * 即時ロールバックできる。
 *
 * Codexレビュー指摘: サポート対象外の値(小数・範囲外整数等)をそのままGeminiに渡すと
 * 全OCRリクエストがバリデーションエラーで失敗しうるため、ロールバック用途として
 * ドキュメント化された `0`/`-1` の2値のみを許容し、それ以外は安全側の既定値0に
 * フォールバックする。
 */
export function parseOcrThinkingBudget(envValue: string | undefined): number {
  if (envValue === '-1') return -1;
  if (envValue === undefined || envValue === '' || envValue === '0') return 0;
  console.warn(
    `[config] GEMINI_OCR_THINKING_BUDGET="${envValue}" is not a supported value (expected "0" or "-1"). Falling back to 0.`
  );
  return 0;
}

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
  /** OCR転記の thinkingBudget (Issue #546)。既定0、`GEMINI_OCR_THINKING_BUDGET`で上書き可能。 */
  ocrThinkingBudget: parseOcrThinkingBudget(process.env.GEMINI_OCR_THINKING_BUDGET),
} as const;
