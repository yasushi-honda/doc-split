/**
 * ドキュメントグループ取得フック
 *
 * documentGroupsコレクションからグループ一覧を取得
 * グループ内ドキュメントの無限スクロール対応
 */

import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  startAfter,
  DocumentSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CONSTANTS } from '@shared/types';
import type { Document } from '@shared/types';

// ============================================
// 型定義
// ============================================

export type GroupType = 'customer' | 'office' | 'documentType' | 'careManager';

export interface GroupPreviewDoc {
  id: string;
  fileName: string;
  documentType: string;
  processedAt: Timestamp;
}

export interface DocumentGroup {
  id: string;
  groupType: GroupType;
  groupKey: string;
  displayName: string;
  count: number;
  latestAt: Timestamp;
  latestDocs: GroupPreviewDoc[];
  updatedAt: Timestamp;
}

export interface UseDocumentGroupsOptions {
  groupType: GroupType;
  sortBy?: 'count' | 'latestAt' | 'none';
  limitCount?: number;
  enabled?: boolean;
}

export interface UseGroupDocumentsOptions {
  groupType: GroupType;
  groupKey: string;
  pageSize?: number;
  enabled?: boolean;
}

// ============================================
// グループキー取得用のフィールドマッピング
// ============================================

const GROUP_KEY_FIELD: Record<GroupType, string> = {
  customer: 'customerKey',
  office: 'officeKey',
  documentType: 'documentTypeKey',
  careManager: 'careManagerKey',
};

// ============================================
// グループ一覧取得
// ============================================

async function fetchDocumentGroups(
  groupType: GroupType,
  sortBy: 'count' | 'latestAt' | 'none',
  limitCount: number
): Promise<DocumentGroup[]> {
  // 顧客別はクライアントソート（あいうえお順）のため orderBy/limit なしで全件取得
  const q = sortBy === 'none'
    ? query(
        collection(db, 'documentGroups'),
        where('groupType', '==', groupType)
      )
    : query(
        collection(db, 'documentGroups'),
        where('groupType', '==', groupType),
        orderBy(sortBy, 'desc'),
        limit(limitCount)
      );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  } as DocumentGroup));
}

/**
 * ドキュメントグループ一覧を取得するフック
 */
export function useDocumentGroups(options: UseDocumentGroupsOptions) {
  const {
    groupType,
    sortBy = 'count',
    limitCount = 50,
    enabled = true,
  } = options;

  return useQuery({
    queryKey: ['documentGroups', groupType, sortBy, limitCount],
    queryFn: () => fetchDocumentGroups(groupType, sortBy, limitCount),
    enabled,
    staleTime: 60 * 1000, // 1分間キャッシュ
  });
}

// ============================================
// グループ内ドキュメント取得（無限スクロール対応）
// ============================================

interface GroupDocumentsPage {
  documents: Document[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
}

async function fetchGroupDocuments(
  groupType: GroupType,
  groupKey: string,
  pageSize: number,
  pageParam?: DocumentSnapshot
): Promise<GroupDocumentsPage> {
  const keyField = GROUP_KEY_FIELD[groupType];

  // documentGroups側は「CM未設定」等を予約keyで集計しているが、documents側の
  // 実データは正規化キーが空文字のまま（予約keyは書き込まれない）。予約keyで
  // クエリすると書類側と一致せず0件になるため、空文字に変換してからクエリする。
  const isUnassignedCareManagerGroup = groupKey === CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY;
  const firestoreKeyValue = isUnassignedCareManagerGroup ? '' : groupKey;

  // シンプルなクエリ（splitのフィルタリングはクライアントサイドで実施）
  // 複合インデックス: {keyField} + processedAt DESC を使用
  let q = query(
    collection(db, 'documents'),
    where(keyField, '==', firestoreKeyValue),
    orderBy('processedAt', 'desc'),
    limit(pageSize * 2) // splitを除外する余地を確保
  );

  if (pageParam) {
    q = query(q, startAfter(pageParam));
  }

  const snapshot = await getDocs(q);

  // クライアントサイドでsplitを除外。CM未設定グループの場合は、集計側
  // (resolveGroupKeyAndDisplayのcanFallbackToUnassigned)と同じ条件で、
  // customerKeyが未確定（pending/processing/error等でOCR未完了）の書類も除外する。
  // これらはcareManagerKeyも空文字のため素朴なクエリだと一覧に混入するが、
  // 集計上はCM未設定グループのcountに含まれていないため、除外しないと
  // 表示件数がcountと食い違う（Codexレビュー指摘）。
  const allDocs = snapshot.docs.filter((docSnap) => {
    const data = docSnap.data();
    if (data.status === 'split') return false;
    if (isUnassignedCareManagerGroup && !data.customerKey) return false;
    return true;
  });

  const hasMore = allDocs.length > pageSize;
  const docs = allDocs.slice(0, pageSize);

  const documents: Document[] = docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as Document));

  return {
    documents,
    lastDoc: docs.length > 0 ? docs[docs.length - 1] ?? null : null,
    hasMore,
  };
}

/**
 * グループ内ドキュメントを取得するフック（無限スクロール対応）
 */
export function useGroupDocuments(options: UseGroupDocumentsOptions) {
  const {
    groupType,
    groupKey,
    pageSize = 100,
    enabled = true,
  } = options;

  return useInfiniteQuery({
    queryKey: ['groupDocuments', groupType, groupKey, pageSize],
    queryFn: ({ pageParam }) =>
      fetchGroupDocuments(groupType, groupKey, pageSize, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.lastDoc : undefined,
    initialPageParam: undefined as DocumentSnapshot | undefined,
    enabled: enabled && !!groupKey,
    staleTime: 30 * 1000, // 30秒間キャッシュ
  });
}

// ============================================
// グループ統計取得
// ============================================

export interface GroupStats {
  totalGroups: number;
  totalDocuments: number;
}

async function fetchGroupStats(groupType: GroupType): Promise<GroupStats> {
  const q = query(
    collection(db, 'documentGroups'),
    where('groupType', '==', groupType)
  );

  const snapshot = await getDocs(q);

  let totalDocuments = 0;
  snapshot.docs.forEach((doc) => {
    const data = doc.data() as DocumentGroup;
    totalDocuments += data.count;
  });

  return {
    totalGroups: snapshot.size,
    totalDocuments,
  };
}

/**
 * グループ統計を取得するフック
 */
export function useGroupStats(groupType: GroupType, enabled = true) {
  return useQuery({
    queryKey: ['groupStats', groupType],
    queryFn: () => fetchGroupStats(groupType),
    enabled,
    staleTime: 60 * 1000,
  });
}

// ============================================
// キャッシュ無効化ユーティリティ
// ============================================

/**
 * グループ関連のキャッシュを無効化
 */
export function useInvalidateGroups() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ['documentGroups'] });
      queryClient.invalidateQueries({ queryKey: ['groupDocuments'] });
      queryClient.invalidateQueries({ queryKey: ['groupStats'] });
    },
    invalidateGroupType: (groupType: GroupType) => {
      queryClient.invalidateQueries({ queryKey: ['documentGroups', groupType] });
      queryClient.invalidateQueries({ queryKey: ['groupStats', groupType] });
    },
    invalidateGroup: (groupType: GroupType, groupKey: string) => {
      queryClient.invalidateQueries({
        queryKey: ['groupDocuments', groupType, groupKey],
      });
    },
  };
}
