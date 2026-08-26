/**
 * Issue #811 Phase B: documentCategoryセグメントの解決を`functions/src/drive/exportDocument.ts`
 * (本番のDriveエクスポート経路)と完全に同一のロジックで行う共有ヘルパー(codex review P1指摘対応)。
 *
 * classify-drive-folder-duplicates.ts / execute-drive-folder-merge.tsの両方が、
 * `documents.category`(OCR実行時点のmastersスナップショット、書類詳細画面でdocumentTypeのみ
 * 手動訂正されても追従更新されない)をそのまま使うと、export実行時点の実際の配置先と
 * ズレた古いカテゴリでフォルダパスを解決してしまう。`masters/documents/items`を
 * documentType名で都度引く必要がある。
 */

import type * as admin from 'firebase-admin';

const MASTER_PATHS_DOCUMENTS = 'masters/documents/items';

/**
 * `exportDocument.ts`と同一ロジック: masters/documents/itemsをdocumentType名で引き、
 * `.category`(trim済み・非空)があればそれを、無ければdocumentTypeへフォールバックする。
 */
export async function resolveExportCategory(
  db: admin.firestore.Firestore,
  documentType: string
): Promise<string> {
  if (!documentType) return documentType;
  const snap = await db
    .collection(MASTER_PATHS_DOCUMENTS)
    .where('name', '==', documentType)
    .limit(1)
    .get();
  const masterCategory = snap.empty ? undefined : (snap.docs[0].data() as { category?: string }).category;
  const resolved = masterCategory?.trim() || undefined;
  return resolved || documentType;
}
