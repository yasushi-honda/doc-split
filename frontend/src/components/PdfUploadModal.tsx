/**
 * PDFアップロードモーダル
 *
 * ローカルファイルからPDF/画像をアップロードしてOCR処理キューに追加
 * OCR処理の進捗を監視し、完了後に自動クローズ
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2, Clock, Sparkles } from 'lucide-react'
import { httpsCallable } from 'firebase/functions'
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
import { functions, db, auth } from '@/lib/firebase'
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
type ProcessingStep = 'idle' | 'uploading' | 'pending' | 'processing' | 'processed' | 'error'

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

export function PdfUploadModal({ open, onOpenChange, onSuccess }: PdfUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<ProcessingStep>('idle')
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [duplicateInfo, setDuplicateInfo] = useState<{
    existingFileName: string
    suggestedFileName: string
  } | null>(null)

  // 状態リセット関数（useEffectより前に定義）
  const resetState = useCallback(() => {
    setSelectedFile(null)
    setError(null)
    setCurrentStep('idle')
    setDocumentId(null)
    setDuplicateInfo(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  // OCR処理完了を監視
  useEffect(() => {
    if (!documentId || currentStep === 'processed' || currentStep === 'error') {
      return
    }

    const unsubscribe = onSnapshot(
      doc(db, 'documents', documentId),
      (snapshot) => {
        const data = snapshot.data()
        if (!data) return

        const status = data.status as DocumentStatus

        if (status === 'pending') {
          setCurrentStep('pending')
        } else if (status === 'processing') {
          setCurrentStep('processing')
        } else if (status === 'processed') {
          setCurrentStep('processed')
          onSuccess?.(documentId)
        } else if (status === 'error') {
          setCurrentStep('error')
          setError(data.lastErrorMessage || 'OCR処理に失敗しました')
        }
      },
      (err) => {
        console.error('Snapshot error:', err)
      }
    )

    return () => unsubscribe()
  }, [documentId, currentStep, onSuccess])

  // 処理完了後の自動クローズ
  useEffect(() => {
    if (currentStep === 'processed') {
      const timer = setTimeout(() => {
        resetState()
        onOpenChange(false)
      }, AUTO_CLOSE_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [currentStep, onOpenChange, resetState])

  const handleClose = useCallback(() => {
    if (currentStep !== 'uploading') {
      resetState()
      onOpenChange(false)
    }
  }, [currentStep, resetState, onOpenChange])

  const validateFile = useCallback((file: File): string | null => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return `対応していないファイル形式です: ${file.type || '不明'}。PDF/JPEG/PNG/TIFF/GIF形式のファイルを選択してください。`
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `ファイルサイズが大きすぎます: ${Math.round(file.size / 1024 / 1024)}MB。最大${MAX_FILE_SIZE_MB}MBまでです。`
    }
    return null
  }, [])

  const handleFileSelect = useCallback((file: File) => {
    setError(null)
    setCurrentStep('idle')

    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      setSelectedFile(null)
      return
    }

    setSelectedFile(file)
  }, [validateFile])

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }, [handleFileSelect])

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

    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }, [handleFileSelect])

  const handleUpload = useCallback(async (options?: { confirmDuplicate?: boolean; alternativeFileName?: string; isRetry?: boolean }) => {
    if (!selectedFile) return

    setCurrentStep('uploading')
    setError(null)
    setDuplicateInfo(null)

    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          const base64 = result.split(',')[1]
          resolve(base64)
        }
        reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'))
        reader.readAsDataURL(selectedFile)
      })

      const uploadPdf = httpsCallable<
        { fileName: string; mimeType: string; data: string; confirmDuplicate?: boolean; alternativeFileName?: string },
        UploadResult
      >(functions, 'uploadPdf')

      const response = await uploadPdf({
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        data: base64Data,
        confirmDuplicate: options?.confirmDuplicate,
        alternativeFileName: options?.alternativeFileName,
      })

      // 重複検出の場合
      if (response.data.duplicate && response.data.suggestedFileName) {
        setDuplicateInfo({
          existingFileName: response.data.existingFileName || selectedFile.name,
          suggestedFileName: response.data.suggestedFileName,
        })
        setCurrentStep('idle')
        return
      }

      // アップロード成功 → documentIdを設定してOCR処理監視開始
      if (response.data.documentId) {
        setDocumentId(response.data.documentId)
        setCurrentStep('pending')
      }
    } catch (err) {
      console.error('Upload error:', err)

      // unauthenticatedエラー時: トークンリフレッシュして1回リトライ
      if (err instanceof Error && err.message.includes('unauthenticated') && !options?.isRetry && auth.currentUser) {
        try {
          await auth.currentUser.getIdToken(true)
          return handleUpload({ ...options, isRetry: true })
        } catch {
          // リフレッシュ失敗 → 通常のエラー処理へ
        }
      }

      setCurrentStep('error')

      let errorMessage = 'アップロードに失敗しました'
      if (err instanceof Error) {
        const message = err.message
        if (message.includes('already-exists') || message.includes('already been uploaded')) {
          errorMessage = 'このファイルは既にアップロードされています'
        } else if (message.includes('permission-denied') || message.includes('not in whitelist')) {
          errorMessage = 'アップロード権限がありません'
        } else if (message.includes('invalid-argument')) {
          const match = message.match(/: (.+)$/)
          errorMessage = match ? match[1] : message
        } else if (message.includes('unauthenticated')) {
          errorMessage = 'ログインセッションが切れました。ページを再読み込みしてください。'
        } else {
          errorMessage = message
        }
      }
      setError(errorMessage)
    }
  }, [selectedFile])

  const handleConfirmAlternativeName = useCallback(() => {
    if (duplicateInfo) {
      handleUpload({ confirmDuplicate: true, alternativeFileName: duplicateInfo.suggestedFileName })
    }
  }, [duplicateInfo, handleUpload])

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const isProcessing = ['uploading', 'pending', 'processing'].includes(currentStep)
  const stepConfig = STEP_CONFIG[currentStep]
  const StepIcon = stepConfig.icon

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>PDFアップロード</DialogTitle>
          <DialogDescription>
            PDF/画像ファイルをアップロードしてOCR処理を行います
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* ドラッグ&ドロップエリア */}
          <div
            className={`
              relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
              ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}
              ${isProcessing ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-gray-400'}
            `}
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_EXTENSIONS}
              onChange={handleInputChange}
              className="hidden"
              disabled={isProcessing}
            />

            {selectedFile ? (
              <div className="flex flex-col items-center gap-2">
                <FileText className="h-10 w-10 text-blue-500" />
                <p className="font-medium text-gray-900 truncate max-w-full">
                  {selectedFile.name}
                </p>
                <p className="text-sm text-gray-500">
                  {formatFileSize(selectedFile.size)}
                </p>
                {currentStep === 'idle' && !duplicateInfo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      resetState()
                    }}
                  >
                    ファイルを変更
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-gray-400" />
                <p className="text-gray-600">
                  クリックまたはドラッグ&ドロップでファイルを選択
                </p>
                <p className="text-sm text-gray-400">
                  PDF, JPEG, PNG, TIFF, GIF（最大{MAX_FILE_SIZE_MB}MB）
                </p>
              </div>
            )}
          </div>

          {/* 処理ステップ表示 */}
          {isProcessing && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <StepIcon className={`h-5 w-5 ${stepConfig.color} ${currentStep === 'uploading' || currentStep === 'processing' ? 'animate-spin' : ''}`} />
                <span className={`text-sm font-medium ${stepConfig.color}`}>
                  {stepConfig.label}
                </span>
              </div>
              <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-500 ease-out"
                  style={{ width: `${stepConfig.progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 text-center">
                {currentStep === 'pending' && 'まもなくOCR処理が開始されます...'}
                {currentStep === 'processing' && 'AIがドキュメントを解析しています...'}
              </p>
            </div>
          )}

          {/* 処理完了 */}
          {currentStep === 'processed' && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">処理完了!</AlertTitle>
              <AlertDescription className="text-green-700">
                OCR処理が完了しました。まもなくこのダイアログは閉じます。
              </AlertDescription>
            </Alert>
          )}

          {/* 重複確認 */}
          {duplicateInfo && (
            <Alert className="border-yellow-200 bg-yellow-50">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <AlertTitle className="text-yellow-800">同名ファイルが存在します</AlertTitle>
              <AlertDescription className="text-yellow-700">
                <p className="mb-2">「{duplicateInfo.existingFileName}」は既に登録されています。</p>
                <p>別名「{duplicateInfo.suggestedFileName}」で保存しますか？</p>
              </AlertDescription>
            </Alert>
          )}

          {/* エラー表示 */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>エラー</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={currentStep === 'uploading'}>
            {currentStep === 'processed' ? '閉じる' : 'キャンセル'}
          </Button>
          {currentStep === 'idle' && !duplicateInfo && (
            <Button
              onClick={() => handleUpload()}
              disabled={!selectedFile}
            >
              <Upload className="mr-2 h-4 w-4" />
              アップロード
            </Button>
          )}
          {duplicateInfo && (
            <Button onClick={handleConfirmAlternativeName} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  別名で保存
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
