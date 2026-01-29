/**
 * PDFアップロード Cloud Function
 *
 * ローカルファイルからPDF/画像をアップロードしてOCR処理キューに追加
 *
 * 処理フロー:
 * 1. 認証チェック（ホワイトリスト確認）
 * 2. ファイルバリデーション（MIMEタイプ、サイズ）
 * 3. MD5ハッシュで重複チェック
 * 4. Cloud Storage保存
 * 5. uploadLogs + documents (status: pending) 作成
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { sanitizeFilenameForStorage } from '../utils/fileNaming';

const db = admin.firestore();
const storage = admin.storage();

// 設定
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// 対象MIMEタイプ
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/gif',
];

/**
 * PDFアップロード Callable Function
 *
 * リクエスト: {
 *   fileName: string,       // オリジナルファイル名
 *   mimeType: string,       // MIMEタイプ
 *   data: string,           // base64エンコードされたファイルデータ
 * }
 *
 * レスポンス: {
 *   success: true,
 *   documentId: string,     // 作成されたdocumentのID
 * }
 */
export const uploadPdf = onCall(
  {
    region: 'asia-northeast1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (request) => {
    // 1. 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const uid = request.auth.uid;
    const email = request.auth.token.email || '';

    // ホワイトリスト確認
    const userDoc = await db.doc(`users/${uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }

    // 2. リクエストバリデーション
    const { fileName, mimeType, data } = request.data;

    if (!fileName || typeof fileName !== 'string') {
      throw new HttpsError('invalid-argument', 'fileName is required');
    }
    if (!mimeType || typeof mimeType !== 'string') {
      throw new HttpsError('invalid-argument', 'mimeType is required');
    }
    if (!data || typeof data !== 'string') {
      throw new HttpsError('invalid-argument', 'data is required');
    }

    // MIMEタイプチェック
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new HttpsError(
        'invalid-argument',
        `Unsupported file type: ${mimeType}. Allowed types: PDF, JPEG, PNG, TIFF, GIF`
      );
    }

    // 3. base64デコード
    let buffer: Buffer;
    try {
      buffer = Buffer.from(data, 'base64');
    } catch {
      throw new HttpsError('invalid-argument', 'Invalid base64 data');
    }

    // ファイルサイズチェック
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new HttpsError(
        'invalid-argument',
        `File too large: ${Math.round(buffer.length / 1024 / 1024)}MB. Max: ${MAX_FILE_SIZE_MB}MB`
      );
    }

    // 4. MD5ハッシュで重複チェック
    const hash = crypto.createHash('md5').update(buffer).digest('hex');

    // gmailLogsとuploadLogs両方で重複チェック
    const [existingGmail, existingUpload] = await Promise.all([
      db.collection('gmailLogs').where('hash', '==', hash).limit(1).get(),
      db.collection('uploadLogs').where('hash', '==', hash).limit(1).get(),
    ]);

    if (!existingGmail.empty || !existingUpload.empty) {
      throw new HttpsError(
        'already-exists',
        'This file has already been uploaded'
      );
    }

    // 5. Cloud Storageに保存
    const bucket = storage.bucket();
    const storagePath = `original/upload_${Date.now()}_${sanitizeFilenameForStorage(fileName)}`;
    const file = bucket.file(storagePath);
    const fileSizeKB = Math.round(buffer.length / 1024);

    try {
      await file.save(buffer, {
        metadata: {
          contentType: mimeType,
          metadata: {
            originalFilename: fileName,
            uploadedBy: uid,
            uploadedByEmail: email,
            uploadedAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      console.error('Storage save error:', error);
      throw new HttpsError('internal', 'Failed to save file to storage');
    }

    const fileUrl = `gs://${bucket.name}/${storagePath}`;

    // 6. トランザクションで uploadLogs と documents を同時作成
    const uploadLogRef = db.collection('uploadLogs').doc();
    const docRef = db.collection('documents').doc();

    try {
      await db.runTransaction(async (transaction) => {
        // uploadLogsに記録
        transaction.set(uploadLogRef, {
          fileName,
          hash,
          fileSizeKB,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
          uploadedBy: uid,
          uploadedByEmail: email,
          fileUrl,
        });

        // documents（status: pending）を作成
        transaction.set(docRef, {
          id: docRef.id,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          fileId: uploadLogRef.id,
          fileName,
          mimeType,
          ocrResult: '',
          documentType: '',
          customerName: '',
          officeName: '',
          fileUrl,
          fileDate: null,
          isDuplicateCustomer: false,
          totalPages: 0,
          targetPageNumber: 1,
          status: 'pending',
          sourceType: 'upload',
        });
      });
    } catch (error) {
      console.error('Firestore transaction error:', error);
      // Storageのファイルを削除（ロールバック）
      try {
        await file.delete();
      } catch {
        console.error('Failed to delete orphaned file');
      }
      throw new HttpsError('internal', 'Failed to create document records');
    }

    console.log(`Uploaded file: ${fileName} → ${docRef.id}`);

    return {
      success: true,
      documentId: docRef.id,
    };
  }
);
