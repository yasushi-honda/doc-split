/**
 * Firestore書類データ連携フック
 * TanStack Queryを使用したリアクティブなデータ取得
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
  getDoc,
  updateDoc,
  Timestamp,
  QueryConstraint,
  startAfter,
  DocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Document, DocumentStatus, DocumentMaster, CustomerMaster, OfficeMaster } from '@shared/types'

// ============================================
// 型定義
// ============================================

export interface DocumentFilters {
  status?: DocumentStatus
  customerName?: string
  documentType?: string
  dateFrom?: Date
  dateTo?: Date
  searchText?: string
}

export interface DocumentListResult {
  documents: Document[]
  lastDoc: DocumentSnapshot | null
  hasMore: boolean
}

interface UseDocumentsOptions {
  filters?: DocumentFilters
  pageSize?: number
  enabled?: boolean
}

// ============================================
// Firestore → Document 変換
// ============================================

/** Firestore DocumentData → Document 型変換（テスト用にエクスポート） */
export function firestoreToDocument(id: string, data: Record<string, unknown>): Document {
  return {
    id,
    processedAt: data.processedAt as Timestamp,
    fileId: data.fileId as string,
    fileName: data.fileName as string,
    mimeType: data.mimeType as string,
    ocrResult: data.ocrResult as string,
    ocrResultUrl: data.ocrResultUrl as string | undefined,
    summary: data.summary as string | undefined,
    documentType: data.documentType as string,
    customerName: data.customerName as string,
    officeName: data.officeName as string,
    fileUrl: data.fileUrl as string,
    fileDate: data.fileDate as Timestamp,
    isDuplicateCustomer: data.isDuplicateCustomer as boolean,
    allCustomerCandidates: data.allCustomerCandidates as string | undefined,
    totalPages: data.totalPages as number,
    targetPageNumber: data.targetPageNumber as number,
    status: data.status as DocumentStatus,
    careManager: data.careManager as string | undefined,
    category: data.category as string | undefined,
    pageResults: data.pageResults as Document['pageResults'],
    splitSuggestions: data.splitSuggestions as Document['splitSuggestions'],
    pageRotations: data.pageRotations as Document['pageRotations'],
    parentDocumentId: data.parentDocumentId as string | undefined,
    splitFromPages: data.splitFromPages as Document['splitFromPages'],
    // 顧客確定フィールド（Phase 7）
    customerId: data.customerId as string | null | undefined,
    customerConfirmed: data.customerConfirmed as boolean | undefined,
    customerCandidates: data.customerCandidates as Document['customerCandidates'],
    customerConfirmedBy: data.customerConfirmedBy as string | null | undefined,
    customerConfirmedAt: data.customerConfirmedAt as Timestamp | null | undefined,
    // 事業所確定フィールド（Phase 8 同名対応）
    officeId: data.officeId as string | null | undefined,
    officeConfirmed: data.officeConfirmed as boolean | undefined,
    officeCandidates: data.officeCandidates as Document['officeCandidates'],
    officeConfirmedBy: data.officeConfirmedBy as string | null | undefined,
    officeConfirmedAt: data.officeConfirmedAt as Timestamp | null | undefined,
    // ソースタイプ（gmail/upload）
    sourceType: data.sourceType as Document['sourceType'],
    // エイリアス学習用キーフィールド
    customerKey: data.customerKey as string | undefined,
    officeKey: data.officeKey as string | undefined,
    documentTypeKey: data.documentTypeKey as string | undefined,
    careManagerKey: data.careManagerKey as string | undefined,
    // OCR結果確認ステータス
    verified: data.verified as boolean | undefined,
    verifiedBy: data.verifiedBy as string | null | undefined,
    verifiedAt: data.verifiedAt as Timestamp | null | undefined,
  }
}

// ============================================
// 書類一覧取得
// ============================================

async function fetchDocuments(
  filters: DocumentFilters,
  pageSize: number,
  afterDoc?: DocumentSnapshot
): Promise<DocumentListResult> {
  const constraints: QueryConstraint[] = []

  // ステータスフィルター
  if (filters.status) {
    constraints.push(where('status', '==', filters.status))
  }

  // 顧客名フィルター
  if (filters.customerName) {
    constraints.push(where('customerName', '==', filters.customerName))
  }

  // 書類種別フィルター
  if (filters.documentType) {
    constraints.push(where('documentType', '==', filters.documentType))
  }

  // 日付範囲フィルター
  if (filters.dateFrom) {
    constraints.push(where('fileDate', '>=', Timestamp.fromDate(filters.dateFrom)))
  }
  if (filters.dateTo) {
    constraints.push(where('fileDate', '<=', Timestamp.fromDate(filters.dateTo)))
  }

  // ソート（処理日時降順）
  constraints.push(orderBy('processedAt', 'desc'))

  // ページネーション
  if (afterDoc) {
    constraints.push(startAfter(afterDoc))
  }
  constraints.push(limit(pageSize + 1)) // +1 for hasMore check

  const q = query(collection(db, 'documents'), ...constraints)
  const snapshot = await getDocs(q)

  const documents: Document[] = []
  let lastDoc: DocumentSnapshot | null = null

  snapshot.docs.slice(0, pageSize).forEach((docSnap) => {
    documents.push(firestoreToDocument(docSnap.id, docSnap.data()))
    lastDoc = docSnap
  })

  // テキスト検索（クライアントサイド）
  let filtered = documents
  if (filters.searchText) {
    const searchLower = filters.searchText.toLowerCase()
    filtered = documents.filter(
      (doc) =>
        doc.fileName.toLowerCase().includes(searchLower) ||
        doc.customerName.toLowerCase().includes(searchLower) ||
        doc.documentType.toLowerCase().includes(searchLower) ||
        doc.ocrResult.toLowerCase().includes(searchLower)
    )
  }

  return {
    documents: filtered,
    lastDoc,
    hasMore: snapshot.docs.length > pageSize,
  }
}

export function useDocuments(options: UseDocumentsOptions = {}) {
  const { filters = {}, pageSize = 20, enabled = true } = options

  return useQuery({
    queryKey: ['documents', filters, pageSize],
    queryFn: () => fetchDocuments(filters, pageSize),
    enabled,
    staleTime: 30000, // 30秒間はキャッシュを使用
    refetchInterval: 30000, // 30秒ごとに自動再取得（ステータス更新反映）
  })
}

// ============================================
// 単一書類取得
// ============================================

async function fetchDocument(documentId: string): Promise<Document | null> {
  const docRef = doc(db, 'documents', documentId)
  const docSnap = await getDoc(docRef)

  if (!docSnap.exists()) {
    return null
  }

  return firestoreToDocument(docSnap.id, docSnap.data())
}

export function useDocument(documentId: string | null) {
  return useQuery({
    queryKey: ['document', documentId],
    queryFn: () => (documentId ? fetchDocument(documentId) : null),
    enabled: !!documentId,
  })
}

// ============================================
// 書類更新
// ============================================

interface UpdateDocumentParams {
  documentId: string
  updates: Partial<Omit<Document, 'id'>>
}

async function updateDocument({ documentId, updates }: UpdateDocumentParams): Promise<void> {
  const docRef = doc(db, 'documents', documentId)
  await updateDoc(docRef, updates)
}

export function useUpdateDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateDocument,
    onSuccess: (_, { documentId }) => {
      // 関連キャッシュを無効化
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document', documentId] })
    },
  })
}

// ============================================
// マスターデータ取得
// ============================================

async function fetchDocumentMasters(): Promise<DocumentMaster[]> {
  const snapshot = await getDocs(collection(db, 'masters/documents/items'))
  return snapshot.docs.map((doc) => ({
    name: doc.data().name as string,
    dateMarker: doc.data().dateMarker as string,
    category: doc.data().category as string,
  }))
}

export function useDocumentMasters() {
  return useQuery({
    queryKey: ['masters', 'documents'],
    queryFn: fetchDocumentMasters,
    staleTime: 5 * 60 * 1000, // 5分間キャッシュ
  })
}

async function fetchCustomerMasters(): Promise<CustomerMaster[]> {
  const snapshot = await getDocs(collection(db, 'masters/customers/items'))
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    name: doc.data().name as string,
    isDuplicate: doc.data().isDuplicate as boolean,
    furigana: doc.data().furigana as string,
    careManagerName: doc.data().careManagerName as string | undefined,
  }))
}

export function useCustomerMasters() {
  return useQuery({
    queryKey: ['masters', 'customers'],
    queryFn: fetchCustomerMasters,
    staleTime: 5 * 60 * 1000,
  })
}

async function fetchOfficeMasters(): Promise<OfficeMaster[]> {
  const snapshot = await getDocs(collection(db, 'masters/offices/items'))
  return snapshot.docs.map((doc) => ({
    name: doc.data().name as string,
  }))
}

export function useOfficeMasters() {
  return useQuery({
    queryKey: ['masters', 'offices'],
    queryFn: fetchOfficeMasters,
    staleTime: 5 * 60 * 1000,
  })
}

// ============================================
// 統計情報取得
// ============================================

export interface DocumentStats {
  total: number
  pending: number
  processing: number
  processed: number
  error: number
  split: number
}

async function fetchDocumentStats(): Promise<DocumentStats> {
  const stats: DocumentStats = {
    total: 0,
    pending: 0,
    processing: 0,
    processed: 0,
    error: 0,
    split: 0,
  }

  const statuses: DocumentStatus[] = ['pending', 'processing', 'processed', 'error', 'split']

  await Promise.all(
    statuses.map(async (status) => {
      const q = query(collection(db, 'documents'), where('status', '==', status))
      const snapshot = await getDocs(q)
      stats[status] = snapshot.size
      stats.total += snapshot.size
    })
  )

  return stats
}

export function useDocumentStats() {
  return useQuery({
    queryKey: ['documentStats'],
    queryFn: fetchDocumentStats,
    staleTime: 30000, // 30秒間キャッシュ
    refetchInterval: 30000, // 30秒ごとに自動再取得
  })
}
