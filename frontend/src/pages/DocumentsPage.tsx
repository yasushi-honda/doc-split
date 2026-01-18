import { useState, useMemo } from 'react'
import { Search, Filter, FileText, ChevronDown, Loader2, AlertCircle, Eye } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Timestamp } from 'firebase/firestore'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDocuments, useDocumentStats, useDocumentMasters, type DocumentFilters } from '@/hooks/useDocuments'
import { DocumentDetailModal } from '@/components/DocumentDetailModal'
import type { Document, DocumentStatus } from '@shared/types'

// ステータスのラベルとバッジVariant
const STATUS_CONFIG: Record<DocumentStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  pending: { label: '待機中', variant: 'secondary' },
  processing: { label: '処理中', variant: 'warning' },
  processed: { label: '完了', variant: 'success' },
  error: { label: 'エラー', variant: 'destructive' },
}

// Timestampを日付文字列に変換
function formatTimestamp(timestamp: Timestamp | undefined): string {
  if (!timestamp) return '-'
  try {
    return format(timestamp.toDate(), 'yyyy/MM/dd', { locale: ja })
  } catch {
    return '-'
  }
}

// 書類行コンポーネント
function DocumentRow({ document, onClick }: { document: Document; onClick: () => void }) {
  const statusConfig = STATUS_CONFIG[document.status]

  return (
    <tr
      className="cursor-pointer border-b border-gray-100 transition-colors hover:bg-gray-50"
      onClick={onClick}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 flex-shrink-0 text-gray-400" />
          <div className="min-w-0">
            <p className="truncate font-medium text-gray-900">{document.fileName}</p>
            <p className="truncate text-sm text-gray-500">{document.documentType || '未判定'}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-gray-700">{document.customerName || '未判定'}</td>
      <td className="px-4 py-3 text-gray-700">{document.officeName || '-'}</td>
      <td className="px-4 py-3 text-gray-700">{formatTimestamp(document.fileDate)}</td>
      <td className="px-4 py-3">
        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
      </td>
      <td className="px-4 py-3">
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onClick(); }}>
          <Eye className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  )
}

// 統計カード
function StatsCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-gray-500">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

export function DocumentsPage() {
  // フィルター状態
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | 'all'>('all')
  const [documentTypeFilter, setDocumentTypeFilter] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)

  // モーダル状態
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)

  // フィルターをDocumentFilters型に変換
  const filters: DocumentFilters = useMemo(() => ({
    status: statusFilter === 'all' ? undefined : statusFilter,
    documentType: documentTypeFilter === 'all' ? undefined : documentTypeFilter,
    searchText: searchQuery || undefined,
  }), [statusFilter, documentTypeFilter, searchQuery])

  // データ取得
  const { data: documentsData, isLoading, isError, error } = useDocuments({ filters })
  const { data: stats } = useDocumentStats()
  const { data: documentMasters } = useDocumentMasters()

  // ドキュメントリスト
  const documents = documentsData?.documents ?? []

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">書類一覧</h1>
      </div>

      {/* 統計カード */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard label="全書類" value={stats.total} color="text-gray-900" />
          <StatsCard label="処理完了" value={stats.processed} color="text-green-600" />
          <StatsCard label="処理中" value={stats.processing} color="text-yellow-600" />
          <StatsCard label="エラー" value={stats.error} color="text-red-600" />
        </div>
      )}

      {/* 検索・フィルターバー */}
      <div className="space-y-4">
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="書類名、顧客名で検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2"
          >
            <Filter className="h-5 w-5" />
            フィルター
            <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </Button>
        </div>

        {/* 展開フィルター */}
        {showFilters && (
          <Card>
            <CardContent className="flex flex-wrap gap-4 p-4">
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-sm font-medium text-gray-700">ステータス</label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as DocumentStatus | 'all')}>
                  <SelectTrigger>
                    <SelectValue placeholder="すべて" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">すべて</SelectItem>
                    <SelectItem value="pending">待機中</SelectItem>
                    <SelectItem value="processing">処理中</SelectItem>
                    <SelectItem value="processed">完了</SelectItem>
                    <SelectItem value="error">エラー</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-sm font-medium text-gray-700">書類種別</label>
                <Select value={documentTypeFilter} onValueChange={setDocumentTypeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="すべて" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">すべて</SelectItem>
                    {documentMasters?.map((master) => (
                      <SelectItem key={master.name} value={master.name}>
                        {master.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 書類リスト */}
      <Card>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-500">読み込み中...</span>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-red-500">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p>データの読み込みに失敗しました</p>
            <p className="text-sm text-gray-500">{error?.message}</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <FileText className="mb-4 h-12 w-12 text-gray-300" />
            <p className="text-lg font-medium">書類がありません</p>
            <p className="mt-1 text-sm">
              {searchQuery || statusFilter !== 'all' || documentTypeFilter !== 'all'
                ? '条件に一致する書類がありません'
                : 'Gmailから添付ファイルが取得されると、ここに表示されます'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">ファイル名</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">顧客名</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">事業所</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">日付</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">ステータス</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700"></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    document={doc}
                    onClick={() => setSelectedDocumentId(doc.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 詳細モーダル */}
      <DocumentDetailModal
        documentId={selectedDocumentId}
        open={!!selectedDocumentId}
        onOpenChange={(open) => !open && setSelectedDocumentId(null)}
      />
    </div>
  )
}
