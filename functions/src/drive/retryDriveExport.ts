/**
 * Google Drive エクスポート 手動リトライ Callable Function(ADR-0022 Phase 1 Task8)
 *
 * エラー一覧UI(Task13で実装予定)の「リトライ」ボタンから呼ばれる。FE直接updateDocは
 * 使わず、Admin SDK専有の原則(ADR-0022 Decision 6)を保つためCallable経由に限定する。
 *
 * `driveExportStatus==='error'`のdocのみリトライ対象とする。`executeDriveExport.ts`
 * (トリガー・定期リトライと共有)でexporting→exported/errorへ遷移させ、UIへの即時
 * フィードバック用に最終状態を返す。
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { isDriveExportEnabled } from '../utils/featureFlags';
import { executeDriveExport } from './executeDriveExport';
import type { ExportDocumentDeps } from './exportDocument';
import type { DriveExportStatus } from '../../../shared/types';

const db = admin.firestore();

/**
 * `retryDriveExportCore`がリトライ対象外と判定した際にthrowするマーカーエラー。
 * onCallラッパーがこれを捕捉し`failed-precondition`へ変換する。
 */
export class DriveExportNotRetryableError extends Error {
  constructor(docId: string) {
    super(`document ${docId} is not in a retryable (error) state, or does not exist`);
    this.name = 'DriveExportNotRetryableError';
  }
}

export interface RetryDriveExportResult {
  success: boolean;
  status?: DriveExportStatus;
  error: string | null;
}

/**
 * リトライ本体ロジック(admin権限チェック・onCall配管から独立、テスト容易性のため
 * `processDriveExportTrigger`と同型パターン)。
 */
export async function retryDriveExportCore(
  firestore: admin.firestore.Firestore,
  docId: string,
  exportDeps: Partial<ExportDocumentDeps> = {}
): Promise<RetryDriveExportResult> {
  const claimed = await executeDriveExport(firestore, docId, exportDeps, ['error']);
  if (!claimed) {
    throw new DriveExportNotRetryableError(docId);
  }

  const finalSnap = await firestore.doc(`documents/${docId}`).get();
  const finalData = finalSnap.data();
  return {
    success: finalData?.driveExportStatus === 'exported',
    status: finalData?.driveExportStatus as DriveExportStatus | undefined,
    error: (finalData?.driveExportError as string | undefined) ?? null,
  };
}

export const retryDriveExport = onCall(
  { region: 'asia-northeast1', timeoutSeconds: 120 },
  async (request): Promise<RetryDriveExportResult> => {
    // 1. 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    // 2. admin権限チェック
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }
    if (userDoc.data()?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin permission required');
    }

    // 3. パラメータ検証
    const { docId } = request.data as { docId?: string };
    if (!docId || typeof docId !== 'string' || !docId.trim()) {
      throw new HttpsError('invalid-argument', 'docId is required');
    }

    // 4. Feature Flag確認(OFF時はDrive API呼び出しを起動させない、fail-closed)
    if (!(await isDriveExportEnabled(db))) {
      throw new HttpsError('failed-precondition', 'Google Drive連携機能が無効です');
    }

    try {
      return await retryDriveExportCore(db, docId);
    } catch (error) {
      if (error instanceof DriveExportNotRetryableError) {
        throw new HttpsError(
          'failed-precondition',
          'リトライ対象外です(ドキュメントが存在しないか、エラー状態ではありません)'
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpsError('internal', `リトライに失敗しました: ${message}`);
    }
  }
);
