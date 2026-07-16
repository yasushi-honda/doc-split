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
  writeBatch,
  type WriteBatch,
  deleteField,
  Timestamp,
  QueryConstraint,
  startAfter,
  DocumentSnapshot,
  getCountFromServer,
} from 'firebase/firestore'
import { useState } from 'react'
import { toast } from 'sonner'
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
  careManager?: string
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
    // Phase E (Issue #547) 以降、新規docの本体にはocrResultが書き込まれずundefinedになる
    // (shared/types.ts Document.ocrResult は optional)。無条件キャストは実態と乖離するため
    // typeof guardで安全に変換する。
    ocrResult: typeof data.ocrResult === 'string' ? data.ocrResult : undefined,
    ocrResultUrl: data.ocrResultUrl as string | undefined,
    // 一覧表示用軽量抜粋 (ADR-0018 Phase B、Issue #547)
    ocrExcerpt: data.ocrExcerpt as string | undefined,
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
    // 書類種別確定フィールド（Issue #526）
    documentTypeConfirmed: data.documentTypeConfirmed as boolean | undefined,
    // 複数顧客FAX複製機能 (GOAL.md D4): 元doc・全コピーに同一値を付与
    distributionId: data.distributionId as string | undefined,
  }
}

/**
 * distributionId兄弟doc(元doc+全コピー)の件数を取得するフック
 * (GOAL.md task 6-3, PR-C)。詳細画面の「同一FAXをN名に配信・要整理」表示用。
 * 件数のみ必要なため getCountFromServer の集計クエリを使い、ドキュメント本体の
 * ダウンロードコストを避ける。
 */
export function useDistributionSiblingCount(distributionId: string | undefined) {
  return useQuery({
    queryKey: ['distributionSiblingCount', distributionId],
    queryFn: async () => {
      const q = query(collection(db, 'documents'), where('distributionId', '==', distributionId))
      const snapshot = await getCountFromServer(q)
      return snapshot.data().count
    },
    enabled: !!distributionId,
    staleTime: 30 * 1000,
  })
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
 * 再処理時にリセットすべき親docの全フィールドを返すファクトリ関数
 * 直接の呼出元は appendReprocessClearToBatch のみ（再処理3経路は
 * ヘルパー経由で間接利用）。deleteField() はファクトリ関数内で毎回生成（安全性）
 *
 * GOAL.md task 6-2 (PR-C): distributionIdを持つdoc(複製元・複製コピー)の
 * customerId/customerName/customerConfirmed/careManagerは「OCRが自動抽出した提案値」
 * ではなく「配信によって確定した顧客の識別子」のため、`preserveDistributionFields`
 * がtrueの場合はこの4フィールドをクリア対象から除外する。customerConfirmedが
 * trueのまま残ることで、BE側(functions/src/ocr/confirmedFieldMerge.ts)の既存
 * confirmed保護マージがそのまま働き、次回OCR完了時にcustomerIdが上書きされるのを防ぐ
 * (Codexセカンドオピニオンで指摘済みのギャップへの対応)。
 */
export function getReprocessClearFields(preserveDistributionFields: boolean = false) {
  const df = deleteField()
  return {
    // OCR結果
    ocrResult: df,
    ocrResultUrl: df,
    // 一覧表示用軽量抜粋 (ADR-0018 Phase B、Issue #547)
    ocrExcerpt: df,
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
    // 分割 PDF provenance (#445 ADR-0016): 再処理時に古い snapshot を残すと
    // derivedObjectPath と実 Storage state が不整合になるため必ずクリアする
    provenance: df,
    // メタ情報
    ...(preserveDistributionFields ? {} : { customerName: df, customerId: df }),
    officeName: df,
    officeId: df,
    documentType: df,
    fileDate: df,
    fileDateFormatted: df,
    ...(preserveDistributionFields ? {} : { careManager: df }),
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
    ...(preserveDistributionFields ? {} : { customerConfirmed: false }),
    confirmedBy: null,
    confirmedAt: null,
    officeConfirmed: false,
    officeConfirmedBy: null,
    officeConfirmedAt: null,
    documentTypeConfirmed: false,
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
    // 429 系 error 自動 rescue 状態 (2026-06-12 vertex 429 resilience):
    // 手動 reprocess 時もクリアして「自動 rescue 諦め (MAX_ERROR_RESCUE_COUNT 到達)」を
    // user 操作で解除可能にする。残存すると次回 429 で即「対象外」判定されてしまう。
    errorRescueCount: df,
    lastRescuedAt: df,
  }
}

/**
 * 再処理時に detail/main サブコレクションからクリアすべきフィールドを返すファクトリ関数
 * (ADR-0018 Phase D PR4b、Issue #547)。親docと同じく3経路(useReprocessDocument /
 * useErrors / DocumentsPage)で共通利用し、親クリアと同一 writeBatch に含めて
 * 原子的にコミットする(片側だけクリアされた doc を作らない)。
 *
 * firestore.rules は detail/main の update を「フィールド削除または無変更」のみ許可
 * している(値の上書きは Functions 専有)ため、deleteField() のみで構成する。
 * `ocrResult: ''` のような値の設定は permission-denied で batch 全体が失敗する。
 *
 * detail/main が不在の doc への挙動は appendReprocessClearToBatch の存在ガード参照
 * (不在時は skip)。不在 detail の充填自体は backfill 再実行(冪等)で行う。
 */
export function getReprocessDetailClearFields() {
  const df = deleteField()
  return {
    ocrResult: df,
    pageResults: df,
  }
}

/**
 * 再処理クリア一式（親doc + detail/main）を writeBatch に積む共通ヘルパー
 * (ADR-0018 Phase D PR4b、Issue #547)。3経路(useReprocessDocument / useErrors /
 * DocumentsPage)はすべて本ヘルパー経由でクリアする — 経路ごとの手書き重複だと
 * detail クリア漏れ(= stale detail 再発)を経路追加時に作り込みやすいため、
 * ペア不変条件をこの1点に集約する。
 *
 * detail/main は存在確認してから update に積む: 不在 doc への update() は
 * not-found で batch 全体を落とす(Firestore 仕様)。rules が create を禁止している
 * ため set() での upsert 回避も不可 — よって存在確認 → 条件付き update が必須。
 * 不在 = クリアすべきコンテンツが最初から無い(望む終端状態が既に成立)ので、
 * skip が意味的にも正しい。
 * 確認と commit の間に detail が作成されるレース(並行OCR完了)はあり得るが、その場合も
 * 親クリアで status:'pending' になった doc を次の OCR パイプラインが dual-write で
 * 上書きするため自己修復する。
 *
 * distributionId (GOAL.md task 6-2, PR-C) の有無を判定するため親docを事前読込する。
 * detail存在確認と同様に、読込と commit の間のレース(並行OCR完了によるdistributionId
 * 付与)は次のOCRパイプラインが再度dual-writeで上書きするため自己修復する。
 * 戻り値のhasDistributionIdは呼出元の楽観的更新(customerName等をブランクにしない)に使う。
 */
export async function appendReprocessClearToBatch(
  batch: WriteBatch,
  documentId: string
): Promise<boolean> {
  const docRef = doc(db, 'documents', documentId)
  const docSnap = await getDoc(docRef)
  const distributionId = docSnap.data()?.distributionId
  const hasDistributionId = typeof distributionId === 'string' && distributionId.length > 0
  batch.update(docRef, {
    status: 'pending',
    ...getReprocessClearFields(hasDistributionId),
  })
  const detailRef = doc(db, 'documents', documentId, 'detail', 'main')
  const detailSnap = await getDoc(detailRef)
  if (detailSnap.exists()) {
    batch.update(detailRef, getReprocessDetailClearFields())
  }
  return hasDistributionId
}

// ============================================
// 個別再処理フック (#524)
// ============================================

/**
 * 書類 1 件を再処理 (status: pending + メタ全クリア) するフック。
 * DocumentDetailModal とグループビュー行の「再試行」で共通利用。
 *
 * 一覧・グループビューの両キャッシュを invalidate する
 * (メタクリアで customerKey/careManagerKey が空になり、再処理中は
 * グループ集計から外れるため、グループ側の再取得が必須)。
 */
export function useReprocessDocument() {
  const queryClient = useQueryClient()
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)

  const reprocess = async (documentId: string): Promise<boolean> => {
    if (!documentId || reprocessingId) return false
    setReprocessingId(documentId)
    try {
      // ADR-0018 Phase D PR4b (Issue #547): 親docクリアと detail/main クリアを
      // 単一batchで原子的にコミット(他2箇所 useErrors/DocumentsPage と同一ヘルパー)
      const batch = writeBatch(db)
      const hasDistributionId = await appendReprocessClearToBatch(batch, documentId)
      await batch.commit()
      // 楽観的更新（即時UI反映）。distributionId保持docはcustomerName/customerConfirmedを
      // 実際にはクリアしない(GOAL.md task 6-2)ため、楽観的更新でも空表示にしない。
      updateDocumentInListCache(queryClient, documentId, {
        status: 'pending',
        ocrResult: '',
        officeName: '',
        documentType: '',
        officeConfirmed: false,
        verified: false,
        ...(hasDistributionId ? {} : { customerName: '', customerConfirmed: false }),
      })
      queryClient.invalidateQueries({ queryKey: ['document', documentId] })
      // detail/main もクリア対象 (appendReprocessClearToBatch) のため、キャッシュ済み
      // detailの古いOCR内容がポーリング再開(3秒後)まで表示され続けるのを防ぐ
      queryClient.invalidateQueries({ queryKey: ['documentDetail', documentId] })
      queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
      queryClient.invalidateQueries({ queryKey: ['groupDocuments'] })
      queryClient.invalidateQueries({ queryKey: ['documentGroups'] })
      toast.success('再処理をリクエストしました。処理完了まで画面が自動更新されます。', { duration: 5000 })
      return true
    } catch (err) {
      console.error('Failed to reprocess:', err)
      toast.error('再処理リクエストに失敗しました')
      return false
    } finally {
      setReprocessingId(null)
    }
  }

  return { reprocess, reprocessingId }
}

// ============================================
// 書類一覧取得
// ============================================

/**
 * ファイル名/顧客名/書類種別のクライアントサイド検索（一覧取得後の後処理）
 *
 * ADR-0018 Phase D (Issue #547): `doc.ocrResult` 条件は除外する。一覧クエリは
 * `ocrResult`/`pageResults` を含まない軽量化がPhase Dの趣旨であり、Phase E完了後は
 * 本体から `ocrResult` フィールド自体が削除されるため `.toLowerCase()` が undefined
 * 呼出で例外を投げる。OCR全文検索という機能自体の要否は本ADRのスコープ外
 * (decision-maker確認事項、ADR-0018 書込・読込箇所表 #12参照)。
 */
export function applySearchTextFilter(documents: Document[], searchText: string | undefined): Document[] {
  if (!searchText) return documents
  const searchLower = searchText.toLowerCase()
  return documents.filter(
    (doc) =>
      doc.fileName.toLowerCase().includes(searchLower) ||
      doc.customerName.toLowerCase().includes(searchLower) ||
      doc.documentType.toLowerCase().includes(searchLower)
  )
}

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

  // ケアマネジャーフィルター
  if (filters.careManager) {
    constraints.push(where('careManager', '==', filters.careManager))
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

  return {
    documents: applySearchTextFilter(documents, filters.searchText),
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
// 書類詳細(detail/main)取得 — オンデマンド (ADR-0018 Phase D PR-D3、Issue #547)
// ============================================

export interface DocumentDetailFields {
  ocrResult?: string
  pageResults?: Document['pageResults']
}

async function fetchDocumentDetail(documentId: string): Promise<DocumentDetailFields> {
  const detailSnap = await getDoc(doc(db, 'documents', documentId, 'detail', 'main'))
  if (!detailSnap.exists()) return {}
  const data = detailSnap.data()
  return {
    ocrResult: data.ocrResult as string | undefined,
    pageResults: data.pageResults as Document['pageResults'],
  }
}

/**
 * detail優先 + 親フォールバックで dual-read を解決する (ADR-0018 Phase D)。
 * Functions側 `resolveDetailFields` (functions/src/ocr/documentDetail.ts) のFE版
 * ペア不変条件: 両実装は同一のフィールド単位フォールバック規則を維持する。
 *
 * フィールド単位で判定し型が合う値のみ採用する(FE reprocess-clear (PR-D1 #598) は
 * detailのocrResult/pageResultsのみdeleteFieldで消すため、「detail doc は存在するが
 * フィールド不在」の形がある)。detailの ocrResult=''/pageResults=[] は有効値として
 * そのまま返す(親へフォールバックしない — offload doc の真値は ''+ocrResultUrl)。
 */
export function resolveDetailFields(
  detail: DocumentDetailFields | undefined,
  parent: Pick<Document, 'ocrResult' | 'pageResults'> | undefined | null
): DocumentDetailFields {
  const resolved: DocumentDetailFields = {}
  if (typeof detail?.ocrResult === 'string') {
    resolved.ocrResult = detail.ocrResult
  } else if (typeof parent?.ocrResult === 'string') {
    resolved.ocrResult = parent.ocrResult
  }
  if (Array.isArray(detail?.pageResults)) {
    resolved.pageResults = detail.pageResults
  } else if (Array.isArray(parent?.pageResults)) {
    resolved.pageResults = parent.pageResults
  }
  return resolved
}

/**
 * documents/{id}/detail/main のオンデマンド取得。一覧・処理履歴では呼ばない
 * (egress削減がPhase Dの趣旨) — DocumentDetailModal/PdfSplitModal が開いている
 * 間のみ `enabled` で取得する。`status` はOCR処理中(pending/processing)の間
 * useDocument と同じ3秒間隔でポーリングするために親から渡す。
 */
export function useDocumentDetail(
  documentId: string | null,
  options: { enabled: boolean; status?: DocumentStatus }
) {
  return useQuery({
    queryKey: ['documentDetail', documentId],
    queryFn: () => fetchDocumentDetail(documentId as string),
    enabled: options.enabled && !!documentId,
    staleTime: 30000,
    refetchInterval: () =>
      options.status === 'pending' || options.status === 'processing' ? 3000 : false,
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
