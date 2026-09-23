/**
 * ドキュメント確認ステータス管理フック
 * OCR結果の人的確認状態を管理
 * 楽観的更新でUIの即時反映を実現
 */

import { useState, useCallback } from 'react'
import { doc, updateDoc, serverTimestamp, Timestamp, addDoc, collection } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db, auth } from '../lib/firebase'
import { updateDocumentInListCache, getDriveExportClearFields, markDocumentsInfiniteVariantsDirty } from './useDocuments'
import type { Document } from '../../../shared/types'
import { planConfirmOnVerify, buildConfirmOnVerifyUpdate } from '../../../shared/confirmOnVerify'
import type { CustomerIdentityLookup } from './useMasters'

interface UseDocumentVerificationResult {
  isUpdating: boolean
  error: string | null
  markAsVerified: () => Promise<boolean>
  markAsUnverified: () => Promise<boolean>
}

export function useDocumentVerification(
  document: Document | null | undefined,
  identityLookup: CustomerIdentityLookup
): UseDocumentVerificationResult {
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // 楽観的更新: キャッシュを即座に更新
  const optimisticUpdate = useCallback((verified: boolean, extra?: Partial<Document>) => {
    if (!document) return

    updateDocumentInListCache(queryClient, document.id, {
      verified,
      verifiedBy: verified ? auth.currentUser?.uid : null,
      verifiedAt: verified ? Timestamp.now() : null,
      ...extra,
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

    // Issue #1034: 「確認済み」にする操作は、同姓同名等の危険なケースを除き
    // customerConfirmed/officeConfirmedも同時に確定する(既存の保存フロー
    // useDocumentEdit.tsのshouldSetCustomerConfirmed/shouldSetOfficeConfirmedと同一ルール)。
    // identityLookup.isReady が false(顧客マスター読み込み中)の間はサイレントに確定させず、
    // verifiedのみ更新する既存動作のままにする。
    const decisions = identityLookup.isReady
      ? planConfirmOnVerify(document, {
          customerMasterName: document.customerId
            ? (identityLookup.customerMasterNameById.get(document.customerId) ?? null)
            : null,
          sameNameCollisionNames: identityLookup.sameNameCollisionNames,
        })
      : null
    const confirmUpdate = decisions
      ? buildConfirmOnVerifyUpdate(decisions, document, { uid: auth.currentUser.uid, now: serverTimestamp() })
      : null

    try {
      // 楽観的更新（即座にUIに反映）
      // 2026-09-08追記(second-opinionレビュー指摘): この呼び出しをtryブロックの外に
      // 置くと、内部のmarkDocumentsInfiniteVariantsDirty等が万一例外を投げた場合に
      // finally(isUpdatingのリセット)が実行されず、確認トグルが永久disabledになる
      // 恐れがあった。tryブロック内へ移動して対称性を確保する。
      const optimisticConfirm: Partial<Document> = {}
      if (decisions?.customer.action === 'confirm') {
        optimisticConfirm.customerConfirmed = true
        optimisticConfirm.confirmedBy = auth.currentUser.uid
        optimisticConfirm.confirmedAt = Timestamp.now()
      }
      if (decisions?.office.action === 'confirm') {
        optimisticConfirm.officeConfirmed = true
        optimisticConfirm.officeConfirmedBy = auth.currentUser.uid
        optimisticConfirm.officeConfirmedAt = Timestamp.now()
      }
      optimisticUpdate(true, optimisticConfirm)

      const docRef = doc(db, 'documents', document.id)
      await updateDoc(docRef, {
        verified: true,
        verifiedBy: auth.currentUser.uid,
        verifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...confirmUpdate?.update,
      })

      // #398と同じ規約の監査ログ(確定フラグ変更のsilent failure検知用)。
      // codexレビュー指摘: updateDoc成功後にここが失敗すると、Firestoreには確定済みの
      // 内容が既に保存されているにもかかわらず、外側catchのロールバックでUIだけ未確認に
      // 戻ってしまい表示とFirestoreの状態が食い違う。監査ログはベストエフォートとして
      // 独立したtry/catchにし、失敗してもドキュメント本体の更新成功を優先する。
      if (confirmUpdate && confirmUpdate.logs.length > 0) {
        try {
          const editLogsRef = collection(db, 'editLogs')
          for (const change of confirmUpdate.logs) {
            await addDoc(editLogsRef, {
              documentId: document.id,
              fieldName: change.field,
              oldValue: change.oldValue,
              newValue: change.newValue,
              editedBy: auth.currentUser.uid,
              editedByEmail: auth.currentUser.email || '',
              editedAt: serverTimestamp(),
            })
          }
        } catch (logErr) {
          console.error('Failed to write editLogs for confirm-on-verify (document update already succeeded):', logErr)
        }
      }
      return true
    } catch (err) {
      console.error('Failed to mark as verified:', err)
      setError(err instanceof Error ? err.message : '確認済みにできませんでした')
      // エラー時はロールバック(確定フラグの楽観的更新も含めて元に戻す)
      const rollbackConfirm: Partial<Document> = {}
      if (decisions?.customer.action === 'confirm') {
        rollbackConfirm.customerConfirmed = document.customerConfirmed
        rollbackConfirm.confirmedBy = document.confirmedBy ?? null
        rollbackConfirm.confirmedAt = document.confirmedAt ?? null
      }
      if (decisions?.office.action === 'confirm') {
        rollbackConfirm.officeConfirmed = document.officeConfirmed
        rollbackConfirm.officeConfirmedBy = document.officeConfirmedBy ?? null
        rollbackConfirm.officeConfirmedAt = document.officeConfirmedAt ?? null
      }
      optimisticUpdate(previousVerified || false, rollbackConfirm)
      return false
    } finally {
      setIsUpdating(false)
    }
  }, [document, optimisticUpdate, identityLookup])

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
