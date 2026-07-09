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
import { resolveDetailFields, readDocWithDetail } from './documentDetail';

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
    // ADR-0018 Phase D (#5): 親 + detail/main の transactional paired-read
    // (不整合な組合せ防止の根拠は readDocWithDetail の doc comment 参照)。
    // fieldMask で pageResults 等の重量フィールドの転送を抑止
    const db = getFirestore();
    const docRef = db.doc(`documents/${documentId}`);
    const [docSnap, detailSnap] = await readDocWithDetail(db, docRef, [
      'ocrResult',
      'ocrResultUrl',
    ]);
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }

    const data = docSnap.data()!;
    const ocrResultUrl = data.ocrResultUrl as string | undefined; // offload判定は親から維持
    const { ocrResult } = resolveDetailFields(detailSnap.data(), data);

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
