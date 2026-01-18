/**
 * エラー履歴管理フック
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
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
// Firestore → ErrorRecord 変換
// ============================================

function firestoreToErrorRecord(id: string, data: Record<string, unknown>): ErrorRecord {
  return {
    errorId: id,
    errorDate: data.errorDate as Timestamp,
    errorType: data.errorType as ErrorType,
    fileName: data.fileName as string,
    fileId: data.fileId as string,
    totalPages: data.totalPages as number,
    successPages: data.successPages as number,
    failedPages: data.failedPages as number,
    failedPageNumbers: data.failedPageNumbers as string[],
    errorDetails: data.errorDetails as string,
    fileUrl: data.fileUrl as string,
    status: data.status as ErrorStatus,
  }
}

// ============================================
// エラー一覧取得
// ============================================

async function fetchErrors(
  filters: ErrorFilters,
  pageSize: number
): Promise<ErrorRecord[]> {
  const constraints: QueryConstraint[] = []

  // ステータスフィルター
  if (filters.status) {
    constraints.push(where('status', '==', filters.status))
  }

  // エラー種別フィルター
  if (filters.errorType) {
    constraints.push(where('errorType', '==', filters.errorType))
  }

  // 日付範囲フィルター
  if (filters.dateFrom) {
    constraints.push(where('errorDate', '>=', Timestamp.fromDate(filters.dateFrom)))
  }
  if (filters.dateTo) {
    constraints.push(where('errorDate', '<=', Timestamp.fromDate(filters.dateTo)))
  }

  // ソート（エラー日時降順）
  constraints.push(orderBy('errorDate', 'desc'))
  constraints.push(limit(pageSize))

  const q = query(collection(db, 'errors'), ...constraints)
  const snapshot = await getDocs(q)

  return snapshot.docs.map((docSnap) =>
    firestoreToErrorRecord(docSnap.id, docSnap.data())
  )
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
  await updateDoc(docRef, { status })
}

export function useUpdateErrorStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateErrorStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['errors'] })
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
  // 1. エラーステータスを「対応中」に更新
  const errorRef = doc(db, 'errors', errorId)
  await updateDoc(errorRef, { status: '対応中' as ErrorStatus })

  // 2. 対応するドキュメントのステータスを「pending」に戻す
  // fileIdで検索してドキュメントを特定
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
      queryClient.invalidateQueries({ queryKey: ['documents'] })
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
  const stats: ErrorStats = {
    total: 0,
    unhandled: 0,
    inProgress: 0,
    completed: 0,
  }

  const statuses: { key: keyof Omit<ErrorStats, 'total'>; value: ErrorStatus }[] = [
    { key: 'unhandled', value: '未対応' },
    { key: 'inProgress', value: '対応中' },
    { key: 'completed', value: '完了' },
  ]

  await Promise.all(
    statuses.map(async ({ key, value }) => {
      const q = query(collection(db, 'errors'), where('status', '==', value))
      const snapshot = await getDocs(q)
      stats[key] = snapshot.size
      stats.total += snapshot.size
    })
  )

  return stats
}

export function useErrorStats() {
  return useQuery({
    queryKey: ['errorStats'],
    queryFn: fetchErrorStats,
    staleTime: 60000,
  })
}
