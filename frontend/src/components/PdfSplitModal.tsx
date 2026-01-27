/**
 * PDF分割モーダル
 * 分割候補の表示、手動追加、分割実行
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Scissors,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  useDetectSplitPoints,
  useSplitPdf,
  useRotatePdfPages,
  generateSplitPreview,
} from '@/hooks/usePdfSplit'
import { useDocumentMasters, useCustomerMasters, useOfficeMasters } from '@/hooks/useDocuments'
import type { Document, SplitSuggestion, SplitSegment } from '@shared/types'

interface PdfSplitModalProps {
  document: Document
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function PdfSplitModal({
  document,
  isOpen,
  onClose,
  onSuccess,
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

  // マスターデータ
  const { data: documentMasters } = useDocumentMasters()
  const { data: customerMasters } = useCustomerMasters()
  const { data: officeMasters } = useOfficeMasters()

  // Mutations
  const detectSplitPoints = useDetectSplitPoints()
  const splitPdf = useSplitPdf()
  const rotatePdf = useRotatePdfPages()

  // 分割候補から初期ポイントを設定
  useEffect(() => {
    if (document.splitSuggestions && document.splitSuggestions.length > 0) {
      const points = document.splitSuggestions.map((s) => s.afterPageNumber)
      setSplitPoints(points)
    }
  }, [document.splitSuggestions])

  // 分割プレビューを生成
  const segments = useMemo(() => {
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
  }, [document.totalPages, splitPoints, document.pageResults, segmentEdits])

  // 分割候補を自動検出
  const handleDetectSplitPoints = async () => {
    const suggestions = await detectSplitPoints.mutateAsync(document.id)
    const points = suggestions.map((s) => s.afterPageNumber)
    setSplitPoints(points)
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
  const handleSegmentEdit = (
    index: number,
    field: keyof SplitSegment,
    value: string
  ) => {
    setSegmentEdits((prev) => {
      const newMap = new Map(prev)
      const existing = newMap.get(index) || {}
      newMap.set(index, { ...existing, [field]: value })
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
    const segmentsData = segments.map((segment) => {
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
        customerCandidates: segment.customerCandidates || (customerMaster ? [{
          id: customerMaster.id,
          name: customerMaster.name,
          score: 100,
          isDuplicate: customerMaster.isDuplicate || false,
          careManagerName: customerMaster.careManagerName,
        }] : []),
        officeCandidates: segment.officeCandidates || (officeMaster ? [{
          id: officeMaster.id,
          name: officeMaster.name,
          score: 100,
          isDuplicate: officeMaster.isDuplicate || false,
        }] : []),
        needsManualCustomerSelection: segment.needsManualCustomerSelection || false,
        needsManualOfficeSelection: segment.needsManualOfficeSelection || false,
        isDuplicateCustomer: segment.isDuplicateCustomer || customerMaster?.isDuplicate || false,
        careManagerName: segment.careManagerName || customerMaster?.careManagerName || null,
      }
    })

    await splitPdf.mutateAsync({
      documentId: document.id,
      splitPoints,
      segments: segmentsData,
    })

    onSuccess()
    onClose()
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
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5" />
            PDF分割
          </DialogTitle>
          <DialogDescription>
            {document.fileName} ({document.totalPages}ページ)
          </DialogDescription>
        </DialogHeader>

        {!isConfirmStep ? (
          // ステップ1: 分割ポイント設定
          <div className="flex-1 overflow-hidden flex gap-4">
            {/* 左側: ページプレビュー */}
            <div className="w-1/2 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  ページ {currentPage} / {document.totalPages}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleRotatePage(90)}
                    disabled={rotatePdf.isPending}
                    title="90度回転"
                  >
                    <RotateCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* ページサムネイル表示エリア */}
              <div className="flex-1 bg-gray-100 rounded-lg flex items-center justify-center min-h-[300px]">
                <div className="text-gray-500 text-center">
                  <p>ページ {currentPage}</p>
                  <p className="text-xs mt-1">
                    (プレビューは実装予定)
                  </p>
                </div>
              </div>

              {/* ページナビゲーション */}
              <div className="flex items-center justify-center gap-2 mt-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={document.totalPages}
                  value={currentPage}
                  onChange={(e) => {
                    const val = parseInt(e.target.value)
                    if (val >= 1 && val <= document.totalPages) {
                      setCurrentPage(val)
                    }
                  }}
                  className="w-20 text-center"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setCurrentPage((p) => Math.min(document.totalPages, p + 1))
                  }
                  disabled={currentPage === document.totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
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
                        <Select
                          value={segment.customerName}
                          onValueChange={(v) =>
                            handleSegmentEdit(index, 'customerName', v)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="未判定">未判定</SelectItem>
                            {customerMasters?.map((c) => (
                              <SelectItem key={c.id} value={c.name}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">書類種別</Label>
                        <Select
                          value={segment.documentType}
                          onValueChange={(v) =>
                            handleSegmentEdit(index, 'documentType', v)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="未判定">未判定</SelectItem>
                            {documentMasters?.map((d) => (
                              <SelectItem key={d.name} value={d.name}>
                                {d.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">事業所</Label>
                        <Select
                          value={segment.officeName}
                          onValueChange={(v) =>
                            handleSegmentEdit(index, 'officeName', v)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="未判定">未判定</SelectItem>
                            {officeMasters?.map((o) => (
                              <SelectItem key={o.name} value={o.name}>
                                {o.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                disabled={splitPoints.length === 0}
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
                disabled={splitPdf.isPending}
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
