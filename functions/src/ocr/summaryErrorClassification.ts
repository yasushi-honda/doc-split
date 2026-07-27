/**
 * summary 生成の空/ブロック応答検知・エラー分類 (Issue #251 Scope3)
 *
 * side-effect-free モジュール。summaryGenerator.ts は rateLimiter.ts 経由で
 * モジュールレベル admin.firestore() に依存するため、admin.initializeApp()
 * 未実行の単体テストプールから直接 import できない (exchangeGmailAuthCode.ts と
 * 同じ制約、詳細: test/exchangeGmailAuthCodeMessage.test.ts 冒頭コメント)。
 * ocr/constants.ts (#196) と同じ方式で、テスト可能なロジックのみをここに分離する。
 */

import { is429Error, isTransientError } from '../utils/retry';

/** Vertex AI が空/ブロック応答を返した際の診断情報 */
export interface BlockedSummaryDetails {
  finishReason?: string;
  safetyRatings?: unknown;
  blockReason?: string;
}

/**
 * generateContent レスポンスから空/ブロック応答時の診断情報を抽出する純粋関数。
 */
export function extractBlockedSummaryDetails(response: {
  candidates?: Array<{ finishReason?: string; safetyRatings?: unknown }>;
  promptFeedback?: { blockReason?: string };
}): BlockedSummaryDetails {
  const candidate = response.candidates?.[0];
  return {
    finishReason: candidate?.finishReason,
    safetyRatings: candidate?.safetyRatings,
    blockReason: response.promptFeedback?.blockReason,
  };
}

/**
 * Vertex AI が空/ブロック応答を返した場合に throw するエラー。
 *
 * 従来は空文字のまま SummaryField として返し、caller (regenerateSummary.ts) が
 * `!summary.text` で汎用 internal エラー化していたため、finishReason/safetyRatings が
 * ログに残らない silent failure だった (#178/#209 系統の教訓)。
 */
export class SummaryBlockedError extends Error {
  constructor(public readonly details: BlockedSummaryDetails) {
    super(
      `Vertex AI returned empty summary (finishReason=${details.finishReason ?? 'unknown'}, ` +
        `blockReason=${details.blockReason ?? 'none'}, ` +
        `safetyRatings=${JSON.stringify(details.safetyRatings ?? null)})`
    );
    this.name = 'SummaryBlockedError';
  }
}

/** regenerateSummary.ts での HttpsError コード細分化用の分類結果 */
export type SummaryErrorClassification = 'quota' | 'transient' | 'blocked' | 'unknown';

/**
 * summary 生成失敗エラーを分類する純粋関数。既存の is429Error/isTransientError
 * (retry.ts) を再利用し DRY を維持する。caller 側で HttpsError コードへマップする。
 */
export function classifySummaryError(error: unknown): SummaryErrorClassification {
  if (error instanceof SummaryBlockedError) return 'blocked';
  if (is429Error(error)) return 'quota';
  if (isTransientError(error)) return 'transient';
  return 'unknown';
}
