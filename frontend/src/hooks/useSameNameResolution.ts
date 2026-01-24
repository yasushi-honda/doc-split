/**
 * 同姓同名解決フック（Phase 7）
 *
 * 機能:
 * - 顧客候補からの選択・確定
 * - 「該当なし」選択
 * - Firestoreトランザクションによる更新 + 監査ログ作成
 * - 大容量OCR結果の取得
 */

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  doc,
  collection,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, app, auth } from '@/lib/firebase';
import { normalizeCandidate } from './useProcessingHistory';
import type { Document, CustomerCandidateInfo } from '@shared/types';

// ============================================
// 型定義
// ============================================

export interface ResolveCustomerParams {
  documentId: string;
  selectedCustomerId: string;
  selectedCustomerName: string;
  selectedCustomerIsDuplicate: boolean;
  selectedCareManagerName?: string | null;
}

export interface ResolveAsUnknownParams {
  documentId: string;
}

export interface FetchOcrTextParams {
  doc: Document;
}

// ============================================
// OCR全文取得
// ============================================

/**
 * 大容量OCR結果をCloud Functionから取得
 */
export async function fetchFullOcrText(doc: Document): Promise<string> {
  // 通常ケース: Firestoreから取得済み
  if (!doc.ocrResultUrl || doc.ocrResult) {
    return doc.ocrResult || '';
  }

  // Cloud Storage保存ケース: Cloud Functionで取得
  const functions = getFunctions(app, 'asia-northeast1');
  const getOcrText = httpsCallable<{ documentId: string }, { text: string }>(
    functions,
    'getOcrText'
  );
  const result = await getOcrText({ documentId: doc.id });
  return result.data.text;
}

// ============================================
// 顧客解決トランザクション
// ============================================

/**
 * 顧客を選択して確定
 */
async function resolveCustomer({
  documentId,
  selectedCustomerId,
  selectedCustomerName,
  selectedCustomerIsDuplicate,
  selectedCareManagerName,
}: ResolveCustomerParams): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  await runTransaction(db, async (transaction) => {
    const docRef = doc(db, 'documents', documentId);
    const docSnap = await transaction.get(docRef);

    if (!docSnap.exists()) throw new Error('Document not found');

    const previousCustomerId = docSnap.data().customerId ?? null;

    // 1. documentsを更新（careManagerも設定）
    transaction.update(docRef, {
      customerId: selectedCustomerId,
      customerName: selectedCustomerName,
      customerConfirmed: true,
      needsManualCustomerSelection: false,  // 後方互換
      confirmedBy: user.uid,
      confirmedAt: serverTimestamp(),
      isDuplicateCustomer: selectedCustomerIsDuplicate,
      careManager: selectedCareManagerName || null,
    });

    // 2. 監査ログを作成
    const logRef = doc(collection(db, 'customerResolutionLogs'));
    transaction.set(logRef, {
      documentId,
      previousCustomerId,
      newCustomerId: selectedCustomerId,
      newCustomerName: selectedCustomerName,
      resolvedBy: user.uid,
      resolvedByEmail: user.email,
      resolvedAt: serverTimestamp(),
    });
  });
}

/**
 * 「該当なし」を選択して確定
 */
async function resolveAsUnknown({
  documentId,
}: ResolveAsUnknownParams): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  await runTransaction(db, async (transaction) => {
    const docRef = doc(db, 'documents', documentId);
    const docSnap = await transaction.get(docRef);

    if (!docSnap.exists()) throw new Error('Document not found');

    const previousCustomerId = docSnap.data().customerId ?? null;

    // 1. documentsを更新
    transaction.update(docRef, {
      customerId: null,
      customerName: '不明顧客',
      customerConfirmed: true,
      needsManualCustomerSelection: false,  // 後方互換
      confirmedBy: user.uid,
      confirmedAt: serverTimestamp(),
      isDuplicateCustomer: false,
    });

    // 2. 監査ログを作成
    const logRef = doc(collection(db, 'customerResolutionLogs'));
    transaction.set(logRef, {
      documentId,
      previousCustomerId,
      newCustomerId: null,
      newCustomerName: '不明顧客',
      resolvedBy: user.uid,
      resolvedByEmail: user.email,
      resolvedAt: serverTimestamp(),
      reason: '該当なし選択',
    });
  });
}

// ============================================
// メインフック
// ============================================

export function useSameNameResolution() {
  const queryClient = useQueryClient();
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [isLoadingOcr, setIsLoadingOcr] = useState(false);
  const [ocrError, setOcrError] = useState<Error | null>(null);

  // 顧客選択mutation
  const resolveCustomerMutation = useMutation({
    mutationFn: resolveCustomer,
    onSuccess: (_, { documentId }) => {
      // キャッシュを無効化
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processingHistory'] });
    },
  });

  // 該当なし選択mutation
  const resolveAsUnknownMutation = useMutation({
    mutationFn: resolveAsUnknown,
    onSuccess: (_, { documentId }) => {
      // キャッシュを無効化
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processingHistory'] });
    },
  });

  // OCR全文取得
  const loadOcrText = useCallback(async (document: Document) => {
    setIsLoadingOcr(true);
    setOcrError(null);
    try {
      const text = await fetchFullOcrText(document);
      setOcrText(text);
    } catch (err) {
      setOcrError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoadingOcr(false);
    }
  }, []);

  // OCR状態リセット
  const resetOcrText = useCallback(() => {
    setOcrText(null);
    setOcrError(null);
  }, []);

  // 顧客候補を正規化して取得
  const getCandidates = useCallback((document: Document): CustomerCandidateInfo[] => {
    const rawCandidates = document.customerCandidates ?? [];
    return rawCandidates.map(c => normalizeCandidate(c as Record<string, unknown>));
  }, []);

  return {
    // 顧客解決
    resolveCustomer: resolveCustomerMutation.mutateAsync,
    resolveAsUnknown: resolveAsUnknownMutation.mutateAsync,
    isResolving: resolveCustomerMutation.isPending || resolveAsUnknownMutation.isPending,
    resolveError: resolveCustomerMutation.error || resolveAsUnknownMutation.error,

    // OCR全文
    ocrText,
    isLoadingOcr,
    ocrError,
    loadOcrText,
    resetOcrText,

    // ユーティリティ
    getCandidates,
  };
}
