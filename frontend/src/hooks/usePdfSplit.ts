/**
 * PDF分割機能フック
 * Cloud Functionsと連携してPDF分割を実行
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import type { SplitSuggestion, SplitSegment } from '@shared/types'

// ============================================
// 型定義
// ============================================

interface DetectSplitPointsResponse {
  suggestions: SplitSuggestion[]
}

interface SplitPdfSegment {
  startPage: number
  endPage: number
  documentType: string
  customerName: string
  customerId?: string | null
  officeName: string
  officeId?: string | null
  /** 顧客候補リスト */
  customerCandidates?: Array<{
    id: string
    name: string
    score: number
    isDuplicate: boolean
    careManagerName?: string
  }>
  /** 事業所候補リスト */
  officeCandidates?: Array<{
    id: string
    name: string
    score: number
    isDuplicate: boolean
  }>
  /** 手動選択が必要か（顧客） */
  needsManualCustomerSelection?: boolean
  /** 手動選択が必要か（事業所） */
  needsManualOfficeSelection?: boolean
  /** 同姓同名の顧客か */
  isDuplicateCustomer?: boolean
  /** 担当ケアマネ名 */
  careManagerName?: string | null
}

interface SplitPdfRequest {
  documentId: string
  splitPoints: number[]
  segments: SplitPdfSegment[]
}

interface SplitPdfResponse {
  success: boolean
  createdDocuments: string[]
}

interface RotatePdfRequest {
  documentId: string
  rotations: Array<{
    pageNumber: number
    degrees: 90 | 180 | 270
  }>
}

// ============================================
// 分割候補検出
// ============================================

async function detectSplitPoints(documentId: string): Promise<SplitSuggestion[]> {
  const callable = httpsCallable<{ documentId: string }, DetectSplitPointsResponse>(
    functions,
    'detectSplitPoints'
  )
  const result = await callable({ documentId })
  return result.data.suggestions
}

export function useDetectSplitPoints() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: detectSplitPoints,
    onSuccess: (_, documentId) => {
      queryClient.invalidateQueries({ queryKey: ['document', documentId] })
    },
  })
}

// ============================================
// PDF分割実行
// ============================================

async function splitPdf(request: SplitPdfRequest): Promise<SplitPdfResponse> {
  const callable = httpsCallable<SplitPdfRequest, SplitPdfResponse>(
    functions,
    'splitPdf'
  )
  const result = await callable(request)
  return result.data
}

export function useSplitPdf() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: splitPdf,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document'] })
    },
  })
}

// ============================================
// PDF回転
// ============================================

async function rotatePdfPages(request: RotatePdfRequest): Promise<void> {
  const callable = httpsCallable<RotatePdfRequest, { success: boolean }>(
    functions,
    'rotatePdfPages'
  )
  await callable(request)
}

export function useRotatePdfPages() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: rotatePdfPages,
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ['document', documentId] })
    },
  })
}

// ============================================
// 分割プレビュー生成
// ============================================

export function generateSplitPreview(
  totalPages: number,
  splitPoints: number[],
  pageResults?: Array<{
    pageNumber: number
    detectedDocumentType: string | null
    detectedCustomerName: string | null
    detectedOfficeName: string | null
  }>
): SplitSegment[] {
  // 分割ポイントをソート
  const sortedPoints = [...splitPoints].sort((a, b) => a - b)

  // セグメントを生成
  const segments: SplitSegment[] = []
  let startPage = 1

  for (const point of sortedPoints) {
    if (point >= startPage && point < totalPages) {
      segments.push(createSegment(startPage, point, pageResults))
      startPage = point + 1
    }
  }

  // 最後のセグメント
  if (startPage <= totalPages) {
    segments.push(createSegment(startPage, totalPages, pageResults))
  }

  return segments
}

function createSegment(
  startPage: number,
  endPage: number,
  pageResults?: Array<{
    pageNumber: number
    detectedDocumentType: string | null
    detectedCustomerName: string | null
    detectedOfficeName: string | null
  }>
): SplitSegment {
  // 該当ページ範囲の最初のページから情報を取得
  const firstPageResult = pageResults?.find((p) => p.pageNumber === startPage)

  return {
    startPage,
    endPage,
    suggestedFileName: '',
    documentType: firstPageResult?.detectedDocumentType || '未判定',
    customerName: firstPageResult?.detectedCustomerName || '未判定',
    officeName: firstPageResult?.detectedOfficeName || '未判定',
    fileDate: null,
  }
}
