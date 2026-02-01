/**
 * ドキュメント確認ステータス管理フック
 * OCR結果の人的確認状態を管理
 */

import { useState, useCallback } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db, auth } from '../lib/firebase'
import type { Document } from '../../../shared/types'

interface UseDocumentVerificationResult {
  isUpdating: boolean
  error: string | null
  markAsVerified: () => Promise<boolean>
  markAsUnverified: () => Promise<boolean>
}

export function useDocumentVerification(
  document: Document | null | undefined,
  onSuccess?: () => void
): UseDocumentVerificationResult {
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const markAsVerified = useCallback(async (): Promise<boolean> => {
    if (!document || !auth.currentUser) {
      setError('認証情報がありません')
      return false
    }

    setIsUpdating(true)
    setError(null)

    try {
      const docRef = doc(db, 'documents', document.id)
      await updateDoc(docRef, {
        verified: true,
        verifiedBy: auth.currentUser.uid,
        verifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      // 一覧画面のキャッシュも無効化
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
      onSuccess?.()
      return true
    } catch (err) {
      console.error('Failed to mark as verified:', err)
      setError(err instanceof Error ? err.message : '確認済みにできませんでした')
      return false
    } finally {
      setIsUpdating(false)
    }
  }, [document, onSuccess, queryClient])

  const markAsUnverified = useCallback(async (): Promise<boolean> => {
    if (!document || !auth.currentUser) {
      setError('認証情報がありません')
      return false
    }

    setIsUpdating(true)
    setError(null)

    try {
      const docRef = doc(db, 'documents', document.id)
      await updateDoc(docRef, {
        verified: false,
        verifiedBy: null,
        verifiedAt: null,
        updatedAt: serverTimestamp(),
      })
      // 一覧画面のキャッシュも無効化
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
      onSuccess?.()
      return true
    } catch (err) {
      console.error('Failed to mark as unverified:', err)
      setError(err instanceof Error ? err.message : '未確認に戻せませんでした')
      return false
    } finally {
      setIsUpdating(false)
    }
  }, [document, onSuccess, queryClient])

  return {
    isUpdating,
    error,
    markAsVerified,
    markAsUnverified,
  }
}
