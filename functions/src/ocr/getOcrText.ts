/**
 * getOcrText Cloud Function
 *
 * 大容量OCR結果（Cloud Storage保存）を取得するCallable Function
 *
 * Phase 7: 処理履歴ビュー・同姓同名解決モーダルで使用
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * OCR全文取得 Callable Function
 *
 * リクエスト: { documentId: string }
 * レスポンス: { text: string }
 */
export const getOcrText = onCall(
  { region: 'asia-northeast1' },
  async (request) => {
    // 1. 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const userDoc = await getFirestore().doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }

    const { documentId } = request.data;
    if (!documentId || typeof documentId !== 'string') {
      throw new HttpsError('invalid-argument', 'documentId is required');
    }

    // 2. ドキュメント取得・存在確認
    const db = getFirestore();
    const docSnap = await db.doc(`documents/${documentId}`).get();
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }

    const data = docSnap.data()!;
    const ocrResultUrl = data.ocrResultUrl as string | undefined;
    const ocrResult = data.ocrResult as string | undefined;

    // 3. ocrResultUrl がない場合は ocrResult を返す
    if (!ocrResultUrl) {
      return { text: ocrResult || '' };
    }

    // 4. Cloud Storage から取得
    const storage = getStorage();
    const bucket = storage.bucket();
    // ocrResultUrl形式: gs://bucket-name/ocr-results/docId.txt
    const filePath = ocrResultUrl.replace(`gs://${bucket.name}/`, '');
    const file = bucket.file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError('not-found', 'OCR file not found in storage');
    }

    const [content] = await file.download();
    return { text: content.toString('utf-8') };
  }
);
