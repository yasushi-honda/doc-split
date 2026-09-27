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
 * 0. isGeneratingSummary(ローカル状態)、またはsummaryState==='processing'かつisDetailErrorで
 *    ない場合 → generating(要約本文があれば下に薄く表示するため保持する)
 * 1. summary.textあり → generated(要約本文が優先。error/detail-errorより先)
 * 2. isDetailErrorかつ要約なし → detail-error
 *    (codex review P2指摘反映: 以前の実装ではsummaryState==='processing'の判定が
 *    isDetailErrorより無条件に先に評価されており、detail/mainの読込失敗中にバックエンドが
 *    processing/pending/error/skippedのいずれであってもdetail-errorが隠れ、本来ブロック
 *    すべき生成操作(queued/generating/failedのボタン)を提示してしまっていた。要約テキストが
 *    既にある場合(手順1で処理済み)や、ローカルでの能動的な生成中(手順0)は従来通り
 *    detail-errorより優先するが、要約なし+バックエンド側processingでもない場合は
 *    isDetailErrorをpending/error/skippedより先に評価する)
 * 3. summaryState==='pending' → queued
 * 4. summaryState==='error' → failed
 * 5. summaryState==='skipped' またはOCR結果 < SUMMARY_MIN_OCR_LENGTH字 → unavailable
 * 6. 上記以外(OCR ≥ SUMMARY_MIN_OCR_LENGTH字) → absent
 *
 * OCR側status(pending/processing)とsummaryState===processingの同時成立は、OCR完了と
 * 同一トランザクションでsummaryStateが確定するため通常到達しない防御的分岐。ポーリング
 * 間隔の優先順位はcomputeDocumentRefetchInterval側で扱う。
 */
export function deriveSummaryDisplayState(input: DeriveSummaryDisplayStateInput): SummaryDisplayState {
  const { summary, summaryState, summaryErrorKind, ocrResult, isDetailError, isGeneratingSummary } = input

  if (isGeneratingSummary || (summaryState === 'processing' && !isDetailError)) {
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
