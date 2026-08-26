/**
 * PDFアップロードモーダル
 *
 * ローカルファイルからPDF/画像を複数まとめて選択し、逐次アップロードしてOCR処理キューに追加
 * 行ごとに独立してOCR処理の進捗を監視し、全件完了後に自動クローズ
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2, Clock, Sparkles, X, RefreshCw } from 'lucide-react'
import { doc, onSnapshot } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { db } from '@/lib/firebase'
import { callFunction, getCallableErrorMessage } from '@/lib/callFunction'
import type { DocumentStatus } from '@shared/types'

// 設定
const MAX_FILE_SIZE_MB = 10
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
const AUTO_CLOSE_DELAY_MS = 2000 // 完了後2秒で自動クローズ

// 対象MIMEタイプ
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/gif',
]

const ALLOWED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.tiff,.tif,.gif'

// 処理ステップ定義
type ProcessingStep = 'idle' | 'uploading' | 'pending' | 'processing' | 'processed' | 'error' | 'duplicate'

const STEP_CONFIG: Record<ProcessingStep, {
  label: string
  icon: React.ElementType
  progress: number
  color: string
}> = {
  idle: { label: '待機中', icon: Clock, progress: 0, color: 'text-gray-400' },
  uploading: { label: 'アップロード中...', icon: Loader2, progress: 20, color: 'text-blue-500' },
  pending: { label: 'OCR処理待機中...', icon: Clock, progress: 40, color: 'text-yellow-500' },
  processing: { label: 'OCR処理中...', icon: Sparkles, progress: 70, color: 'text-blue-500' },
  processed: { label: '処理完了!', icon: CheckCircle2, progress: 100, color: 'text-green-500' },
  error: { label: 'エラー', icon: AlertCircle, progress: 0, color: 'text-red-500' },
  duplicate: { label: '重複あり', icon: AlertCircle, progress: 0, color: 'text-yellow-500' },
}

interface PdfUploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (documentId: string) => void
}

interface UploadResult {
  success: boolean
  documentId?: string
  duplicate?: boolean
  existingFileName?: string
  suggestedFileName?: string
  existingDocumentId?: string
}

interface FileUploadItem {
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

function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return `対応していないファイル形式です: ${file.type || '不明'}。PDF/JPEG/PNG/TIFF/GIF形式のファイルを選択してください。`
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `ファイルサイズが大きすぎます: ${Math.round(file.size / 1024 / 1024)}MB。最大${MAX_FILE_SIZE_MB}MBまでです。`
  }
  return null
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function readFileAsBase64(file: File): Promise<string> {
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

function resolveUploadErrorMessage(err: unknown): string {
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

export function PdfUploadModal({ open, onOpenChange, onSuccess }: PdfUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<FileUploadItem[]>([])
  const [selectError, setSelectError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [isAnyUploadInFlight, setIsAnyUploadInFlight] = useState(false)
  const [claimedFileNames, setClaimedFileNames] = useState<ClaimedFileNames>(new Map())

  // handleRowStatusUpdate を documentId 変更以外で再生成させないための最新files参照
  const filesRef = useRef<FileUploadItem[]>(files)
  useEffect(() => {
    filesRef.current = files
  }, [files])

  const handleFilesSelect = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList)
    if (incoming.length === 0) return

    const validationErrors: string[] = []
    const newItems: FileUploadItem[] = []
    let nextClaimed = claimedFileNames

    for (const file of incoming) {
      const validationError = validateFile(file)
      if (validationError) {
        validationErrors.push(`${file.name}: ${validationError}`)
        continue
      }
      const id = crypto.randomUUID()
      const claimed = claimFileName(nextClaimed, file.name, id)
      if (claimed) {
        nextClaimed = claimed
      }
      newItems.push({ id, file, step: 'idle' })
    }

    if (newItems.length > 0) {
      setFiles((prev) => [...prev, ...newItems])
      setClaimedFileNames(nextClaimed)
    }
    setSelectError(validationErrors.length > 0 ? validationErrors.join('\n') : null)
  }, [claimedFileNames])

  const performUpload = useCallback(async (
    id: string,
    file: File,
    options?: { confirmDuplicate?: boolean; alternativeFileName?: string }
  ) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, step: 'uploading', error: undefined } : f)))

    try {
      const base64Data = await readFileAsBase64(file)

      const response = await callFunction<
        { fileName: string; mimeType: string; data: string; confirmDuplicate?: boolean; alternativeFileName?: string },
        UploadResult
      >('uploadPdf', {
        fileName: file.name,
        mimeType: file.type,
        data: base64Data,
        confirmDuplicate: options?.confirmDuplicate,
        alternativeFileName: options?.alternativeFileName,
      }, { timeout: 120_000 })

      if (response.duplicate && response.suggestedFileName) {
        setFiles((prev) => prev.map((f) => (f.id === id ? {
          ...f,
          step: 'duplicate',
          duplicateInfo: {
            existingFileName: response.existingFileName || file.name,
            suggestedFileName: response.suggestedFileName as string,
          },
        } : f)))
        return
      }

      if (response.success && response.documentId) {
        setFiles((prev) => prev.map((f) => (f.id === id ? {
          ...f,
          step: 'pending',
          documentId: response.documentId,
          duplicateInfo: undefined,
        } : f)))
        return
      }

      // 想定外レスポンス(duplicateでもdocumentIdでもない成功応答): fail-visibleにerrorへ倒す
      setFiles((prev) => prev.map((f) => (f.id === id ? {
        ...f,
        step: 'error',
        error: '予期しない応答が返されました。再試行してください。',
      } : f)))
      // documentIdが発行されず終端したため、onSnapshot経由の解放が発生しない。ここで明示的に解放する
      setClaimedFileNames((prev) => releaseRowClaims(prev, id))
    } catch (err) {
      console.error('Upload error:', err)
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, step: 'error', error: resolveUploadErrorMessage(err) } : f)))
      // callFunction自体が失敗した場合も同様にdocumentIdが発行されないため、ここで明示的に解放する
      // (codex review指摘: 別名で保存の確定リクエストがネットワークエラー等で失敗すると、
      //  claimedFileNamesの予約がリークし、他の重複行が永久に「他のファイルの処理完了後に再試行」に
      //  ブロックされ続けていた)
      setClaimedFileNames((prev) => releaseRowClaims(prev, id))
    }
  }, [])

  // バッチ全体の逐次アップロード
  const handleUploadAll = useCallback(async () => {
    if (isAnyUploadInFlight) return
    const targets = files.filter((f) => f.step === 'idle').map((f) => ({ id: f.id, file: f.file }))
    if (targets.length === 0) return

    setIsAnyUploadInFlight(true)
    try {
      for (const target of targets) {
        await performUpload(target.id, target.file)
      }
    } finally {
      setIsAnyUploadInFlight(false)
    }
  }, [files, isAnyUploadInFlight, performUpload])

  // 行単位の単独アップロード(再試行・別名で保存)。バッチループの外から呼ぶ想定
  const uploadOneFile = useCallback(async (
    id: string,
    options?: { confirmDuplicate?: boolean; alternativeFileName?: string }
  ) => {
    if (isAnyUploadInFlight) return
    const item = files.find((f) => f.id === id)
    if (!item) return

    setIsAnyUploadInFlight(true)
    try {
      await performUpload(id, item.file, options)
    } finally {
      setIsAnyUploadInFlight(false)
    }
  }, [files, isAnyUploadInFlight, performUpload])

  const handleRetry = useCallback((id: string) => {
    uploadOneFile(id)
  }, [uploadOneFile])

  const handleResolveDuplicate = useCallback((id: string) => {
    const item = files.find((f) => f.id === id)
    if (!item?.duplicateInfo) return
    const suggested = item.duplicateInfo.suggestedFileName

    setClaimedFileNames((prev) => claimFileName(prev, suggested, id) ?? prev)
    uploadOneFile(id, { confirmDuplicate: true, alternativeFileName: suggested })
  }, [files, uploadOneFile])

  const handleRemoveFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
    setClaimedFileNames((prev) => releaseRowClaims(prev, id))
  }, [])

  // FileUploadRow の onSnapshot からの状態更新。documentId以外で再生成されないよう
  // files の参照は filesRef 経由で読み、依存配列を onSuccess のみに保つ
  const handleRowStatusUpdate = useCallback((
    id: string,
    step: 'pending' | 'processing' | 'processed' | 'error',
    errorMessage?: string
  ) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, step, error: errorMessage } : f)))

    if (step === 'processed' || step === 'error') {
      setClaimedFileNames((prev) => releaseRowClaims(prev, id))
    }
    if (step === 'processed') {
      const item = filesRef.current.find((f) => f.id === id)
      if (item?.documentId) {
        onSuccess?.(item.documentId)
      }
    }
  }, [onSuccess])

  const handleClose = useCallback(() => {
    if (files.some((f) => f.step === 'uploading')) return
    setFiles([])
    setClaimedFileNames(new Map())
    setSelectError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onOpenChange(false)
  }, [files, onOpenChange])

  // 全件完了後の自動クローズ
  useEffect(() => {
    if (files.length > 0 && files.every((f) => f.step === 'processed')) {
      const timer = setTimeout(() => {
        handleClose()
      }, AUTO_CLOSE_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [files, handleClose])

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      handleFilesSelect(event.target.files)
    }
    // ブラウザは同一valueでのchange再発火をしないため、同名ファイルの選び直しに対応するためリセットする
    event.target.value = ''
  }, [handleFilesSelect])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelect(e.dataTransfer.files)
    }
  }, [handleFilesSelect])

  const hasIdleFiles = files.some((f) => f.step === 'idle')

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>PDFアップロード</DialogTitle>
          <DialogDescription>
            PDF/画像ファイルをアップロードしてOCR処理を行います(複数選択可)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* ドラッグ&ドロップエリア */}
          <div
            className={`
              relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
              ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}
              ${isAnyUploadInFlight ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-gray-400'}
            `}
            onClick={() => !isAnyUploadInFlight && fileInputRef.current?.click()}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ALLOWED_EXTENSIONS}
              onChange={handleInputChange}
              className="hidden"
              disabled={isAnyUploadInFlight}
            />

            <div className="flex flex-col items-center gap-2">
              <Upload className="h-10 w-10 text-gray-400" />
              <p className="text-gray-600">
                クリックまたはドラッグ&ドロップでファイルを選択(複数可)
              </p>
              <p className="text-sm text-gray-400">
                PDF, JPEG, PNG, TIFF, GIF（1ファイルあたり最大{MAX_FILE_SIZE_MB}MB）
              </p>
            </div>
          </div>

          {selectError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>選択できなかったファイルがあります</AlertTitle>
              <AlertDescription className="whitespace-pre-line">{selectError}</AlertDescription>
            </Alert>
          )}

          {/* 選択済みファイル一覧 */}
          {files.length > 0 && (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {files.map((item) => (
                <FileUploadRow
                  key={item.id}
                  item={item}
                  disabled={isAnyUploadInFlight}
                  isSuggestedNameClaimedByOther={
                    item.duplicateInfo
                      ? isNameClaimedByOther(claimedFileNames, item.duplicateInfo.suggestedFileName, item.id)
                      : false
                  }
                  onRemove={handleRemoveFile}
                  onRetry={handleRetry}
                  onResolveDuplicate={handleResolveDuplicate}
                  onStatusUpdate={handleRowStatusUpdate}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={files.some((f) => f.step === 'uploading')}
          >
            {files.length > 0 && files.every((f) => f.step === 'processed') ? '閉じる' : 'キャンセル'}
          </Button>
          <Button
            onClick={handleUploadAll}
            disabled={!hasIdleFiles || isAnyUploadInFlight}
          >
            {isAnyUploadInFlight ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                処理中...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                アップロード
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface FileUploadRowProps {
  item: FileUploadItem
  disabled: boolean
  isSuggestedNameClaimedByOther: boolean
  onRemove: (id: string) => void
  onRetry: (id: string) => void
  onResolveDuplicate: (id: string) => void
  onStatusUpdate: (id: string, step: 'pending' | 'processing' | 'processed' | 'error', errorMessage?: string) => void
}

function FileUploadRow({
  item,
  disabled,
  isSuggestedNameClaimedByOther,
  onRemove,
  onRetry,
  onResolveDuplicate,
  onStatusUpdate,
}: FileUploadRowProps) {
  // documentId確定時にのみ購読を張る。stepの変化では再購読しない(依存配列はdocumentIdのみ)
  useEffect(() => {
    if (!item.documentId) return

    const unsubscribe = onSnapshot(
      doc(db, 'documents', item.documentId),
      (snapshot) => {
        const data = snapshot.data()
        if (!data) return

        const status = data.status as DocumentStatus

        if (status === 'pending') {
          onStatusUpdate(item.id, 'pending')
        } else if (status === 'processing') {
          onStatusUpdate(item.id, 'processing')
        } else if (status === 'processed') {
          onStatusUpdate(item.id, 'processed')
          unsubscribe()
        } else if (status === 'error') {
          onStatusUpdate(item.id, 'error', data.lastErrorMessage || 'OCR処理に失敗しました')
          unsubscribe()
        }
      },
      (err) => {
        console.error('Snapshot error:', err)
      }
    )

    return () => unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.documentId])

  const stepConfig = STEP_CONFIG[item.step]
  const StepIcon = stepConfig.icon
  const isProcessing = ['uploading', 'pending', 'processing'].includes(item.step)

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <FileText className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-gray-900 truncate max-w-[280px]">{item.file.name}</p>
            <p className="text-xs text-gray-500">{formatFileSize(item.file.size)}</p>
          </div>
        </div>
        {item.step === 'idle' && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 h-7 w-7 p-0"
            disabled={disabled}
            onClick={() => onRemove(item.id)}
            aria-label="削除"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {item.step !== 'idle' && item.step !== 'duplicate' && item.step !== 'processed' && item.step !== 'error' && (
        <div className="flex items-center gap-2">
          <StepIcon className={`h-4 w-4 ${stepConfig.color} ${item.step === 'uploading' || item.step === 'processing' ? 'animate-spin' : ''}`} />
          <span className={`text-xs font-medium ${stepConfig.color}`}>{stepConfig.label}</span>
        </div>
      )}

      {isProcessing && (
        <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-500 ease-out"
            style={{ width: `${stepConfig.progress}%` }}
          />
        </div>
      )}

      {item.step === 'duplicate' && item.duplicateInfo && (
        <Alert className="border-yellow-200 bg-yellow-50 py-2">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-800 text-sm">同名ファイルが存在します</AlertTitle>
          <AlertDescription className="text-yellow-700 text-xs space-y-2">
            <p>「{item.duplicateInfo.existingFileName}」は既に登録されています。別名「{item.duplicateInfo.suggestedFileName}」で保存しますか？</p>
            {isSuggestedNameClaimedByOther ? (
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => onRetry(item.id)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                他のファイルの処理完了後に再試行
              </Button>
            ) : (
              <Button size="sm" disabled={disabled} onClick={() => onResolveDuplicate(item.id)}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                別名で保存
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {item.step === 'error' && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-sm">エラー</AlertTitle>
          <AlertDescription className="text-xs space-y-2">
            <p>{item.error}</p>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => onRetry(item.id)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              再試行
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {item.step === 'processed' && (
        <div className="flex items-center gap-2 text-green-600 text-xs">
          <CheckCircle2 className="h-4 w-4" />
          処理完了
        </div>
      )}
    </div>
  )
}
