/**
 * PDF分割モーダル
 * 分割候補の表示、手動追加、分割実行
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { ref, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { toast } from 'sonner'
import {
  Scissors,
  Plus,
  Trash2,
  RotateCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MasterSelectField } from '@/components/MasterSelectField'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  useDetectSplitPoints,
  useSplitPdf,
  useRotatePdfPages,
  generateSplitPreview,
} from '@/hooks/usePdfSplit'
import { useDocumentMasters, useCustomerMasters, useOfficeMasters } from '@/hooks/useDocuments'
import { PdfSplitPreview } from './PdfSplitPreview'
import { getDisplayFileName } from '@/utils/getDisplayFileName'
import { applySegmentFieldEdit, buildSegmentConfirmedFlags, type SegmentTextField } from '@/lib/documentUtils'
import { getCallableErrorCode, getCallableErrorMessage } from '@/lib/callFunction'
import type { Document, SplitSuggestion, SplitSegment } from '@shared/types'

interface PdfSplitModalProps {
  document: Document
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  // ADR-0018 Phase E 事前調査の既知リスク対応: documents/{id}/detail/main の
  // 取得が未完了・失敗のまま分割を進めると、pageResults 欠落により
  // documentType/customerName が黙って「未判定」化する（親から渡される
  // document.pageResults は親側で detail 優先の resolveDetailFields 済み）。
  // 呼び出し元 (DocumentDetailModal) の useDocumentDetail の状態をそのまま渡す。
  detailLoading: boolean
  detailError: boolean
}

export function PdfSplitModal({
  document,
  isOpen,
  onClose,
  onSuccess,
  detailLoading,
  detailError,
}: PdfSplitModalProps) {
  // 分割ポイント（ページ番号の配列）
  const [splitPoints, setSplitPoints] = useState<number[]>([])
  // 各セグメントの編集データ
  const [segmentEdits, setSegmentEdits] = useState<Map<number, Partial<SplitSegment>>>(
    new Map()
  )
  // 現在表示中のページ
  const [currentPage, setCurrentPage] = useState(1)
  // 確認ステップ
  const [isConfirmStep, setIsConfirmStep] = useState(false)
  // PDFダウンロードURL（gs:// URLを変換）
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [urlLoading, setUrlLoading] = useState(false)
  // 自動検出されたセグメント
  const [detectedSegments, setDetectedSegments] = useState<Array<{
    startPage: number
    endPage: number
    documentType: string
    customerName: string
    customerId: string | null
    officeName: string
    officeId?: string | null
  }> | null>(null)
  // 自動検出結果メッセージ
  const [detectResultMessage, setDetectResultMessage] = useState<{
    type: 'success' | 'info' | 'error'
    message: string
  } | null>(null)

  // マスターデータ
  const { data: documentMasters } = useDocumentMasters()
  const { data: customerMasters } = useCustomerMasters()
  const { data: officeMasters } = useOfficeMasters()

  // MasterSelectField用に変換
  const customerItems = useMemo(() => (customerMasters || []).map(c => ({
    id: c.id,
    name: c.name,
    subText: c.furigana,
  })), [customerMasters])
  const officeItems = useMemo(() => (officeMasters || []).map(o => ({
    id: o.id,
    name: o.name,
    subText: o.shortName,
  })), [officeMasters])
  const documentTypeItems = useMemo(() => (documentMasters || []).map(d => ({
    id: d.id ?? d.name,
    name: d.name,
  })), [documentMasters])

  // Mutations
  const detectSplitPoints = useDetectSplitPoints()
  const splitPdf = useSplitPdf()
  const rotatePdf = useRotatePdfPages()

  // 分割候補から初期ポイントを設定
  // Issue #621 (Codexレビュー指摘反映): isConfirmStepへの依存でガードすると、
  // 「戻る」でisConfirmStepがfalseに戻った際に本エフェクトが再発火し、結局
  // ユーザーの手動編集がsplitSuggestionsで上書きされてしまう(往路のonError
  // invalidateだけでなく復路の「戻る」操作でも同じ問題が起きる)。
  // ステップ遷移に依存させず、同一document.idに対しては一度だけ初期化する。
  const initializedDocIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (initializedDocIdRef.current === document.id) return
    if (document.splitSuggestions && document.splitSuggestions.length > 0) {
      const points = document.splitSuggestions.map((s) => s.afterPageNumber)
      setSplitPoints(points)
      initializedDocIdRef.current = document.id
    }
  }, [document.id, document.splitSuggestions])

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

  // 分割プレビューを生成
  const segments = useMemo(() => {
    // 自動検出されたセグメントがあればそれを使用
    if (detectedSegments && detectedSegments.length > 0) {
      return detectedSegments.map((segment, index) => {
        const edits = segmentEdits.get(index)
        return edits ? { ...segment, ...edits } : segment
      })
    }
    // なければgenerateSplitPreviewで生成
    const preview = generateSplitPreview(
      document.totalPages,
      splitPoints,
      document.pageResults
    )
    // 編集データを反映
    return preview.map((segment, index) => {
      const edits = segmentEdits.get(index)
      return edits ? { ...segment, ...edits } : segment
    })
  }, [document.totalPages, splitPoints, document.pageResults, segmentEdits, detectedSegments])

  // 分割候補を自動検出
  // GOAL.md task 7 (AC-f): segmentEditsはセグメント配列のindexをキーに手動編集内容を
  // 保持するが、再検出でセグメント構成(境界・内容)が丸ごと入れ替わるとindexの対応関係も
  // 無効になる。クリアせずに残すと、新しいセグメントへ古いindexの編集内容が誤って
  // 上書き適用されてしまう(手動修正後の自動検出再実行で発生する回帰)。
  const handleDetectSplitPoints = async () => {
    setDetectResultMessage(null)
    try {
      const result = await detectSplitPoints.mutateAsync(document.id)
      const points = result.suggestions.map((s) => s.afterPageNumber)
      setSplitPoints(points)
      setSegmentEdits(new Map())

      // 検出されたセグメントを保存
      if (result.segments && result.segments.length > 0) {
        setDetectedSegments(result.segments.map(seg => ({
          startPage: seg.startPage,
          endPage: seg.endPage,
          documentType: seg.documentType || '未判定',
          customerName: seg.customerName || '未判定',
          customerId: seg.customerId,
          officeName: seg.officeName || '未判定',
          officeId: seg.officeId,
        })))
      }

      // 結果メッセージを設定
      if (points.length > 0) {
        setDetectResultMessage({
          type: 'success',
          message: `${points.length}件の分割ポイントを検出しました`,
        })
      } else if (result.shouldSplit === false) {
        setDetectResultMessage({
          type: 'info',
          message: '分割の必要はありません（1つの書類として認識）',
        })
      } else {
        setDetectResultMessage({
          type: 'info',
          message: '分割ポイントは検出されませんでした',
        })
      }
    } catch (error) {
      console.error('Detection error:', error)
      setDetectResultMessage({
        type: 'error',
        message: '検出に失敗しました。再度お試しください。',
      })
    }
  }

  // 分割ポイントを追加
  const handleAddSplitPoint = (pageNumber: number) => {
    if (pageNumber >= 1 && pageNumber < document.totalPages) {
      setSplitPoints((prev) => {
        if (prev.includes(pageNumber)) return prev
        return [...prev, pageNumber].sort((a, b) => a - b)
      })
    }
  }

  // 分割ポイントを削除
  const handleRemoveSplitPoint = (pageNumber: number) => {
    setSplitPoints((prev) => prev.filter((p) => p !== pageNumber))
  }

  // セグメントの編集
  // Issue #538: 顧客名/事業所名編集時にIDが古いまま残る不整合を防ぐため、
  // ID同期は applySegmentFieldEdit（documentUtils.ts）に委譲する。
  const handleSegmentEdit = (
    index: number,
    field: SegmentTextField,
    value: string,
    item?: { id: string }
  ) => {
    setSegmentEdits((prev) => {
      const newMap = new Map(prev)
      const existing = newMap.get(index) || {}
      newMap.set(index, applySegmentFieldEdit(existing, field, value, item))
      return newMap
    })
  }

  // ページ回転
  const handleRotatePage = async (degrees: 90 | 180 | 270) => {
    await rotatePdf.mutateAsync({
      documentId: document.id,
      rotations: [{ pageNumber: currentPage, degrees }],
    })
  }

  // 分割実行
  const handleSplit = async () => {
    const segmentsData = segments.map((segment, index) => {
      // マスターデータからIDを解決
      const customerMaster = customerMasters?.find(
        (c) => c.name === segment.customerName
      )
      const officeMaster = officeMasters?.find(
        (o) => o.name === segment.officeName
      )

      return {
        startPage: segment.startPage,
        endPage: segment.endPage,
        documentType: segment.documentType,
        customerName: segment.customerName,
        customerId: segment.customerId || customerMaster?.id || null,
        officeName: segment.officeName,
        officeId: segment.officeId || officeMaster?.id || null,
        // 候補情報（既存のセグメント情報があれば引き継ぐ）
        customerCandidates: ('customerCandidates' in segment && segment.customerCandidates) || (customerMaster ? [{
          id: customerMaster.id,
          name: customerMaster.name,
          score: 100,
          isDuplicate: customerMaster.isDuplicate || false,
          careManagerName: customerMaster.careManagerName,
        }] : []),
        officeCandidates: ('officeCandidates' in segment && segment.officeCandidates) || (officeMaster ? [{
          id: officeMaster.id,
          name: officeMaster.name,
          score: 100,
          isDuplicate: officeMaster.isDuplicate || false,
        }] : []),
        needsManualCustomerSelection: ('needsManualCustomerSelection' in segment && segment.needsManualCustomerSelection) || false,
        needsManualOfficeSelection: ('needsManualOfficeSelection' in segment && segment.needsManualOfficeSelection) || false,
        isDuplicateCustomer: ('isDuplicateCustomer' in segment && segment.isDuplicateCustomer) || customerMaster?.isDuplicate || false,
        careManagerName: ('careManagerName' in segment ? segment.careManagerName : null) || customerMaster?.careManagerName || null,
        // Issue #526: サーバー側でID有無から確定状態を推測せず、フロントエンドが
        // 「実際に編集したフィールドか」+値の妥当性に基づくconfirmedフラグを明示送信する
        // (AI自動検出のみで未編集のフィールドはconfirmed=falseのまま、
        //  silent-failure-hunterレビュー反映)
        ...buildSegmentConfirmedFlags(
          {
            customerName: segment.customerName,
            officeName: segment.officeName,
            documentType: segment.documentType,
          },
          segmentEdits.get(index)
        ),
      }
    })

    try {
      await splitPdf.mutateAsync({
        documentId: document.id,
        splitPoints,
        segments: segmentsData,
      })
      toast.success('PDF分割が完了しました')
      onSuccess()
      onClose()
    } catch (error) {
      console.error('Split error:', error)
      // Issue #621: already-exists/aborted はBE側メッセージに内部docIdや英語の
      // 技術的説明文が含まれるため、そのまま表示せず文脈に応じた文言に翻訳する。
      // それ以外のコード(invalid-argument/not-found/failed-precondition等)は
      // 従来通り生メッセージを表示する(getCallableErrorMessageは未知コードを
      // 汎用文言に丸めてしまい、splitPdf固有の具体的な原因情報が失われるため)
      const code = getCallableErrorCode(error)
      let message: string
      if (code === 'already-exists') {
        message = 'この書類は既に分割済みです。画面を更新して最新の状態をご確認ください。'
      } else if (code === 'aborted') {
        message = '別の操作と競合したため分割を中断しました。時間をおいて再度お試しください。'
      } else if (
        code === 'unauthenticated' ||
        code === 'deadline-exceeded' ||
        code === 'internal' ||
        code === 'permission-denied'
      ) {
        message = getCallableErrorMessage(error, '分割処理に失敗しました')
      } else {
        message = error instanceof Error ? error.message : '分割処理に失敗しました'
      }
      toast.error(`分割エラー: ${message}`)
    }
  }

  // 分割ポイントの理由を取得
  const getSplitReason = (pageNumber: number): SplitSuggestion | undefined => {
    return document.splitSuggestions?.find((s) => s.afterPageNumber === pageNumber)
  }

  const reasonLabels: Record<string, string> = {
    new_customer: '顧客変更',
    new_document_type: '書類種別変更',
    content_break: '内容区切り',
    manual: '手動追加',
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5" />
            PDF分割
          </DialogTitle>
          <DialogDescription>
            {getDisplayFileName(document)} ({document.totalPages}ページ)
          </DialogDescription>
        </DialogHeader>

        {(detailLoading || detailError) && (
          <div
            className={`flex items-center gap-2 rounded p-2 text-sm ${
              detailError
                ? 'bg-red-50 text-red-700 border border-red-200'
                : 'bg-blue-50 text-blue-700 border border-blue-200'
            }`}
          >
            {detailError ? (
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
            ) : (
              <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
            )}
            {detailError
              ? '書類詳細の取得に失敗したため分割を実行できません。モーダルを閉じて開き直してください。'
              : '書類詳細を読み込み中です。読み込みが完了するまで分割は実行できません。'}
          </div>
        )}

        {!isConfirmStep ? (
          // ステップ1: 分割ポイント設定
          <div className="flex-1 overflow-hidden flex gap-4">
            {/* 左側: PDFプレビュー */}
            <div className="w-1/2 flex flex-col min-h-[400px]">
              {/* 回転ボタン */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">
                  サムネイルをクリックでページ選択
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRotatePage(90)}
                  disabled={rotatePdf.isPending}
                  title="選択中のページを90度回転"
                >
                  <RotateCw className="h-4 w-4 mr-1" />
                  回転
                </Button>
              </div>

              {/* PDFプレビュー（サムネイル一覧 + 拡大表示） */}
              <div className="flex-1 border rounded-lg overflow-hidden">
                {urlLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-500">PDFを準備中...</span>
                  </div>
                ) : downloadUrl ? (
                  <PdfSplitPreview
                    fileUrl={downloadUrl}
                    totalPages={document.totalPages}
                    currentPage={currentPage}
                    splitPoints={splitPoints}
                    onPageSelect={setCurrentPage}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-red-500">
                    PDFのURLを取得できませんでした
                  </div>
                )}
              </div>

              {/* 現在ページの後に分割ポイント追加 */}
              {currentPage < document.totalPages && (
                <div className="mt-2">
                  {splitPoints.includes(currentPage) ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => handleRemoveSplitPoint(currentPage)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      ページ {currentPage} の後の分割を解除
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => handleAddSplitPoint(currentPage)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      ページ {currentPage} の後で分割
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* 右側: 分割ポイント一覧 */}
            <div className="w-1/2 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">分割ポイント</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDetectSplitPoints}
                  disabled={detectSplitPoints.isPending}
                >
                  {detectSplitPoints.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <AlertCircle className="h-4 w-4 mr-2" />
                  )}
                  自動検出
                </Button>
              </div>

              {/* 自動検出結果メッセージ */}
              {detectResultMessage && (
                <div
                  className={`mb-2 p-2 rounded text-sm ${
                    detectResultMessage.type === 'success'
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : detectResultMessage.type === 'error'
                        ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                  }`}
                >
                  {detectResultMessage.message}
                </div>
              )}

              <div className="flex-1 overflow-y-auto space-y-2">
                {splitPoints.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    <p>分割ポイントがありません</p>
                    <p className="text-xs mt-1">
                      「自動検出」または手動でポイントを追加してください
                    </p>
                  </div>
                ) : (
                  splitPoints.map((point) => {
                    const reason = getSplitReason(point)
                    return (
                      <Card key={point} className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Scissors className="h-4 w-4 text-orange-500" />
                            <span className="font-medium">
                              ページ {point} の後
                            </span>
                            {reason && (
                              <Badge variant="secondary">
                                {reasonLabels[reason.reason] || reason.reason}
                              </Badge>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveSplitPoint(point)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                        {reason && (
                          <div className="mt-2 text-xs text-gray-500">
                            {reason.newCustomerName && (
                              <p>顧客: {reason.newCustomerName}</p>
                            )}
                            {reason.newDocumentType && (
                              <p>書類: {reason.newDocumentType}</p>
                            )}
                            <p>確信度: {reason.confidence}%</p>
                          </div>
                        )}
                      </Card>
                    )
                  })
                )}
              </div>

              {/* 分割プレビュー */}
              <Separator className="my-4" />
              <div className="text-sm font-medium mb-2">
                分割後のセグメント ({segments.length}件)
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {segments.map((segment, index) => (
                  <div
                    key={index}
                    className="text-xs bg-gray-50 rounded p-2 flex justify-between"
                  >
                    <span>
                      セグメント {index + 1}: ページ {segment.startPage}-
                      {segment.endPage}
                    </span>
                    <span className="text-gray-500">
                      {segment.customerName} / {segment.documentType}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          // ステップ2: 分割確認・編集
          <div className="flex-1 overflow-y-auto">
            <div className="space-y-4">
              {segments.map((segment, index) => (
                <Card key={index}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Badge variant="outline">セグメント {index + 1}</Badge>
                      ページ {segment.startPage} - {segment.endPage}
                      <span className="text-gray-500 text-sm font-normal">
                        ({segment.endPage - segment.startPage + 1}ページ)
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">顧客名</Label>
                        <MasterSelectField
                          type="customer"
                          value={segment.customerName}
                          items={customerItems}
                          onChange={(v, item) => handleSegmentEdit(index, 'customerName', v, item)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">書類種別</Label>
                        <MasterSelectField
                          type="documentType"
                          value={segment.documentType}
                          items={documentTypeItems}
                          onChange={(v) => handleSegmentEdit(index, 'documentType', v)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">事業所</Label>
                        <MasterSelectField
                          type="office"
                          value={segment.officeName}
                          items={officeItems}
                          onChange={(v, item) => handleSegmentEdit(index, 'officeName', v, item)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="mt-4">
          {!isConfirmStep ? (
            <>
              <Button variant="outline" onClick={onClose}>
                キャンセル
              </Button>
              <Button
                onClick={() => setIsConfirmStep(true)}
                disabled={splitPoints.length === 0 || detailLoading || detailError}
              >
                次へ: 分割内容の確認
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setIsConfirmStep(false)}>
                戻る
              </Button>
              <Button
                onClick={handleSplit}
                disabled={splitPdf.isPending || detailLoading || detailError}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {splitPdf.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                分割を実行
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
