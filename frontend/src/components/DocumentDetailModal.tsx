/**
 * 書類詳細モーダル
 * PDFビューアーとメタ情報を表示
 */

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Timestamp } from 'firebase/firestore'
import { ref, getDownloadURL } from 'firebase/storage'
import { Download, ExternalLink, Loader2, FileText, User, Building, Calendar, Tag, AlertCircle, Scissors, UserCheck } from 'lucide-react'
import { storage } from '@/lib/firebase'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { VisuallyHidden } from '@/components/ui/visually-hidden'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PdfViewer } from '@/components/PdfViewer'
import { PdfSplitModal } from '@/components/PdfSplitModal'
import { SameNameResolveModal } from '@/components/SameNameResolveModal'
import { useDocument } from '@/hooks/useDocuments'
import { isCustomerConfirmed } from '@/hooks/useProcessingHistory'
import type { DocumentStatus } from '@shared/types'

interface DocumentDetailModalProps {
  documentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ステータス設定
const STATUS_CONFIG: Record<DocumentStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  pending: { label: '待機中', variant: 'secondary' },
  processing: { label: '処理中', variant: 'warning' },
  processed: { label: '完了', variant: 'success' },
  error: { label: 'エラー', variant: 'destructive' },
  split: { label: '分割済', variant: 'default' },
}

// Timestampを日付文字列に変換
function formatTimestamp(timestamp: Timestamp | undefined, formatStr = 'yyyy年MM月dd日'): string {
  if (!timestamp) return '-'
  try {
    return format(timestamp.toDate(), formatStr, { locale: ja })
  } catch {
    return '-'
  }
}

// メタ情報行
function MetaRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="truncate text-sm text-gray-900">{value || '-'}</p>
      </div>
    </div>
  )
}

export function DocumentDetailModal({ documentId, open, onOpenChange }: DocumentDetailModalProps) {
  const { data: document, isLoading, isError, error, refetch } = useDocument(documentId)
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false)
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [urlLoading, setUrlLoading] = useState(false)

  // 顧客確定状態を判定（Phase 7）
  const needsCustomerConfirmation = document ? !isCustomerConfirmed(document) : false

  // ドキュメントが変わったらdownloadUrlをリセット
  useEffect(() => {
    setDownloadUrl(null)
    setUrlLoading(false)
  }, [documentId])

  // gs:// URL を HTTPS ダウンロードURLに変換
  useEffect(() => {
    async function convertGsUrl() {
      if (!document?.fileUrl) {
        setDownloadUrl(null)
        return
      }

      // 既にHTTPS URLの場合はそのまま使用
      if (document.fileUrl.startsWith('https://')) {
        setDownloadUrl(document.fileUrl)
        return
      }

      // gs:// URLの場合は変換
      if (document.fileUrl.startsWith('gs://')) {
        setUrlLoading(true)
        try {
          // gs://bucket/path から path を抽出
          const gsUrl = document.fileUrl
          const match = gsUrl.match(/^gs:\/\/[^/]+\/(.+)$/)
          if (match) {
            const filePath = match[1]
            const fileRef = ref(storage, filePath)
            const url = await getDownloadURL(fileRef)
            setDownloadUrl(url)
          } else {
            console.error('Invalid gs:// URL format:', gsUrl)
            setDownloadUrl(null)
          }
        } catch (err) {
          console.error('Failed to get download URL:', err)
          setDownloadUrl(null)
        } finally {
          setUrlLoading(false)
        }
      }
    }

    convertGsUrl()
  }, [document?.fileUrl])

  // ダウンロード処理
  const handleDownload = () => {
    if (downloadUrl) {
      window.open(downloadUrl, '_blank')
    }
  }

  // 分割成功時
  const handleSplitSuccess = () => {
    refetch()
    setIsSplitModalOpen(false)
  }

  // 顧客解決成功時（Phase 7）
  const handleResolveSuccess = () => {
    refetch()
    setIsResolveModalOpen(false)
  }

  // 分割可能かどうか（複数ページのPDFで、processed状態）
  const canSplit = document &&
    document.totalPages > 1 &&
    document.mimeType === 'application/pdf' &&
    document.status === 'processed'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-7xl flex-col p-0" aria-describedby={undefined}>
        {isLoading ? (
          <>
            <VisuallyHidden>
              <DialogTitle>書類詳細を読み込み中</DialogTitle>
            </VisuallyHidden>
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">読み込み中...</span>
            </div>
          </>
        ) : isError ? (
          <>
            <VisuallyHidden>
              <DialogTitle>エラー</DialogTitle>
            </VisuallyHidden>
            <div className="flex flex-1 flex-col items-center justify-center text-red-500">
              <AlertCircle className="mb-2 h-8 w-8" />
              <p>データの読み込みに失敗しました</p>
              <p className="text-sm text-gray-500">{error?.message}</p>
            </div>
          </>
        ) : document ? (
          <>
            {/* ヘッダー */}
            <DialogHeader className="flex-shrink-0 border-b p-3 sm:p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <FileText className="hidden h-6 w-6 text-gray-400 sm:block" />
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="truncate text-base sm:text-lg">{document.fileName}</DialogTitle>
                    <p className="text-xs text-gray-500 sm:text-sm">{document.documentType || '未判定'}</p>
                  </div>
                  <Badge variant={(STATUS_CONFIG[document.status] || STATUS_CONFIG.pending).variant}>
                    {(STATUS_CONFIG[document.status] || STATUS_CONFIG.pending).label}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  {canSplit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsSplitModalOpen(true)}
                      className="text-orange-600 border-orange-300 hover:bg-orange-50"
                    >
                      <Scissors className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">PDF分割</span>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={handleDownload} disabled={!downloadUrl}>
                    <Download className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">ダウンロード</span>
                  </Button>
                  {downloadUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(downloadUrl, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">新しいタブで開く</span>
                    </Button>
                  )}
                </div>
              </div>
            </DialogHeader>

            {/* コンテンツエリア */}
            <div className="flex flex-1 overflow-hidden">
              {/* PDFビューアー */}
              <div className="min-w-0 flex-1 bg-gray-100">
                {urlLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-500">ファイルを読み込み中...</span>
                  </div>
                ) : downloadUrl && document.mimeType === 'application/pdf' ? (
                  <PdfViewer
                    fileUrl={downloadUrl}
                    totalPages={document.totalPages}
                  />
                ) : downloadUrl ? (
                  // PDF以外のファイル（画像など）
                  <div className="flex h-full items-center justify-center">
                    <img
                      src={downloadUrl}
                      alt={document.fileName}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-gray-500">
                    <FileText className="mb-4 h-16 w-16 text-gray-300" />
                    <p>プレビューを表示できません</p>
                  </div>
                )}
              </div>

              {/* メタ情報サイドバー（モバイルでは非表示） */}
              <div className="hidden w-80 flex-shrink-0 overflow-y-auto border-l bg-white p-4 md:block">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">書類情報</h3>

                <div className="divide-y">
                  <MetaRow
                    icon={User}
                    label="顧客名"
                    value={
                      <div className="flex items-center gap-2">
                        <span>{document.customerName || '未判定'}</span>
                        {needsCustomerConfirmation && (
                          <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
                            要確認
                          </Badge>
                        )}
                      </div>
                    }
                  />
                  <MetaRow icon={Building} label="事業所" value={document.officeName} />
                  <MetaRow icon={Tag} label="書類種別" value={document.documentType || '未判定'} />
                  <MetaRow icon={Calendar} label="書類日付" value={formatTimestamp(document.fileDate)} />
                  <MetaRow icon={Calendar} label="処理日時" value={formatTimestamp(document.processedAt, 'yyyy/MM/dd HH:mm')} />
                  <MetaRow icon={FileText} label="ページ数" value={`${document.totalPages} ページ`} />
                </div>

                {/* 顧客確定ボタン（Phase 7） */}
                {needsCustomerConfirmation && (
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100"
                      onClick={() => setIsResolveModalOpen(true)}
                    >
                      <UserCheck className="h-4 w-4 mr-2" />
                      顧客を確定
                    </Button>
                  </div>
                )}

                {/* 重複警告 */}
                {document.isDuplicateCustomer && document.allCustomerCandidates && (
                  <div className="mt-4 rounded-lg bg-yellow-50 p-3">
                    <p className="text-xs font-medium text-yellow-800">同姓同名の顧客が存在します</p>
                    <p className="mt-1 text-xs text-yellow-700">{document.allCustomerCandidates}</p>
                  </div>
                )}

                {/* ケアマネ情報 */}
                {document.careManager && (
                  <div className="mt-4">
                    <h4 className="mb-2 text-xs font-medium text-gray-500">担当ケアマネージャー</h4>
                    <p className="text-sm text-gray-900">{document.careManager}</p>
                  </div>
                )}

                {/* OCR結果プレビュー */}
                <div className="mt-6">
                  <h4 className="mb-2 text-xs font-medium text-gray-500">OCR結果（抜粋）</h4>
                  <div className="max-h-40 overflow-y-auto rounded bg-gray-50 p-2 text-xs text-gray-600">
                    {document.ocrResult?.slice(0, 500) || 'OCR結果なし'}
                    {document.ocrResult && document.ocrResult.length > 500 && '...'}
                  </div>
                </div>

                {/* カテゴリ */}
                {document.category && (
                  <div className="mt-4">
                    <Badge variant="outline">{document.category}</Badge>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <VisuallyHidden>
              <DialogTitle>書類が見つかりません</DialogTitle>
            </VisuallyHidden>
            <div className="flex flex-1 items-center justify-center text-gray-500">
              書類が見つかりません
            </div>
          </>
        )}
      </DialogContent>

      {/* PDF分割モーダル */}
      {document && (
        <PdfSplitModal
          document={document}
          isOpen={isSplitModalOpen}
          onClose={() => setIsSplitModalOpen(false)}
          onSuccess={handleSplitSuccess}
        />
      )}

      {/* 顧客解決モーダル（Phase 7） */}
      {document && (
        <SameNameResolveModal
          document={document}
          isOpen={isResolveModalOpen}
          onClose={() => setIsResolveModalOpen(false)}
          onResolved={handleResolveSuccess}
        />
      )}
    </Dialog>
  )
}
