/**
 * ドキュメント確認ステータス管理フック
 * OCR結果の人的確認状態を管理
 * 楽観的更新でUIの即時反映を実現
 */

import { useState, useCallback } from 'react'
import { doc, updateDoc, serverTimestamp, Timestamp, collection, runTransaction } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db, auth } from '../lib/firebase'
import {
  updateDocumentInListCache,
  getDriveExportClearFields,
  markDocumentsInfiniteVariantsDirty,
  invalidateGroupQueries,
} from './useDocuments'
import type { Document } from '../../../shared/types'
import {
  planConfirmOnVerify,
  buildConfirmOnVerifyUpdate,
  CONFIRM_ON_VERIFY_SKIPPED_WARNING_MESSAGE,
} from '../../../shared/confirmOnVerify'
import { fetchFreshCustomerIdentityLookup } from './useMasters'

interface UseDocumentVerificationResult {
  isUpdating: boolean
  error: string | null
  markAsVerified: () => Promise<boolean>
  markAsUnverified: () => Promise<boolean>
}

export function useDocumentVerification(document: Document | null | undefined): UseDocumentVerificationResult {
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
      // Issue #1034 + codexレビュー指摘(P1・1回目): propの`document`はモーダルを開いた時点の
      // スナップショットで、確定操作を押すまでの間に他者が顧客/事業所を変更している
      // 可能性がある。トランザクション内でFirestoreから直前に再読込した最新データに
      // 対して判定・書込みを行うことで、この競合を防ぐ。
      //
      // codexレビュー指摘(P1・2回目): 上記だけでは、同姓同名判定に使う顧客マスター側が
      // 依然`useCustomers()`のキャッシュ(最大5分古い)のままだった。直近に追加・改名された
      // 同姓同名マスターがキャッシュに反映されていないと、実際には曖昧な顧客を誤って
      // 確定してしまう。確定操作の直前に`fetchFreshCustomerIdentityLookup()`でキャッシュを
      // 経由しない最新のマスター一覧を取得し、判定に使う。
      //
      // codexレビュー指摘(P2・5回目): この取得を`identityLookup.isReady`(=`useCustomers()`
      // キャッシュの初回ロード完了)条件で分岐すると、ページ初回表示直後にキャッシュが
      // まだ無い間はfalseになり、確定操作が`verified`のみ更新してサイレントに確定を
      // 恒久的にスキップしてしまう(単体トグルは一括確認済みと違いこの間disabledにならない
      // ため、ユーザーが気付かず後から手戻りが必要になる)。`fetchFreshCustomerIdentityLookup()`
      // はキャッシュを経由しない独立したFirestore取得のため、`identityLookup.isReady`の
      // 状態に関わらず常に呼び出せる。
      //
      // codexレビュー指摘(P1、6回目、DocumentsPage.tsxの一括確認済みで指摘・本フックにも
      // 同型で存在): この取得からトランザクション完了までの間の同姓同名TOCTOUは意図的に
      // 許容する残存リスク(詳細・理由はDocumentsPage.tsxのhandleBulkVerify内の同種コメント
      // 参照)。
      const freshIdentityLookup = await fetchFreshCustomerIdentityLookup().catch((fetchErr) => {
        console.error('Failed to fetch fresh customer identity lookup, skipping confirm-on-verify:', fetchErr)
        return null
      })

      const decisions = await runTransaction(db, async (tx) => {
        const freshSnap = await tx.get(docRef)
        if (!freshSnap.exists()) {
          throw new Error('Document not found')
        }
        const freshDoc = freshSnap.data() as Document

        const txDecisions = freshIdentityLookup
          ? planConfirmOnVerify(freshDoc, {
              customerMasterName: freshDoc.customerId
                ? (freshIdentityLookup.customerMasterNameById.get(freshDoc.customerId) ?? null)
                : null,
              sameNameCollisionNames: freshIdentityLookup.sameNameCollisionNames,
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

      // codexレビュー(second opinion、comment-analyzer)指摘: トランザクションは既に成功して
      // おり、Firestoreには`verified`/確定フラグが書き込まれ済みのため、以降のキャッシュ
      // 補正(optimisticUpdate/invalidateGroupQueries)は表示上の後始末に過ぎない。ここで
      // 例外が起きても外側のcatch(下記)のロールバック処理を発火させてはならない
      // (発火させると、Firestoreには確定済みなのにUIキャッシュだけ未確認へ戻り、
      // 表示とデータが食い違う)。そのため別のtry/catchで隔離し、失敗してもログのみ残す。
      try {
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
        // グループ表示(担当CM別・利用者別)を開いたまま詳細モーダルで確認済みにすると、
        // groupDocumentsクエリ(staleTime:Infinity、自動再取得なし)が古いcustomerConfirmed/
        // officeConfirmedバッジを保持し続ける。他の単体書類更新(useDocumentEdit.ts等)と
        // 同じくinvalidateGroupQueriesでdirty化し、バナー経由で気付けるようにする。
        invalidateGroupQueries(queryClient)
      } catch (postCommitErr) {
        console.error('Failed to sync cache after markAsVerified transaction succeeded:', postCommitErr)
      }
      // Issue #1042: freshIdentityLookup取得失敗により確定判定(customerConfirmed/
      // officeConfirmed)が丸ごとスキップされた場合、verifiedはtrueで書き込まれ成功したように
      // 見えるが確定フラグは書き込まれていない。console.errorのみではユーザーが気付けず、
      // 手戻りが必要になるまで放置されるため、非ブロッキングの警告を表示する。
      // 元々どちらも確定済み(何も変わらないはずだった)の書類では、確定判定をスキップしても
      // 実害がないため警告を出さない(モーダルを開いた時点のdocument propによる簡易判定、
      // トランザクション内で再読込した最新状態との食い違いは許容する)。
      if (
        freshIdentityLookup === null &&
        !(document.customerConfirmed === true && document.officeConfirmed === true)
      ) {
        setError(CONFIRM_ON_VERIFY_SKIPPED_WARNING_MESSAGE)
      }
      return true
    } catch (err) {
      console.error('Failed to mark as verified:', err)
      setError(err instanceof Error ? err.message : '確認済みにできませんでした')
      // エラー時はロールバック(runTransaction自体が失敗した場合のみここに到達し、確定
      // フラグは一切書き込まれていない前提。トランザクション成功後の後始末は上の内側
      // try/catchで隔離済みのため、ここに来た時点でFirestoreへの書込みは行われていない)。
      // verifiedの楽観的更新のみ元に戻せばよい。
      optimisticUpdate(previousVerified || false)
      return false
    } finally {
      setIsUpdating(false)
    }
  }, [document, optimisticUpdate, queryClient])

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
