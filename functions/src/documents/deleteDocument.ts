/**
 * ドキュメント削除 Cloud Function
 *
 * 管理者のみがドキュメントを完全削除可能
 *
 * 処理フロー:
 * 1. 認証チェック（管理者のみ）
 * 2. documentId検証
 * 3. Cloud Storage ファイル削除
 * 4. gmailLogs または uploadLogs 削除（sourceType判定）
 * 5. documents 削除
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();
const storage = admin.storage();

/**
 * ドキュメント削除 Callable Function
 *
 * リクエスト: {
 *   documentId: string,  // 削除対象のドキュメントID
 * }
 *
 * レスポンス: {
 *   success: true,
 * }
 */
export const deleteDocument = onCall(
  {
    region: 'asia-northeast1',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    // 1. 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const uid = request.auth.uid;

    // 管理者チェック
    const userDoc = await db.doc(`users/${uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }

    const userData = userDoc.data();
    if (userData?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin permission required');
    }

    // 2. リクエストバリデーション
    const { documentId } = request.data;

    if (!documentId || typeof documentId !== 'string') {
      throw new HttpsError('invalid-argument', 'documentId is required');
    }

    // 3. ドキュメント取得
    const docRef = db.collection('documents').doc(documentId);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }

    const docData = docSnapshot.data()!;
    const { fileUrl, fileId, sourceType } = docData;

    const errors: string[] = [];

    // 4. Cloud Storage ファイル削除
    if (fileUrl && typeof fileUrl === 'string') {
      try {
        // gs://bucket-name/path/to/file 形式からパスを抽出
        const match = fileUrl.match(/^gs:\/\/([^/]+)\/(.+)$/);
        if (match) {
          const bucketName = match[1];
          const filePath = match[2];
          const bucket = storage.bucket(bucketName);
          const file = bucket.file(filePath);

          const [exists] = await file.exists();
          if (exists) {
            await file.delete();
            console.log(`Deleted storage file: ${filePath}`);
          } else {
            console.log(`Storage file not found (already deleted?): ${filePath}`);
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Failed to delete storage file:', errMsg);
        errors.push(`Storage deletion failed: ${errMsg}`);
      }
    }

    // 5. gmailLogs または uploadLogs 削除
    if (fileId && typeof fileId === 'string') {
      try {
        const logCollection = sourceType === 'upload' ? 'uploadLogs' : 'gmailLogs';
        const logRef = db.collection(logCollection).doc(fileId);
        const logSnapshot = await logRef.get();

        if (logSnapshot.exists) {
          await logRef.delete();
          console.log(`Deleted ${logCollection}/${fileId}`);
        } else {
          console.log(`Log not found (already deleted?): ${logCollection}/${fileId}`);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Failed to delete log:', errMsg);
        errors.push(`Log deletion failed: ${errMsg}`);
      }
    }

    // 6. documents 削除
    try {
      await docRef.delete();
      console.log(`Deleted document: ${documentId}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Failed to delete document:', errMsg);
      throw new HttpsError('internal', `Failed to delete document: ${errMsg}`);
    }

    // 部分的なエラーがあっても、ドキュメント自体は削除成功とする
    if (errors.length > 0) {
      console.warn('Deletion completed with warnings:', errors);
    }

    return {
      success: true,
      warnings: errors.length > 0 ? errors : undefined,
    };
  }
);
