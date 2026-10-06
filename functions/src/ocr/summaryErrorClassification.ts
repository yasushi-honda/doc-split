/**
 * summary 生成失敗のエラー分類 (Issue #251 Scope3)
 *
 * side-effect-free モジュール(firebase-admin 初期化なしの単体テストから import できる)。
 * ADR-0027 PR-E: Gemini 専用だった空/ブロック応答の検知(SummaryBlockedError 等)と、
 * 呼び出し元の無くなった HttpsError マッピングを削除した。`blocked` は過去データの
 * `summaryErrorKind` として残りうるため、型(shared/types.ts)とFE表示は変更しない。
 */

import { is429Error, isTransientError } from '../utils/retry';

/** 要約生成失敗の分類結果 */
export type SummaryErrorClassification = 'quota' | 'transient' | 'unknown';

/**
 * summary 生成失敗エラーを分類する純粋関数。既存の is429Error/isTransientError
 * (retry.ts) を再利用し DRY を維持する。Sarashina 以外の例外の受け皿として
 * `summaryRunGuard.ts` の classifySummaryFailure が使う。
 *
 * 呼び出し側は catch した生の error をそのまま渡すこと。
 * `new Error(String(error))` 等でラップした値を渡すと、is429Error/isTransientError が
 * 読む `.code`/`.status`/`.cause.code` が失われ 'unknown' に落ちる (/code-review指摘)。
 */
export function classifySummaryError(error: unknown): SummaryErrorClassification {
  if (is429Error(error)) return 'quota';
  if (isTransientError(error)) return 'transient';
  return 'unknown';
}
