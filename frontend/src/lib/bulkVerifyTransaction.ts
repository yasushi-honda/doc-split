/**
 * 一括確認済み(DocumentsPage.tsxのhandleBulkVerify)の文書1件あたりのFirestore
 * トランザクション実行をテスト可能な単位へ切り出したもの(Issue #1044、evaluator/
 * pr-test-analyzerの指摘対応: bulkVerifyOutcome.tsへ抽出した集計ロジックのテストだけでは、
 * fail-closedの発生源そのもの(fetchFreshCustomerIdentityLookup失敗時にdecisionsが
 * nullになる経路)が未検証だった)。
 *
 * frontend/src/hooks/useDocumentVerification.ts(単体トグル版)と同型のFirestore
 * トランザクション構成を、一括確認済み(複数文書を並行処理)向けに1文書単位の関数として
 * 抽出する。DocumentsPage.tsx側はrunWithConcurrency(bulkVerifyOutcome.ts)の
 * コールバックからこれを呼ぶだけになる。
 */

import { doc, collection, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore'
import type { Document } from '../../../shared/types'
import { planConfirmOnVerify, buildConfirmOnVerifyUpdate } from '../../../shared/confirmOnVerify'
import type { CustomerIdentityLookup } from '../hooks/useMasters'
import type { BulkVerifyDocOutcome } from './bulkVerifyOutcome'

export interface BulkVerifyDocTransactionOpts {
  /**
   * `fetchFreshCustomerIdentityLookup()`の結果。取得自体が失敗した場合は`null`を渡す
   * (fail-closed: 確定判定を一律スキップし、`verified`のみ更新する)。
   */
  freshIdentityLookup: Omit<CustomerIdentityLookup, 'isReady'> | null
  uid: string
  email: string
}

/**
 * 1文書分の「確認済み」書込みをFirestoreトランザクションで実行する。
 * 失敗しても例外を投げず、`status: 'error'`のoutcomeとして返す
 * (呼び出し元のrunWithConcurrencyが他文書の処理を継続できるようにするため)。
 */
export async function executeBulkVerifyDocumentTransaction(
  db: Firestore,
  docId: string,
  opts: BulkVerifyDocTransactionOpts
): Promise<BulkVerifyDocOutcome> {
  const { freshIdentityLookup, uid, email } = opts
  const docRef = doc(db, 'documents', docId)
  try {
    const { decisions, alreadyFullyConfirmed } = await runTransaction(db, async (tx) => {
      const freshSnap = await tx.get(docRef)
      if (!freshSnap.exists()) {
        throw new Error(`Document not found: ${docId}`)
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
      const { update: confirmFields, logs } = txDecisions
        ? buildConfirmOnVerifyUpdate(txDecisions, freshDoc, { uid, now: serverTimestamp() })
        : { update: {}, logs: [] }

      // 既存のuseDocumentEdit.ts(L396)と同じ規約: 動的に組み立てたRecord<string, unknown>を
      // Firestoreの厳密なUpdateData型へ渡すためのキャスト。
      tx.update(docRef, {
        verified: true,
        verifiedBy: uid,
        verifiedAt: serverTimestamp(),
        ...confirmFields,
      } as any)

      const editLogsRef = collection(db, 'editLogs')
      for (const change of logs) {
        tx.set(doc(editLogsRef), {
          documentId: docId,
          fieldName: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          editedBy: uid,
          editedByEmail: email,
          editedAt: serverTimestamp(),
        })
      }

      return {
        decisions: txDecisions,
        // codex review 3巡目指摘: identityLookupFailedによる警告は、成功した書類の
        // うち少なくとも1件が実際に確定できたはず(=両方確定済みではなかった)場合のみ
        // 出す。単体トグルの「既に両方確定済みなら警告不要」と同じ判定を、このtx内で
        // 再読込した最新状態(freshDoc)を基準に行う。
        alreadyFullyConfirmed: freshDoc.customerConfirmed === true && freshDoc.officeConfirmed === true,
      }
    })
    return { docId, status: 'ok' as const, decisions, alreadyFullyConfirmed }
  } catch (err) {
    console.error(`Bulk verify failed for document ${docId}:`, err)
    return { docId, status: 'error' as const, decisions: null, alreadyFullyConfirmed: false }
  }
}
