/**
 * PDFアップロードモーダル(表示専用、Issue #1031)
 *
 * ローカルファイルからPDF/画像を複数まとめて選択し、逐次アップロードしてOCR処理キューに追加
 * アップロード状態・ロジック・Firestore onSnapshot購読はpdfUploadStore.tsへ引き上げ済みで、
 * このコンポーネントはストアのセレクタで状態を読み、モーダルの開閉から独立してバックグラウンドで
 * 処理が継続できるようにする(閉じてもストアの処理・購読は止まらない)。
 */

import { useRef, useState, useCallback } from 'react'
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2, Clock, Sparkles, X, RefreshCw } from 'lucide-react'
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
import { usePdfUploadStore } from '@/stores/pdfUploadStore'
import {
  isNameClaimedByOther,
  isActiveStep,
  formatFileSize,
  MAX_FILE_SIZE_MB,
  ALLOWED_EXTENSIONS,
  type ProcessingStep,
  type FileUploadItem,
} from '@/lib/pdfUpload'

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

export function PdfUploadModal() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  const isModalOpen = usePdfUploadStore((s) => s.isModalOpen)
  const files = usePdfUploadStore((s) => s.files)
  const selectError = usePdfUploadStore((s) => s.selectError)
  const isAnyUploadInFlight = usePdfUploadStore((s) => s.isAnyUploadInFlight)
  const claimedFileNames = usePdfUploadStore((s) => s.claimedFileNames)
  const openModal = usePdfUploadStore((s) => s.openModal)
  const closeModal = usePdfUploadStore((s) => s.closeModal)
  const addFiles = usePdfUploadStore((s) => s.addFiles)
  const uploadAll = usePdfUploadStore((s) => s.uploadAll)
  const retry = usePdfUploadStore((s) => s.retry)
  const resolveDuplicate = usePdfUploadStore((s) => s.resolveDuplicate)
  const removeFile = usePdfUploadStore((s) => s.removeFile)

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      addFiles(event.target.files)
    }
    // ブラウザは同一valueでのchange再発火をしないため、同名ファイルの選び直しに対応するためリセットする
    event.target.value = ''
  }, [addFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }, [addFiles])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const hasIdleFiles = files.some((f) => f.step === 'idle')
  const hasActiveRow = files.some((f) => isActiveStep(f.step)) || isAnyUploadInFlight
  const allProcessed = files.length > 0 && files.every((f) => f.step === 'processed')
  const hasAttentionRow = files.some((f) => f.step === 'error' || f.step === 'duplicate')

  // ボタン文言: 進行中の行、またはerror/duplicate行(NeedsAttention)が残っていれば
  // 「閉じる(バックグラウンドで継続)」、全件processedなら「閉じる」、それ以外は「キャンセル」
  const closeButtonLabel = allProcessed
    ? '閉じる'
    : hasActiveRow || hasAttentionRow
      ? '閉じる(バックグラウンドで継続)'
      : 'キャンセル'

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => (open ? openModal() : closeModal())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>PDFアップロード</DialogTitle>
          <DialogDescription>
            PDF/画像ファイルをアップロードしてOCR処理を行います(複数選択可)
            {(hasActiveRow || hasAttentionRow) && !allProcessed && '。閉じても処理は継続されます'}
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
                  onRemove={removeFile}
                  onRetry={retry}
                  onResolveDuplicate={resolveDuplicate}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={closeModal}
          >
            {closeButtonLabel}
          </Button>
          <Button
            onClick={uploadAll}
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
}

function FileUploadRow({
  item,
  disabled,
  isSuggestedNameClaimedByOther,
  onRemove,
  onRetry,
  onResolveDuplicate,
}: FileUploadRowProps) {
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
