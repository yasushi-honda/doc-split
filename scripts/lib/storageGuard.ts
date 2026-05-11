/**
 * Storage path 削除安全性判定 (Issue #432 PR-C migration 用)
 *
 * functions/src/storage/storageDeletionGuard.ts (canSafelyDeleteStorageFile) の
 * scripts 版。Functions 変更ゼロ制約のため独立実装する。
 *
 * Functions 版との API 差:
 *   - Functions 版: 「自分以外」の共有 doc を判定 (limit(2) 単独参照判定)
 *   - 本 scripts 版: 「除外 docIds リスト以外」の共有 doc を判定 (migration で
 *     複数の敗者 doc を一括除外しつつ「他に共有者が居ないか」確認するため)
 *
 * race condition: query 後の新規共有出現は防げない。caller は execute 直前に
 *   再 query するか、precondition snapshot との不一致 reject で対応すること。
 */

import * as admin from 'firebase-admin';

/**
 * 同一 fileUrl を参照する全ての document id を返す。
 *
 * limit を付けない理由: migration では「除外 IDs を全部弾いた後の残存」を
 * 数える必要があり、Functions 版の limit(2) 最適化は使えない。kanameone の
 * 衝突 group 最大が 6 docs であるため、limit なし全件取得でも実用的なコスト。
 */
export async function findDocsReferencingFileUrl(
  db: admin.firestore.Firestore,
  fileUrl: string
): Promise<string[]> {
  const snap = await db
    .collection('documents')
    .where('fileUrl', '==', fileUrl)
    .get();
  return snap.docs.map((d) => d.id);
}

/**
 * pure: 共有 doc id 一覧と除外 id 一覧から削除安全性を判定。
 *
 * - safe=true: 除外 IDs 以外に共有 doc がない (= 削除しても孤児化しない)
 * - safe=false: 残存 (residualDocIds) があり、削除すれば残存 doc を巻き添えに
 *   する。caller は skip + warning で対応。
 *
 * 単体テスト用に async から分離した pure function。Firestore mock 不要。
 */
export function evaluatePathSafety(
  referencingDocIds: readonly string[],
  excludeDocIds: readonly string[]
): { safe: boolean; residualDocIds: string[] } {
  const excludeSet = new Set(excludeDocIds);
  const residualDocIds = referencingDocIds.filter((id) => !excludeSet.has(id));
  return { safe: residualDocIds.length === 0, residualDocIds };
}

/**
 * 同 fileUrl を共有する doc 群から除外 IDs を弾き、残存ゼロ時のみ delete 安全。
 *
 * @param excludeDocIds 削除/更新で fileUrl 参照を外す予定の docIds (敗者 doc 群)
 * @returns safe=true なら delete 実行可、false なら residualDocIds があり skip 必須
 */
export async function isPathSafeToDeleteAfterExcluding(
  db: admin.firestore.Firestore,
  fileUrl: string,
  excludeDocIds: readonly string[]
): Promise<{ safe: boolean; residualDocIds: string[] }> {
  const referencingDocIds = await findDocsReferencingFileUrl(db, fileUrl);
  return evaluatePathSafety(referencingDocIds, excludeDocIds);
}
