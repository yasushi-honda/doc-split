import { useState, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { doc, writeBatch, serverTimestamp, deleteField } from 'firebase/firestore'
import {
  Filter,
  FileText,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  LayoutList,
  Users,
  Building2,
  FolderOpen,
  UserCheck,
  History,
  Upload,
  ArrowUpDown,
  Trash2,
  RotateCcw,
  CheckCircle2,
  X,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuthStore } from '@/stores/authStore'
import { functions, db } from '@/lib/firebase'
import { Checkbox } from '@/components/ui/checkbox'
import { useInfiniteDocuments, useDocumentStats, useDocumentMasters, type DocumentFilters, type SortField, type SortOrder } from '@/hooks/useDocuments'
import { DateRangeFilter, type DateRange } from '@/components/DateRangeFilter'
import { isCustomerConfirmed } from '@/hooks/useProcessingHistory'
import { DocumentDetailModal } from '@/components/DocumentDetailModal'
import { AliasLearningHistoryModal } from '@/components/AliasLearningHistoryModal'
import { PdfUploadModal } from '@/components/PdfUploadModal'
import { GroupList } from '@/components/views'
import { SearchBar } from '@/components/SearchBar'
import { LoadMoreIndicator } from '@/components/LoadMoreIndicator'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import type { Document, DocumentStatus } from '@shared/types'
import type { GroupType } from '@/hooks/useDocumentGroups'

// ソートヘッダーコンポーネント
function SortableHeader({
  label,
  field,
  currentField,
  currentOrder,
  onClick,
  hideOnMobile = false,
}: {
  label: string
  field: SortField
  currentField: SortField
  currentOrder: SortOrder
  onClick: (field: SortField) => void
  hideOnMobile?: boolean
}) {
  const isActive = currentField === field

  return (
    <th
      className={`px-2 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none sm:px-4 sm:py-3 sm:text-sm ${hideOnMobile ? 'hidden md:table-cell' : ''}`}
      onClick={() => onClick(field)}
    >
      <div className="flex items-center gap-1">
        <span className="truncate">{label}</span>
        {isActive ? (
          currentOrder === 'asc' ? (
            <ChevronUp className="h-3 w-3 text-blue-600 sm:h-4 sm:w-4" />
          ) : (
            <ChevronDown className="h-3 w-3 text-blue-600 sm:h-4 sm:w-4" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-gray-400" />
        )}
      </div>
    </th>
  )
}

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

// Timestampを日時文字列に変換（登録日用）
function formatDateTime(timestamp: Timestamp | undefined): string {
  if (!timestamp) return '-'
  try {
    return format(timestamp.toDate(), 'yyyy/MM/dd HH:mm', { locale: ja })
  } catch {
    return '-'
  }
}

// 書類行コンポーネント
function DocumentRow({
  document,
  onClick,
  isSelected,
  onSelectChange,
  showCheckbox,
  isProcessing,
}: {
  document: Document
  onClick: () => void
  isSelected: boolean
  onSelectChange: (checked: boolean) => void
  showCheckbox: boolean
  isProcessing: boolean
}) {
  const statusConfig = STATUS_CONFIG[document.status] || { label: '不明', variant: 'secondary' as const }

  // 選択待ち判定（顧客・事業所）
  const needsCustomerConfirmation = !isCustomerConfirmed(document)
  const needsOfficeConfirmation =
    document.officeConfirmed === false &&
    document.officeCandidates &&
    document.officeCandidates.length > 0
  const needsReview = needsCustomerConfirmation || needsOfficeConfirmation

  // OCR未確認
  const isUnverified = !document.verified

  // 行のスタイル
  const rowClassName = `cursor-pointer border-b border-gray-100 transition-all duration-300 ${
    isProcessing && isSelected
      ? 'bg-blue-100 animate-pulse'
      : isSelected
        ? 'bg-blue-50 hover:bg-blue-100'
        : 'hover:bg-gray-50'
  }`

  return (
    <tr className={rowClassName} onClick={onClick}>
      {showCheckbox && (
        <td className="px-2 py-2 sm:px-3 sm:py-3" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelectChange(checked === true)}
            disabled={isProcessing}
          />
        </td>
      )}
      <td className="px-2 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <FileText className="h-4 w-4 flex-shrink-0 text-gray-400 sm:h-5 sm:w-5" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900 sm:text-base">{document.fileName}</p>
            <p className="truncate text-xs text-gray-500 sm:text-sm">{document.documentType || '未判定'}</p>
          </div>
        </div>
      </td>
      <td className="px-2 py-2 text-xs text-gray-700 sm:px-4 sm:py-3 sm:text-sm">{document.customerName || '未判定'}</td>
      <td className="hidden px-4 py-3 text-gray-700 md:table-cell">{document.officeName || '-'}</td>
      <td className="px-2 py-2 text-xs text-gray-700 sm:px-4 sm:py-3 sm:text-sm">{formatDateTime(document.processedAt)}</td>
      <td className="hidden px-4 py-3 text-gray-700 md:table-cell">{formatTimestamp(document.fileDate)}</td>
      <td className="px-2 py-2 sm:px-4 sm:py-3">
        {needsReview ? (
          <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
            選択待ち
          </Badge>
        ) : (
          <Badge variant={statusConfig.variant} className="text-xs sm:text-sm">{statusConfig.label}</Badge>
        )}
      </td>
      <td className="px-2 py-2 sm:px-3 sm:py-3 text-center">
        {!isUnverified && (
          <CheckCircle2 className="h-5 w-5 text-green-500 inline-block" />
        )}
      </td>
    </tr>
  )
}

// 統計カード（モバイル対応）
function StatsCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="p-2 sm:p-4">
        <p className="text-xs text-gray-500 sm:text-sm">{label}</p>
        <p className={`text-xl font-bold sm:text-2xl ${color}`}>{value}</p>
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
  const queryClient = useQueryClient()
  const { isAdmin, user } = useAuthStore()

  // タブ状態
  const [activeTab, setActiveTab] = useState<ViewTab>('list')

  // フィルター状態（一覧ビュー用）
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | 'all'>('processed')
  const [showPendingProcessing, setShowPendingProcessing] = useState(false) // 処理中を含む
  const [documentTypeFilter, setDocumentTypeFilter] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [showSplit, setShowSplit] = useState(false) // 分割済み表示フラグ
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false) // 未確認のみ表示フラグ
  const [dateRange, setDateRange] = useState<DateRange>({
    dateFrom: undefined,
    dateTo: undefined,
    dateField: 'fileDate',
  })

  // ソート状態（デフォルト: 登録日の新しい順）
  const [sortField, setSortField] = useState<SortField>('processedAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  // 履歴モーダル
  const [showHistoryModal, setShowHistoryModal] = useState(false)

  // アップロードモーダル
  const [showUploadModal, setShowUploadModal] = useState(false)

  // 一括選択
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkOperating, setIsBulkOperating] = useState(false)
  const [bulkOperation, setBulkOperation] = useState<'delete' | 'verify' | 'reprocess' | null>(null)
  const [selectionMode, setSelectionMode] = useState<'delete' | 'verify' | 'reprocess' | null>(null)

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
  // showPendingProcessing=trueの場合はステータスフィルタを解除
  const effectiveStatusFilter = showPendingProcessing ? 'all' : statusFilter
  const filters: DocumentFilters = useMemo(() => ({
    status: effectiveStatusFilter === 'all' ? undefined : effectiveStatusFilter,
    documentType: documentTypeFilter === 'all' ? undefined : documentTypeFilter,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    dateField: dateRange.dateField,
    sortField,
    sortOrder,
  }), [effectiveStatusFilter, documentTypeFilter, dateRange.dateFrom?.getTime(), dateRange.dateTo?.getTime(), dateRange.dateField, sortField, sortOrder])

  // データ取得（無限スクロール対応）
  const {
    data: documentsData,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteDocuments({ filters })
  const { loadMoreRef } = useInfiniteScroll({ hasNextPage: !!hasNextPage, isFetchingNextPage, fetchNextPage })
  const { data: stats } = useDocumentStats()
  const { data: documentMasters } = useDocumentMasters()

  // ソートハンドラ
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }, [sortField])

  // アップロード成功時のハンドラ
  const handleUploadSuccess = useCallback(() => {
    // ドキュメント一覧と統計をリフレッシュ
    queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
    queryClient.invalidateQueries({ queryKey: ['documentStats'] })
  }, [queryClient])

  // 一括選択のトグル
  const handleSelectToggle = useCallback((docId: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) {
        next.add(docId)
      } else {
        next.delete(docId)
      }
      return next
    })
  }, [])

  // 選択クリア（選択モードも終了）
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setSelectionMode(null)
  }, [])

  // 一括確認済み
  const handleBulkVerify = useCallback(async () => {
    if (selectedIds.size === 0 || !user) return

    setIsBulkOperating(true)
    try {
      const batch = writeBatch(db)
      for (const docId of selectedIds) {
        const docRef = doc(db, 'documents', docId)
        batch.update(docRef, {
          verified: true,
          verifiedBy: user.uid,
          verifiedAt: serverTimestamp(),
        })
      }
      await batch.commit()

      // 一覧をリフレッシュ
      queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
      queryClient.invalidateQueries({ queryKey: ['documentStats'] })
      clearSelection()
      setBulkOperation(null)
    } catch (error) {
      console.error('Bulk verify error:', error)
      alert('一括確認に失敗しました')
    } finally {
      setIsBulkOperating(false)
    }
  }, [selectedIds, user, queryClient, clearSelection])

  // 一括再処理
  const handleBulkReprocess = useCallback(async () => {
    if (selectedIds.size === 0) return

    setIsBulkOperating(true)
    try {
      const batch = writeBatch(db)
      for (const docId of selectedIds) {
        const docRef = doc(db, 'documents', docId)
        batch.update(docRef, {
          status: 'pending',
          ocrResult: deleteField(),
          error: deleteField(),
        })
      }
      await batch.commit()

      // 一覧をリフレッシュ
      queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
      queryClient.invalidateQueries({ queryKey: ['documentStats'] })
      clearSelection()
      setBulkOperation(null)
    } catch (error) {
      console.error('Bulk reprocess error:', error)
      alert('一括再処理に失敗しました')
    } finally {
      setIsBulkOperating(false)
    }
  }, [selectedIds, queryClient, clearSelection])

  // 一括削除
  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return

    const deletingIds = new Set(selectedIds)

    // 楽観的UI更新: 即座にリストから削除
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const previousPages = queryClient.getQueriesData<any>({ queryKey: ['documentsInfinite'] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryClient.setQueriesData<any>(
      { queryKey: ['documentsInfinite'] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (oldData: any) => {
        if (!oldData?.pages) return oldData
        return {
          ...oldData,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pages: oldData.pages.map((page: any) => ({
            ...page,
            documents: page.documents.filter((doc: { id: string }) => !deletingIds.has(doc.id)),
          })),
        }
      }
    )
    clearSelection()
    setBulkOperation(null)

    // バックエンド削除（バックグラウンド）
    try {
      const deleteDocument = httpsCallable<{ documentId: string }, { success: boolean }>(
        functions,
        'deleteDocument'
      )
      const results = await Promise.allSettled(
        Array.from(deletingIds).map(id => deleteDocument({ documentId: id }))
      )

      const failed = results.filter(r => r.status === 'rejected').length

      if (failed > 0) {
        // 部分失敗: サーバーの実際の状態で一覧を更新
        alert(`${results.length - failed}件削除、${failed}件失敗しました`)
        queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
      }

      queryClient.invalidateQueries({ queryKey: ['documentStats'] })
      queryClient.invalidateQueries({ queryKey: ['documentGroups'] })
    } catch (error) {
      console.error('Bulk delete error:', error)
      alert('一括削除に失敗しました')
      // ロールバック: 元のデータを復元
      previousPages.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data)
      })
    }
  }, [selectedIds, queryClient, clearSelection])

  // 全ページのドキュメントをフラット化
  const allDocuments = useMemo(() => {
    if (!documentsData?.pages) return []
    return documentsData.pages.flatMap(page => page.documents)
  }, [documentsData?.pages])

  // ドキュメントリスト（フィルターのみ、ソートはFirestoreで実行済み）
  const documents = useMemo(() => {
    let docs = allDocuments

    // showSplitがfalseの場合は常にsplitを除外
    if (!showSplit) {
      docs = docs.filter(doc => doc.status !== 'split')
    }

    // 未確認のみ表示
    if (showUnverifiedOnly) {
      docs = docs.filter(doc => !doc.verified)
    }

    return docs
  }, [allDocuments, showSplit, showUnverifiedOnly])

  // 全選択/全解除（documentsの後に定義する必要あり）
  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(documents.map(doc => doc.id)))
    } else {
      setSelectedIds(new Set())
    }
  }, [documents])

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
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <TabsList className="flex-wrap h-auto">
            {VIEW_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                title={tab.label}
                className="flex items-center gap-1.5"
              >
                <tab.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* 一括操作ボタン（管理者のみ） */}
          {isAdmin && (
            <div className="flex items-center gap-1.5 ml-auto">
              {/* 処理中スピナー */}
              {selectionMode && isBulkOperating && (
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              )}

              {/* 再処理ボタン */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (selectionMode === 'reprocess' && selectedIds.size > 0) {
                      setBulkOperation('reprocess')
                    } else {
                      setSelectionMode(selectionMode === 'reprocess' ? null : 'reprocess')
                      setSelectedIds(new Set())
                    }
                  }}
                  disabled={isBulkOperating || (!!selectionMode && selectionMode !== 'reprocess')}
                  className={`flex items-center gap-1 h-7 text-xs transition-all ${
                    selectionMode === 'reprocess'
                      ? 'bg-blue-100 border-blue-400 text-blue-700 ring-1 ring-blue-400'
                      : selectionMode ? 'opacity-40' : ''
                  }`}
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isBulkOperating && bulkOperation === 'reprocess' ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">再処理</span>
                </Button>
                {/* フローティングバッジ（アクティブ時） */}
                {selectionMode === 'reprocess' && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0 leading-4 shadow-sm whitespace-nowrap pointer-events-none">
                    {selectedIds.size}<span className="hidden sm:inline">件選択中</span>
                  </span>
                )}
              </div>

              {/* 確認済みボタン */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (selectionMode === 'verify' && selectedIds.size > 0) {
                      setBulkOperation('verify')
                    } else {
                      setSelectionMode(selectionMode === 'verify' ? null : 'verify')
                      setSelectedIds(new Set())
                    }
                  }}
                  disabled={isBulkOperating || (!!selectionMode && selectionMode !== 'verify')}
                  className={`flex items-center gap-1 h-7 text-xs transition-all ${
                    selectionMode === 'verify'
                      ? 'bg-blue-100 border-blue-400 text-blue-700 ring-1 ring-blue-400'
                      : selectionMode ? 'opacity-40' : ''
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">確認済み</span>
                </Button>
                {selectionMode === 'verify' && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0 leading-4 shadow-sm whitespace-nowrap pointer-events-none">
                    {selectedIds.size}<span className="hidden sm:inline">件選択中</span>
                  </span>
                )}
              </div>

              {/* 削除ボタン */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (selectionMode === 'delete' && selectedIds.size > 0) {
                      setBulkOperation('delete')
                    } else {
                      setSelectionMode(selectionMode === 'delete' ? null : 'delete')
                      setSelectedIds(new Set())
                    }
                  }}
                  disabled={isBulkOperating || (!!selectionMode && selectionMode !== 'delete')}
                  className={`flex items-center gap-1 h-7 text-xs transition-all ${
                    selectionMode === 'delete'
                      ? 'bg-red-100 border-red-400 text-red-700 ring-1 ring-red-400'
                      : selectionMode ? 'opacity-40' : 'text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200'
                  }`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">削除</span>
                </Button>
                {selectionMode === 'delete' && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full bg-red-600 text-white text-[10px] font-bold px-1.5 py-0 leading-4 shadow-sm whitespace-nowrap pointer-events-none">
                    {selectedIds.size}<span className="hidden sm:inline">件選択中</span>
                  </span>
                )}
              </div>

              {/* 選択モード終了ボタン */}
              {selectionMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                  disabled={isBulkOperating}
                  className="h-7 w-7 p-0"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>

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

        {/* 展開フィルター（全タブ共通） */}
        {showFilters && (
          <Card className="mb-4">
            <CardContent className="space-y-3 p-4">
              {/* 上段: ステータス・書類種別（書類一覧タブのみ） */}
              {activeTab === 'list' && (
                <div className="flex flex-wrap gap-4">
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
                  <div className="flex flex-wrap items-end gap-4 pb-1">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
                      <input
                        type="checkbox"
                        checked={showPendingProcessing}
                        onChange={(e) => setShowPendingProcessing(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-gray-600 focus:ring-gray-500"
                      />
                      処理中を含む
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
                      <input
                        type="checkbox"
                        checked={showUnverifiedOnly}
                        onChange={(e) => setShowUnverifiedOnly(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                      />
                      未確認のみ表示
                    </label>
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
                </div>
              )}

              {/* 期間指定フィルター（全タブ共通） */}
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            </CardContent>
          </Card>
        )}

        {/* 書類一覧タブ */}
        <TabsContent value="list" className="space-y-4">
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
              <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-200 bg-gray-50">
                    <tr>
                      {selectionMode && (
                        <th className="px-2 py-2 sm:px-3 sm:py-3 w-10">
                          <Checkbox
                            checked={documents.length > 0 && selectedIds.size === documents.length}
                            onCheckedChange={(checked) => handleSelectAll(checked === true)}
                          />
                        </th>
                      )}
                      <SortableHeader label="ファイル名" field="fileName" currentField={sortField} currentOrder={sortOrder} onClick={handleSort} />
                      <SortableHeader label="顧客名" field="customerName" currentField={sortField} currentOrder={sortOrder} onClick={handleSort} />
                      <SortableHeader label="事業所" field="officeName" currentField={sortField} currentOrder={sortOrder} onClick={handleSort} hideOnMobile />
                      <SortableHeader label="登録日" field="processedAt" currentField={sortField} currentOrder={sortOrder} onClick={handleSort} />
                      <SortableHeader label="書類日付" field="fileDate" currentField={sortField} currentOrder={sortOrder} onClick={handleSort} hideOnMobile />
                      <SortableHeader label="ステータス" field="status" currentField={sortField} currentOrder={sortOrder} onClick={handleSort} />
                      <th className="px-2 py-2 text-center text-xs font-medium text-gray-700 sm:px-3 sm:py-3 sm:text-sm w-12">
                        <CheckCircle2 className="h-4 w-4 text-gray-400 inline-block" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <DocumentRow
                        key={doc.id}
                        document={doc}
                        onClick={() => setSelectedDocumentId(doc.id)}
                        isSelected={selectedIds.has(doc.id)}
                        onSelectChange={(checked) => handleSelectToggle(doc.id, checked)}
                        showCheckbox={!!selectionMode}
                        isProcessing={isBulkOperating}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* 無限スクロール読み込みインジケーター（ページスクロールで検知） */}
              <LoadMoreIndicator
                ref={loadMoreRef}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                className="border-t border-gray-100"
              />
            </>
            )}
          </Card>
        </TabsContent>

        {/* グループ化ビュータブ */}
        {(['customer', 'office', 'documentType', 'careManager'] as const).map((groupType) => (
          <TabsContent key={groupType} value={groupType}>
            <GroupList
              groupType={groupType}
              dateFilter={dateRange}
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
        onSuccess={handleUploadSuccess}
      />

      {/* 一括操作確認ダイアログ */}
      <AlertDialog open={!!bulkOperation} onOpenChange={(open) => !open && !isBulkOperating && setBulkOperation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {isBulkOperating && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
              {bulkOperation === 'delete' && (isBulkOperating ? '削除中...' : '一括削除しますか？')}
              {bulkOperation === 'verify' && (isBulkOperating ? '確認処理中...' : '一括確認済みにしますか？')}
              {bulkOperation === 'reprocess' && (isBulkOperating ? '再処理中...' : '一括再処理しますか？')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isBulkOperating ? (
                <div className="flex items-center gap-2 text-blue-600">
                  <span>{selectedIds.size}件の書類を処理しています。しばらくお待ちください...</span>
                </div>
              ) : (
                <>
                  {bulkOperation === 'delete' && (
                    <>
                      選択した{selectedIds.size}件の書類を削除します。
                      <br />
                      この操作は元に戻せません。関連するファイルとログも同時に削除されます。
                    </>
                  )}
                  {bulkOperation === 'verify' && (
                    <>
                      選択した{selectedIds.size}件の書類を確認済みにします。
                    </>
                  )}
                  {bulkOperation === 'reprocess' && (
                    <>
                      選択した{selectedIds.size}件の書類を再処理します。
                      <br />
                      OCR処理が再実行されます。
                    </>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkOperating}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (bulkOperation === 'delete') handleBulkDelete()
                else if (bulkOperation === 'verify') handleBulkVerify()
                else if (bulkOperation === 'reprocess') handleBulkReprocess()
              }}
              disabled={isBulkOperating}
              className={`flex items-center gap-2 ${bulkOperation === 'delete' ? 'bg-red-600 hover:bg-red-700 focus:ring-red-600' : ''}`}
            >
              {isBulkOperating && <Loader2 className="h-4 w-4 animate-spin" />}
              {isBulkOperating ? '処理中...' : '実行する'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
