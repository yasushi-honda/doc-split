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
 *
 * 呼び出し側 (regenerateSummary.ts) は catch した生の error をそのまま渡すこと。
 * `new Error(String(error))` 等でラップした値を渡すと、is429Error/isTransientError が
 * 読む `.code`/`.status`/`.cause.code` が失われ 'unknown' に落ちる (/code-review指摘)。
 */
export function classifySummaryError(error: unknown): SummaryErrorClassification {
  if (error instanceof SummaryBlockedError) return 'blocked';
  if (is429Error(error)) return 'quota';
  if (isTransientError(error)) return 'transient';
  return 'unknown';
}

/** classifySummaryError の分類結果に対応する HttpsError コード + client向け日本語メッセージ */
export interface SummaryHttpsErrorMapping {
  code: 'resource-exhausted' | 'unavailable' | 'failed-precondition';
  message: string;
}

/**
 * classifySummaryError の結果を HttpsError コード+メッセージへマップする純粋関数。
 *
 * regenerateSummary.ts (Firebase onCall, admin.firestore() 依存) 側にこのマッピングを
 * 直接書くと、firebase-admin 初期化なしの単体テストプールから検証できず、コード/
 * メッセージの取り違え (例: quota と transient の入れ替え) がテストで検知できない
 * (/code-review指摘)。regenerateSummary.ts は `new functions.https.HttpsError(...)`
 * の構築のみを担い、コード/メッセージの対応関係自体はここで一元管理する。
 * classification === 'unknown' の場合は null を返し、caller 側で元エラーを rethrow する。
 */
export function mapSummaryErrorToHttpsError(
  classification: SummaryErrorClassification
): SummaryHttpsErrorMapping | null {
  switch (classification) {
    case 'quota':
      return {
        code: 'resource-exhausted',
        message: 'AI要約生成の割当上限に達しました。しばらく待って再試行してください',
      };
    case 'transient':
      return {
        code: 'unavailable',
        message: 'AI要約生成サービスが一時的に利用できません。しばらく待って再試行してください',
      };
    case 'blocked':
      return {
        code: 'failed-precondition',
        message: 'この書類の内容から要約を生成できませんでした',
      };
    default:
      return null;
  }
}
