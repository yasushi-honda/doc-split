/**
 * 処理履歴ビュー用フック（Phase 7）
 *
 * 機能:
 * - 処理済みドキュメントの履歴表示
 * - 期間・ステータス・顧客確定状態フィルター
 * - バッファリング方式ページネーション
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  QueryConstraint,
  Timestamp,
  DocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Document, DocumentStatus, CustomerCandidateInfo } from '@shared/types';

// ============================================
// 定数
// ============================================

const FETCH_SIZE = 50;  // Firestoreから取得する件数
const PAGE_SIZE = 20;   // 画面に表示する件数

// ============================================
// 型定義
// ============================================

export type PeriodFilter = '7days' | '30days' | 'all';
export type StatusFilter = 'all' | DocumentStatus;
export type ConfirmedFilter = 'all' | 'confirmed' | 'unconfirmed';

export interface ProcessingHistoryFilters {
  period: PeriodFilter;
  status: StatusFilter;
  confirmed: ConfirmedFilter;
}

export interface ProcessingHistoryResult {
  documents: Document[];
  hasMore: boolean;
  isLoading: boolean;
  isFetchingMore: boolean;
  error: Error | null;
  fetchNextPage: () => Promise<void>;
  refetch: () => void;
}

// ============================================
// ユーティリティ関数
// ============================================

/**
 * 顧客確定状態を判定（デュアルリード対応）
 * PRD: customerConfirmed の undefined 挙動と needsManualCustomerSelection マッピング
 */
export function isCustomerConfirmed(doc: Document): boolean {
  // 1. customerConfirmed が明示的に設定されている場合（Phase 7以降のデータ）
  if (doc.customerConfirmed !== undefined) {
    return doc.customerConfirmed;
  }

  // 2. needsManualCustomerSelection が設定されている場合（現行データ）
  if (doc.needsManualCustomerSelection !== undefined) {
    return !doc.needsManualCustomerSelection;  // 反転: 要確認→未確定
  }

  // 3. どちらも undefined（Phase 6以前のデータ）
  return true;  // 確定済みとして扱う
}

/**
 * OCR抜粋を取得（ocrResultUrl対応）
 * PRD: ocrResultUrl 対応（大容量OCR結果）
 */
export function getOcrExcerpt(doc: Document): string {
  if (doc.ocrResultUrl && !doc.ocrResult) {
    return '（OCR結果はCloud Storageに保存されています）';
  }
  return doc.ocrResult?.slice(0, 200) || '';
}

/**
 * 顧客候補を正規化（旧スキーマ互換）
 * PRD: customerCandidates スキーマ互換性
 */
export function normalizeCandidate(raw: Record<string, unknown>): CustomerCandidateInfo {
  return {
    customerId: (raw.customerId as string) ?? (raw.id as string) ?? '',
    customerName: (raw.customerName as string) ?? (raw.name as string) ?? '',
    isDuplicate: (raw.isDuplicate as boolean) ?? false,
    score: (raw.score as number) ?? 0,
    matchType: (raw.matchType as 'exact' | 'partial' | 'fuzzy') ?? 'fuzzy',
  };
}

/**
 * Firestore → Document 変換
 */
function firestoreToDocument(id: string, data: Record<string, unknown>): Document {
  return {
    id,
    processedAt: data.processedAt as Timestamp,
    fileId: data.fileId as string,
    fileName: data.fileName as string,
    mimeType: data.mimeType as string,
    ocrResult: data.ocrResult as string,
    ocrResultUrl: data.ocrResultUrl as string | undefined,
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
    // Phase 7 fields
    customerId: data.customerId as string | null | undefined,
    customerCandidates: data.customerCandidates as CustomerCandidateInfo[] | undefined,
    customerConfirmed: data.customerConfirmed as boolean | undefined,
    confirmedBy: data.confirmedBy as string | null | undefined,
    confirmedAt: data.confirmedAt as Timestamp | null | undefined,
    needsManualCustomerSelection: data.needsManualCustomerSelection as boolean | undefined,
  };
}

/**
 * 期間フィルターから日付を計算
 */
function getPeriodDate(period: PeriodFilter): Date | null {
  if (period === 'all') return null;

  const date = new Date();
  if (period === '7days') {
    date.setDate(date.getDate() - 7);
  } else if (period === '30days') {
    date.setDate(date.getDate() - 30);
  }
  return date;
}

/**
 * 顧客確定フィルターを適用（クライアント側）
 */
function applyConfirmedFilter(docs: Document[], filter: ConfirmedFilter): Document[] {
  if (filter === 'all') return docs;
  return docs.filter(doc => {
    const confirmed = isCustomerConfirmed(doc);
    return filter === 'confirmed' ? confirmed : !confirmed;
  });
}

// ============================================
// メインフック
// ============================================

export function useProcessingHistory(filters: ProcessingHistoryFilters): ProcessingHistoryResult {
  const queryClient = useQueryClient();

  // 内部状態
  const [displayedDocs, setDisplayedDocs] = useState<Document[]>([]);
  const [buffer, setBuffer] = useState<Document[]>([]);
  const [lastFirestoreDoc, setLastFirestoreDoc] = useState<DocumentSnapshot | null>(null);
  const [noMoreFirestoreDocs, setNoMoreFirestoreDocs] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  // 初期データ取得
  const fetchInitialData = useCallback(async () => {
    const constraints: QueryConstraint[] = [
      orderBy('processedAt', 'desc'),
    ];

    // 期間フィルター
    const periodDate = getPeriodDate(filters.period);
    if (periodDate) {
      constraints.push(where('processedAt', '>=', Timestamp.fromDate(periodDate)));
    }

    // ステータスフィルター（Firestoreクエリ）
    if (filters.status !== 'all') {
      constraints.push(where('status', '==', filters.status));
    }

    constraints.push(limit(FETCH_SIZE));

    const q = query(collection(db, 'documents'), ...constraints);
    const snapshot = await getDocs(q);

    const docs: Document[] = snapshot.docs.map(docSnap =>
      firestoreToDocument(docSnap.id, docSnap.data())
    );

    // Firestore カーソル更新
    const lastDoc = snapshot.docs.length > 0
      ? snapshot.docs[snapshot.docs.length - 1]
      : null;
    setLastFirestoreDoc(lastDoc);
    setNoMoreFirestoreDocs(snapshot.docs.length < FETCH_SIZE);

    // クライアント側フィルター適用
    const filteredDocs = applyConfirmedFilter(docs, filters.confirmed);

    // 表示用とバッファに分割
    const displayDocs = filteredDocs.slice(0, PAGE_SIZE);
    const remainingDocs = filteredDocs.slice(PAGE_SIZE);

    setDisplayedDocs(displayDocs);
    setBuffer(remainingDocs);

    return displayDocs;
  }, [filters.period, filters.status, filters.confirmed]);

  // React Query
  const { isLoading, error } = useQuery({
    queryKey: ['processingHistory', filters],
    queryFn: fetchInitialData,
    staleTime: 30000,
  });

  // 次ページ取得
  const fetchNextPage = useCallback(async () => {
    if (isFetchingMore) return;

    // 1. バッファが PAGE_SIZE 以上あれば、バッファから返す
    if (buffer.length >= PAGE_SIZE) {
      const nextDocs = buffer.slice(0, PAGE_SIZE);
      setDisplayedDocs(prev => [...prev, ...nextDocs]);
      setBuffer(buffer.slice(PAGE_SIZE));
      return;
    }

    // 2. バッファが足りない場合、Firestoreから追加取得
    if (noMoreFirestoreDocs) {
      // 残りのバッファを全て表示
      if (buffer.length > 0) {
        setDisplayedDocs(prev => [...prev, ...buffer]);
        setBuffer([]);
      }
      return;
    }

    setIsFetchingMore(true);
    try {
      const currentBuffer = [...buffer];
      let currentLastDoc = lastFirestoreDoc;
      let noMore = noMoreFirestoreDocs;

      // バッファがPAGE_SIZE未満の間、追加フェッチ
      while (currentBuffer.length < PAGE_SIZE && !noMore) {
        const constraints: QueryConstraint[] = [
          orderBy('processedAt', 'desc'),
        ];

        const periodDate = getPeriodDate(filters.period);
        if (periodDate) {
          constraints.push(where('processedAt', '>=', Timestamp.fromDate(periodDate)));
        }

        if (filters.status !== 'all') {
          constraints.push(where('status', '==', filters.status));
        }

        if (currentLastDoc) {
          constraints.push(startAfter(currentLastDoc));
        }
        constraints.push(limit(FETCH_SIZE));

        const q = query(collection(db, 'documents'), ...constraints);
        const snapshot = await getDocs(q);

        if (snapshot.docs.length < FETCH_SIZE) {
          noMore = true;
        }
        if (snapshot.docs.length > 0) {
          currentLastDoc = snapshot.docs[snapshot.docs.length - 1];
        }

        const fetchedDocs: Document[] = snapshot.docs.map(docSnap =>
          firestoreToDocument(docSnap.id, docSnap.data())
        );

        // クライアント側フィルター適用
        const filteredDocs = applyConfirmedFilter(fetchedDocs, filters.confirmed);
        currentBuffer.push(...filteredDocs);
      }

      // 状態更新
      setLastFirestoreDoc(currentLastDoc);
      setNoMoreFirestoreDocs(noMore);

      // 表示用とバッファに分割
      const nextDocs = currentBuffer.slice(0, PAGE_SIZE);
      const remainingDocs = currentBuffer.slice(PAGE_SIZE);

      setDisplayedDocs(prev => [...prev, ...nextDocs]);
      setBuffer(remainingDocs);
    } finally {
      setIsFetchingMore(false);
    }
  }, [buffer, lastFirestoreDoc, noMoreFirestoreDocs, isFetchingMore, filters]);

  // hasMore 判定
  const hasMore = useMemo(() => {
    return buffer.length > 0 || !noMoreFirestoreDocs;
  }, [buffer.length, noMoreFirestoreDocs]);

  // refetch時に内部状態をリセット
  const handleRefetch = useCallback(() => {
    setDisplayedDocs([]);
    setBuffer([]);
    setLastFirestoreDoc(null);
    setNoMoreFirestoreDocs(false);
    queryClient.invalidateQueries({ queryKey: ['processingHistory'] });
  }, [queryClient]);

  return {
    documents: displayedDocs,
    hasMore,
    isLoading,
    isFetchingMore,
    error: error as Error | null,
    fetchNextPage,
    refetch: handleRefetch,
  };
}

// ============================================
// 日付グルーピングユーティリティ
// ============================================

export interface GroupedDocuments {
  date: string;
  documents: Document[];
}

/**
 * ドキュメントを日付ごとにグループ化
 */
export function groupDocumentsByDate(documents: Document[]): GroupedDocuments[] {
  const grouped = documents.reduce((acc, doc) => {
    const dateKey = doc.processedAt.toDate().toLocaleDateString('ja-JP');
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(doc);
    return acc;
  }, {} as Record<string, Document[]>);

  return Object.entries(grouped).map(([date, docs]) => ({
    date,
    documents: docs,
  }));
}
