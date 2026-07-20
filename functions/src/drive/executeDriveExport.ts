/**
 * Google Drive エクスポート実行の共通ロジック(ADR-0022 Phase 1 Task8)
 *
 * `driveExportStatus`が`claimFromStatus`である時のみトランザクションで`exporting`へ
 * クレームし、`exportDocument()`を実行、成功/失敗を書き戻す。verified検知トリガー
 * (`driveExportTrigger.ts`)・手動リトライ(`retryDriveExport.ts`)・定期リトライ
 * (`driveExportScheduled.ts`)の3箇所から共通で呼び出される。
 *
 * クレームをトランザクション化することで、同一docIdに対する呼び出しが重なっても
 * (例: 手動リトライと定期リトライの同時実行)、`exportDocument()`が二重実行される
 * ことはない(`driveExportTrigger.ts`のTOCTOUレース対策と同じ思想)。
 *
 * クレーム成功時は`randomUUID()`で所有権トークン(`driveExportRunId`)を発行し、
 * `exportDocument()`へ渡す。書戻し(成功時はexportDocument()内、失敗時は本ファイルの
 * catch節)は、書戻し直前に再読込した`driveExportRunId`が自分のrunIdと一致する場合
 * のみ行う。これにより、`driveExportScheduled.ts`が長時間'exporting'のdocを再クレーム
 * し2つの実行が並走した場合でも、後から完了した古い実行が新しい実行の状態を上書き
 * しない(`functions/src/ocr/ocrRunGuard.ts`の`ocrRunId`による所有権検証と同じ思想)。
 *
 * `updatedAt`は`driveExportScheduled.ts`の滞留検出(`exporting`状態の長時間スタック)
 * が参照するため、`exporting`/`error`遷移の両方で必ず書き込む。
 */

import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { exportDocument, ExportDocumentDeps } from './exportDocument';
import type { DriveExportStatus } from '../../../shared/types';

/**
 * @returns クレームに成功し`exportDocument()`を実行した場合true。
 *   現在の`driveExportStatus`が`claimFromStatus`と一致しない(既に他の呼び出しが
 *   処理中/対象外の状態)場合はfalse(何も書き込まない)。
 */
export async function executeDriveExport(
  firestore: admin.firestore.Firestore,
  docId: string,
  exportDeps: Partial<ExportDocumentDeps> = {},
  claimFromStatus: DriveExportStatus | undefined
): Promise<boolean> {
  const docRef = firestore.doc(`documents/${docId}`);
  const runId = randomUUID();

  const claimed = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      return false;
    }
    const currentStatus = snap.data()?.driveExportStatus as DriveExportStatus | undefined;
    if (currentStatus !== claimFromStatus) {
      return false;
    }
    tx.update(docRef, {
      driveExportStatus: 'exporting',
      driveExportRunId: runId,
      driveExportError: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!claimed) {
    return false;
  }

  try {
    await exportDocument(docId, runId, exportDeps);
    // 成功時のdriveFileId/driveExportedAt/driveExportStatus:'exported'書戻しはexportDocument()の責務
    // (所有権チェック付きtransactionで行われる)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Drive export failed for document ${docId}: ${message}`);
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists || snap.data()?.driveExportRunId !== runId) {
        return; // 他の実行に引き継がれている(superseded) → 新しい状態を上書きしない
      }
      tx.update(docRef, {
        driveExportStatus: 'error',
        driveExportError: message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  }

  return true;
}
