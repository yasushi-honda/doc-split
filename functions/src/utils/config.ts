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
 *
 * PR#550レビュー指摘: GCPコンソール等からのコピペで混入しうる前後空白・改行を
 * trimしてから比較する(でないと"-1\n"等が不正値扱いされ、意図したロールバックが
 * 無言で無効化される)。
 */
export function parseOcrThinkingBudget(envValue: string | undefined): number {
  const trimmed = envValue?.trim();
  if (trimmed === '-1') return -1;
  if (trimmed === undefined || trimmed === '' || trimmed === '0') return 0;
  console.warn(
    `[config] GEMINI_OCR_THINKING_BUDGET="${envValue}" is not a supported value (expected "0" or "-1"). Falling back to 0.`
  );
  return 0;
}

/**
 * 使用するGeminiモデルIDを環境変数から解決する (Issue #548)。
 *
 * 既定は'gemini-3.5-flash'(2026-07-06、A/Bテストharness実機3回PASSにより移行決定。
 * gemini-2.5-flashは2026-10-16廃止予定)。dev環境で精度劣化等の問題が見つかった場合、
 * 環境変数 `GEMINI_MODEL_ID` に`gemini-2.5-flash`を設定してfunctionsを再deployするだけで
 * コード変更・PRなしに即時ロールバックできる(GEMINI_OCR_THINKING_BUDGETと同じパターン)。
 *
 * ドキュメント化された2値(gemini-3.5-flash/gemini-2.5-flash)以外は、全OCR/summaryリクエストが
 * 存在しないモデルIDでエラーになることを避けるため、安全側の既定値(移行後の3.5-flash)にフォールバックする。
 */
export function parseModelId(envValue: string | undefined): string {
  const trimmed = envValue?.trim();
  if (trimmed === 'gemini-2.5-flash' || trimmed === 'gemini-3.5-flash') return trimmed;
  if (trimmed !== undefined && trimmed !== '') {
    console.warn(
      `[config] GEMINI_MODEL_ID="${envValue}" is not a supported value (expected "gemini-3.5-flash" or "gemini-2.5-flash"). Falling back to gemini-3.5-flash.`
    );
  }
  return 'gemini-3.5-flash';
}

/**
 * modelIdがGemini 3.5系かどうかを判定する (Issue #548)。
 * thinkingConfigの形式分岐(3.5系=thinkingLevel / 2.5系=thinkingBudget)に使用する。
 */
export function isThreePointFiveModel(modelId: string): boolean {
  return modelId === 'gemini-3.5-flash';
}

// Vertex AI / Gemini設定
export const GEMINI_CONFIG = {
  /** 使用するGeminiモデルID (Issue #548: `GEMINI_MODEL_ID`で上書き可能、既定gemini-3.5-flash) */
  modelId: parseModelId(process.env.GEMINI_MODEL_ID),
  /** モデルのリージョン */
  location: GCP_CONFIG.location,
  /**
   * generateContent の maxOutputTokens 上限 (Issue #205, #209)
   * Vertex AI のハルシネーション/暴走で1.1M chars を返す事故への根本対策。
   * OCR 経路・summary 経路の両方で必須設定。
   */
  maxOutputTokens: 8192,
  /** OCR転記の thinkingBudget (Issue #546)。既定0、`GEMINI_OCR_THINKING_BUDGET`で上書き可能。gemini-2.5-flash使用時のみ参照される。 */
  ocrThinkingBudget: parseOcrThinkingBudget(process.env.GEMINI_OCR_THINKING_BUDGET),
} as const;

/** Gemini 1モデル分の料金(100万トークンあたりの単価USD) */
interface GeminiPricing {
  inputPer1MTokens: number;
  outputPer1MTokens: number;
}

/**
 * モデル別料金テーブル (2026年7月時点、公式単価: ai.google.dev)
 *
 * Issue #546: gemini-2.5-flash実単価($0.30/$2.50)。
 * Issue #548: gemini-3.5-flash実単価($1.50/$9.00、2.5-flash比で入力5倍/出力3.6倍)。
 */
const GEMINI_PRICING_BY_MODEL: Record<string, GeminiPricing> = Object.freeze({
  'gemini-2.5-flash': { inputPer1MTokens: 0.3, outputPer1MTokens: 2.5 },
  'gemini-3.5-flash': { inputPer1MTokens: 1.5, outputPer1MTokens: 9.0 },
});

/** 指定modelIdの料金を解決する。未知のmodelIdはgemini-2.5-flash単価にフォールバックする (Issue #548)。 */
export function resolveGeminiPricing(modelId: string): GeminiPricing {
  return GEMINI_PRICING_BY_MODEL[modelId] ?? GEMINI_PRICING_BY_MODEL['gemini-2.5-flash'];
}

/**
 * 料金定数（GEMINI_CONFIG.modelIdに応じた実単価、Issue #546/#548）
 *
 * Issue #546: 旧値($0.075/$0.30)はgemini-1.5-flash相当の単価が残置されており、
 * アプリ内コスト表示が実請求の約1/8に過小評価されていた。
 * Issue #548: 固定値からGEMINI_CONFIG.modelId依存の解決に変更（3.5 Flash移行）。
 */
export const GEMINI_PRICING = Object.freeze(resolveGeminiPricing(GEMINI_CONFIG.modelId));
