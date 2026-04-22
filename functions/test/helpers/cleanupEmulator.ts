/**
 * Firestore emulator コレクション一括削除ヘルパー (integration test 用)
 *
 * integration test 間のデータ汚染を防ぐ。PR #359 (#196 fix) で rescue が errors/ にも
 * 書き込むようになり、今後 integration test は複数コレクションを掃除する前提になった。
 * 本ヘルパーで可変引数対応することで、将来 summary/ 等を追加する時も import 側のみ更新で済む。
 */

import type * as admin from 'firebase-admin';

/**
 * 指定コレクションの全ドキュメントを batch delete する。
 * 空コレクションは no-op (batch.commit を空で呼ぶと emulator が警告を出すのを避ける)。
 */
export async function cleanupCollections(
  db: admin.firestore.Firestore,
  collectionPaths: readonly string[]
): Promise<void> {
  const snapshots = await Promise.all(
    collectionPaths.map((path) => db.collection(path).get())
  );
  const nonEmpty = snapshots.filter((snap) => !snap.empty);
  if (nonEmpty.length === 0) return;

  const batch = db.batch();
  nonEmpty.forEach((snap) => snap.forEach((doc) => batch.delete(doc.ref)));
  await batch.commit();
}
