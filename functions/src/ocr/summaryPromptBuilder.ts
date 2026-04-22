/**
 * 要約生成用プロンプト構築 (Issue #251 Scope 2)
 *
 * summaryGenerator.ts から `buildSummaryPrompt` と関連定数を分離した pure module。
 * Vertex AI / firebase-admin / rateLimiter への依存を持たず、unit test が admin 初期化
 * なしで実行可能。
 *
 * 分離の理由 (PR #250 review 指摘):
 * - summaryGenerator.ts の依存チェーン (rateLimiter.ts → firebase-admin) により
 *   pure function 部分を unit test しようとすると `app/no-app` エラーで失敗する
 * - prompt 文言は最も退行しやすい箇所 (truncation 閾値、fallback 文言、セクション配置)
 *   だが、既存は grep 契約も無く境界値テストも欠落していた
 */

/** OCR 結果がこの長さを超えたら「...(以下省略)」で切り詰める */
export const MAX_SUMMARY_INPUT_LENGTH = 8000;

/**
 * documentType が空文字列のときに prompt 文言に差し込む fallback ラベル。
 * caller 側での二重 fallback (type-design-analyzer 指摘) を構造的に防止するため、
 * 本モジュール内に single source of truth として閉じ込める (export しない)。
 */
const DEFAULT_DOCUMENT_TYPE_LABEL = '書類';

/**
 * OCR 結果と書類タイプから Gemini 要約生成用プロンプトを組み立てる。
 *
 * - `ocrResult.length > MAX_SUMMARY_INPUT_LENGTH` の場合、先頭 MAX_SUMMARY_INPUT_LENGTH
 *   文字のみを使用し末尾に「...(以下省略)」を付ける
 * - `documentType` が空文字列なら DEFAULT_DOCUMENT_TYPE_LABEL をタイトルに差し込む
 */
export function buildSummaryPrompt(ocrResult: string, documentType: string): string {
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
