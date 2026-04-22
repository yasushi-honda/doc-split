/**
 * Firestore書類データ連携フック
 * TanStack Queryを使用したリアクティブなデータ取得
 */

import { useQuery, useInfiniteQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
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
  deleteField,
  Timestamp,
  QueryConstraint,
  startAfter,
  DocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Document, DocumentStatus, DocumentMaster, CustomerMaster, OfficeMaster, SummaryField } from '@shared/types'

// ============================================
// Summary 後方互換読込 (Issue #215)
// ============================================

/**
 * 旧フラット形式 (summary:string + summaryTruncated + summaryOriginalLength) の既存
 * Firestore ドキュメントを新 discriminated union 型 SummaryField に変換する。
 *
 * 新形式: data.summary = { text, truncated, originalLength? }
 * 旧形式: data.summary = string, data.summaryTruncated = boolean, data.summaryOriginalLength = number
 *
 * 書込経路は常に新形式で保存するため、再処理されたドキュメントから順に自然にクリーン化される。
 * ただし **未再処理のドキュメントは旧フラット形式のまま残留** するため、後方互換読込は
 * 旧形式が実運用から消えるまで (最低 1-2 リリース) 維持が必要。
 * 旧フィールドは再処理時に FieldValue.delete() で明示削除される (ocrProcessor / regenerateSummary)。
 *
 * ## 旧データ不整合 (illegal state) への防御仕様
 *
 * 本来、新型 SummaryField では「truncated=true ⟹ originalLength 必須」が型レベル保証される。
 * しかし Firestore データには下記 3 通りの不整合が残存しうる:
 *
 * 1. 新形式で truncated=true だが originalLength 欠落 → undefined (summary 欠落扱い)
 * 2. 旧形式で summaryTruncated=true だが summaryOriginalLength 欠落
 *    → { text, truncated:false } にフォールバック (要約テキスト自体は保持)
 * 3. 新形式で text 欠落 / 型違い → undefined
 *
 * ケース 2 のみフォールバック挙動とする根拠: 旧形式は「3 フィールドの書込漏れ」が #178 教訓の
 * 元になった実害。要約本文を表示する方が無表示より実害が小さく、切り詰めメタは失われても
 * 要約本文は保持すべき、という仕様判断。ケース 1/3 の新形式は書込経路で型保証されるため到達不能
 * (防衛的コード)。
 */
export function normalizeSummary(data: Record<string, unknown>): SummaryField | undefined {
  const summary = data.summary

  // 新形式: オブジェクト
  if (summary && typeof summary === 'object' && 'text' in summary && 'truncated' in summary) {
    const obj = summary as { text: unknown; truncated: unknown; originalLength?: unknown }
    if (typeof obj.text === 'string' && typeof obj.truncated === 'boolean') {
      if (obj.truncated && typeof obj.originalLength === 'number') {
        return { text: obj.text, truncated: true, originalLength: obj.originalLength }
      }
      if (!obj.truncated) {
        return { text: obj.text, truncated: false }
      }
    }
    // illegal state: 新形式だが型違反 (手動編集 / 未来のスキーマドリフト等で到達可能)
    console.warn('[normalizeSummary] illegal state: new-format summary with invalid types', {
      truncated: obj.truncated,
      originalLengthType: typeof obj.originalLength,
    })
    return undefined
  }

  // 旧形式: string + サイドカー
  if (typeof summary === 'string') {
    const truncated = data.summaryTruncated === true
    const originalLength = data.summaryOriginalLength
    if (truncated && typeof originalLength === 'number') {
      return { text: summary, truncated: true, originalLength }
    }
    // 旧形式で truncated=true だが originalLength 欠落: 切り詰めバナーが表示できなくなる
    // (#209 切り詰め検出要件に対する silent degradation)。要約本文は保持して表示する。
    if (truncated) {
      console.warn(
        '[normalizeSummary] legacy-format summary with truncated=true but missing originalLength; truncation badge will not be shown'
      )
    }
    return { text: summary, truncated: false }
  }

  return undefined
}

// ============================================
// 型定義
// ============================================

// ソート可能なフィールド
export type SortField = 'fileName' | 'customerName' | 'officeName' | 'processedAt' | 'fileDate' | 'status'
export type SortOrder = 'asc' | 'desc'

export interface DocumentFilters {
  status?: DocumentStatus
  customerName?: string
  documentType?: string
  dateFrom?: Date
  dateTo?: Date
  dateField?: 'fileDate' | 'processedAt'
  searchText?: string
  // ソート設定
  sortField?: SortField
  sortOrder?: SortOrder
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
    displayFileName: data.displayFileName as string | undefined,
    mimeType: data.mimeType as string,
    ocrResult: data.ocrResult as string,
    ocrResultUrl: data.ocrResultUrl as string | undefined,
    // Issue #209/#215: 切り詰めメタ込みの discriminated union (旧フラット形式も互換読込)
    summary: normalizeSummary(data),
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
    confirmedBy: data.confirmedBy as string | null | undefined,
    confirmedAt: data.confirmedAt as Timestamp | null | undefined,
    // 事業所確定フィールド（Phase 8 同名対応）
    officeId: data.officeId as string | null | undefined,
    officeConfirmed: data.officeConfirmed as boolean | undefined,
    officeCandidates: data.officeCandidates as Document['officeCandidates'],
    officeConfirmedBy: data.officeConfirmedBy as string | null | undefined,
    officeConfirmedAt: data.officeConfirmedAt as Timestamp | null | undefined,
    // ソースタイプ（gmail/upload）
    sourceType: data.sourceType as Document['sourceType'],
    messageId: data.messageId as string | undefined,
    // 分割元フラグ・分割先
    isSplitSource: data.isSplitSource as boolean | undefined,
    splitInto: data.splitInto as string[] | undefined,
    // エイリアス学習用キーフィールド
    customerKey: data.customerKey as string | undefined,
    officeKey: data.officeKey as string | undefined,
    documentTypeKey: data.documentTypeKey as string | undefined,
    careManagerKey: data.careManagerKey as string | undefined,
    // OCR抽出スナップショット
    ocrExtraction: data.ocrExtraction as Document['ocrExtraction'],
    // 抽出スコア・詳細
    extractionScores: data.extractionScores as Document['extractionScores'],
    extractionDetails: data.extractionDetails as Document['extractionDetails'],
    // OCR結果確認ステータス
    verified: data.verified as boolean | undefined,
    verifiedBy: data.verifiedBy as string | null | undefined,
    verifiedAt: data.verifiedAt as Timestamp | null | undefined,
    // 後方互換: 顧客確定状態のレガシー表現。customerConfirmed と併読される。
    needsManualCustomerSelection: data.needsManualCustomerSelection as boolean | undefined,
  }
}

// ============================================
// キャッシュ楽観的更新ユーティリティ
// ============================================

/**
 * ドキュメントの詳細キャッシュと一覧キャッシュを同時に楽観的更新する
 * useDocumentVerification, useDocumentEdit で共通利用（DRY）
 */
export function updateDocumentInListCache(
  queryClient: QueryClient,
  documentId: string,
  updates: Partial<Document>
) {
  // 個別ドキュメントのキャッシュを更新
  queryClient.setQueryData(['document', documentId], (old: Document | undefined) => {
    if (!old) return old
    return { ...old, ...updates }
  })

  // 一覧のキャッシュも更新（無限スクロール）
  queryClient.setQueriesData<{ pages: { documents: Document[] }[] }>(
    { queryKey: ['documentsInfinite'] },
    (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map(page => ({
          ...page,
          documents: page.documents.map(doc =>
            doc.id === documentId ? { ...doc, ...updates } : doc
          ),
        })),
      }
    }
  )
}

// ============================================
// 再処理時クリアフィールド
// ============================================

/**
 * 再処理時にリセットすべき全フィールドを返すファクトリ関数
 * DocumentDetailModal, DocumentsPage, useErrors の3箇所で共通利用（DRY）
 * deleteField() はファクトリ関数内で毎回生成（安全性）
 */
export function getReprocessClearFields() {
  const df = deleteField()
  return {
    // OCR結果
    ocrResult: df,
    ocrResultUrl: df,
    // Issue #215: summary は discriminated union ネスト型に統一。旧フラット3フィールド
    // (summaryTruncated / summaryOriginalLength) は後方互換のため同時に delete し、
    // 既存 Firestore ドキュメントに残存する旧フィールドも再処理時にクリーン化する。
    summary: df,
    summaryTruncated: df,
    summaryOriginalLength: df,
    ocrExtraction: df,
    pageResults: df,
    // 表示用ファイル名（#178 displayFileName自動生成）
    displayFileName: df,
    // メタ情報
    customerName: df,
    customerId: df,
    officeName: df,
    officeId: df,
    documentType: df,
    fileDate: df,
    fileDateFormatted: df,
    careManager: df,
    category: df,
    // 候補・スコア
    customerCandidates: df,
    officeCandidates: df,
    extractionScores: df,
    extractionDetails: df,
    // フラグ
    isDuplicateCustomer: df,
    needsManualCustomerSelection: df,
    allCustomerCandidates: df,
    suggestedNewOffice: df,
    // 確認ステータス
    customerConfirmed: false,
    confirmedBy: null,
    confirmedAt: null,
    officeConfirmed: false,
    officeConfirmedBy: null,
    officeConfirmedAt: null,
    // OCR確認ステータス
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    // エラー
    error: df,
    lastErrorMessage: df,
    lastErrorId: df,
    // リトライ状態 (#360 code-reviewer I3): PR #359 で rescue が error/pending 両経路で
    // retryCount/retryAfter を扱うようになったため、手動再処理 (FE reprocess) でも
    // 古い値を残さずクリアする。#178 教訓 (派生フィールド drift 防止) の延長。
    retryCount: df,
    retryAfter: df,
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

  // 日付範囲フィルター（dateFieldで対象フィールドを切替）
  const dateField = filters.dateField || 'fileDate'
  if (filters.dateFrom) {
    constraints.push(where(dateField, '>=', Timestamp.fromDate(filters.dateFrom)))
  }
  if (filters.dateTo) {
    constraints.push(where(dateField, '<=', Timestamp.fromDate(filters.dateTo)))
  }

  // ソート（デフォルト: 処理日時降順）
  const sortField = filters.sortField || 'processedAt'
  const sortOrder = filters.sortOrder || 'desc'
  constraints.push(orderBy(sortField, sortOrder))

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

/**
 * 無限スクロール対応版の書類一覧取得
 */
export function useInfiniteDocuments(options: UseDocumentsOptions = {}) {
  const { filters = {}, pageSize = 100, enabled = true } = options

  return useInfiniteQuery({
    queryKey: ['documentsInfinite', filters, pageSize],
    queryFn: ({ pageParam }) => fetchDocuments(filters, pageSize, pageParam as DocumentSnapshot | undefined),
    initialPageParam: undefined as DocumentSnapshot | undefined,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.lastDoc : undefined,
    enabled,
    staleTime: 30000,
    refetchInterval: 30000,
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
    refetchInterval: (query) => {
      const doc = query.state.data as Document | null
      if (doc && (doc.status === 'pending' || doc.status === 'processing')) {
        return 3000 // 3秒ごとにポーリング（処理中のみ）
      }
      return false
    },
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
      queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
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
    id: doc.id,
    name: doc.data().name as string,
    // #338: shared 側 optional と整合させる honesty cast (silent-failure-hunter I2/I3 対応)
    dateMarker: doc.data().dateMarker as string | undefined,
    category: doc.data().category as string | undefined,
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
    // #338: shared 側 optional と整合させる honesty cast。fetchCustomers (useMasters.ts) と同パターンに統一。
    isDuplicate: doc.data().isDuplicate as boolean | undefined,
    furigana: doc.data().furigana as string | undefined,
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
    id: doc.id,
    name: doc.data().name as string,
    // #338: shared 側 optional と整合。旧 `?? false` は caller 側で行う方が optional 契約を隠蔽せず明瞭。
    isDuplicate: doc.data().isDuplicate as boolean | undefined,
    shortName: doc.data().shortName as string | undefined,
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
