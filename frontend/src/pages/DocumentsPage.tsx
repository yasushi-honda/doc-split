import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { doc, writeBatch, serverTimestamp, collection, runTransaction } from 'firebase/firestore'
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
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Timestamp } from 'firebase/firestore'
import { formatTimestamp } from '@/lib/documentUtils'
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
import { db } from '@/lib/firebase'
import { callFunction } from '@/lib/callFunction'
import { Checkbox } from '@/components/ui/checkbox'
import {
  useInfiniteDocuments,
  useDocumentStats,
  useDocumentMasters,
  appendReprocessClearToBatch,
  invalidateGroupQueries,
  updateDocumentInListCache,
  documentsInfiniteQueryKey,
  resetDocumentsInfiniteToFirstPage,
  markDocumentsInfiniteStale,
  clearDocumentsInfiniteVariantDirty,
  type DocumentFilters,
  type SortField,
  type SortOrder,
} from '@/hooks/useDocuments'
import { useDocumentListRefresh } from '@/hooks/useDocumentListRefresh'
import { DocumentListUpdateBanner } from '@/components/DocumentListUpdateBanner'
import { useCareManagers, useCustomerIdentityLookup, fetchFreshCustomerIdentityLookup, useContractEndedLookup, type CustomerIdentityLookup } from '@/hooks/useMasters'
import { useSettings } from '@/hooks/useSettings'
import { isDocumentHiddenByContractEnd } from '@/lib/contractEnded'
import { DateRangeFilter, type DateRange } from '@/components/DateRangeFilter'
import { isCustomerConfirmed } from '@/hooks/useProcessingHistory'
import { resolveCustomerUnconfirmedReason } from '@shared/customerIdentity'
import { planConfirmOnVerify, buildConfirmOnVerifyUpdate } from '@shared/confirmOnVerify'
import { DocumentDetailModal } from '@/components/DocumentDetailModal'
import { MultiCustomerBadge } from '@/components/MultiCustomerBadge'
import { AliasLearningHistoryModal } from '@/components/AliasLearningHistoryModal'
import { usePdfUploadStore } from '@/stores/pdfUploadStore'
import { GroupList } from '@/components/views'
import { SearchBar } from '@/components/SearchBar'
import { LoadMoreIndicator } from '@/components/LoadMoreIndicator'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { getDisplayFileName } from '@/utils/getDisplayFileName'
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
      className={`px-2 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap sm:px-4 sm:py-3 sm:text-sm ${hideOnMobile ? 'hidden lg:table-cell' : ''}`}
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

/**
 * 並行数を制限しつつ配列の各要素を非同期処理する(Issue #1034 一括確認済み用)。
 * `items.length`件のFirestoreトランザクションを無制限に同時発行しないための簡易プール。
 */
async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++
      results[current] = await fn(items[current] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// 一括操作モードの型
type BulkActionMode = 'delete' | 'verify' | 'reprocess'

// 一括操作ボタンの色スキーム
// ホバー時の文字の読みにくさ(kaname報告、Issue #1034)への対応:
// 1. 全状態でホバー時の背景色・文字色を明示指定する(Button基底の`outline`variantが持つ
//    `hover:bg-accent hover:text-accent-foreground`は、`cn()`(twMerge)がclassName側の
//    hover:クラスを優先して打ち消すため、明示すれば確実に上書きできる)
// 2. 非アクティブ状態(inactive、他ボタン選択中)は、手動`opacity-40`と基底の
//    `disabled:opacity-50`(components/ui/button.tsx)が重ねて掛かり実効不透明度が
//    大幅に下がって文字が読めなくなっていた。opacity指定をやめ、明示的な薄いグレー
//    配色に変更し、`disabled:opacity-100`で基底のdisabled:opacity-50を打ち消す。
const BULK_COLORS = {
  blue: {
    solid: 'bg-blue-600 border-blue-600 text-white shadow-md hover:bg-blue-700 hover:text-white',
    light: 'bg-blue-100 border-blue-400 text-blue-700 ring-1 ring-blue-400 hover:bg-blue-200 hover:text-blue-800',
    inactive: 'bg-gray-50 border-gray-200 text-gray-400 disabled:opacity-100',
    defaultStyle: 'text-gray-700 hover:bg-blue-50 hover:text-blue-700 border-gray-200',
    badgeText: 'text-blue-700',
    badgeBorder: 'border-blue-300',
  },
  red: {
    solid: 'bg-red-600 border-red-600 text-white shadow-md hover:bg-red-700 hover:text-white',
    light: 'bg-red-100 border-red-400 text-red-700 ring-1 ring-red-400 hover:bg-red-200 hover:text-red-800',
    inactive: 'bg-gray-50 border-gray-200 text-gray-400 disabled:opacity-100',
    badgeText: 'text-red-700',
    badgeBorder: 'border-red-300',
    defaultStyle: 'text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200',
  },
} as const

type BulkColorScheme = typeof BULK_COLORS[keyof typeof BULK_COLORS]

// 一括操作ボタン共通コンポーネント
function BulkActionButton({
  mode, icon: Icon, label, colors, selectionMode, selectedCount,
  isBulkOperating, isSpinning, onToggle, onExecute, disabledReason,
}: {
  mode: BulkActionMode
  icon: React.ComponentType<{ className?: string }>
  label: string
  colors: BulkColorScheme
  selectionMode: BulkActionMode | null
  selectedCount: number
  isBulkOperating: boolean
  isSpinning: boolean
  onToggle: () => void
  onExecute: () => void
  /** 指定時はボタンをdisabledにし、理由をtitle属性で表示する(例: 顧客マスター読み込み中)。 */
  disabledReason?: string
}) {
  const isActive = selectionMode === mode
  const hasSelection = selectedCount > 0

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={isActive && hasSelection ? onExecute : onToggle}
        disabled={isBulkOperating || !!disabledReason || (!!selectionMode && !isActive && hasSelection)}
        title={disabledReason}
        className={`flex items-center gap-1 h-7 text-xs transition-all duration-200 ${
          isActive && hasSelection
            ? colors.solid
            : isActive
              ? colors.light
              : selectionMode ? colors.inactive : ('defaultStyle' in colors ? colors.defaultStyle : '')
        }`}
      >
        <Icon className={`h-3.5 w-3.5 ${isSpinning ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">{label}</span>
      </Button>
      {isActive && hasSelection && (
        <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 sm:hidden inline-flex items-center rounded-full bg-white ${colors.badgeText} border ${colors.badgeBorder} text-[10px] font-bold px-1.5 py-0 leading-4 shadow-sm whitespace-nowrap pointer-events-none`}>
          {selectedCount}
        </span>
      )}
    </div>
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
  identityLookup,
}: {
  document: Document
  onClick: () => void
  isSelected: boolean
  onSelectChange: (checked: boolean) => void
  showCheckbox: boolean
  isProcessing: boolean
  identityLookup?: CustomerIdentityLookup
}) {
  const statusConfig = STATUS_CONFIG[document.status] || { label: '不明', variant: 'secondary' as const }

  // 選択待ち判定（顧客・事業所）
  const needsCustomerConfirmation = !isCustomerConfirmed(document)
  const needsOfficeConfirmation =
    document.officeConfirmed === false &&
    document.officeCandidates &&
    document.officeCandidates.length > 0

  // 同姓同名判定(2026-07-26追加)
  const unconfirmedReason = identityLookup
    ? resolveCustomerUnconfirmedReason(document, {
        customerMasterName: document.customerId
          ? (identityLookup.customerMasterNameById.get(document.customerId) ?? null)
          : null,
        sameNameCollisionNames: identityLookup.sameNameCollisionNames,
      })
    : null
  const isSameNameCollision = unconfirmedReason === 'same-name-collision'
  const needsReview = needsCustomerConfirmation || needsOfficeConfirmation || isSameNameCollision

  // バッジ文言優先順位: 同姓同名 > 選択待ち。title は該当する全理由を列挙し、needsReview合成
  // による「事業所要対応が同姓同名バッジの裏で隠れる」ことを防ぐ(Codex plan review指摘)。
  const reviewReasons: string[] = []
  if (isSameNameCollision) {
    reviewReasons.push('同姓同名の顧客マスターが複数あります。書類詳細で正しい顧客を選び直してください')
  } else if (needsCustomerConfirmation) {
    // codexレビュー(second opinion、comment-analyzer)指摘: 従来のコメントは同姓同名
    // ケース特有の説明をこのelse-if分岐(既にisSameNameCollisionを除外済み)に誤って
    // 当てはめていた。この分岐に入るのは「未確認かつ同姓同名ではない」ケース全般で、
    // shared/confirmOnVerify.tsのdecideCustomerConfirmが実際に評価する内訳は:
    // - 有効な単一候補で未確認なだけ → 「確認済み」操作でcustomerConfirmed:trueとなり
    //   このバッジは消える(直後のUI文言通り)
    // - invalid-name/name-id-mismatch/customer-master-missing(候補自体が無効/マスター
    //   不整合) → 「確認済み」操作でもdecideCustomerConfirmがskipを返すため解消せず、
    //   書類詳細で候補を選び直す必要がある
    // UI文言はこの2ケースを区別せず一括して案内している(過不足があれば別途改善)。
    reviewReasons.push('顧客が未確定です。書類詳細で候補を選択するか、確認済みにすると表示中の候補で確定します')
  }
  if (needsOfficeConfirmation) {
    reviewReasons.push('事業所が未選択です')
  }
  const reviewTitle = reviewReasons.length > 0 ? reviewReasons.join('。') : undefined

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
    <tr className={rowClassName} onClick={() => {
      if (showCheckbox && !isProcessing) {
        onSelectChange(!isSelected)
      } else {
        onClick()
      }
    }}>
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
        <div className="flex items-start gap-2 sm:gap-3">
          <FileText className="h-4 w-4 flex-shrink-0 text-gray-400 sm:h-5 sm:w-5" />
          <div className="min-w-0 max-w-[160px] sm:max-w-[240px]">
            <p className="break-words text-sm font-medium text-gray-900 sm:text-base">{getDisplayFileName(document)}</p>
            <p className="truncate text-xs text-gray-500 sm:text-sm">{document.documentType || '未判定'}</p>
          </div>
        </div>
      </td>
      <td className="px-2 py-2 text-xs text-gray-700 sm:px-4 sm:py-3 sm:text-sm">
        <div>{document.customerName || '未判定'}</div>
        {/* 担当CM表示 (Issue #813)。#424教訓により列は増やさず、既存の顧客名セル内に小さく併記する */}
        {document.careManager && (
          <div className="truncate text-[11px] text-gray-400">担当CM: {document.careManager}</div>
        )}
        <MultiCustomerBadge document={document} />
      </td>
      <td className="hidden px-4 py-3 text-gray-700 lg:table-cell">{document.officeName || '-'}</td>
      <td className="px-2 py-2 text-xs text-gray-700 sm:px-4 sm:py-3 sm:text-sm">{formatDateTime(document.processedAt)}</td>
      <td className="hidden px-4 py-3 text-gray-700 lg:table-cell">{formatTimestamp(document.fileDate)}</td>
      {/* ページ数 (#525): 0 は旧形式 doc (OCR 前の初期値) のため「-」表示 */}
      <td className="hidden whitespace-nowrap px-4 py-3 text-gray-700 xl:table-cell">
        {document.totalPages > 0 ? `${document.totalPages}` : '-'}
      </td>
      <td className="whitespace-nowrap px-2 py-2 sm:px-4 sm:py-3">
        {needsReview ? (
          <Badge
            variant="outline"
            className="whitespace-nowrap bg-orange-100 text-orange-800 border-orange-300 text-xs"
            title={reviewTitle}
          >
            {isSameNameCollision && <Users className="mr-1 h-3 w-3 inline" />}
            {isSameNameCollision ? '同姓同名' : '選択待ち'}
          </Badge>
        ) : (
          <Badge variant={statusConfig.variant} className="whitespace-nowrap text-xs sm:text-sm">{statusConfig.label}</Badge>
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
  const [careManagerFilter, setCareManagerFilter] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [showSplit, setShowSplit] = useState(false) // 分割済み表示フラグ
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false) // 未確認のみ表示フラグ
  // 複数人記載の可能性のみ表示(PR-B、2026-08-30)。showUnverifiedOnly/showSplitと同型の
  // クライアント側JSフィルタ。multiCustomerDetectionフラグを持たないテナントではdocに
  // フィールド自体が存在せず常にfalse相当になるため、チェックしても該当0件になるだけで
  // 無害(Firestore whereを使わない理由は同ファイルのdocumentsフィルタ処理コメント参照)。
  const [showMultiCustomerOnly, setShowMultiCustomerOnly] = useState(false)
  // 契約終了した利用者の書類を表示するか(Issue #1033)。nullは「一時切替未操作」を表し、
  // その場合はアプリ全体共有設定(settings.showContractEndedCustomers)に従う。
  // ページ再読み込みでこの一時切替は消え、共有既定値に戻る(保存しない)
  const [contractEndedOverride, setContractEndedOverride] = useState<boolean | null>(null)
  const { data: settings, isError: isSettingsError } = useSettings()
  // pr-review-toolkit(silent-failure-hunter)指摘: 設定取得(useSettings)が失敗した場合、
  // settingsがundefinedのまま`?? false`にフォールバックすると、共有既定値が実際にはtrue
  // だったとしても書類がサイレントに非表示になる。本機能の設計方針(迷ったら表示=fail-open)
  // と矛盾するため、設定取得失敗時は明示的に表示側へ倒す
  const showContractEnded = contractEndedOverride ?? (isSettingsError ? true : settings?.showContractEndedCustomers ?? false)
  const contractEndedLookup = useContractEndedLookup()
  const [dateRange, setDateRange] = useState<DateRange>({
    dateFrom: undefined,
    dateTo: undefined,
    dateField: 'processedAt',
  })

  // ソート状態（デフォルト: 登録日の新しい順）
  const [sortField, setSortField] = useState<SortField>('processedAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  // 履歴モーダル
  const [showHistoryModal, setShowHistoryModal] = useState(false)

  // 一括選択
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkOperating, setIsBulkOperating] = useState(false)
  const [bulkOperation, setBulkOperation] = useState<BulkActionMode | null>(null)
  const [selectionMode, setSelectionMode] = useState<BulkActionMode | null>(null)

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
  const { dateFrom, dateTo, dateField } = dateRange
  const filters: DocumentFilters = useMemo(() => ({
    status: effectiveStatusFilter === 'all' ? undefined : effectiveStatusFilter,
    documentType: documentTypeFilter === 'all' ? undefined : documentTypeFilter,
    careManager: careManagerFilter === 'all' ? undefined : careManagerFilter,
    dateFrom,
    dateTo,
    dateField,
    sortField,
    sortOrder,
  }), [effectiveStatusFilter, documentTypeFilter, careManagerFilter, dateFrom, dateTo, dateField, sortField, sortOrder])

  // データ取得（無限スクロール対応）
  // 2026-09-08: pageSizeは`useInfiniteDocuments`の既定値(100)と一致させる必要があるため
  // 明示的に渡す(activeQueryKeyの組み立てと`resetDocumentsInfiniteToFirstPage`が
  // 完全一致のqueryKeyを要求するため、暗黙のデフォルト値に依存しない)。
  const DOCUMENTS_PAGE_SIZE = 100
  const {
    data: documentsData,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchDocuments,
  } = useInfiniteDocuments({ filters, pageSize: DOCUMENTS_PAGE_SIZE })
  // reset処理中(1ページ目へのリセット中)はIntersectionObserverによる自動次ページ取得を
  // 止める(crossreview High #1、useInfiniteScroll.ts参照)
  const [isResetting, setIsResetting] = useState(false)
  const { loadMoreRef } = useInfiniteScroll({
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    disabled: isResetting,
  })
  const { data: stats } = useDocumentStats()
  const { data: documentMasters } = useDocumentMasters()
  const { data: careManagers } = useCareManagers()

  // 現在のfilters/pageSizeに完全一致するqueryKey(resetDocumentsInfiniteToFirstPageへ渡す)
  const activeDocumentsQueryKey = useMemo(
    () => documentsInfiniteQueryKey(filters, DOCUMENTS_PAGE_SIZE),
    [filters]
  )
  const {
    hasUpdates: hasListUpdates,
    message: listUpdateMessage,
    resetBaseline: resetListUpdateBaseline,
  } = useDocumentListRefresh({ filters, pageSize: DOCUMENTS_PAGE_SIZE })

  /**
   * 一覧を1ページ目へ明示的にリセットする共通処理(2026-09-08、crossreview反映)。
   * バナー押下・アップロード成功(デバウンス後)・一括削除部分失敗の3箇所から共通で
   * 呼ばれる。スクロールを先に行う理由・isResettingの意図はuseInfiniteScroll.ts/
   * resetDocumentsInfiniteToFirstPageのコメント参照。
   *
   * 2026-09-08追記(codex review P2指摘): `documentStats`の再取得を明示的にawaitして
   * から`resetListUpdateBaseline()`を呼ぶ。fire-and-forgetのinvalidateQueriesだけだと
   * baseline確定時点でstatsキャッシュがまだ古いままの場合があり、直後にstatsが
   * 反映されるとベースラインとの差分で誤って「更新があります」バナーが再表示されうる。
   *
   * 2026-09-08追記(codex review 3周目 P2指摘): TanStack Queryの`refetch()`はデフォルトでは
   * 失敗してもPromiseをrejectしない(`QueryObserverResult`を解決値として返すだけ)。
   * そのため`try/catch`ではなく戻り値の`isSuccess`を明示的に確認してから
   * dirtyフラグ解除・baseline更新を行う。失敗時はどちらも据え置き、バナーが
   * 表示され続けて再試行を促す(自動再取得を全廃した現設計での唯一の「要更新」通知経路)。
   */
  const refreshDocumentList = useCallback(async () => {
    setIsResetting(true)
    try {
      window.scrollTo({ top: 0 })
      await resetDocumentsInfiniteToFirstPage(queryClient, activeDocumentsQueryKey)
      const [documentsResult] = await Promise.all([
        refetchDocuments(),
        queryClient.refetchQueries({ queryKey: ['documentStats'] }),
      ])
      if (documentsResult.isSuccess) {
        clearDocumentsInfiniteVariantDirty(activeDocumentsQueryKey)
        // second-opinionレビュー指摘反映(2026-09-08): queryClient.refetchQueries()は
        // 内部でエラーを握りつぶすため(TanStack Query仕様、失敗してもPromiseはresolveする)、
        // documentStatsの再取得が実は失敗していても気付けない。resetBaseline()が
        // 古い統計値でbaselineを確定してしまうと直後にバナーが再表示されうるので、
        // 失敗時は可視化だけしておく(自己修復は既存の30秒ポーリングに委ねる。実害は
        // 「バナーが最大30秒程度余計に出る」程度で、データ不整合はない)。
        const statsState = queryClient.getQueryState(['documentStats'])
        if (statsState?.status === 'error') {
          console.error('[refreshDocumentList] documentStats refetch failed; baseline may use stale stats', statsState.error)
        }
        resetListUpdateBaseline()
      }
    } finally {
      setIsResetting(false)
    }
  }, [queryClient, activeDocumentsQueryKey, refetchDocuments, resetListUpdateBaseline])

  // 同姓同名バッジ判定用(2026-07-26追加)。書類一覧(テーブルビュー)は5箇所のうち唯一
  // useCustomers()の新規読込が増える画面(kanameone 1355件、staleTime5分キャッシュ共有)
  const identityLookup = useCustomerIdentityLookup()

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
  // 2026-09-08 crossreview反映: pdfUploadStoreのcompletionCounterはファイルごとの
  // OCR完了時に個別加算される(pdfUploadStore.ts subscribeRow、step==='processed')。
  // 複数ファイル同時アップロードだと短時間に複数回変化するため、300ms trailing
  // デバウンスでまとめて1回だけrefreshDocumentList()を呼ぶ(lodash未導入のため自前実装)。
  const uploadSuccessDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleUploadSuccess = useCallback(() => {
    // documentStatsの再取得はrefreshDocumentList内でawait付きで行う(codex review P2指摘、
    // resetBaselineのタイミング参照)ため、ここでの個別invalidateは不要
    if (uploadSuccessDebounceRef.current) {
      clearTimeout(uploadSuccessDebounceRef.current)
    }
    uploadSuccessDebounceRef.current = setTimeout(() => {
      uploadSuccessDebounceRef.current = null
      void refreshDocumentList()
    }, 300)
  }, [refreshDocumentList])

  // 2026-09-08追記(codex review 4周目 P2指摘): OCR完了(=アップロード成功)から300ms以内に
  // 別画面へ遷移されると、unmount後にこのタイマーが発火し、既にアンマウント済みの
  // コンポーネントに対してscrollTo・Firestore再取得・setState(isResetting)を実行してしまう。
  // unmount時に保留中のタイマーを破棄する。
  useEffect(() => {
    return () => {
      if (uploadSuccessDebounceRef.current) {
        clearTimeout(uploadSuccessDebounceRef.current)
      }
    }
  }, [])

  // Issue #1031: PdfUploadModalがLayout共通マウントへ移設され、アップロード状態は
  // pdfUploadStoreのモジュールシングルトンへ引き上げられたため、completionCounterの
  // 変化を購読してhandleUploadSuccessを呼ぶ形に差し替える。依存配列にcompletionCounter
  // を直接入れる方式は、他画面から戻った際の再マウントで不要なrefreshDocumentList()を
  // 誘発するため不採用(subscribeで「変化」のみを検知する)。
  useEffect(() => {
    return usePdfUploadStore.subscribe((state, prevState) => {
      if (state.completionCounter !== prevState.completionCounter) {
        handleUploadSuccess()
      }
    })
  }, [handleUploadSuccess])

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

  // 操作モード切替（トグル）
  const handleModeToggle = useCallback((mode: BulkActionMode) => {
    setSelectionMode(prev => prev === mode ? null : mode)
    setSelectedIds(new Set())
  }, [])

  // 一括確認済み
  // Issue #1034: 「確認済み」にする操作は、同姓同名等の危険なケースを除きcustomerConfirmed/
  // officeConfirmedも同時に確定する(shared/confirmOnVerify.ts、単体トグルと同一ロジック)。
  //
  // codexレビュー指摘(P1、2026-09-23): 当初案は`documentsData`(Reactクエリキャッシュ、
  // 最大5分古い)から取得した文書データで確定可否を判定し、`writeBatch`でチャンクごとに
  // まとめて書き込んでいた。選択してから実行するまでの間に他者が顧客/事業所を変更していた
  // 場合、古いデータのまま誤って確定してしまう恐れがあった(単体トグルと同じ問題)。
  // 文書ごとに`runTransaction`でFirestoreから直前に再読込した最新データに対して判定・
  // 書込みを行う方式に変更し、この競合を防ぐ。writeBatchのチャンク化(500オペレーション
  // 上限対策)も、文書単位の独立したトランザクションに置き換わったことで不要になった
  // (1件の衝突/失敗が他の文書を巻き込まない点は、scripts/backfill-confirm-on-verify.ts
  // が個別update()+precondition方式を採る理由と同じ)。
  const handleBulkVerify = useCallback(async () => {
    // codexレビュー(second opinion、strict-config)指摘: identityLookup.isReady
    // (useCustomers()キャッシュの初回ロード完了)は、確定判定の実際の権威である
    // fetchFreshCustomerIdentityLookup()(キャッシュを経由しない独立取得)とは無関係。
    // 初回のuseCustomers()が一度でもエラーになるとisReadyはfalseのまま固着し、直接
    // サーバー読み取りなら成功するはずの状況でも一括確認済みが永久に使えなくなって
    // いた。ここではゲートせず、fetchFreshCustomerIdentityLookup()自体の成否
    // (失敗時はcatchでnullフォールバック、verifiedのみ更新)に判断を委ねる。
    if (selectedIds.size === 0 || !user) return

    setIsBulkOperating(true)
    try {
      const ids = Array.from(selectedIds)
      const uid = user.uid
      const email = user.email || ''

      // codexレビュー指摘(P1・2回目): 同姓同名判定に使う顧客マスターを`identityLookup`
      // (useCustomers()キャッシュ、最大5分古い)からではなく、この一括確認済み実行の
      // 直前に新規取得したものから読む(このバッチ内の全文書で1回だけ取得・共有する。
      // 文書自体の鮮度は各文書のトランザクション内でtx.get()により個別に保証する)。
      //
      // codexレビュー指摘(P1、6回目): この取得(1回)からループ内の各`runTransaction`完了
      // までの間に、他者が顧客マスターを追加・改名して新たな同姓同名衝突が発生する可能性は
      // 残る(TOCTOU)。文書側とは異なりFirestore(client SDK)のトランザクションは任意の
      // クエリを内包できない(`tx.get()`は特定docRefのみ)ため、「同姓同名が新たに発生して
      // いないか」を該当トランザクション内で検証することはできず、完全に閉じるには顧客
      // マスター側へ衝突有無を非正規化して都度1文書読み取りで検証できるようにする設計変更が
      // 必要(本Issueのスコープ外)。この残存窓は、既存の単体編集保存フロー
      // (useDocumentEdit.ts)が元々受け入れていた同種のトレードオフ(marker: ADR-0022)の
      // 延長として意図的に許容する。5分キャッシュだった従来より窓は大幅に縮小済み(この
      // 一括取得〜各文書のトランザクション完了までの数秒程度)であり、同一名の顧客が
      // まさにこの数秒の間に追加・改名され、かつそれが今回確定対象の文書と一致するという
      // 低頻度の偶発事象が前提となる。
      //
      // codexレビュー指摘(P1、7回目): fetchFreshCustomerIdentityLookup()自体がサーバー
      // 到達不能で失敗しうる(fail-closed設計、useMasters.ts参照)。単体トグルと同じく
      // 失敗時は確定判定を一律スキップし、verifiedのみ更新する(オフライン等でも
      // 「確認済みにする」操作自体は引き続き行えるようにする。誤った確定を書き込むより
      // 安全側に倒す)。
      const freshIdentityLookup = await fetchFreshCustomerIdentityLookup().catch((fetchErr) => {
        console.error('Failed to fetch fresh customer identity lookup, skipping confirm-on-verify:', fetchErr)
        return null
      })

      const outcomes = await runWithConcurrency(ids, 20, async (docId) => {
        const docRef = doc(db, 'documents', docId)
        try {
          const decisions = await runTransaction(db, async (tx) => {
            const freshSnap = await tx.get(docRef)
            if (!freshSnap.exists()) {
              throw new Error(`Document not found: ${docId}`)
            }
            const freshDoc = freshSnap.data() as Document

            const txDecisions = freshIdentityLookup
              ? planConfirmOnVerify(freshDoc, {
                  customerMasterName: freshDoc.customerId
                    ? (freshIdentityLookup.customerMasterNameById.get(freshDoc.customerId) ?? null)
                    : null,
                  sameNameCollisionNames: freshIdentityLookup.sameNameCollisionNames,
                })
              : null
            const { update: confirmFields, logs } = txDecisions
              ? buildConfirmOnVerifyUpdate(txDecisions, freshDoc, { uid, now: serverTimestamp() })
              : { update: {}, logs: [] }

            // 既存のuseDocumentEdit.ts(L396)と同じ規約: 動的に組み立てたRecord<string, unknown>を
            // Firestoreの厳密なUpdateData型へ渡すためのキャスト。
            tx.update(docRef, {
              verified: true,
              verifiedBy: uid,
              verifiedAt: serverTimestamp(),
              ...confirmFields,
            } as any)

            const editLogsRef = collection(db, 'editLogs')
            for (const change of logs) {
              tx.set(doc(editLogsRef), {
                documentId: docId,
                fieldName: change.field,
                oldValue: change.oldValue,
                newValue: change.newValue,
                editedBy: uid,
                editedByEmail: email,
                editedAt: serverTimestamp(),
              })
            }

            return txDecisions
          })
          return { docId, status: 'ok' as const, decisions }
        } catch (err) {
          console.error(`Bulk verify failed for document ${docId}:`, err)
          return { docId, status: 'error' as const, decisions: null }
        }
      })

      const succeeded = outcomes.filter((o) => o.status === 'ok')
      const failed = outcomes.filter((o) => o.status === 'error')

      const confirmedAtApprox = Timestamp.now()
      for (const o of succeeded) {
        const cachePatch: Record<string, unknown> = {
          verified: true,
          verifiedBy: uid,
          verifiedAt: confirmedAtApprox,
        }
        if (o.decisions?.customer.action === 'confirm') {
          cachePatch.customerConfirmed = true
          cachePatch.confirmedBy = uid
          cachePatch.confirmedAt = confirmedAtApprox
        }
        if (o.decisions?.office.action === 'confirm') {
          cachePatch.officeConfirmed = true
          cachePatch.officeConfirmedBy = uid
          cachePatch.officeConfirmedAt = confirmedAtApprox
        }
        updateDocumentInListCache(queryClient, o.docId, cachePatch)
      }

      // 安全網: staleマークのみ(refetchType:'none')。表示更新は上記パッチが担う
      markDocumentsInfiniteStale(queryClient)
      queryClient.invalidateQueries({ queryKey: ['documentStats'] })
      // codexレビュー指摘(P2・5回目): 一括確認済みもcustomerConfirmed/officeConfirmedを
      // 変更するが、上記パッチはdocumentsInfiniteのみが対象。グループ表示(担当CM別・
      // 利用者別)を開いている場合、staleTime:Infiniteのgroup系キャッシュが古いバッジを
      // 保持し続ける。他の一括操作(一括再処理・一括削除)と同じくinvalidateGroupQueriesを呼ぶ。
      invalidateGroupQueries(queryClient)

      const confirmedCount = succeeded.filter(
        (o) => o.decisions?.customer.action === 'confirm' || o.decisions?.office.action === 'confirm'
      ).length

      if (failed.length > 0) {
        const failedIds = new Set(failed.map((o) => o.docId))
        setSelectedIds(prev => new Set([...prev].filter(id => failedIds.has(id))))
        toast.error(`一括確認が一部失敗しました（${succeeded.length}/${ids.length}件完了）`)
      } else {
        clearSelection()
        setBulkOperation(null)
        toast.success(
          confirmedCount > 0
            ? `${succeeded.length}件を確認済みにしました（うち${confirmedCount}件は顧客/事業所も確定しました）`
            : `${succeeded.length}件を確認済みにしました`
        )
      }
    } catch (error) {
      console.error('Bulk verify error:', error)
      toast.error('一括確認に失敗しました')
    } finally {
      setIsBulkOperating(false)
    }
  }, [selectedIds, user, queryClient, clearSelection])

  // 一括再処理
  // ADR-0018 Phase D PR4b (Issue #547): 親doc + detail/main を同一batchでクリア。
  // CHUNK_SIZE=250 (最大500 update/チャンク) は保守値: Firestoreのbatch 500件hard limitは
  // 2023年に撤廃済みだが、request payloadサイズ上限と部分成功の粒度(チャンク単位の
  // 成否がユーザーに報告される)を考慮して据え置く。
  const handleBulkReprocess = useCallback(async () => {
    if (selectedIds.size === 0) return

    setIsBulkOperating(true)
    try {
      // codex review指摘(PR #677): pending/processing中のdocを再処理すると、
      // appendReprocessClearToBatchのdistributionId読込とOCR完了トランザクションの
      // 競合(TOCTOU)でdistributionId保護が外れうる。既定の一覧フィルタは'processed'
      // だが、フィルタを変更すればpending/processing中docも選択可能なため、実行時に
      // 明示的に除外する(単体doc再処理ボタンは元々error/processedのみ表示のため対象外)。
      const allDocsForStatusCheck = documentsData?.pages.flatMap(page => page.documents) ?? []
      const inProgressIds = new Set(
        allDocsForStatusCheck
          .filter((d) => d.status === 'pending' || d.status === 'processing')
          .map((d) => d.id)
      )
      const ids = Array.from(selectedIds).filter((id) => !inProgressIds.has(id))
      const skippedCount = selectedIds.size - ids.length
      if (ids.length === 0) {
        toast.error(`選択した${skippedCount}件は処理中のため再処理をスキップしました`)
        setIsBulkOperating(false)
        return
      }
      const CHUNK_SIZE = 250
      let succeededCount = 0
      let chunkFailed = false

      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE)
        // code-review指摘: batch構築(doc()/batch.update())もtry内に含め、
        // チャンク単位のエラーとして扱う(構築時エラーが外側catchに漏れて
        // succeededCountの情報が失われるのを防ぐ)
        try {
          const batch = writeBatch(db)
          // detail/main の存在確認(ヘルパー内のgetDoc)はチャンク内で並列実行。
          // 2026-09-08 crossreview High #2反映: 戻り値(id単位のhasDistributionId)を
          // 保持し、commit成功後(=このチャンクが確定した後)にのみキャッシュへ
          // パッチする。commit前にパッチすると、後続チャンクが失敗した場合に
          // 未確定の文書まで見た目上「再処理済み」になってしまうため。
          const chunkHasDistributionId = await Promise.all(
            chunk.map((docId) => appendReprocessClearToBatch(batch, docId))
          )
          await batch.commit()
          succeededCount += chunk.length
          // 単体再処理(useReprocessDocument)と同一フィールド集合でパッチする
          chunk.forEach((docId, idx) => {
            updateDocumentInListCache(queryClient, docId, {
              status: 'pending',
              ocrResult: '',
              officeName: '',
              documentType: '',
              officeConfirmed: false,
              verified: false,
              ...(chunkHasDistributionId[idx] ? {} : { customerName: '', customerConfirmed: false }),
            })
          })
        } catch (chunkError) {
          console.error('Bulk reprocess chunk error:', chunkError)
          chunkFailed = true
          break
        }
      }

      // 表示は上記チャンクごとのパッチが既に反映済みのため、ここは安全網(stale
      // マークのみ、即時再取得はしない)。ステータス変更によりstatusフィルタ済み
      // variantのメンバーシップが変わりうる(updateDocumentInListCacheは値のみ書換え、
      // フィルタ離脱による非表示化はしない)ため、非アクティブな他variantを独立
      // トラッキングでdirty化する。
      markDocumentsInfiniteStale(queryClient)
      queryClient.invalidateQueries({ queryKey: ['documentStats'] })
      // customerName/careManagerName等をクリアするためグルーピングキーから外れる書類が
      // 生じる。単体再処理(useReprocessDocument)と同じ理由でグループ表示キャッシュも
      // 無効化する(2026-08-06、PR #802セカンドオピニオンレビューで発覚した漏れを解消)
      invalidateGroupQueries(queryClient)
      setBulkOperation(null)

      // detail/main もクリア対象 (appendReprocessClearToBatch) のため、成功分の
      // documentDetailキャッシュを無効化する (useDocuments.ts useReprocessDocument
      // と同じ理由、Issue #547) — DocumentDetailModalを開いていた文書が対象に
      // 含まれる場合、古いOCR内容が残存するのを防ぐ
      const succeededIds = ids.slice(0, succeededCount)
      succeededIds.forEach((docId) => {
        queryClient.invalidateQueries({ queryKey: ['documentDetail', docId] })
      })

      if (chunkFailed) {
        // Codexレビュー指摘: 成功済みチャンクのIDは選択から除外する。残すと
        // 既にpending化済みの文書が再試行対象に残り、進行中のOCRと重複/競合しうる。
        // 失敗+未処理分のみ選択に残し、ユーザーがその分だけ再試行できるようにする。
        const succeededIdSet = new Set(succeededIds)
        setSelectedIds(prev => new Set([...prev].filter(id => !succeededIdSet.has(id))))
        toast.error(`一括再処理が途中で失敗しました（${succeededCount}/${ids.length}件完了）`)
      } else {
        clearSelection()
        toast.success(
          skippedCount > 0
            ? `${succeededCount}件を再処理キューに追加しました（処理中のため${skippedCount}件はスキップ）`
            : `${succeededCount}件を再処理キューに追加しました`
        )
      }
    } catch (error) {
      console.error('Bulk reprocess error:', error)
      toast.error('一括再処理に失敗しました')
    } finally {
      setIsBulkOperating(false)
    }
  }, [selectedIds, queryClient, clearSelection, documentsData])

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
      const results = await Promise.allSettled(
        Array.from(deletingIds).map(id =>
          callFunction<{ documentId: string }, { success: boolean; warnings?: string[] }>(
            'deleteDocument', { documentId: id }, { timeout: 60_000 }
          )
        )
      )

      const failed = results.filter(r => r.status === 'rejected').length
      const allWarnings = results
        .filter((r): r is PromiseFulfilledResult<{ success: boolean; warnings?: string[] }> => r.status === 'fulfilled')
        .flatMap(r => r.value.warnings ?? [])

      if (failed > 0) {
        // 部分失敗: 楽観的に消した全idのうち、実際には削除されていない(失敗した)idが
        // 一覧から消えたままになる。2026-09-08 crossreview High #2反映:
        // カーソルベースページネーションでは失敗idを元の位置へ正確に戻すことが
        // 構造的に不可能なため、中途半端な部分復元は行わず、
        // refreshDocumentList()(バナー押下と同じ共通reset)でサーバー確定状態の
        // 1ページ目を再取得して確実に復元する。
        toast.warning(`${results.length - failed}件削除、${failed}件失敗しました`)
        void refreshDocumentList()
      } else {
        toast.success(`${results.length}件を削除しました`)
        // 2026-09-08追記: カーソルベースページネーションでは「削除で見た目上詰まった
        // 行数」を後続ページの取得が埋め合わせない(次ページのカーソルは削除前の
        // 最後のドキュメントの値のまま変わらないため、削除件数分のドキュメントが
        // 以後一切表示されなくなる)。以前は30秒毎の全ページ自動再取得がこの欠落を
        // 自己修復していたが、それを全廃した現設計では修復手段がバナー経由の
        // リセットしかない。dirty化してバナーで気付けるようにする。
        markDocumentsInfiniteStale(queryClient)
      }

      if (allWarnings.length > 0) {
        console.warn('deleteDocument warnings (Storage cleanup failures):', allWarnings)
        toast.warning('一部のStorageファイル削除に失敗しました（動作への影響はありません）')
      }

      queryClient.invalidateQueries({ queryKey: ['documentStats'] })
      // documentGroupsだけでなくgroupDocuments/groupStatsも無効化する
      // (2026-08-06、PR #802セカンドオピニオンレビューで発覚した漏れを解消)
      invalidateGroupQueries(queryClient)
    } catch (error) {
      console.error('Bulk delete error:', error)
      toast.error('一括削除に失敗しました')
      // ロールバック: 元のデータを復元
      previousPages.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data)
      })
    }
  }, [selectedIds, queryClient, clearSelection, refreshDocumentList])

  // 全ページのドキュメントをフラット化
  const allDocuments = useMemo(() => {
    if (!documentsData?.pages) return []
    return documentsData.pages.flatMap(page => page.documents)
  }, [documentsData?.pages])

  // ドキュメントリスト（フィルターのみ、ソートはFirestoreで実行済み）
  const { documents, hiddenByContractEndedCount } = useMemo(() => {
    let docs = allDocuments

    // showSplitがfalseの場合は常にsplitを除外
    if (!showSplit) {
      docs = docs.filter(doc => doc.status !== 'split')
    }

    // 未確認のみ表示
    if (showUnverifiedOnly) {
      docs = docs.filter(doc => !doc.verified)
    }

    // 複数人記載の可能性のみ表示(PR-B、2026-08-30)。Firestore whereではなくクライアント側
    // フィルタにしている理由: multiCustomerDetectedフィールドを持たない既存doc(先方が
    // 初日に見たい母集団そのもの)をwhereで絞ると全件サイレント除外してしまうため
    // (showUnverifiedOnly/showSplitと同型のトレードオフを踏襲)
    if (showMultiCustomerOnly) {
      docs = docs.filter(doc => doc.multiCustomerDetected === true)
    }

    // 契約終了した利用者の確認済み書類を非表示(Issue #1033)。未確認書類は隠さない
    // (isDocumentHiddenByContractEnd内でverified!==trueは表示側に倒す)
    const beforeContractFilterCount = docs.length
    docs = docs.filter(doc => !isDocumentHiddenByContractEnd(doc, contractEndedLookup, showContractEnded))

    return { documents: docs, hiddenByContractEndedCount: beforeContractFilterCount - docs.length }
  }, [allDocuments, showSplit, showUnverifiedOnly, showMultiCustomerOnly, contractEndedLookup, showContractEnded])

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
            onClick={() => usePdfUploadStore.getState().openModal()}
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
        <div className="mb-4 flex items-center gap-2 pt-3">
          <TabsList className="shrink-0">
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

          {/* 一括操作ボタン(削除は全ユーザー、再処理・確認済みは管理者のみ。Issue #1037) */}
          <div className="flex items-center gap-1.5 ml-auto">
            {/* デスクトップ: 件数テキスト＋×ボタン（操作ボタンの左側に配置） */}
            {selectionMode && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                  disabled={isBulkOperating}
                  className="hidden sm:flex h-7 w-7 p-0"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
                <span className={`hidden sm:inline text-sm font-medium whitespace-nowrap ${
                  selectedIds.size > 0 ? 'text-blue-800' : 'text-gray-500'
                }`}>
                  {selectedIds.size}件選択中
                </span>
              </>
            )}

            {/* 処理中スピナー */}
            {selectionMode && isBulkOperating && (
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            )}

            {isAdmin && (
              <>
                <BulkActionButton
                  mode="reprocess"
                  icon={RotateCcw}
                  label="再処理"
                  colors={BULK_COLORS.blue}
                  selectionMode={selectionMode}
                  selectedCount={selectedIds.size}
                  isBulkOperating={isBulkOperating}
                  isSpinning={isBulkOperating && bulkOperation === 'reprocess'}
                  onToggle={() => handleModeToggle('reprocess')}
                  onExecute={() => setBulkOperation('reprocess')}
                />
                <BulkActionButton
                  mode="verify"
                  icon={CheckCircle2}
                  label="確認済み"
                  colors={BULK_COLORS.blue}
                  selectionMode={selectionMode}
                  selectedCount={selectedIds.size}
                  isBulkOperating={isBulkOperating}
                  isSpinning={false}
                  onToggle={() => handleModeToggle('verify')}
                  onExecute={() => setBulkOperation('verify')}
                />
              </>
            )}
            <BulkActionButton
              mode="delete"
              icon={Trash2}
              label="削除"
              colors={BULK_COLORS.red}
              selectionMode={selectionMode}
              selectedCount={selectedIds.size}
              isBulkOperating={isBulkOperating}
              isSpinning={false}
              onToggle={() => handleModeToggle('delete')}
              onExecute={() => setBulkOperation('delete')}
            />

          </div>
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
                  <div className="min-w-[200px] flex-1">
                    <label className="mb-1 block text-sm font-medium text-gray-700">ケアマネジャー</label>
                    <Select value={careManagerFilter} onValueChange={setCareManagerFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="すべて" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">すべて</SelectItem>
                        {careManagers?.map((cm) => (
                          <SelectItem key={cm.id} value={cm.name}>
                            {cm.name}
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
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
                      <input
                        type="checkbox"
                        checked={showMultiCustomerOnly}
                        onChange={(e) => setShowMultiCustomerOnly(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      複数名の可能性のみ
                    </label>
                  </div>
                </div>
              )}

              {/* 契約終了利用者の表示切替（全タブ共通、Issue #1033）。保存しない一時切替で、
                  未操作(null)の間はアプリ全体共有設定(settings.showContractEndedCustomers)に従う */}
              <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={showContractEnded}
                  onChange={(e) => setContractEndedOverride(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-gray-600 focus:ring-gray-500"
                />
                契約終了の利用者も表示
              </label>

              {/* 期間指定フィルター（全タブ共通） */}
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            </CardContent>
          </Card>
        )}

        {/* 書類一覧タブ */}
        <TabsContent value="list" className="space-y-4">
          {/* 書類リスト */}
          <Card>
            <DocumentListUpdateBanner
              hasUpdates={hasListUpdates}
              message={listUpdateMessage}
              isRefreshing={isResetting}
              onRefresh={() => {
                clearSelection()
                void refreshDocumentList()
              }}
            />
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
                  {(showMultiCustomerOnly || hiddenByContractEndedCount > 0) && hasNextPage
                    ? '表示中のページに該当する書類はありません。さらに読み込むと見つかる可能性があります'
                    : statusFilter !== 'all' || documentTypeFilter !== 'all' || careManagerFilter !== 'all'
                    ? '条件に一致する書類がありません'
                    : 'Gmailから添付ファイルが取得されると、ここに表示されます'}
                </p>
                {/* 複数名の可能性フィルタ(PR-B)・契約終了フィルタ(Issue #1033)はクライアント側
                    フィルタのため、現在のページに該当0件でも後続ページに該当があり得る。
                    documents.length===0でもLoadMoreIndicatorを出し続けてfetchNextPageが
                    呼ばれ続けるようにする(codex review P1指摘対応: 未対応だとこの分岐で
                    LoadMoreIndicatorがunmountされscrollトリガーが失われ、実質ページネーションが
                    停止してしまう) */}
                {(showMultiCustomerOnly || hiddenByContractEndedCount > 0) && hasNextPage && (
                  <LoadMoreIndicator
                    ref={loadMoreRef}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    className="mt-2"
                  />
                )}
              </div>
            ) : (
              <>
              {hiddenByContractEndedCount > 0 && (
                <p className="px-4 pt-3 text-xs text-gray-500">
                  契約終了の利用者の書類 {hiddenByContractEndedCount}件を非表示中(読み込み済みの範囲)
                </p>
              )}
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
                      {/* ページ数 (#525): xl 未満は非表示 (#424 教訓 — lg 帯 1024px は 7 列 940px + スクロールバーで限界のため列を増やさない) */}
                      <th className="hidden whitespace-nowrap px-4 py-3 text-left text-sm font-medium text-gray-700 xl:table-cell">ページ数</th>
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
                        identityLookup={identityLookup}
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
              showContractEnded={showContractEnded}
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
                      <br />
                      同姓同名等の対象を除き、表示中の顧客・事業所も同時に確定します(確定後も書類詳細から変更できます)。
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
