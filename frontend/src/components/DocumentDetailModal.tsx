/**
 * 書類詳細モーダル
 * PDFビューアーとメタ情報を表示
 */

import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Timestamp, doc as firestoreDoc, updateDoc } from 'firebase/firestore'
import { ref, getDownloadURL } from 'firebase/storage'
import { Download, ExternalLink, Loader2, FileText, User, Building, Calendar, Tag, AlertCircle, Scissors, Pencil, Save, X, BookMarked, History, ChevronUp, ChevronDown, Sparkles, RefreshCw, CheckCircle, XCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { db, storage } from '@/lib/firebase'
import { callFunction } from '@/lib/callFunction'
import { useAuthStore } from '@/stores/authStore'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { VisuallyHidden } from '@/components/ui/visually-hidden'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { PdfViewer } from '@/components/PdfViewer'
import { PdfSplitModal } from '@/components/PdfSplitModal'
import { MasterSelectField } from '@/components/MasterSelectField'
import { ExtractionInfoPopover } from '@/components/ExtractionInfoPopover'
import { useDocument, getReprocessClearFields, updateDocumentInListCache } from '@/hooks/useDocuments'
import { useDocumentEdit } from '@/hooks/useDocumentEdit'
import { useCustomers, useOffices, useDocumentTypes } from '@/hooks/useMasters'
import { useMasterAlias } from '@/hooks/useMasterAlias'
import { useAliasLearningHistory, useInvalidateAliasLearningHistory } from '@/hooks/useAliasLearningHistory'
import { isCustomerConfirmed } from '@/hooks/useProcessingHistory'
import { useDocumentVerification } from '@/hooks/useDocumentVerification'
import type { DocumentStatus } from '@shared/types'

// 閉じる確認ダイアログ用のAlertDialog
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

interface DocumentDetailModalProps {
  documentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// モバイル用ポップアップコンポーネント（Vanilla JS DOM操作でRadix UIを完全にバイパス）
function MobileContentPopup({
  type,
  document: doc,
  onClose,
  onGenerateSummary,
  isGeneratingSummary,
}: {
  type: 'summary' | 'ocr'
  document: { summary?: string; ocrResult?: string }
  onClose: () => void
  onGenerateSummary: () => void
  isGeneratingSummary: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Vanilla JSでDOM要素を作成（Reactのイベントシステムをバイパス）
    const container = globalThis.document.createElement('div')
    container.id = 'mobile-popup-container'
    container.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      background: rgba(0,0,0,0.5);
      pointer-events: auto !important;
    `
    containerRef.current = container

    const content = globalThis.document.createElement('div')
    content.style.cssText = `
      width: 100%;
      height: 70vh;
      background: white;
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
      display: flex;
      flex-direction: column;
      pointer-events: auto !important;
      overflow: hidden;
    `
    // コンテンツ部分のクリックは背景に伝播させない
    content.onclick = (e) => {
      e.stopPropagation()
    }

    // ヘッダー
    const header = globalThis.document.createElement('div')
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #e5e7eb;
      background: ${type === 'summary' ? '#faf5ff' : '#f8fafc'};
      flex-shrink: 0;
      pointer-events: auto;
    `

    const title = globalThis.document.createElement('span')
    title.style.cssText = 'font-weight: 500; color: #111827;'
    title.textContent = type === 'summary' ? '✨ AI要約' : '📄 OCR結果'
    if (type === 'ocr' && doc.ocrResult) {
      title.textContent += ` (${doc.ocrResult.length.toLocaleString()}文字)`
    }

    const closeBtn = globalThis.document.createElement('button')
    closeBtn.style.cssText = `
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #e5e7eb;
      border: none;
      font-size: 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto !important;
    `
    closeBtn.textContent = '✕'
    closeBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }

    header.appendChild(title)
    header.appendChild(closeBtn)

    // スクロールコンテナ（高さ固定）
    const scrollContainer = globalThis.document.createElement('div')
    scrollContainer.id = 'mobile-popup-scroll-container'
    scrollContainer.style.cssText = `
      flex: 1;
      overflow: hidden;
      position: relative;
      pointer-events: auto;
    `

    // コンテンツエリア（スクロール可能）
    const contentArea = globalThis.document.createElement('div')
    contentArea.id = 'mobile-popup-content-area'
    contentArea.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 16px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      pointer-events: auto;
    `

    // modal={false} により Radix のイベントキャプチャが無効化されるため
    // ネイティブスクロールがそのまま動作する

    scrollContainer.appendChild(contentArea)

    if (type === 'summary') {
      if (doc.summary) {
        contentArea.innerHTML = `<div style="font-size: 14px; color: #374151; line-height: 1.6;">${doc.summary}</div>`
      } else if (doc.ocrResult && doc.ocrResult.length >= 100) {
        contentArea.innerHTML = `<div style="text-align: center; padding: 16px;">
          <button id="generate-summary-btn" style="padding: 8px 16px; background: #f3e8ff; color: #7c3aed; border: 1px solid #c4b5fd; border-radius: 6px; cursor: pointer;">
            🔄 AI要約を生成
          </button>
        </div>`
      } else {
        contentArea.innerHTML = `<p style="font-size: 14px; color: #9ca3af; text-align: center; padding: 16px;">OCR結果が短いため要約を生成できません</p>`
      }
    } else {
      contentArea.innerHTML = `<pre style="font-size: 12px; color: #4b5563; white-space: pre-wrap; font-family: monospace; line-height: 1.5; margin: 0;">${doc.ocrResult || 'OCR結果なし'}</pre>`
    }

    content.appendChild(header)
    content.appendChild(scrollContainer)
    container.appendChild(content)

    // 背景クリックで閉じる（イベント伝播は必ず止める）
    container.onclick = (e) => {
      e.stopPropagation()
      e.preventDefault()
      if (e.target === container) {
        onClose()
      }
    }
    container.onmousedown = (e) => {
      e.stopPropagation()
    }
    container.ontouchstart = (e) => {
      // 背景タッチの場合のみ閉じる
      if (e.target === container) {
        e.preventDefault()
        onClose()
      }
    }

    // AI要約生成ボタン
    const generateBtn = contentArea.querySelector<HTMLElement>('#generate-summary-btn')
    if (generateBtn) {
      generateBtn.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        onGenerateSummary()
      }
    }

    // body に追加
    globalThis.document.body.appendChild(container)

    // body スクロール防止
    const originalOverflow = globalThis.document.body.style.overflow
    globalThis.document.body.style.overflow = 'hidden'

    return () => {
      globalThis.document.body.style.overflow = originalOverflow
      if (container.parentNode) {
        container.parentNode.removeChild(container)
      }
    }
  }, [type, doc.summary, doc.ocrResult, onClose, onGenerateSummary])

  // isGeneratingSummary の変更を反映
  useEffect(() => {
    const btn = globalThis.document.querySelector('#generate-summary-btn') as HTMLButtonElement
    if (btn) {
      btn.disabled = isGeneratingSummary
      btn.textContent = isGeneratingSummary ? '⏳ 生成中...' : '🔄 AI要約を生成'
    }
  }, [isGeneratingSummary])

  return null // DOMはuseEffectで直接操作
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

// 編集可能メタ情報行
function EditableMetaRow({
  icon: Icon,
  label,
  value,
  editValue,
  isEditing,
  onChange,
  type = 'text',
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
  editValue?: string
  isEditing: boolean
  onChange?: (value: string) => void
  type?: 'text' | 'date'
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500">{label}</p>
        {isEditing && onChange ? (
          <Input
            type={type}
            value={editValue || ''}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1 h-8 text-sm"
          />
        ) : (
          <p className="truncate text-sm text-gray-900">{value || '-'}</p>
        )}
      </div>
    </div>
  )
}

export function DocumentDetailModal({ documentId, open, onOpenChange }: DocumentDetailModalProps) {
  const { data: document, isLoading, isError, error, refetch } = useDocument(documentId)
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlRefreshKey, setUrlRefreshKey] = useState(0) // URL強制リフレッシュ用
  const [isMetadataCollapsed, setIsMetadataCollapsed] = useState(true) // モバイルでメタ情報を折りたたみ（初期は折りたたみ）
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false) // AI要約生成中
  // デスクトップ用: 排他的アコーディオン
  const [expandedSection, setExpandedSection] = useState<'summary' | 'ocr' | null>('summary')
  // モバイル用: ポップアップ表示
  const [mobilePopup, setMobilePopup] = useState<'summary' | 'ocr' | null>(null)
  // 閉じる確認ダイアログ
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  // 編集モードで閉じる確認ダイアログ
  const [showEditCloseDialog, setShowEditCloseDialog] = useState(false)
  // ダウンロード確認ダイアログ
  const [showDownloadDialog, setShowDownloadDialog] = useState(false)
  // 再処理確認ダイアログ
  const [showReprocessDialog, setShowReprocessDialog] = useState(false)
  const [isReprocessing, setIsReprocessing] = useState(false)
  // 削除確認ダイアログ
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const queryClient = useQueryClient()
  const { isAdmin } = useAuthStore()

  // 確認ステータス管理（楽観的更新で即時反映）
  const {
    isUpdating: isVerifying,
    error: verifyError,
    markAsVerified,
    markAsUnverified,
  } = useDocumentVerification(document)

  // 編集機能
  const {
    isEditing,
    isSaving,
    editedFields,
    startEditing,
    cancelEditing,
    updateField,
    saveChanges,
    error: editError,
  } = useDocumentEdit(document)

  // マスターデータ取得（編集時のドロップダウン用）
  const { data: customers } = useCustomers()
  const { data: offices } = useOffices()
  const { data: documentTypes } = useDocumentTypes()

  // エイリアス登録
  const { addAlias, isAdding: isAddingAlias } = useMasterAlias()
  const [rememberDocTypeNotation, setRememberDocTypeNotation] = useState(false)
  const [rememberCustomerNotation, setRememberCustomerNotation] = useState(false)
  const [rememberOfficeNotation, setRememberOfficeNotation] = useState(false)

  // 学習履歴
  const { data: historyData } = useAliasLearningHistory({ pageSize: 3 })
  const { invalidate: invalidateHistory } = useInvalidateAliasLearningHistory()

  // マスターデータをMasterSelectField用に変換
  const customerItems = (customers || []).map(c => ({
    id: c.id,
    name: c.name,
    subText: c.furigana,
    notes: c.notes,
  }))
  const officeItems = (offices || []).map(o => ({
    id: o.id,
    name: o.name,
    subText: o.shortName,
    notes: o.notes,
  }))
  const documentTypeItems = (documentTypes || []).map(d => ({
    id: d.id ?? d.name,
    name: d.name,
  }))

  // OCR候補をMasterSelectField用に変換（優先表示用）
  const suggestedCustomerItems = document?.customerCandidates?.map(c => ({
    id: c.customerId || '',
    name: c.customerName || '',
    subText: c.customerNameKana,
    notes: c.notes,
    score: c.score,
  })).filter(c => c.id && c.name) || []

  const suggestedOfficeItems = document?.officeCandidates?.map(o => ({
    id: o.officeId || '',
    name: o.officeName || '',
    subText: o.shortName,
    notes: o.notes,
    score: o.score,
  })).filter(o => o.id && o.name) || []

  // 編集保存成功時
  const handleSave = async () => {
    // 顧客エイリアス登録（チェックが入っている場合）
    if (rememberCustomerNotation && document && editedFields.customerName) {
      const originalCustomer = document.customerName || ''
      const newCustomerName = editedFields.customerName
      const selectedCustomer = customers?.find(c => c.name === newCustomerName)
      if (selectedCustomer && originalCustomer !== newCustomerName) {
        try {
          await addAlias('customer', selectedCustomer.id, originalCustomer)
        } catch (err) {
          console.error('Failed to add customer alias:', err)
        }
      }
    }

    // 事業所エイリアス登録（チェックが入っている場合）
    if (rememberOfficeNotation && document && editedFields.officeName) {
      const originalOffice = document.officeName || ''
      const newOfficeName = editedFields.officeName
      const selectedOffice = offices?.find(o => o.name === newOfficeName)
      if (selectedOffice && originalOffice !== newOfficeName) {
        try {
          await addAlias('office', selectedOffice.id, originalOffice)
        } catch (err) {
          console.error('Failed to add office alias:', err)
        }
      }
    }

    // 書類種別エイリアス登録（チェックが入っている場合）
    if (rememberDocTypeNotation && document && editedFields.documentType) {
      const originalDocType = document.documentType || ''
      const newDocType = editedFields.documentType
      // 新しい書類種別のマスターIDを取得
      const selectedDocType = documentTypes?.find(d => d.name === newDocType)
      if (selectedDocType?.id && originalDocType !== newDocType && originalDocType !== '不明文書' && originalDocType !== '未判定') {
        try {
          await addAlias('document', selectedDocType.id, originalDocType)
        } catch (err) {
          console.error('Failed to add document type alias:', err)
        }
      }
    }

    const success = await saveChanges()
    if (success) {
      setRememberDocTypeNotation(false)
      setRememberCustomerNotation(false)
      setRememberOfficeNotation(false)
      // 学習履歴を更新
      if (rememberCustomerNotation || rememberOfficeNotation || rememberDocTypeNotation) {
        invalidateHistory()
      }
    }
  }

  // AI要約を生成
  const handleGenerateSummary = async () => {
    if (!documentId || isGeneratingSummary) return

    setIsGeneratingSummary(true)
    try {
      await callFunction<{ docId: string }, { success: boolean; summary: string }>(
        'regenerateSummary', { docId: documentId }, { timeout: 60_000 }
      )
      // キャッシュを無効化して再取得
      await queryClient.invalidateQueries({ queryKey: ['document', documentId] })
      await refetch()
    } catch (err) {
      console.error('Failed to generate summary:', err)
    } finally {
      setIsGeneratingSummary(false)
    }
  }

  // 顧客確定状態を判定（Phase 7）
  const needsCustomerConfirmation = document ? !isCustomerConfirmed(document) : false

  // 事業所確定状態を判定（Phase 8 同名対応）
  const needsOfficeConfirmation = document
    ? document.officeConfirmed === false && document.officeCandidates && document.officeCandidates.length > 0
    : false

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
        // キャッシュバスト用にタイムスタンプを追加
        const separator = document.fileUrl.includes('?') ? '&' : '?'
        setDownloadUrl(`${document.fileUrl}${separator}t=${urlRefreshKey}`)
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
            // キャッシュバスト用にタイムスタンプを追加
            const separator = url.includes('?') ? '&' : '?'
            setDownloadUrl(`${url}${separator}t=${urlRefreshKey}`)
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
  }, [document?.fileUrl, urlRefreshKey])

  // 実際のダウンロード処理
  const executeDownload = async () => {
    if (!downloadUrl || !document) return

    try {
      // ファイルをfetchしてBlobとして取得
      const response = await fetch(downloadUrl)
      const blob = await response.blob()

      // ダウンロードリンクを作成
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = document.fileName || 'document.pdf'
      window.document.body.appendChild(link)
      link.click()
      window.document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download failed:', error)
      // フォールバック: 新しいタブで開く
      window.open(downloadUrl, '_blank')
    }
  }

  // ダウンロードボタンクリック時（未確認なら確認ダイアログを表示）
  const handleDownload = () => {
    if (!downloadUrl || !document) return

    if (!document.verified) {
      // 未確認の場合は確認ダイアログを表示
      setShowDownloadDialog(true)
    } else {
      // 確認済みの場合は直接ダウンロード
      executeDownload()
    }
  }

  // 確認済みにしてダウンロード
  const handleVerifyAndDownload = async () => {
    await markAsVerified()
    setShowDownloadDialog(false)
    executeDownload()
  }

  // 確認なしでダウンロード
  const handleDownloadWithoutVerify = () => {
    setShowDownloadDialog(false)
    executeDownload()
  }

  // 分割成功時
  const handleSplitSuccess = () => {
    refetch()
    setIsSplitModalOpen(false)
  }

  // 再処理ハンドラ
  const handleReprocess = async () => {
    if (!documentId || isReprocessing) return
    setIsReprocessing(true)
    try {
      const clearFields = getReprocessClearFields()
      const docRef = firestoreDoc(db, 'documents', documentId)
      await updateDoc(docRef, {
        status: 'pending',
        ...clearFields,
      })
      // 楽観的更新（即時UI反映）
      updateDocumentInListCache(queryClient, documentId, {
        status: 'pending',
        ocrResult: '',
        customerName: '',
        officeName: '',
        documentType: '',
        customerConfirmed: false,
        officeConfirmed: false,
        verified: false,
      })
      queryClient.invalidateQueries({ queryKey: ['document', documentId] })
      queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
      setShowReprocessDialog(false)
      toast.success('再処理をリクエストしました。処理完了まで画面が自動更新されます。', { duration: 5000 })
    } catch (err) {
      console.error('Failed to reprocess:', err)
      toast.error('再処理リクエストに失敗しました')
    } finally {
      setIsReprocessing(false)
    }
  }

  // 個別削除
  const handleDelete = async () => {
    if (!documentId || isDeleting) return
    setIsDeleting(true)
    try {
      await callFunction<{ documentId: string }, { success: boolean; warnings?: string[] }>(
        'deleteDocument', { documentId }, { timeout: 60_000 }
      )
      // 一覧キャッシュから削除
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
              documents: page.documents.filter((doc: { id: string }) => doc.id !== documentId),
            })),
          }
        }
      )
      queryClient.invalidateQueries({ queryKey: ['documentStats'] })
      queryClient.invalidateQueries({ queryKey: ['documentGroups'] })
      setShowDeleteDialog(false)
      onOpenChange(false)
      toast.success('書類を削除しました')
    } catch (err) {
      console.error('Failed to delete document:', err)
      toast.error('書類の削除に失敗しました')
    } finally {
      setIsDeleting(false)
    }
  }

  // 分割可能かどうか（複数ページのPDFで、processed状態）
  const canSplit = document &&
    document.totalPages > 1 &&
    document.mimeType === 'application/pdf' &&
    document.status === 'processed'

  // 閉じる時のハンドラ（編集中または未確認の場合はダイアログを表示）
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // 閉じようとしている
      if (isEditing) {
        // 編集モードの場合は編集破棄の確認ダイアログを表示
        setShowEditCloseDialog(true)
      } else if (document && !document.verified) {
        // 未確認の場合はOCR確認ダイアログを表示
        setShowCloseDialog(true)
      } else {
        onOpenChange(newOpen)
      }
    } else {
      onOpenChange(newOpen)
    }
  }

  // 確認済みにして閉じる
  const handleVerifyAndClose = async () => {
    await markAsVerified()
    setShowCloseDialog(false)
    onOpenChange(false)
  }

  // 未確認のまま閉じる
  const handleCloseWithoutVerify = () => {
    setShowCloseDialog(false)
    onOpenChange(false)
  }

  // 編集を破棄して閉じる
  const handleDiscardAndClose = () => {
    cancelEditing()
    setShowEditCloseDialog(false)
    // 編集キャンセル後、未確認の場合はOCR確認ダイアログを表示
    if (document && !document.verified) {
      setShowCloseDialog(true)
    } else {
      onOpenChange(false)
    }
  }

  // 編集を続ける（閉じない）
  const handleContinueEditing = () => {
    setShowEditCloseDialog(false)
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange} modal={false}>
      <DialogContent
        className="flex h-[90vh] w-[95vw] max-w-[1100px] flex-col p-0 [&>button.absolute]:hidden"
        aria-describedby={undefined}
        onInteractOutside={(e) => {
          // ポップアップ・モーダル・確認ダイアログ表示中は外側クリックでDialogを閉じない
          if (mobilePopup !== null || isSplitModalOpen || showReprocessDialog || showCloseDialog || showEditCloseDialog || showDownloadDialog) {
            e.preventDefault()
          } else {
            handleOpenChange(false)
          }
        }}
        onPointerDownOutside={(e) => {
          if (mobilePopup !== null || isSplitModalOpen || showReprocessDialog || showCloseDialog || showEditCloseDialog || showDownloadDialog) {
            e.preventDefault()
          }
        }}
        onEscapeKeyDown={(e) => {
          // ポップアップ表示中はESCでポップアップを閉じる
          if (mobilePopup !== null) {
            e.preventDefault()
            setMobilePopup(null)
          }
        }}
      >
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
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-gray-500 sm:text-sm">{document.documentType || '未判定'}</p>
                      {document.category && (
                        <Badge variant="outline" className="text-xs">{document.category}</Badge>
                      )}
                    </div>
                  </div>
                  <Badge variant={(STATUS_CONFIG[document.status] || STATUS_CONFIG.pending).variant}>
                    {(document.status === 'pending' || document.status === 'processing') && (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    )}
                    {(STATUS_CONFIG[document.status] || STATUS_CONFIG.pending).label}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  {document.status === 'error' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowReprocessDialog(true)}
                      className="text-blue-600 border-blue-300 hover:bg-blue-50"
                    >
                      <RefreshCw className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">再処理</span>
                    </Button>
                  )}
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
                  {/* 削除ボタン（管理者のみ、編集中は無効） */}
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteDialog(true)}
                      disabled={isEditing}
                      className="text-red-600 border-red-300 hover:bg-red-50 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">削除</span>
                    </Button>
                  )}
                  {/* 閉じるボタン（独立・明確に表示） */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenChange(false)}
                    className="ml-2 h-8 w-8 rounded-full p-0 hover:bg-gray-200"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </DialogHeader>

            {/* コンテンツエリア */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
              {/* PDFビューアー（モバイル: flex-1で残り領域、デスクトップ: flex-1） */}
              <div className={`min-w-0 min-h-0 flex-1 bg-gray-100 md:h-auto`}>
                {urlLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-500">ファイルを読み込み中...</span>
                  </div>
                ) : downloadUrl && document.mimeType === 'application/pdf' ? (
                  <PdfViewer
                    key={`pdf-${urlRefreshKey}`} // キャッシュ回避のため強制再マウント
                    fileUrl={downloadUrl}
                    totalPages={document.totalPages}
                    documentId={document.id}
                    onRotationSaved={async () => {
                      // 回転保存後、URLキャッシュをクリア
                      setDownloadUrl(null)
                      setUrlLoading(true)
                      // まずrefetchを待ってから新しいURLを取得
                      await refetch()
                      // refetch完了後にURLリフレッシュキーを更新
                      setUrlRefreshKey((prev) => prev + 1)
                    }}
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

              {/* メタ情報サイドバー（モバイル: 下部表示・折りたたみ可、デスクトップ: サイドバー） */}
              <div
                className={`w-full border-t bg-white transition-all duration-200 md:flex md:h-auto md:w-72 md:flex-col md:flex-shrink-0 md:border-l md:border-t-0 md:p-4 ${
                  isMetadataCollapsed
                    ? 'h-12 flex-shrink-0 overflow-hidden px-3 py-2 md:h-auto md:overflow-y-auto'
                    : 'min-h-0 max-h-[45vh] flex-shrink-0 overflow-y-auto overscroll-contain p-3 [-webkit-overflow-scrolling:touch] md:max-h-none md:overflow-y-auto'
                }`}
              >
                <div className={`flex items-center justify-between ${isMetadataCollapsed ? '' : 'mb-4'}`}>
                  {/* モバイル用折りたたみボタン */}
                  <button
                    type="button"
                    onClick={() => setIsMetadataCollapsed(!isMetadataCollapsed)}
                    className="flex items-center gap-2 md:hidden"
                  >
                    {isMetadataCollapsed ? (
                      <ChevronDown className="h-4 w-4 text-gray-500" />
                    ) : (
                      <ChevronUp className="h-4 w-4 text-gray-500" />
                    )}
                    <h3 className="text-sm font-semibold text-gray-900">書類情報</h3>
                  </button>
                  {/* デスクトップ用タイトル + 確認ステータス */}
                  <div className="hidden md:flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-gray-900">書類情報</h3>
                    {/* OCR確認トグルスイッチ（デスクトップ：インライン表示） */}
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={document.verified || false}
                        onCheckedChange={(checked) => {
                          if (isVerifying) return // 連打防止
                          if (checked) {
                            markAsVerified()
                          } else {
                            markAsUnverified()
                          }
                        }}
                        disabled={isEditing || isVerifying}
                        className={`data-[state=checked]:bg-green-500 cursor-pointer ${isVerifying ? 'opacity-50' : ''}`}
                      />
                      <span className={`text-xs font-medium ${document.verified ? 'text-green-700' : 'text-gray-500'}`}>
                        {document.verified ? '確認済み' : '未確認'}
                      </span>
                    </div>
                  </div>

                  {/* 右側のボタン群 */}
                  <div className="flex items-center gap-2">
                    {/* AI要約/OCRボタン（モバイルのみ表示） */}
                    <button
                      type="button"
                      onClick={() => setMobilePopup('summary')}
                      className="flex md:hidden items-center gap-1 px-2 py-1 rounded bg-purple-100 text-purple-700 text-xs font-medium hover:bg-purple-200 transition-colors"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">AI</span>要約
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobilePopup('ocr')}
                      className="flex md:hidden items-center gap-1 px-2 py-1 rounded bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      OCR
                    </button>

                    {!isEditing ? (
                      <Button variant="ghost" size="sm" onClick={startEditing} className={isMetadataCollapsed ? 'md:flex hidden' : ''}>
                        <Pencil className="h-4 w-4 mr-1" />
                        編集
                      </Button>
                    ) : (
                    <div className={`flex gap-1 ${isMetadataCollapsed ? 'md:flex hidden' : ''}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={cancelEditing}
                        disabled={isSaving || isAddingAlias}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving || isAddingAlias}
                      >
                        {isSaving || isAddingAlias ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-1" />
                        )}
                        保存
                      </Button>
                    </div>
                    )}
                  </div>{/* 右側ボタン群終了 */}
                </div>

                {/* 折りたたみコンテンツ（モバイルで折りたたみ可能、デスクトップは常時表示） */}
                <div className={`relative md:flex md:flex-col md:flex-1 md:min-h-0 md:overflow-y-auto ${isMetadataCollapsed ? 'hidden md:flex' : 'block'}`}>
                {editError && (
                  <div className="mb-4 rounded bg-red-50 p-2 text-xs text-red-600">
                    {editError}
                  </div>
                )}
                {verifyError && (
                  <div className="mb-4 hidden md:block rounded bg-red-50 p-2 text-xs text-red-600">
                    {verifyError}
                  </div>
                )}

                <div className="divide-y">
                  {/* 顧客名 */}
                  <div className="flex items-start gap-3 py-2">
                    <User className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500">顧客名</p>
                      {isEditing ? (
                        <div className="mt-1">
                          {/* 編集時の警告（複数候補がある場合） */}
                          {needsCustomerConfirmation && document.customerCandidates && document.customerCandidates.length > 1 && (
                            <div className="mb-2 rounded bg-amber-50 px-2 py-1.5 border border-amber-200">
                              <p className="text-xs text-amber-800">
                                <AlertCircle className="inline h-3 w-3 mr-1" />
                                {document.customerCandidates.length}件の候補があります。確認してください
                              </p>
                            </div>
                          )}
                          <MasterSelectField
                            type="customer"
                            value={editedFields.customerName || ''}
                            items={customerItems}
                            suggestedItems={suggestedCustomerItems.length > 0 ? suggestedCustomerItems : undefined}
                            onChange={(v) => updateField('customerName', v)}
                          />
                          {/* 顧客名エイリアス学習オプション */}
                          {editedFields.customerName &&
                           document.customerName &&
                           editedFields.customerName !== document.customerName &&
                           document.customerName !== '不明顧客' &&
                           document.customerName !== '未判定' && (
                            <div className="mt-2 rounded bg-blue-50 p-2 border border-blue-200">
                              <div className="flex items-start gap-2">
                                <Checkbox
                                  id="remember-customer-notation"
                                  checked={rememberCustomerNotation}
                                  onCheckedChange={(checked) => setRememberCustomerNotation(checked === true)}
                                  className="mt-0.5"
                                />
                                <div className="flex-1">
                                  <label
                                    htmlFor="remember-customer-notation"
                                    className="text-xs font-medium cursor-pointer flex items-center gap-1"
                                  >
                                    <BookMarked className="h-3 w-3 text-blue-600" />
                                    この表記を記憶する
                                  </label>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    「{document.customerName}」を「{editedFields.customerName}」の許容表記として登録
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                          {/* 未判定時のエイリアス登録ヒント */}
                          {editedFields.customerName &&
                           document.customerName === '未判定' && (
                            <p className="mt-1.5 text-xs text-muted-foreground">
                              表記揺れで未判定になる場合は、<a href="/masters" className="text-blue-600 underline">マスター管理</a>で別表記を登録すると次回から自動マッチします
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm text-gray-900">{document.customerName || '未判定'}</span>
                          <ExtractionInfoPopover fieldType="customer" document={document} />
                          {needsCustomerConfirmation && (
                            <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
                              選択待ち
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* 事業所 */}
                  <div className="flex items-start gap-3 py-2">
                    <Building className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500">事業所</p>
                      {isEditing ? (
                        <div className="mt-1">
                          {/* 編集時の警告（複数候補がある場合） */}
                          {needsOfficeConfirmation && document.officeCandidates && document.officeCandidates.length > 1 && (
                            <div className="mb-2 rounded bg-amber-50 px-2 py-1.5 border border-amber-200">
                              <p className="text-xs text-amber-800">
                                <AlertCircle className="inline h-3 w-3 mr-1" />
                                {document.officeCandidates.length}件の候補があります。確認してください
                              </p>
                            </div>
                          )}
                          <MasterSelectField
                            type="office"
                            value={editedFields.officeName || ''}
                            items={officeItems}
                            suggestedItems={suggestedOfficeItems.length > 0 ? suggestedOfficeItems : undefined}
                            onChange={(v) => updateField('officeName', v)}
                          />
                          {/* 事業所エイリアス学習オプション */}
                          {editedFields.officeName &&
                           document.officeName &&
                           editedFields.officeName !== document.officeName &&
                           document.officeName !== '未判定' && (
                            <div className="mt-2 rounded bg-blue-50 p-2 border border-blue-200">
                              <div className="flex items-start gap-2">
                                <Checkbox
                                  id="remember-office-notation"
                                  checked={rememberOfficeNotation}
                                  onCheckedChange={(checked) => setRememberOfficeNotation(checked === true)}
                                  className="mt-0.5"
                                />
                                <div className="flex-1">
                                  <label
                                    htmlFor="remember-office-notation"
                                    className="text-xs font-medium cursor-pointer flex items-center gap-1"
                                  >
                                    <BookMarked className="h-3 w-3 text-blue-600" />
                                    この表記を記憶する
                                  </label>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    「{document.officeName}」を「{editedFields.officeName}」の許容表記として登録
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                          {/* 未判定時のエイリアス登録ヒント */}
                          {editedFields.officeName &&
                           document.officeName === '未判定' && (
                            <p className="mt-1.5 text-xs text-muted-foreground">
                              表記揺れで未判定になる場合は、<a href="/masters" className="text-blue-600 underline">マスター管理</a>で別表記を登録すると次回から自動マッチします
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm text-gray-900">{document.officeName || '未判定'}</span>
                          <ExtractionInfoPopover fieldType="office" document={document} />
                          {needsOfficeConfirmation && (
                            <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
                              選択待ち
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* 書類種別 */}
                  <div className="flex items-start gap-3 py-2">
                    <Tag className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500">書類種別</p>
                      {isEditing ? (
                        <div className="mt-1">
                          <MasterSelectField
                            type="documentType"
                            value={editedFields.documentType || ''}
                            items={documentTypeItems}
                            onChange={(v) => updateField('documentType', v)}
                          />
                          {/* 書類種別エイリアス学習オプション */}
                          {editedFields.documentType &&
                           document.documentType &&
                           editedFields.documentType !== document.documentType &&
                           document.documentType !== '不明文書' &&
                           document.documentType !== '未判定' && (
                            <div className="mt-2 rounded bg-blue-50 p-2 border border-blue-200">
                              <div className="flex items-start gap-2">
                                <Checkbox
                                  id="remember-doctype-notation"
                                  checked={rememberDocTypeNotation}
                                  onCheckedChange={(checked) => setRememberDocTypeNotation(checked === true)}
                                  className="mt-0.5"
                                />
                                <div className="flex-1">
                                  <label
                                    htmlFor="remember-doctype-notation"
                                    className="text-xs font-medium cursor-pointer flex items-center gap-1"
                                  >
                                    <BookMarked className="h-3 w-3 text-blue-600" />
                                    この表記を記憶する
                                  </label>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    「{document.documentType}」を「{editedFields.documentType}」の許容表記として登録
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                          {/* 未判定時のエイリアス登録ヒント */}
                          {editedFields.documentType &&
                           document.documentType === '未判定' && (
                            <p className="mt-1.5 text-xs text-muted-foreground">
                              表記揺れで未判定になる場合は、<a href="/masters" className="text-blue-600 underline">マスター管理</a>で別表記を登録すると次回から自動マッチします
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm text-gray-900">{document.documentType || '未判定'}</span>
                          <ExtractionInfoPopover fieldType="documentType" document={document} />
                        </div>
                      )}
                    </div>
                  </div>
                  <EditableMetaRow
                    icon={Calendar}
                    label="書類日付"
                    value={formatTimestamp(document.fileDate)}
                    editValue={editedFields.fileDate ? format(editedFields.fileDate, 'yyyy-MM-dd') : ''}
                    isEditing={isEditing}
                    onChange={(v) => updateField('fileDate', v ? new Date(v) : null)}
                    type="date"
                  />
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
                    <h4 className="mb-2 text-xs font-medium text-gray-500">担当ケアマネジャー</h4>
                    <p className="text-sm text-gray-900">{document.careManager}</p>
                  </div>
                )}

                {/* OCR確認ステータス（モバイルのみ表示） */}
                <div className="mt-4 rounded-lg border p-3 md:hidden">
                  <h4 className="mb-2 text-xs font-medium text-gray-500">OCR確認ステータス</h4>
                  {verifyError && (
                    <div className="mb-2 rounded bg-red-50 p-2 text-xs text-red-600">
                      {verifyError}
                    </div>
                  )}
                  {document.verified ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded-lg bg-green-50 p-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium text-green-800">確認済み</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={markAsUnverified}
                        disabled={isVerifying || isEditing}
                        className="w-full text-gray-600 border-gray-300 hover:bg-gray-50"
                      >
                        {isVerifying ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <XCircle className="mr-1 h-3 w-3" />
                        )}
                        取り消し
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2">
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                        <span className="text-sm font-medium text-amber-800">未確認</span>
                      </div>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={markAsVerified}
                        disabled={isVerifying || isEditing}
                        className="w-full bg-green-600 hover:bg-green-700"
                      >
                        {isVerifying ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle className="mr-1 h-3 w-3" />
                        )}
                        確認済みにする
                      </Button>
                    </div>
                  )}
                </div>

                {/* デスクトップ: アコーディオン */}
                <div className="hidden md:block">
                  {/* AI要約（排他的アコーディオン） */}
                  <div className="mt-4 border border-gray-200 rounded-lg flex flex-col">
                    <button
                      onClick={() => setExpandedSection(expandedSection === 'summary' ? null : 'summary')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 transition-colors flex-shrink-0 ${
                        expandedSection === 'summary'
                          ? 'bg-gradient-to-r from-purple-100 to-violet-100 border-b border-purple-200'
                          : 'bg-gradient-to-r from-purple-50 to-violet-50 hover:from-purple-100 hover:to-violet-100'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-xs font-medium text-gray-700">
                        <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                        AI要約
                        {document.summary && (
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-purple-500 text-white text-[10px]">✓</span>
                        )}
                      </span>
                      <ChevronDown className={`h-4 w-4 text-purple-400 transition-transform duration-200 ${expandedSection === 'summary' ? 'rotate-180' : ''}`} />
                    </button>
                    {expandedSection === 'summary' && (
                      <div className="p-3 overflow-y-auto max-h-[180px] bg-white border-t border-purple-100">
                        {document.summary ? (
                          <div className="text-sm text-gray-700 leading-relaxed">
                            {document.summary}
                          </div>
                        ) : document.ocrResult && document.ocrResult.length >= 100 ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleGenerateSummary}
                            disabled={isGeneratingSummary}
                            className="text-purple-600 border-purple-200 hover:bg-purple-50"
                          >
                            {isGeneratingSummary ? (
                              <>
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                生成中...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="mr-1 h-3 w-3" />
                                AI要約を生成
                              </>
                            )}
                          </Button>
                        ) : (
                          <p className="text-xs text-gray-400">OCR結果が短いため要約を生成できません</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* OCR結果（排他的アコーディオン） */}
                  <div className="mt-2 border border-gray-200 rounded-lg flex flex-col">
                    <button
                      onClick={() => setExpandedSection(expandedSection === 'ocr' ? null : 'ocr')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 transition-colors flex-shrink-0 ${
                        expandedSection === 'ocr'
                          ? 'bg-gradient-to-r from-slate-100 to-gray-100 border-b border-gray-200'
                          : 'bg-gradient-to-r from-slate-50 to-gray-50 hover:from-slate-100 hover:to-gray-100'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-xs font-medium text-gray-700">
                        <FileText className="h-3.5 w-3.5 text-slate-500" />
                        OCR結果
                        {document.ocrResult && (
                          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                            {document.ocrResult.length.toLocaleString()}文字
                          </span>
                        )}
                      </span>
                      <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expandedSection === 'ocr' ? 'rotate-180' : ''}`} />
                    </button>
                    {expandedSection === 'ocr' && (
                      <div className="p-3 overflow-y-auto max-h-[220px] bg-white border-t border-gray-100">
                        <div className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
                          {document.ocrResult || 'OCR結果なし'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>


                {/* 直近の学習履歴 */}
                {historyData && historyData.logs.length > 0 && (
                  <div className="mt-6">
                    <h4 className="mb-2 text-xs font-medium text-gray-500 flex items-center gap-1">
                      <History className="h-3 w-3" />
                      最近の学習
                    </h4>
                    <div className="space-y-1.5">
                      {historyData.logs.map((log) => (
                        <div key={log.id} className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5">
                          <span className="font-medium">{log.masterName}</span>
                          <span className="text-gray-400 mx-1">←</span>
                          <span className="text-gray-500">「{log.alias}」</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* 処理中オーバーレイ */}
                {(document.status === 'pending' || document.status === 'processing') && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                      <span className="text-sm text-blue-600 font-medium">
                        {document.status === 'pending' ? 'OCR処理待ち...' : 'OCR処理中...'}
                      </span>
                    </div>
                  </div>
                )}
                </div>{/* 折りたたみコンテンツ終了 */}
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
    </Dialog>

    {/* モバイル用ポップアップ */}
    {mobilePopup && document && (
      <MobileContentPopup
        type={mobilePopup}
        document={document}
        onClose={() => setMobilePopup(null)}
        onGenerateSummary={handleGenerateSummary}
        isGeneratingSummary={isGeneratingSummary}
      />
    )}

    {/* 閉じる確認ダイアログ（未確認時のみ） */}
    <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>OCR結果を確認しましたか？</AlertDialogTitle>
          <AlertDialogDescription>
            この書類のOCR結果はまだ確認されていません。
            確認済みとしてマークするか、未確認のまま閉じるかを選択してください。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel onClick={handleCloseWithoutVerify}>
            未確認のまま閉じる
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleVerifyAndClose}
            className="bg-green-600 hover:bg-green-700"
          >
            <CheckCircle className="mr-1 h-4 w-4" />
            確認済みにして閉じる
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* 編集モードで閉じる確認ダイアログ */}
    <AlertDialog open={showEditCloseDialog} onOpenChange={setShowEditCloseDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>編集内容を破棄しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            編集中の変更があります。保存せずに閉じると、変更内容は破棄されます。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel onClick={handleContinueEditing}>
            編集を続ける
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDiscardAndClose}
            className="bg-red-600 hover:bg-red-700"
          >
            破棄して閉じる
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* ダウンロード確認ダイアログ（未確認時） */}
    <AlertDialog open={showDownloadDialog} onOpenChange={setShowDownloadDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>OCR結果を確認しましたか？</AlertDialogTitle>
          <AlertDialogDescription>
            この書類のOCR結果はまだ確認されていません。
            確認済みにしてからダウンロードすることをお勧めします。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel>
            キャンセル
          </AlertDialogCancel>
          <Button
            variant="outline"
            onClick={handleDownloadWithoutVerify}
          >
            <Download className="mr-1 h-4 w-4" />
            確認なしでダウンロード
          </Button>
          <AlertDialogAction
            onClick={handleVerifyAndDownload}
            disabled={isVerifying}
            className="bg-green-600 hover:bg-green-700"
          >
            {isVerifying ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="mr-1 h-4 w-4" />
            )}
            確認済みにしてダウンロード
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* 再処理確認ダイアログ */}
    <AlertDialog open={showReprocessDialog} onOpenChange={setShowReprocessDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>再処理を実行しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            この書類のOCR処理を再実行します。現在のOCR結果は削除されます。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isReprocessing}>
            キャンセル
          </AlertDialogCancel>
          <Button
            onClick={handleReprocess}
            disabled={isReprocessing}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isReprocessing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            {isReprocessing ? '処理中...' : '再処理を実行'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* 削除確認ダイアログ */}
    <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {isDeleting && <Loader2 className="h-5 w-5 animate-spin" />}
            {isDeleting ? '削除中...' : 'この書類を削除しますか？'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isDeleting ? (
              <span className="text-blue-600">書類を削除しています。しばらくお待ちください...</span>
            ) : (
              <>
                「{document?.fileName}」を削除します。<br />
                この操作は元に戻せません。関連するファイルとログも同時に削除されます。
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            キャンセル
          </AlertDialogCancel>
          <Button
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
          >
            {isDeleting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-4 w-4" />
            )}
            {isDeleting ? '処理中...' : '削除する'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
