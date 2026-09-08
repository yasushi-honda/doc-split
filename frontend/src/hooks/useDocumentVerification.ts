/**
 * ドキュメント確認ステータス管理フック
 * OCR結果の人的確認状態を管理
 * 楽観的更新でUIの即時反映を実現
 */

import { useState, useCallback } from 'react'
import { doc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db, auth } from '../lib/firebase'
import { updateDocumentInListCache, getDriveExportClearFields, markDocumentsInfiniteVariantsDirty } from './useDocuments'
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
    // 2026-09-08追記(codex review 5周目 P2指摘): この書類が現在`documentsInfinite`の
    // どのvariantにもキャッシュされていない場合(グループ表示やdeep linkから開いた場合等)、
    // 上記パッチは無言のno-opになる。また「未確認のみ表示」はクライアント側フィルタ
    // (documentStatsには反映されない)のため、確認状態の変更だけでは更新バナーの
    // 通常の検知シグナルが一切発火しない。dirty化して、少なくともバナー経由で
    // 気付けるようにする。
    markDocumentsInfiniteVariantsDirty(queryClient)
  }, [document, queryClient])

  const markAsVerified = useCallback(async (): Promise<boolean> => {
    if (!document || !auth.currentUser) {
      setError('認証情報がありません')
      return false
    }

    setIsUpdating(true)
    setError(null)

    // ロールバック用に変更前の値を保持(documentは以降optimisticUpdateで変異しない
    // オブジェクトのため、try内外どちらで読んでも同じ値になる)
    const previousVerified = document.verified

    try {
      // 楽観的更新（即座にUIに反映）
      // 2026-09-08追記(second-opinionレビュー指摘): この呼び出しをtryブロックの外に
      // 置くと、内部のmarkDocumentsInfiniteVariantsDirty等が万一例外を投げた場合に
      // finally(isUpdatingのリセット)が実行されず、確認トグルが永久disabledになる
      // 恐れがあった。tryブロック内へ移動して対称性を確保する。
      optimisticUpdate(true)

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

    // ロールバック用に変更前の値を保持
    const previousVerified = document.verified

    try {
      // 楽観的更新（即座にUIに反映）。tryブロック内に置く理由はmarkAsVerified参照。
      optimisticUpdate(false)

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
