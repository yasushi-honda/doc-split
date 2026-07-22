/**
 * ドキュメント確認ステータス管理フック
 * OCR結果の人的確認状態を管理
 * 楽観的更新でUIの即時反映を実現
 */

import { useState, useCallback } from 'react'
import { doc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db, auth } from '../lib/firebase'
import { updateDocumentInListCache, getDriveExportClearFields } from './useDocuments'
import type { Document } from '../../../shared/types'

interface UseDocumentVerificationResult {
  isUpdating: boolean
  error: string | null
  markAsVerified: () => Promise<boolean>
  markAsUnverified: () => Promise<boolean>
}

export function useDocumentVerification(
  document: Document | null | undefined
): UseDocumentVerificationResult {
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // 楽観的更新: キャッシュを即座に更新
  const optimisticUpdate = useCallback((verified: boolean) => {
    if (!document) return

    updateDocumentInListCache(queryClient, document.id, {
      verified,
      verifiedBy: verified ? auth.currentUser?.uid : null,
      verifiedAt: verified ? Timestamp.now() : null,
    })
  }, [document, queryClient])

  const markAsVerified = useCallback(async (): Promise<boolean> => {
    if (!document || !auth.currentUser) {
      setError('認証情報がありません')
      return false
    }

    setIsUpdating(true)
    setError(null)

    // 楽観的更新（即座にUIに反映）
    const previousVerified = document.verified
    optimisticUpdate(true)

    try {
      const docRef = doc(db, 'documents', document.id)
      await updateDoc(docRef, {
        verified: true,
        verifiedBy: auth.currentUser.uid,
        verifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      return true
    } catch (err) {
      console.error('Failed to mark as verified:', err)
      setError(err instanceof Error ? err.message : '確認済みにできませんでした')
      // エラー時はロールバック
      optimisticUpdate(previousVerified || false)
      return false
    } finally {
      setIsUpdating(false)
    }
  }, [document, optimisticUpdate])

  const markAsUnverified = useCallback(async (): Promise<boolean> => {
    if (!document || !auth.currentUser) {
      setError('認証情報がありません')
      return false
    }

    setIsUpdating(true)
    setError(null)

    // 楽観的更新（即座にUIに反映）
    const previousVerified = document.verified
    optimisticUpdate(false)

    try {
      const docRef = doc(db, 'documents', document.id)
      await updateDoc(docRef, {
        verified: false,
        verifiedBy: null,
        verifiedAt: null,
        updatedAt: serverTimestamp(),
        // ADR-0022 Phase1、code-review指摘#42対応(2026-07-22): 未確認に戻す時点でDrive
        // エクスポート状態をクリアしないと、訂正後の再確認でdriveExportTrigger.tsのクレーム
        // (driveExportStatus不在のdocのみ対象)が古い'exported'値を検知してスキップされ、
        // 二度と再エクスポートされなくなる。driveFileIdは意図的にクリアしない
        // (getDriveExportClearFields()のコメント参照、旧Driveファイルへの参照を保持する)。
        ...getDriveExportClearFields(),
      })
      return true
    } catch (err) {
      console.error('Failed to mark as unverified:', err)
      setError(err instanceof Error ? err.message : '未確認に戻せませんでした')
      // エラー時はロールバック
      optimisticUpdate(previousVerified || false)
      return false
    } finally {
      setIsUpdating(false)
    }
  }, [document, optimisticUpdate])

  return {
    isUpdating,
    error,
    markAsVerified,
    markAsUnverified,
  }
}
