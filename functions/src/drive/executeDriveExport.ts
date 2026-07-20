/**
 * Google Drive エクスポート実行の共通ロジック(ADR-0022 Phase 1 Task8)
 *
 * `driveExportStatus`が`claimFromStatuses`(既定`['pending']`)のいずれかである時のみ
 * トランザクションで`exporting`へクレームし、`exportDocument()`を実行、成功/失敗を
 * 書き戻す。verified検知トリガー(`driveExportTrigger.ts`)・手動リトライ
 * (`retryDriveExport.ts`)・定期リトライ(`driveExportScheduled.ts`)の3箇所から
 * 共通で呼び出される。
 *
 * クレームをトランザクション化することで、同一docIdに対する呼び出しが重なっても
 * (例: 手動リトライと定期リトライの同時実行)、`exportDocument()`が二重実行される
 * ことはない(`driveExportTrigger.ts`のTOCTOUレース対策と同じ思想)。
 *
 * `updatedAt`は`driveExportScheduled.ts`の滞留検出(`exporting`状態の長時間スタック)
 * が参照するため、`exporting`/`error`遷移の両方で必ず書き込む。
 */

import * as admin from 'firebase-admin';
import { exportDocument, ExportDocumentDeps } from './exportDocument';
import type { DriveExportStatus } from '../../../shared/types';

/**
 * @returns クレームに成功し`exportDocument()`を実行した場合true。
 *   現在の`driveExportStatus`が`claimFromStatuses`に含まれない(既に他の呼び出しが
 *   処理中/対象外の状態)場合はfalse(何も書き込まない)。
 */
export async function executeDriveExport(
  firestore: admin.firestore.Firestore,
  docId: string,
  exportDeps: Partial<ExportDocumentDeps> = {},
  claimFromStatuses: DriveExportStatus[] = ['pending']
): Promise<boolean> {
  const docRef = firestore.doc(`documents/${docId}`);

  const claimed = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      return false;
    }
    const currentStatus = snap.data()?.driveExportStatus as DriveExportStatus | undefined;
    if (!currentStatus || !claimFromStatuses.includes(currentStatus)) {
      return false;
    }
    tx.update(docRef, {
      driveExportStatus: 'exporting',
      driveExportError: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!claimed) {
    return false;
  }

  try {
    await exportDocument(docId, exportDeps);
    // 成功時のdriveFileId/driveExportedAt/driveExportStatus:'exported'書戻しはexportDocument()の責務
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Drive export failed for document ${docId}: ${message}`);
    await docRef.update({
      driveExportStatus: 'error',
      driveExportError: message,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return true;
}
