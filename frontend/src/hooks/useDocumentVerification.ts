/**
 * ドキュメント確認ステータス管理フック
 * OCR結果の人的確認状態を管理
 * 楽観的更新でUIの即時反映を実現
 */

import { useState, useCallback } from 'react'
import { doc, updateDoc, serverTimestamp, Timestamp, collection, runTransaction } from 'firebase/firestore'
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
    const uid = auth.currentUser.uid
    const email = auth.currentUser.email || ''

    try {
      // 楽観的更新（即座にUIに反映）。verifiedのみ即時反映し、確定フラグ(customerConfirmed等)は
      // トランザクション確定後の実際の判定結果で反映する(下記)。
      // 2026-09-08追記(second-opinionレビュー指摘): この呼び出しをtryブロックの外に
      // 置くと、内部のmarkDocumentsInfiniteVariantsDirty等が万一例外を投げた場合に
      // finally(isUpdatingのリセット)が実行されず、確認トグルが永久disabledになる
      // 恐れがあった。tryブロック内へ移動して対称性を確保する。
      optimisticUpdate(true)

      const docRef = doc(db, 'documents', document.id)
      // Issue #1034 + codexレビュー指摘(P1): propの`document`はモーダルを開いた時点の
      // スナップショットで、確定操作を押すまでの間に他者が顧客/事業所を変更している
      // 可能性がある。その場合、古いスナップショットで「確定可能」と判定した内容を
      // 書き込むと、実際には変更後の(未検証の)顧客/事業所を人間確定扱いにしてしまい、
      // 同姓同名ゲートを素通りしうる。トランザクション内でFirestoreから直前に再読込した
      // 最新データに対して判定・書込みを行うことで、この競合を防ぐ。
      const decisions = await runTransaction(db, async (tx) => {
        const freshSnap = await tx.get(docRef)
        if (!freshSnap.exists()) {
          throw new Error('Document not found')
        }
        const freshDoc = freshSnap.data() as Document

        const txDecisions = identityLookup.isReady
          ? planConfirmOnVerify(freshDoc, {
              customerMasterName: freshDoc.customerId
                ? (identityLookup.customerMasterNameById.get(freshDoc.customerId) ?? null)
                : null,
              sameNameCollisionNames: identityLookup.sameNameCollisionNames,
            })
          : null
        const confirmUpdate = txDecisions
          ? buildConfirmOnVerifyUpdate(txDecisions, freshDoc, { uid, now: serverTimestamp() })
          : null

        tx.update(docRef, {
          verified: true,
          verifiedBy: uid,
          verifiedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...confirmUpdate?.update,
        })

        // #398と同じ規約の監査ログ(確定フラグ変更のsilent failure検知用)。ドキュメント本体の
        // 更新と同一トランザクションに含めることで、ログ書込みが失敗した場合は本体更新も
        // 含めて全体がロールバックされ、Firestoreの状態とUIが食い違うことがなくなる
        // (codexレビュー指摘: 従来はupdateDoc成功後にaddDocが独立して失敗しうる構造だった)。
        if (confirmUpdate) {
          const editLogsRef = collection(db, 'editLogs')
          for (const change of confirmUpdate.logs) {
            tx.set(doc(editLogsRef), {
              documentId: document.id,
              fieldName: change.field,
              oldValue: change.oldValue,
              newValue: change.newValue,
              editedBy: uid,
              editedByEmail: email,
              editedAt: serverTimestamp(),
            })
          }
        }

        return txDecisions
      })

      // トランザクション確定後、実際に判定された確定フラグでキャッシュを補正する
      // (最新データに基づく結果のため、モーダルを開いた時点のdocumentとは食い違いうる)。
      if (decisions) {
        const confirmedAtApprox = Timestamp.now()
        const patch: Partial<Document> = {}
        if (decisions.customer.action === 'confirm') {
          patch.customerConfirmed = true
          patch.confirmedBy = uid
          patch.confirmedAt = confirmedAtApprox
        }
        if (decisions.office.action === 'confirm') {
          patch.officeConfirmed = true
          patch.officeConfirmedBy = uid
          patch.officeConfirmedAt = confirmedAtApprox
        }
        if (Object.keys(patch).length > 0) {
          optimisticUpdate(true, patch)
        }
      }
      return true
    } catch (err) {
      console.error('Failed to mark as verified:', err)
      setError(err instanceof Error ? err.message : '確認済みにできませんでした')
      // エラー時はロールバック(トランザクション全体が失敗しているため、確定フラグは
      // 一切書き込まれていない。verifiedの楽観的更新のみ元に戻せばよい)。
      optimisticUpdate(previousVerified || false)
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
