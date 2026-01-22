/**
 * 事業所同名解決フック
 *
 * 機能:
 * - 事業所候補からの選択・確定
 * - 「該当なし」選択
 * - Firestoreトランザクションによる更新 + 監査ログ作成
 */

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  doc,
  collection,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import type { Document, OfficeCandidateInfo } from '@shared/types';

// ============================================
// 型定義
// ============================================

export interface ResolveOfficeParams {
  documentId: string;
  selectedOfficeId: string;
  selectedOfficeName: string;
  selectedOfficeIsDuplicate: boolean;
}

export interface ResolveOfficeAsUnknownParams {
  documentId: string;
}

// ============================================
// 事業所解決トランザクション
// ============================================

/**
 * 事業所を選択して確定
 */
async function resolveOffice({
  documentId,
  selectedOfficeId,
  selectedOfficeName,
  selectedOfficeIsDuplicate: _selectedOfficeIsDuplicate,
}: ResolveOfficeParams): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  await runTransaction(db, async (transaction) => {
    const docRef = doc(db, 'documents', documentId);
    const docSnap = await transaction.get(docRef);

    if (!docSnap.exists()) throw new Error('Document not found');

    const previousOfficeId = docSnap.data().officeId ?? null;

    // 1. documentsを更新
    transaction.update(docRef, {
      officeId: selectedOfficeId,
      officeName: selectedOfficeName,
      officeConfirmed: true,
      officeConfirmedBy: user.uid,
      officeConfirmedAt: serverTimestamp(),
    });

    // 2. 監査ログを作成
    const logRef = doc(collection(db, 'officeResolutionLogs'));
    transaction.set(logRef, {
      documentId,
      previousOfficeId,
      newOfficeId: selectedOfficeId,
      newOfficeName: selectedOfficeName,
      resolvedBy: user.uid,
      resolvedByEmail: user.email,
      resolvedAt: serverTimestamp(),
    });
  });
}

/**
 * 「該当なし」を選択して確定
 */
async function resolveOfficeAsUnknown({
  documentId,
}: ResolveOfficeAsUnknownParams): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  await runTransaction(db, async (transaction) => {
    const docRef = doc(db, 'documents', documentId);
    const docSnap = await transaction.get(docRef);

    if (!docSnap.exists()) throw new Error('Document not found');

    const previousOfficeId = docSnap.data().officeId ?? null;

    // 1. documentsを更新
    transaction.update(docRef, {
      officeId: null,
      officeName: '不明事業所',
      officeConfirmed: true,
      officeConfirmedBy: user.uid,
      officeConfirmedAt: serverTimestamp(),
    });

    // 2. 監査ログを作成
    const logRef = doc(collection(db, 'officeResolutionLogs'));
    transaction.set(logRef, {
      documentId,
      previousOfficeId,
      newOfficeId: null,
      newOfficeName: '不明事業所',
      resolvedBy: user.uid,
      resolvedByEmail: user.email,
      resolvedAt: serverTimestamp(),
      reason: '該当なし選択',
    });
  });
}

// ============================================
// 候補正規化ユーティリティ
// ============================================

/**
 * Firestoreから取得した生の候補データを正規化
 */
export function normalizeOfficeCandidate(raw: Record<string, unknown>): OfficeCandidateInfo {
  return {
    officeId: (raw.officeId as string) || '',
    officeName: (raw.officeName as string) || '',
    shortName: raw.shortName as string | undefined,
    isDuplicate: (raw.isDuplicate as boolean) || false,
    score: (raw.score as number) || 0,
    matchType: (raw.matchType as 'exact' | 'partial' | 'fuzzy') || 'fuzzy',
  };
}

// ============================================
// メインフック
// ============================================

export function useOfficeResolution() {
  const queryClient = useQueryClient();

  // 事業所選択mutation
  const resolveOfficeMutation = useMutation({
    mutationFn: resolveOffice,
    onSuccess: (_, { documentId }) => {
      // キャッシュを無効化
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processingHistory'] });
    },
  });

  // 該当なし選択mutation
  const resolveAsUnknownMutation = useMutation({
    mutationFn: resolveOfficeAsUnknown,
    onSuccess: (_, { documentId }) => {
      // キャッシュを無効化
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processingHistory'] });
    },
  });

  // 事業所候補を正規化して取得
  const getCandidates = useCallback((document: Document): OfficeCandidateInfo[] => {
    const rawCandidates = document.officeCandidates ?? [];
    return rawCandidates.map(c => normalizeOfficeCandidate(c as unknown as Record<string, unknown>));
  }, []);

  return {
    // 事業所解決
    resolveOffice: resolveOfficeMutation.mutateAsync,
    resolveAsUnknown: resolveAsUnknownMutation.mutateAsync,
    isResolving: resolveOfficeMutation.isPending || resolveAsUnknownMutation.isPending,
    resolveError: resolveOfficeMutation.error || resolveAsUnknownMutation.error,

    // ユーティリティ
    getCandidates,
  };
}
