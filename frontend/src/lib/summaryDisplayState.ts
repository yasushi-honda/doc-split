/**
 * AI要約の表示状態判定 (ADR-0027 PR4c)
 *
 * デスクトップ(アコーディオン)とモバイル(MobileContentPopup、手組みDOM)の2系統が
 * 同じ判定ロジックを個別実装すると#193型の食い違いを起こしやすいため、純関数へ切り出し
 * 両方から参照させる。kindは上から最初に一致したものを採用する固定順序で判定する。
 */

import type { SummaryErrorKind, SummaryField, SummaryState } from '../../../shared/types'

/** OCR結果の最小長。`functions/src/ocr/summaryPromptBuilder.ts`のMIN_OCR_LENGTH_FOR_SUMMARYと同値。 */
export const SUMMARY_MIN_OCR_LENGTH = 100

export type SummaryDisplayKind =
  | 'detail-error'
  | 'generating'
  | 'generated'
  | 'queued'
  | 'failed'
  | 'unavailable'
  | 'absent'

export interface SummaryDisplayState {
  kind: SummaryDisplayKind
  /** kind==='generating'|'generated'の場合、既存の要約テキスト(generatingでは薄く表示する用途) */
  summaryText?: string
  /** kind==='failed'の場合のユーザー向けメッセージ */
  errorMessage?: string
}

export interface DeriveSummaryDisplayStateInput {
  summary: SummaryField | undefined
  summaryState: SummaryState | undefined
  summaryErrorKind: SummaryErrorKind | null | undefined
  ocrResult: string | undefined
  isDetailError: boolean
  isGeneratingSummary: boolean
}

/**
 * `summaryErrorKind`別のユーザー向けメッセージ。`kind`が`null`/`undefined`
 * (Firestore上でフィールド自体が未設定)の場合は`unknown`と同じ汎用文言にフォールバックする。
 */
export function summaryErrorMessage(kind: SummaryErrorKind | null | undefined): string {
  switch (kind) {
    case 'fabrication_suspected':
      return '自動生成された要約に原文にない固有名詞が含まれていたため保存しませんでした。手動で再生成してください'
    case 'blocked':
      return '安全フィルタにより要約を生成できませんでした'
    case 'quota':
    case 'transient':
      return '一時的なエラーで要約を生成できませんでした。しばらくして再試行してください'
    case 'unknown':
    case null:
    case undefined:
    default:
      return '要約の生成に失敗しました'
  }
}

/**
 * 7 kindを上から最初に一致したもので判定する。判定順序:
 * 0. isDetailErrorかつ要約なし → detail-error
 * 1. isGeneratingSummary(ローカル状態)またはsummaryState==='processing' → generating
 *    (OCR側status(pending/processing)との同時成立は、OCR完了と同一トランザクションで
 *    summaryStateが確定するため通常到達しない防御的分岐。ポーリング間隔の優先順位は
 *    computeDocumentRefetchInterval側で扱う)
 * 2. summary.textあり → generated(要約本文が最優先。processing/error/detail-errorより先)
 * 3. summaryState==='pending' → queued
 * 4. summaryState==='error' → failed
 * 5. summaryState==='skipped' またはOCR結果 < SUMMARY_MIN_OCR_LENGTH字 → unavailable
 * 6. 上記以外(OCR ≥ SUMMARY_MIN_OCR_LENGTH字) → absent
 */
export function deriveSummaryDisplayState(input: DeriveSummaryDisplayStateInput): SummaryDisplayState {
  const { summary, summaryState, summaryErrorKind, ocrResult, isDetailError, isGeneratingSummary } = input

  if (isGeneratingSummary || summaryState === 'processing') {
    return { kind: 'generating', summaryText: summary?.text }
  }

  if (summary?.text) {
    return { kind: 'generated', summaryText: summary.text }
  }

  if (isDetailError) {
    return { kind: 'detail-error' }
  }

  if (summaryState === 'pending') {
    return { kind: 'queued' }
  }

  if (summaryState === 'error') {
    return { kind: 'failed', errorMessage: summaryErrorMessage(summaryErrorKind) }
  }

  const hasEnoughOcrResult = !!ocrResult && ocrResult.length >= SUMMARY_MIN_OCR_LENGTH
  if (summaryState === 'skipped' || !hasEnoughOcrResult) {
    return { kind: 'unavailable' }
  }

  return { kind: 'absent' }
}
