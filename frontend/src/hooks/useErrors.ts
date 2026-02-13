/**
 * エラー履歴管理フック
 *
 * バックエンド(ErrorLog)とフロントエンド(ErrorRecord)のスキーマ変換を行う
 * BE: createdAt, category, source, status('pending'/'resolved'/'ignored'), errorMessage
 * FE: errorDate, errorType(日本語), status('未対応'/'対応中'/'完了'), errorDetails
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  Timestamp,
  QueryConstraint,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { ErrorRecord, ErrorStatus, ErrorType } from '@shared/types'

// ============================================
// 型定義
// ============================================

export interface ErrorFilters {
  status?: ErrorStatus
  errorType?: ErrorType
  dateFrom?: Date
  dateTo?: Date
}

interface UseErrorsOptions {
  filters?: ErrorFilters
  pageSize?: number
  enabled?: boolean
}

// ============================================
// BE → FE スキーマ変換ヘルパー
// ============================================

/** BE category + source → FE ErrorType(日本語) */
function convertToErrorType(category: string, source: string): ErrorType {
  if (source === 'ocr') {
    if (category === 'fatal') return 'OCR完全失敗'
    if (category === 'data') return '情報抽出エラー'
    return 'OCR部分失敗'
  }
  if (source === 'pdf') return 'ファイル処理エラー'
  return 'システムエラー'
}

/** BE status → FE ErrorStatus(日本語) */
function convertToErrorStatus(status: string): ErrorStatus {
  if (status === 'pending') return '未対応'
  if (status === 'resolved' || status === 'ignored') return '完了'
  return '未対応'
}

/** FE ErrorStatus(日本語) → BE status値の配列(クエリ用) */
function convertFromErrorStatus(status: ErrorStatus): string[] {
  if (status === '未対応') return ['pending']
  if (status === '完了') return ['resolved', 'ignored']
  if (status === '対応中') return [] // BEに該当なし
  return []
}

/** FE ErrorStatus(日本語) → BE status値(更新用) */
function convertFromErrorStatusSingle(status: ErrorStatus): string {
  if (status === '未対応') return 'pending'
  if (status === '完了') return 'resolved'
  if (status === '対応中') return 'pending'
  return 'pending'
}

// ============================================
// エラー一覧取得
// ============================================

async function fetchErrors(
  filters: ErrorFilters,
  pageSize: number
): Promise<ErrorRecord[]> {
  const constraints: QueryConstraint[] = []

  // ステータスフィルター（BE値に変換してクエリ）
  if (filters.status) {
    const beStatuses = convertFromErrorStatus(filters.status)
    if (beStatuses.length === 0) return [] // '対応中'はBEに該当なし
    if (beStatuses.length === 1) {
      constraints.push(where('status', '==', beStatuses[0]))
    } else {
      constraints.push(where('status', 'in', beStatuses))
    }
  }

  // 日付範囲フィルター（BE: createdAt）
  if (filters.dateFrom) {
    constraints.push(where('createdAt', '>=', Timestamp.fromDate(filters.dateFrom)))
  }
  if (filters.dateTo) {
    constraints.push(where('createdAt', '<=', Timestamp.fromDate(filters.dateTo)))
  }

  // ソート（BE: createdAt 降順）
  constraints.push(orderBy('createdAt', 'desc'))
  constraints.push(limit(pageSize))

  const q = query(collection(db, 'errors'), ...constraints)
  const snapshot = await getDocs(q)

  // documentIdを収集してバッチ取得
  const docIds = new Set<string>()
  const errorDocs = snapshot.docs.map((d) => {
    const data = d.data()
    if (data.documentId) docIds.add(data.documentId as string)
    return { id: d.id, data }
  })

  // 関連ドキュメントをバッチ取得
  const docMap = new Map<string, Record<string, unknown>>()
  const docFetches = Array.from(docIds).map(async (docId) => {
    try {
      const docSnap = await getDoc(doc(db, 'documents', docId))
      if (docSnap.exists()) {
        docMap.set(docId, docSnap.data())
      }
    } catch (e) {
      console.error('Failed to fetch document:', docId, e)
    }
  })
  await Promise.all(docFetches)

  // ErrorLog → ErrorRecord に変換
  let records = errorDocs.map(({ id, data }) => {
    const docData = data.documentId ? docMap.get(data.documentId as string) : undefined
    const totalPages = (docData?.totalPages as number) || 0

    return {
      errorId: id,
      errorDate: data.createdAt as Timestamp,
      errorType: convertToErrorType(
        (data.category as string) || '',
        (data.source as string) || ''
      ),
      fileName: (docData?.fileName as string) || (data.documentId as string) || '不明',
      fileId: (data.fileId as string) || '',
      totalPages,
      successPages: 0,
      failedPages: totalPages,
      failedPageNumbers: [],
      errorDetails: (data.errorMessage as string) || '',
      fileUrl: (docData?.fileUrl as string) || '',
      status: convertToErrorStatus((data.status as string) || ''),
    } as ErrorRecord
  })

  // errorTypeフィルターはメモリフィルタ（category+sourceの組み合わせのため）
  if (filters.errorType) {
    records = records.filter((r) => r.errorType === filters.errorType)
  }

  return records
}

export function useErrors(options: UseErrorsOptions = {}) {
  const { filters = {}, pageSize = 50, enabled = true } = options

  return useQuery({
    queryKey: ['errors', filters, pageSize],
    queryFn: () => fetchErrors(filters, pageSize),
    enabled,
    staleTime: 30000,
  })
}

// ============================================
// エラーステータス更新
// ============================================

interface UpdateErrorStatusParams {
  errorId: string
  status: ErrorStatus
}

async function updateErrorStatus({
  errorId,
  status,
}: UpdateErrorStatusParams): Promise<void> {
  const docRef = doc(db, 'errors', errorId)
  await updateDoc(docRef, { status: convertFromErrorStatusSingle(status) })
}

export function useUpdateErrorStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateErrorStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['errors'] })
      queryClient.invalidateQueries({ queryKey: ['errorStats'] })
    },
  })
}

// ============================================
// 再処理リクエスト
// ============================================

interface ReprocessParams {
  errorId: string
  fileId: string
}

async function requestReprocess({ errorId, fileId }: ReprocessParams): Promise<void> {
  // 1. エラーステータスを「pending」に更新（BE値）
  const errorRef = doc(db, 'errors', errorId)
  await updateDoc(errorRef, { status: 'pending' })

  // 2. 対応するドキュメントのステータスを「pending」に戻す
  const docsQuery = query(
    collection(db, 'documents'),
    where('fileId', '==', fileId),
    limit(1)
  )
  const snapshot = await getDocs(docsQuery)

  const firstDoc = snapshot.docs[0]
  if (firstDoc) {
    const docRef = doc(db, 'documents', firstDoc.id)
    await updateDoc(docRef, { status: 'pending' })
  }
}

export function useReprocessError() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: requestReprocess,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['errors'] })
      queryClient.invalidateQueries({ queryKey: ['errorStats'] })
      queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
    },
  })
}

// ============================================
// エラー統計
// ============================================

export interface ErrorStats {
  total: number
  unhandled: number
  inProgress: number
  completed: number
}

async function fetchErrorStats(): Promise<ErrorStats> {
  // BE status値でクエリ
  const [pendingSnapshot, resolvedSnapshot, ignoredSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'errors'), where('status', '==', 'pending'))),
    getDocs(query(collection(db, 'errors'), where('status', '==', 'resolved'))),
    getDocs(query(collection(db, 'errors'), where('status', '==', 'ignored'))),
  ])

  const unhandled = pendingSnapshot.size
  const completed = resolvedSnapshot.size + ignoredSnapshot.size

  return {
    total: unhandled + completed,
    unhandled,
    inProgress: 0, // BEに「対応中」ステータスなし
    completed,
  }
}

export function useErrorStats() {
  return useQuery({
    queryKey: ['errorStats'],
    queryFn: fetchErrorStats,
    staleTime: 60000,
  })
}
