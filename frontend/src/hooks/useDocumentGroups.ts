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
  sortBy?: 'count' | 'latestAt';
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
  sortBy: 'count' | 'latestAt',
  limitCount: number
): Promise<DocumentGroup[]> {
  const q = query(
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

  // シンプルなクエリ（splitのフィルタリングはクライアントサイドで実施）
  // 複合インデックス: {keyField} + processedAt DESC を使用
  let q = query(
    collection(db, 'documents'),
    where(keyField, '==', groupKey),
    orderBy('processedAt', 'desc'),
    limit(pageSize * 2) // splitを除外する余地を確保
  );

  if (pageParam) {
    q = query(q, startAfter(pageParam));
  }

  const snapshot = await getDocs(q);

  // クライアントサイドでsplitを除外
  const allDocs = snapshot.docs.filter(
    (docSnap) => docSnap.data().status !== 'split'
  );

  const hasMore = allDocs.length > pageSize;
  const docs = allDocs.slice(0, pageSize);

  const documents: Document[] = docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as Document));

  return {
    documents,
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
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
