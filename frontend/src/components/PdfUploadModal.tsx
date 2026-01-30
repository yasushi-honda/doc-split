/**
 * PDFアップロードモーダル
 *
 * ローカルファイルからPDF/画像をアップロードしてOCR処理キューに追加
 */

import { useState, useRef, useCallback } from 'react'
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { httpsCallable } from 'firebase/functions'
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
import { functions } from '@/lib/firebase'

// 設定
const MAX_FILE_SIZE_MB = 10
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

// 対象MIMEタイプ
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/gif',
]

const ALLOWED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.tiff,.tif,.gif'

interface PdfUploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (documentId: string) => void
}

interface UploadResult {
  success: boolean
  documentId?: string
  // 重複検出時のレスポンス
  duplicate?: boolean
  existingFileName?: string
  suggestedFileName?: string
  existingDocumentId?: string
}

export function PdfUploadModal({ open, onOpenChange, onSuccess }: PdfUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [dragActive, setDragActive] = useState(false)
  // 重複確認ダイアログ
  const [duplicateInfo, setDuplicateInfo] = useState<{
    existingFileName: string
    suggestedFileName: string
  } | null>(null)

  const resetState = useCallback(() => {
    setSelectedFile(null)
    setError(null)
    setResult(null)
    setDuplicateInfo(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const handleClose = useCallback(() => {
    if (!uploading) {
      resetState()
      onOpenChange(false)
    }
  }, [uploading, resetState, onOpenChange])

  const validateFile = useCallback((file: File): string | null => {
    // MIMEタイプチェック
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return `対応していないファイル形式です: ${file.type || '不明'}。PDF/JPEG/PNG/TIFF/GIF形式のファイルを選択してください。`
    }

    // ファイルサイズチェック
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `ファイルサイズが大きすぎます: ${Math.round(file.size / 1024 / 1024)}MB。最大${MAX_FILE_SIZE_MB}MBまでです。`
    }

    return null
  }, [])

  const handleFileSelect = useCallback((file: File) => {
    setError(null)
    setResult(null)

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

  const handleUpload = useCallback(async (options?: { confirmDuplicate?: boolean; alternativeFileName?: string }) => {
    if (!selectedFile) return

    setUploading(true)
    setError(null)
    setDuplicateInfo(null)

    try {
      // ファイルをbase64に変換
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          // data:application/pdf;base64, の部分を除去
          const base64 = result.split(',')[1]
          resolve(base64)
        }
        reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'))
        reader.readAsDataURL(selectedFile)
      })

      // Cloud Function呼び出し
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
        setUploading(false)
        return
      }

      setResult(response.data)
      if (response.data.documentId) {
        onSuccess?.(response.data.documentId)
      }
    } catch (err) {
      console.error('Upload error:', err)

      // エラーメッセージの抽出
      let errorMessage = 'アップロードに失敗しました'
      if (err instanceof Error) {
        // Firebase Functions のエラーメッセージを解析
        const message = err.message
        if (message.includes('already-exists') || message.includes('already been uploaded')) {
          errorMessage = 'このファイルは既にアップロードされています'
        } else if (message.includes('permission-denied') || message.includes('not in whitelist')) {
          errorMessage = 'アップロード権限がありません'
        } else if (message.includes('invalid-argument')) {
          // メッセージから詳細を抽出
          const match = message.match(/: (.+)$/)
          errorMessage = match ? match[1] : message
        } else if (message.includes('unauthenticated')) {
          errorMessage = 'ログインが必要です'
        } else {
          errorMessage = message
        }
      }
      setError(errorMessage)
    } finally {
      setUploading(false)
    }
  }, [selectedFile, onSuccess])

  // 別名で保存を確定
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
              ${uploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-gray-400'}
            `}
            onClick={() => !uploading && fileInputRef.current?.click()}
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
              disabled={uploading}
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
                {!uploading && !result && (
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

          {/* 成功メッセージ */}
          {result && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">アップロード完了</AlertTitle>
              <AlertDescription className="text-green-700">
                ファイルがアップロードされました。OCR処理は数分後に自動実行されます。
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={uploading}>
            {result ? '閉じる' : 'キャンセル'}
          </Button>
          {!result && !duplicateInfo && (
            <Button
              onClick={() => handleUpload()}
              disabled={!selectedFile || uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  アップロード中...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  アップロード
                </>
              )}
            </Button>
          )}
          {duplicateInfo && (
            <Button onClick={handleConfirmAlternativeName} disabled={uploading}>
              {uploading ? (
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
