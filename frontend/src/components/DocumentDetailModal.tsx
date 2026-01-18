/**
 * 書類詳細モーダル
 * PDFビューアーとメタ情報を表示
 */

import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Timestamp } from 'firebase/firestore'
import { Download, ExternalLink, Loader2, FileText, User, Building, Calendar, Tag, AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PdfViewer } from '@/components/PdfViewer'
import { useDocument } from '@/hooks/useDocuments'
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
  const { data: document, isLoading, isError, error } = useDocument(documentId)

  // ダウンロード処理
  const handleDownload = () => {
    if (document?.fileUrl) {
      window.open(document.fileUrl, '_blank')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-7xl flex-col p-0">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-500">読み込み中...</span>
          </div>
        ) : isError ? (
          <div className="flex flex-1 flex-col items-center justify-center text-red-500">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p>データの読み込みに失敗しました</p>
            <p className="text-sm text-gray-500">{error?.message}</p>
          </div>
        ) : document ? (
          <>
            {/* ヘッダー */}
            <DialogHeader className="flex-shrink-0 border-b p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="h-6 w-6 text-gray-400" />
                  <div>
                    <DialogTitle className="text-lg">{document.fileName}</DialogTitle>
                    <p className="text-sm text-gray-500">{document.documentType || '未判定'}</p>
                  </div>
                  <Badge variant={STATUS_CONFIG[document.status].variant}>
                    {STATUS_CONFIG[document.status].label}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleDownload}>
                    <Download className="mr-1 h-4 w-4" />
                    ダウンロード
                  </Button>
                  {document.fileUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(document.fileUrl, '_blank')}
                    >
                      <ExternalLink className="mr-1 h-4 w-4" />
                      新しいタブで開く
                    </Button>
                  )}
                </div>
              </div>
            </DialogHeader>

            {/* コンテンツエリア */}
            <div className="flex flex-1 overflow-hidden">
              {/* PDFビューアー */}
              <div className="flex-1 bg-gray-100">
                {document.fileUrl && document.mimeType === 'application/pdf' ? (
                  <PdfViewer
                    fileUrl={document.fileUrl}
                    totalPages={document.totalPages}
                    splitSuggestions={document.splitSuggestions}
                  />
                ) : document.fileUrl ? (
                  // PDF以外のファイル（画像など）
                  <div className="flex h-full items-center justify-center">
                    <img
                      src={document.fileUrl}
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

              {/* メタ情報サイドバー */}
              <div className="w-80 flex-shrink-0 overflow-y-auto border-l bg-white p-4">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">書類情報</h3>

                <div className="divide-y">
                  <MetaRow icon={User} label="顧客名" value={document.customerName || '未判定'} />
                  <MetaRow icon={Building} label="事業所" value={document.officeName} />
                  <MetaRow icon={Tag} label="書類種別" value={document.documentType || '未判定'} />
                  <MetaRow icon={Calendar} label="書類日付" value={formatTimestamp(document.fileDate)} />
                  <MetaRow icon={Calendar} label="処理日時" value={formatTimestamp(document.processedAt, 'yyyy/MM/dd HH:mm')} />
                  <MetaRow icon={FileText} label="ページ数" value={`${document.totalPages} ページ`} />
                </div>

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
          <div className="flex flex-1 items-center justify-center text-gray-500">
            書類が見つかりません
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
