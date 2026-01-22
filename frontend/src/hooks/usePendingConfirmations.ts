/**
 * 確認待ちドキュメント取得フック
 *
 * 顧客未確定・事業所未確定のドキュメントを取得
 * 通知バナーと確認待ちタブで使用
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getCountFromServer,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Document } from '@shared/types';

// ============================================
// 型定義
// ============================================

export interface PendingConfirmationStats {
  customerUnconfirmed: number;
  officeUnconfirmed: number;
  total: number;
}

export interface PendingConfirmationDocument extends Document {
  pendingType: 'customer' | 'office' | 'both';
}

// ============================================
// 件数取得
// ============================================

async function fetchPendingStats(): Promise<PendingConfirmationStats> {
  // 顧客未確定件数
  const customerQuery = query(
    collection(db, 'documents'),
    where('status', '==', 'processed'),
    where('customerConfirmed', '==', false)
  );
  const customerSnapshot = await getCountFromServer(customerQuery);
  const customerUnconfirmed = customerSnapshot.data().count;

  // 事業所未確定件数（将来用 - 現在は0）
  // const officeQuery = query(
  //   collection(db, 'documents'),
  //   where('status', '==', 'processed'),
  //   where('officeConfirmed', '==', false)
  // );
  // const officeSnapshot = await getCountFromServer(officeQuery);
  // const officeUnconfirmed = officeSnapshot.data().count;
  const officeUnconfirmed = 0;

  return {
    customerUnconfirmed,
    officeUnconfirmed,
    total: customerUnconfirmed + officeUnconfirmed,
  };
}

/**
 * 確認待ち件数を取得するフック
 */
export function usePendingConfirmationStats() {
  return useQuery({
    queryKey: ['pendingConfirmationStats'],
    queryFn: fetchPendingStats,
    staleTime: 30 * 1000, // 30秒キャッシュ
    refetchInterval: 60 * 1000, // 1分ごとに自動更新
  });
}

// ============================================
// ドキュメント一覧取得
// ============================================

async function fetchPendingDocuments(
  limitCount: number = 50
): Promise<PendingConfirmationDocument[]> {
  // 顧客未確定ドキュメントを取得
  const q = query(
    collection(db, 'documents'),
    where('status', '==', 'processed'),
    where('customerConfirmed', '==', false),
    orderBy('processedAt', 'desc'),
    limit(limitCount)
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    pendingType: 'customer' as const,
  })) as PendingConfirmationDocument[];
}

/**
 * 確認待ちドキュメント一覧を取得するフック
 */
export function usePendingConfirmationDocuments(limitCount: number = 50) {
  return useQuery({
    queryKey: ['pendingConfirmationDocuments', limitCount],
    queryFn: () => fetchPendingDocuments(limitCount),
    staleTime: 30 * 1000,
  });
}

// ============================================
// キャッシュ無効化
// ============================================

/**
 * 確認待ち関連のキャッシュを無効化
 */
export function useInvalidatePendingConfirmations() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingConfirmationStats'] });
      queryClient.invalidateQueries({ queryKey: ['pendingConfirmationDocuments'] });
    },
  };
}
