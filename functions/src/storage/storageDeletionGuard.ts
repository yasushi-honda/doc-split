/**
 * Storage delete safety net (Issue #432 PR-A)
 *
 * 同一 fileUrl を複数 document が共有している場合、
 * rotatePdfPages / deleteDocument での Storage file delete が
 * 他 document の実体を巻き添え破壊する設計バグへの暫定対策。
 *
 * 構造修正 (Issue #432 PR-B: docId namespace 化) 完了後も、
 * 既存旧 path doc 保護のため恒久的に有効な safety net として残す。
 */

import * as admin from 'firebase-admin';

/**
 * 同一 fileUrl を参照する他の document が存在するかを判定。
 *
 * @param sharingDocs Firestore query 結果の document リスト (id のみ必要)
 * @param selfDocumentId 自分自身の documentId
 * @returns true なら他 doc と共有されており delete 危険、false なら単独参照で delete 安全
 */
export function hasOtherSharingDoc(
  sharingDocs: Array<{ id: string }>,
  selfDocumentId: string
): boolean {
  if (sharingDocs.length >= 2) return true;
  if (sharingDocs.length === 1 && sharingDocs[0].id !== selfDocumentId) return true;
  return false;
}

/**
 * Firestore で同 fileUrl を共有する document を limit(2) で検索し、
 * Storage file delete の安全性を判定する。
 *
 * limit(2) は「自分自身 + 他 1 件」を検出すれば十分のため軽量。
 * race condition は完全には防げない (query 後に別 doc 追加の可能性あり) が、
 * Issue #432 P0 の即応 safety net として実用十分。
 */
export async function canSafelyDeleteStorageFile(
  db: admin.firestore.Firestore,
  fileUrl: string,
  selfDocumentId: string
): Promise<{ canDelete: boolean; sharingDocCount: number }> {
  const sharingQuery = await db
    .collection('documents')
    .where('fileUrl', '==', fileUrl)
    .limit(2)
    .get();
  const sharingDocs = sharingQuery.docs.map((d) => ({ id: d.id }));
  const canDelete = !hasOtherSharingDoc(sharingDocs, selfDocumentId);
  return {
    canDelete,
    sharingDocCount: sharingQuery.size,
  };
}
