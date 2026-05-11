/**
 * Storage delete safety net (Issue #432 PR-A)
 *
 * 同一 fileUrl を複数 document が共有している場合、
 * rotatePdfPages / deleteDocument での Storage file delete が
 * 他 document の実体を巻き添え破壊する設計バグへの暫定対策。
 *
 * 旧 path (docId namespace 化前に作成された document) が 1 件でも残る限り有効。
 * Issue #432 PR-B (docId namespace 化) + 全 backfill 完了 + 旧 path 削除確認後に
 * 再評価可。
 *
 * 適用範囲: 後発的な delete (rotatePdfPages 旧 file 削除 / deleteDocument)。
 * upload-rollback (uploadPdf.ts:243) は新規 upload 直後で他 doc が参照しえないため
 * 意図的に対象外。
 */

import * as admin from 'firebase-admin';

/**
 * 同一 fileUrl を参照する他の document が存在するかを判定。
 *
 * @param sharingDocs 同 fileUrl を共有する document の id 配列 (limit(2) で取得済を想定)
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
 * limit(2) は次の両ケースを最小コストで判定するための採用:
 *   (a) 「自分自身 + 他 1 件」 → delete 不可
 *   (b) 「他 2 件 (= 自分が窓外、3+ 件共有時に該当)」 → 保守的に delete 不可
 * count() 集計より目的に合致しコストも軽量。
 *
 * race condition は完全には防げない。本 safety net がカバーしない代表例:
 *   - query 後に別 doc が同 fileUrl で追加される (新規共有出現)
 *   - 逆方向の race: concurrent rotate で両者が単独所有と判定 → 両方 delete 走行
 *   後者は PR-B の docId namespace 化で根絶されるため、本 safety net は
 *   既存共有資産の保護を主目的とする。
 *
 * 例外時の扱い: 本関数は throw する。caller は fail-closed (delete を skip) で
 *   呼び出すこと。silent-failure 防止のため caller 側で try/catch + 構造化ログ必須。
 */
export async function canSafelyDeleteStorageFile(
  db: admin.firestore.Firestore,
  fileUrl: string,
  selfDocumentId: string
): Promise<{ canDelete: boolean; sharingDocCountUpTo2: number }> {
  const sharingQuery = await db
    .collection('documents')
    .where('fileUrl', '==', fileUrl)
    .limit(2)
    .get();
  const sharingDocs = sharingQuery.docs.map((d) => ({ id: d.id }));
  const canDelete = !hasOtherSharingDoc(sharingDocs, selfDocumentId);
  return {
    canDelete,
    sharingDocCountUpTo2: sharingQuery.size,
  };
}
