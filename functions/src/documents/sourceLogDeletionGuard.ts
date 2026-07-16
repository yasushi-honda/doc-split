/**
 * gmailLogs/uploadLogs delete safety net(kanameone現場要件「複数顧客FAX複製機能」、GOAL.md D2)
 *
 * 複数顧客FAX複製機能により、同一fileId(Gmail添付/アップロード実体への参照)を複数の
 * documentが共有しうるようになった。deleteDocument()のgmailLogs/uploadLogs削除は従来
 * fileId単独ドキュメントIDとして無条件削除しており(Codexセカンドオピニオン指摘#5、
 * storageDeletionGuard.tsのfileUrl共有チェックはIssue #432 PR-Aで先行対応済みだった一方、
 * uploadLogsは見落としだった)、複製の兄弟docが残っている状態で削除すると兄弟doc側の
 * Gmail再取込重複防止チェックが破綻する。storageDeletionGuard.tsのfileUrl共有チェックと
 * 全く同じ設計(limit(2)判定、hasOtherSharingDocを共用)をfileId単位で適用する。
 *
 * CodeRabbit指摘反映: 当初はsourceTypeとの複合キーで絞り込んでいたが、sourceType未設定
 * (legacy doc)の兄弟が同一fileIdを参照する場合に検知漏れとなる欠陥があった。fileIdは
 * それ自体がGmail添付/アップロード実体を一意に指す値であり、storageDeletionGuard.ts
 * (fileUrl単独照合)と同様にsourceTypeでの追加絞り込みは不要かつ安全性を下げるだけの
 * ため撤去し、fileId単独照合に統一する。
 */

import * as admin from 'firebase-admin';
import { hasOtherSharingDoc } from '../storage/storageDeletionGuard';

/**
 * 同一fileIdを参照する他のdocumentが存在するかどうかを判定し、
 * gmailLogs/uploadLogs削除の安全性を返す。
 *
 * race conditionはstorageDeletionGuard.tsのcanSafelyDeleteStorageFileと同様に完全には
 * 防げない(query後の新規共有出現等)。caller はfail-closed(delete skip)で呼び出すこと。
 */
export async function canSafelyDeleteSourceLog(
  db: admin.firestore.Firestore,
  fileId: string,
  selfDocumentId: string
): Promise<{ canDelete: boolean; sharingDocCountUpTo2: number }> {
  const sharingQuery = await db.collection('documents').where('fileId', '==', fileId).limit(2).get();
  const sharingDocs = sharingQuery.docs.map((d) => ({ id: d.id }));
  const canDelete = !hasOtherSharingDoc(sharingDocs, selfDocumentId);
  return {
    canDelete,
    sharingDocCountUpTo2: sharingQuery.size,
  };
}
