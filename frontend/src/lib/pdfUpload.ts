/**
 * PDFアップロードの純粋関数層(Issue #1031)
 *
 * PdfUploadModal.tsxのローカルstateだったアップロードロジックを、
 * frontend/src/stores/pdfUploadStore.tsから利用する純粋関数として切り出す。
 * ReactやonSnapshot等の副作用に依存しない部分だけをここに置く。
 */

import { getCallableErrorMessage } from '@/lib/callFunction'

// 設定
export const MAX_FILE_SIZE_MB = 10
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
export const AUTO_CLOSE_DELAY_MS = 2000 // 完了後2秒で自動クローズ

// 対象MIMEタイプ
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/gif',
]

export const ALLOWED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.tiff,.tif,.gif'

// 処理ステップ定義
export type ProcessingStep = 'idle' | 'uploading' | 'pending' | 'processing' | 'processed' | 'error' | 'duplicate'

export interface UploadResult {
  success: boolean
  documentId?: string
  duplicate?: boolean
  existingFileName?: string
  suggestedFileName?: string
  existingDocumentId?: string
}

export interface FileUploadItem {
  id: string
  file: File
  step: ProcessingStep
  documentId?: string
  error?: string
  duplicateInfo?: { existingFileName: string; suggestedFileName: string }
}

// ============================================
// claimedFileNames 予約ロジック(純粋関数、UIイベントから分離して単体テスト可能にする)
//
// 候補ファイル名(通常アップロードの元ファイル名 or 重複解決時の代替名)を
// 「候補名 → 予約している行ID」のMapで管理する。同一バッチ内で複数の行が
// 同じ最終ファイル名を狙って衝突するのを防ぐためのクライアントローカルな排他制御。
// BE(uploadPdf.ts)側の重複検査は変更しない前提のため、別タブ・別ユーザー間の
// 衝突までは防げない(既知の残存リスク、Issue #815スコープ外)。
// ============================================

export type ClaimedFileNames = Map<string, string>

export function claimFileName(
  claimed: ClaimedFileNames,
  fileName: string,
  rowId: string
): ClaimedFileNames | null {
  const owner = claimed.get(fileName)
  if (owner && owner !== rowId) {
    return null // 他の行が既に予約済み
  }
  const next = new Map(claimed)
  next.set(fileName, rowId)
  return next
}

export function releaseRowClaims(claimed: ClaimedFileNames, rowId: string): ClaimedFileNames {
  const next = new Map(claimed)
  for (const [name, owner] of next) {
    if (owner === rowId) {
      next.delete(name)
    }
  }
  return next
}

export function isNameClaimedByOther(claimed: ClaimedFileNames, fileName: string, rowId: string): boolean {
  const owner = claimed.get(fileName)
  return !!owner && owner !== rowId
}

export function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return `対応していないファイル形式です: ${file.type || '不明'}。PDF/JPEG/PNG/TIFF/GIF形式のファイルを選択してください。`
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `ファイルサイズが大きすぎます: ${Math.round(file.size / 1024 / 1024)}MB。最大${MAX_FILE_SIZE_MB}MBまでです。`
  }
  return null
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'))
    reader.readAsDataURL(file)
  })
}

export function resolveUploadErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const message = err.message
    if (message.includes('already-exists') || message.includes('already been uploaded')) {
      return 'このファイルは既にアップロードされています'
    }
    if (message.includes('invalid-argument')) {
      const match = message.match(/: (.+)$/)
      return match ? match[1] ?? message : message
    }
    return getCallableErrorMessage(err, 'アップロードに失敗しました')
  }
  return 'アップロードに失敗しました'
}

// ============================================
// OCR進捗(Firestore onSnapshot)のstatus → ProcessingStep 変換
// ============================================

export interface DocumentSnapshotData {
  status?: string
  lastErrorMessage?: string
}

export type TerminalOrProgressStep = 'pending' | 'processing' | 'processed' | 'error'

/**
 * onSnapshotのnext/errorどちらのコールバックからも呼べる形にする。
 * `data`がundefined(文書消失、またはerrorコールバック相当)はerror終端として扱う。
 * `split`はprocessed扱い。未知のstatus値もerror終端にし、pendingのまま固まらせない。
 */
export function mapDocumentStatusToStep(
  data: DocumentSnapshotData | undefined
): { step: TerminalOrProgressStep; error?: string } {
  if (!data) {
    return { step: 'error', error: '書類の状態を取得できませんでした。再試行してください。' }
  }
  switch (data.status) {
    case 'pending':
      return { step: 'pending' }
    case 'processing':
      return { step: 'processing' }
    case 'processed':
    case 'split':
      return { step: 'processed' }
    case 'error':
      return { step: 'error', error: data.lastErrorMessage || 'OCR処理に失敗しました' }
    default:
      return { step: 'error', error: '予期しないステータスです。再試行してください。' }
  }
}

export function isActiveStep(step: ProcessingStep): boolean {
  return step === 'uploading' || step === 'pending' || step === 'processing'
}

export interface UploadSummary {
  total: number
  active: number
  needsAttention: boolean
  allDone: boolean
}

export function summarizeUploads(files: FileUploadItem[], isAnyUploadInFlight: boolean): UploadSummary {
  const total = files.length
  const active = files.filter((f) => isActiveStep(f.step)).length
  const hasAttentionRows = files.some((f) => f.step === 'error' || f.step === 'duplicate')
  const needsAttention = !isAnyUploadInFlight && active === 0 && hasAttentionRows
  const allDone = total > 0 && files.every((f) => f.step === 'processed')
  return { total, active, needsAttention, allDone }
}

export type UploadToastSpec =
  | { kind: 'dismiss' }
  | { kind: 'loading'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string; actionLabel: string }

/**
 * トースト表示ルール: Open×* → dismiss / Hidden×Active → loading /
 * Hidden×NeedsAttention → error+確認ボタン / Hidden×AllDone(一瞬) → success
 */
export function deriveUploadToast(summary: UploadSummary, isModalOpen: boolean): UploadToastSpec | null {
  if (isModalOpen) {
    return { kind: 'dismiss' }
  }
  if (summary.allDone) {
    return { kind: 'success', message: 'PDFのアップロードが完了しました' }
  }
  if (summary.needsAttention) {
    return { kind: 'error', message: '確認が必要なファイルがあります', actionLabel: '確認' }
  }
  if (summary.active > 0) {
    return { kind: 'loading', message: `PDFをアップロード中です(${summary.total}件)` }
  }
  return null
}
