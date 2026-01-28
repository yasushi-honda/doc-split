/**
 * 書類詳細モーダル
 * PDFビューアーとメタ情報を表示
 */

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Timestamp } from 'firebase/firestore'
import { ref, getDownloadURL } from 'firebase/storage'
import { Download, ExternalLink, Loader2, FileText, User, Building, Calendar, Tag, AlertCircle, Scissors, Pencil, Save, X, BookMarked, History } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { PdfViewer } from '@/components/PdfViewer'
import { PdfSplitModal } from '@/components/PdfSplitModal'
import { MasterSelectField } from '@/components/MasterSelectField'
import { useDocument } from '@/hooks/useDocuments'
import { useDocumentEdit } from '@/hooks/useDocumentEdit'
import { useCustomers, useOffices, useDocumentTypes } from '@/hooks/useMasters'
import { useMasterAlias } from '@/hooks/useMasterAlias'
import { useAliasLearningHistory, useInvalidateAliasLearningHistory } from '@/hooks/useAliasLearningHistory'
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
    id: d.id,
    name: d.name,
  }))

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
      if (selectedDocType && originalDocType !== newDocType && originalDocType !== '不明文書' && originalDocType !== '未判定') {
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
      refetch()
      // 学習履歴を更新
      if (rememberCustomerNotation || rememberOfficeNotation || rememberDocTypeNotation) {
        invalidateHistory()
      }
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

              {/* メタ情報サイドバー（モバイルでは非表示） */}
              <div className="hidden w-80 flex-shrink-0 overflow-y-auto border-l bg-white p-4 md:block">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">書類情報</h3>
                  {!isEditing ? (
                    <Button variant="ghost" size="sm" onClick={startEditing}>
                      <Pencil className="h-4 w-4 mr-1" />
                      編集
                    </Button>
                  ) : (
                    <div className="flex gap-1">
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
                </div>

                {editError && (
                  <div className="mb-4 rounded bg-red-50 p-2 text-xs text-red-600">
                    {editError}
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
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm text-gray-900">{document.customerName || '未判定'}</span>
                          {needsCustomerConfirmation && (
                            <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
                              要確認
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
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm text-gray-900">{document.officeName || '未判定'}</span>
                          {needsOfficeConfirmation && (
                            <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
                              要確認
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
                        </div>
                      ) : (
                        <p className="truncate text-sm text-gray-900">{document.documentType || '未判定'}</p>
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
  )
}
