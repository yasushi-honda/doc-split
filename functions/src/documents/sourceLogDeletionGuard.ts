/**
 * gmailLogs/uploadLogs delete safety net(kanameone現場要件「複数顧客FAX複製機能」、GOAL.md D2)
 *
 * 複数顧客FAX複製機能により、同一fileId(Gmail添付/アップロード実体への参照)を複数の
 * documentが共有しうるようになった。deleteDocument()のgmailLogs/uploadLogs削除は従来
 * fileId単独ドキュメントIDとして無条件削除しており(Codexセカンドオピニオン指摘#5、
 * storageDeletionGuard.tsのfileUrl共有チェックはIssue #432 PR-Aで先行対応済みだった一方、
 * uploadLogsは見落としだった)、複製の兄弟docが残っている状態で削除すると兄弟doc側の
 * Gmail再取込重複防止チェックが破綻する。storageDeletionGuard.tsのfileUrl共有チェックと
 * 同じ設計(limit(2)判定、hasOtherSharingDocを共用)を(sourceType, fileId)単位で適用する。
 *
 * sourceTypeが未設定(legacy doc)の場合はfileIdのみでの絞り込みにフォールバックする
 * (Firestoreのwhere句にundefinedを渡すと例外になるため)。本機能導入前のdocは常にfileId
 * 単独参照だったため、この場合でも安全性は損なわれない。
 */

import * as admin from 'firebase-admin';
import { hasOtherSharingDoc } from '../storage/storageDeletionGuard';

/**
 * 同一(sourceType, fileId)を参照する他のdocumentが存在するかどうかを判定し、
 * gmailLogs/uploadLogs削除の安全性を返す。
 *
 * race conditionはstorageDeletionGuard.tsのcanSafelyDeleteStorageFileと同様に完全には
 * 防げない(query後の新規共有出現等)。caller はfail-closed(delete skip)で呼び出すこと。
 */
export async function canSafelyDeleteSourceLog(
  db: admin.firestore.Firestore,
  sourceType: string | undefined,
  fileId: string,
  selfDocumentId: string
): Promise<{ canDelete: boolean; sharingDocCountUpTo2: number }> {
  let query: FirebaseFirestore.Query = db.collection('documents').where('fileId', '==', fileId);
  if (typeof sourceType === 'string' && sourceType.length > 0) {
    query = query.where('sourceType', '==', sourceType);
  }

  const sharingQuery = await query.limit(2).get();
  const sharingDocs = sharingQuery.docs.map((d) => ({ id: d.id }));
  const canDelete = !hasOtherSharingDoc(sharingDocs, selfDocumentId);
  return {
    canDelete,
    sharingDocCountUpTo2: sharingQuery.size,
  };
}
