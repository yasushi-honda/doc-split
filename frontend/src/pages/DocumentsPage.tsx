import { useState, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Filter,
  FileText,
  ChevronDown,
  Loader2,
  AlertCircle,
  LayoutList,
  Users,
  Building2,
  FolderOpen,
  UserCheck,
  History,
  Upload,
} from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Timestamp } from 'firebase/firestore'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDocuments, useDocumentStats, useDocumentMasters, type DocumentFilters } from '@/hooks/useDocuments'
import { isCustomerConfirmed } from '@/hooks/useProcessingHistory'
import { DocumentDetailModal } from '@/components/DocumentDetailModal'
import { AliasLearningHistoryModal } from '@/components/AliasLearningHistoryModal'
import { PdfUploadModal } from '@/components/PdfUploadModal'
import { GroupList } from '@/components/views'
import { SearchBar } from '@/components/SearchBar'
import type { Document, DocumentStatus } from '@shared/types'
import type { GroupType } from '@/hooks/useDocumentGroups'

// ステータスのラベルとバッジVariant
const STATUS_CONFIG: Record<DocumentStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  pending: { label: '待機中', variant: 'secondary' },
  processing: { label: '処理中', variant: 'warning' },
  processed: { label: '完了', variant: 'success' },
  error: { label: 'エラー', variant: 'destructive' },
  split: { label: '分割済', variant: 'default' },
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
  const statusConfig = STATUS_CONFIG[document.status] || { label: '不明', variant: 'secondary' as const }

  // 要確認判定（顧客・事業所）
  const needsCustomerConfirmation = !isCustomerConfirmed(document)
  const needsOfficeConfirmation =
    document.officeConfirmed === false &&
    document.officeCandidates &&
    document.officeCandidates.length > 0
  const needsReview = needsCustomerConfirmation || needsOfficeConfirmation

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
        {needsReview ? (
          <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">
            要確認
          </Badge>
        ) : (
          <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
        )}
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

// ビュータブの定義
type ViewTab = 'list' | GroupType

interface TabConfig {
  value: ViewTab
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const VIEW_TABS: TabConfig[] = [
  { value: 'list', label: '書類一覧', icon: LayoutList },
  { value: 'customer', label: '顧客別', icon: Users },
  { value: 'office', label: '事業所別', icon: Building2 },
  { value: 'documentType', label: '書類種別', icon: FolderOpen },
  { value: 'careManager', label: '担当CM別', icon: UserCheck },
]

export function DocumentsPage() {
  // URLパラメータ
  const [searchParams, setSearchParams] = useSearchParams()

  // タブ状態
  const [activeTab, setActiveTab] = useState<ViewTab>('list')

  // フィルター状態（一覧ビュー用）
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | 'all'>('all')
  const [documentTypeFilter, setDocumentTypeFilter] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [showSplit, setShowSplit] = useState(false) // 分割済み表示フラグ

  // 履歴モーダル
  const [showHistoryModal, setShowHistoryModal] = useState(false)

  // アップロードモーダル
  const [showUploadModal, setShowUploadModal] = useState(false)

  // モーダル状態（URLパラメータと同期）
  const selectedDocumentId = searchParams.get('doc')

  // モーダルを閉じる時はURLパラメータを削除
  const setSelectedDocumentId = useCallback((id: string | null) => {
    if (id) {
      setSearchParams({ doc: id })
    } else {
      setSearchParams({})
    }
  }, [setSearchParams])

  // フィルターをDocumentFilters型に変換
  const filters: DocumentFilters = useMemo(() => ({
    status: statusFilter === 'all' ? undefined : statusFilter,
    documentType: documentTypeFilter === 'all' ? undefined : documentTypeFilter,
  }), [statusFilter, documentTypeFilter])

  // データ取得
  const { data: documentsData, isLoading, isError, error } = useDocuments({ filters })
  const { data: stats } = useDocumentStats()
  const { data: documentMasters } = useDocumentMasters()

  // ドキュメントリスト（デフォルトでsplitを除外、チェックボックスで表示）
  const documents = useMemo(() => {
    const docs = documentsData?.documents ?? []
    // showSplitがfalseの場合は常にsplitを除外
    if (!showSplit) {
      return docs.filter(doc => doc.status !== 'split')
    }
    return docs
  }, [documentsData?.documents, showSplit])

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">書類管理</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2"
          >
            <Upload className="h-4 w-4" />
            PDFアップロード
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistoryModal(true)}
            className="flex items-center gap-2"
          >
            <History className="h-4 w-4" />
            学習履歴
          </Button>
        </div>
      </div>

      {/* 統計カード */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard label="全書類" value={stats.total - stats.split} color="text-gray-900" />
          <StatsCard label="処理完了" value={stats.processed} color="text-green-600" />
          <StatsCard label="処理中" value={stats.processing} color="text-yellow-600" />
          <StatsCard label="エラー" value={stats.error} color="text-red-600" />
        </div>
      )}

      {/* ビュー切替タブ */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ViewTab)}>
        <TabsList className="mb-4 flex-wrap h-auto">
          {VIEW_TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-1.5"
            >
              <tab.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* 検索バー＆フィルター（同一行） */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex-1">
            <SearchBar onResultClick={(docId) => setSelectedDocumentId(docId)} />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className="flex shrink-0 items-center gap-2"
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline">フィルター</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </Button>
        </div>

        {/* 書類一覧タブ */}
        <TabsContent value="list" className="space-y-4">
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
                  <div className="flex items-end pb-1">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
                      <input
                        type="checkbox"
                        checked={showSplit}
                        onChange={(e) => setShowSplit(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      分割元も表示
                    </label>
                  </div>
                </CardContent>
              </Card>
          )}

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
                  {statusFilter !== 'all' || documentTypeFilter !== 'all'
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
        </TabsContent>

        {/* グループ化ビュータブ */}
        {(['customer', 'office', 'documentType', 'careManager'] as const).map((groupType) => (
          <TabsContent key={groupType} value={groupType}>
            <GroupList
              groupType={groupType}
              onDocumentSelect={(docId) => setSelectedDocumentId(docId)}
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* 詳細モーダル */}
      <DocumentDetailModal
        documentId={selectedDocumentId}
        open={!!selectedDocumentId}
        onOpenChange={(open) => !open && setSelectedDocumentId(null)}
      />

      {/* 学習履歴モーダル */}
      <AliasLearningHistoryModal
        open={showHistoryModal}
        onOpenChange={setShowHistoryModal}
      />

      {/* PDFアップロードモーダル */}
      <PdfUploadModal
        open={showUploadModal}
        onOpenChange={setShowUploadModal}
      />
    </div>
  )
}
