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

/**
 * backendが要約へ渡すOCR先頭文字数の上限。`functions/src/ocr/summaryPromptBuilder.ts`の
 * MAX_SUMMARY_INPUT_LENGTHと同値(契約テスト`summaryDisplayState.test`で一致を固定)。
 */
export const SUMMARY_MAX_INPUT_LENGTH = 8000

/** 手動依頼を受け付けた(pending)間の案内。デスクトップ/モバイル/トーストで共通利用する(1か所に集約)。 */
export const SUMMARY_QUEUED_DETAIL =
  'バックグラウンドで作成するので、他の操作を続けられます(目安: 数分〜10分)。完了すると自動で表示されます'

export const SUMMARY_QUEUED_MESSAGE = `要約の作成を受け付けました。${SUMMARY_QUEUED_DETAIL}`

/** 受付ダイアログの見出し(OKボタンで閉じる。トーストはすぐ消えて読めないため、decision-maker指摘で変更)。 */
export const SUMMARY_QUEUED_TITLE = '要約の作成を受け付けました'

/**
 * 要約の作成に時間がかかる理由。利用者が納得して待てるよう、受付ダイアログと「受付中」の案内に併記する。
 * 生成元(SUMMARY_PROVIDER)によらず事実である文言にする: 画面はプロバイダを知らず、ロールバック運用
 * (gemini)では書類の内容がVertex AI Geminiへ送られるため、「外部へ送らない」「専用環境」等は書かない
 * (codex review P1指摘)。断定的な誇張(完全・絶対等)も避ける。
 */
export const SUMMARY_SAFETY_NOTICE =
  '時間がかかるのは、書類の内容(要配慮個人情報を含む場合があります)を安全に取り扱うため、管理された環境で慎重に処理しているためです。'

/** 旧要約を残したまま再作成が失敗した場合の見出し(個別の失敗理由は`summaryErrorMessage`を併記する)。 */
export const SUMMARY_PREVIOUS_FAILED_MESSAGE = '前回の要約です。今回の再作成は失敗しました'

/**
 * 旧要約を残したまま再作成が`skipped`になった場合の理由(原文を読み込めなかった、または要約機能の
 * 対象から外れた等)。`summaryErrorKind`を持たないため固定文にする。
 */
export const SUMMARY_SKIPPED_MESSAGE = '要約の対象外、または原文を読み込めなかったため、再作成できませんでした'

/** 生成済み要約に付ける注意ラベル。 */
export const SUMMARY_AI_REVIEW_LABEL = 'AI生成・要確認'

/** OCR全文が上限を超える(またはオフロードで全文が手元にない)場合の注記。 */
export const SUMMARY_TRUNCATION_NOTICE = '長い書類のため、先頭約8,000字を要約しています'

/**
 * 先頭約8,000字の注記を出すか。OCR全文が上限超、またはオフロード文書(`ocrResultUrl`あり、
 * 全文が手元になく長さ不明だが10万字超でオフロードされているため必ず上限超)は常に出す。
 */
export function shouldShowSummaryTruncationNotice(
  ocrResult: string | undefined,
  ocrResultUrl: string | null | undefined
): boolean {
  if (ocrResultUrl) return true
  return !!ocrResult && ocrResult.length > SUMMARY_MAX_INPUT_LENGTH
}

export type SummaryDisplayKind =
  | 'detail-error'
  | 'generating'
  | 'generated'
  | 'generated-with-failure'
  | 'queued'
  | 'failed'
  | 'unavailable'
  | 'absent'

export interface SummaryDisplayState {
  kind: SummaryDisplayKind
  /**
   * 既存の要約テキスト。generated/generated-with-failureでは本文、generating/queuedでは
   * 再生成依頼中も旧要約を見せ続けるために保持する(薄く表示する用途)
   */
  summaryText?: string
  /** kind==='failed'|'generated-with-failure'、および依頼がskippedになった'absent'の場合のユーザー向けメッセージ(理由) */
  errorMessage?: string
}

export interface DeriveSummaryDisplayStateInput {
  summary: SummaryField | undefined
  summaryState: SummaryState | undefined
  summaryErrorKind: SummaryErrorKind | null | undefined
  ocrResult: string | undefined
  /**
   * 親documentの`ocrResultUrl`。10万字超でStorageへオフロードされた文書(ADR-0018)は
   * detail側`ocrResult=''`となるため、これがあればOCR十分長とみなす。
   */
  ocrResultUrl?: string | null
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
 * 8 kindを上から最初に一致したもので判定する。判定順序(最終形):
 * 0. isGeneratingSummary(ローカル状態)、またはsummaryState==='processing'かつisDetailErrorで
 *    ない場合 → generating(旧要約があれば薄く表示するため summaryText を保持)
 * 1. summary.textあり(以降、本文は常に保持する。要約本文はdetail-errorより優先):
 *    a. summaryState==='pending' → queued(再生成依頼中。旧要約を見せ続ける)
 *    b. summaryState==='error'   → generated-with-failure(旧要約+「今回の再作成は失敗」+理由)
 *    c. summaryState==='skipped' → generated-with-failure(原文の読込失敗・対象外。固定の理由文)
 *    d. 上記以外 → generated
 * 2. isDetailErrorかつ要約なし → detail-error
 *    (codex review P2指摘反映: summaryStateの値に関わらず要約なしのdetail取得失敗は
 *    生成操作を提示せずブロックする。ローカルの能動的な生成中(手順0)のみ優先する)
 * 3. summaryState==='pending' → queued
 * 4. summaryState==='error' → failed
 * 5. OCR結果 < SUMMARY_MIN_OCR_LENGTH字、かつocrResultUrlなし → unavailable
 *    (summaryStateの値に関わらず。ocrResultUrlあり=オフロード文書は10万字超のため十分長いとみなす)
 * 6. 上記以外(OCR ≥ SUMMARY_MIN_OCR_LENGTH字、またはocrResultUrlあり。
 *    summaryState==='skipped'を含む) → absent
 *    (codex review P2指摘反映: Sarashina L2ゲートのallowlist除外時、バックエンドはOCR長に
 *    関係なくsummaryState:'skipped'にする。skippedを無条件でunavailableにすると十分長い
 *    文書で手動生成経路を失うため、OCR長を先に判定し十分ならabsentとして依頼ボタンを残す)
 *
 * OCR側status(pending/processing)とsummaryState===processingの同時成立は、OCR完了と
 * 同一トランザクションでsummaryStateが確定するため通常到達しない防御的分岐。ポーリング
 * 間隔の優先順位はcomputeDocumentRefetchInterval側で扱う。
 */
export function deriveSummaryDisplayState(input: DeriveSummaryDisplayStateInput): SummaryDisplayState {
  const { summary, summaryState, summaryErrorKind, ocrResult, ocrResultUrl, isDetailError, isGeneratingSummary } = input

  if (isGeneratingSummary || (summaryState === 'processing' && !isDetailError)) {
    return { kind: 'generating', summaryText: summary?.text }
  }

  if (summary?.text) {
    if (summaryState === 'pending') {
      return { kind: 'queued', summaryText: summary.text }
    }
    if (summaryState === 'error') {
      return {
        kind: 'generated-with-failure',
        summaryText: summary.text,
        errorMessage: summaryErrorMessage(summaryErrorKind),
      }
    }
    if (summaryState === 'skipped') {
      // 再生成の依頼後にバッチがskippedにした(原文の読込失敗・allowlist外等)。旧要約は温存されるが、
      // 今回の依頼は成功していないため「生成済み」には見せない(codex review P2指摘)。
      return {
        kind: 'generated-with-failure',
        summaryText: summary.text,
        errorMessage: SUMMARY_SKIPPED_MESSAGE,
      }
    }
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

  const hasEnoughOcrResult = !!ocrResultUrl || (!!ocrResult && ocrResult.length >= SUMMARY_MIN_OCR_LENGTH)
  if (!hasEnoughOcrResult) {
    return { kind: 'unavailable' }
  }

  if (summaryState === 'skipped') {
    // 要約なしで依頼が実行されなかった(allowlist外・原文の読込失敗・OCR未完了)。理由を伝え、ボタンは残す。
    return { kind: 'absent', errorMessage: SUMMARY_SKIPPED_MESSAGE }
  }

  return { kind: 'absent' }
}
