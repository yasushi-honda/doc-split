/**
 * エイリアス学習履歴取得フック
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { AliasLearningLog, AliasLearningMasterType } from '@shared/types';

const COLLECTION_NAME = 'aliasLearningLogs';
const PAGE_SIZE = 10;

interface UseAliasLearningHistoryOptions {
  filterType?: AliasLearningMasterType | 'all';
  pageSize?: number;
}

interface AliasLearningHistoryResult {
  logs: AliasLearningLog[];
  hasMore: boolean;
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
}

/**
 * 学習履歴を取得
 */
async function fetchAliasLearningHistory(
  filterType: AliasLearningMasterType | 'all',
  pageSize: number,
  lastDoc?: QueryDocumentSnapshot<DocumentData> | null
): Promise<AliasLearningHistoryResult> {
  const logsRef = collection(db, COLLECTION_NAME);

  let q = query(
    logsRef,
    orderBy('learnedAt', 'desc'),
    limit(pageSize + 1) // +1 で次のページがあるか確認
  );

  if (lastDoc) {
    q = query(
      logsRef,
      orderBy('learnedAt', 'desc'),
      startAfter(lastDoc),
      limit(pageSize + 1)
    );
  }

  const snapshot = await getDocs(q);

  let logs: AliasLearningLog[] = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as AliasLearningLog[];

  // フィルタリング（クライアント側）
  if (filterType !== 'all') {
    logs = logs.filter((log) => log.masterType === filterType);
  }

  // 次のページがあるかどうか
  const hasMore = logs.length > pageSize;
  if (hasMore) {
    logs = logs.slice(0, pageSize);
  }

  const lastVisible = snapshot.docs.length > 0
    ? snapshot.docs[Math.min(snapshot.docs.length - 1, pageSize - 1)] ?? null
    : null;

  return { logs, hasMore, lastDoc: lastVisible };
}

/**
 * エイリアス学習履歴を取得するフック
 */
export function useAliasLearningHistory(options: UseAliasLearningHistoryOptions = {}) {
  const { filterType = 'all', pageSize = PAGE_SIZE } = options;

  return useQuery({
    queryKey: ['aliasLearningHistory', filterType, pageSize],
    queryFn: () => fetchAliasLearningHistory(filterType, pageSize),
    staleTime: 30000, // 30秒
  });
}

/**
 * 履歴のキャッシュを無効化
 */
export function useInvalidateAliasLearningHistory() {
  const queryClient = useQueryClient();

  return {
    invalidate: () => {
      queryClient.invalidateQueries({ queryKey: ['aliasLearningHistory'] });
    },
  };
}
