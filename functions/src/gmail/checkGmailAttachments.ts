/**
 * Gmail添付ファイル取得 Cloud Function
 *
 * トリガー: Cloud Scheduler（5分間隔）
 *
 * 処理フロー:
 * 1. Gmail API → ラベル指定でメール検索（過去10分）
 * 2. Firestore gmailLogs → MD5ハッシュで重複チェック
 * 3. 新規ファイルのみ → Cloud Storage原本保存
 * 4. Firestore → gmailLogs記録
 * 5. Firestore → documents（status: pending）作成
 * 6. Pub/Sub → OCR処理をトリガー
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import * as crypto from 'crypto';

const db = admin.firestore();
const storage = admin.storage();

// 設定
const SEARCH_MINUTES = 10; // 過去何分のメールを検索するか

export const checkGmailAttachments = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: 'asia-northeast1',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    console.log('Starting Gmail attachment check...');

    try {
      // 設定を取得
      const settingsDoc = await db.doc('settings/app').get();
      if (!settingsDoc.exists) {
        console.log('No settings found, skipping...');
        return;
      }

      const settings = settingsDoc.data();
      const targetLabels = settings?.targetLabels || [];
      const gmailAccount = settings?.gmailAccount;

      if (!gmailAccount || targetLabels.length === 0) {
        console.log('Gmail account or labels not configured, skipping...');
        return;
      }

      // Gmail API認証（Service Account + Domain-wide Delegation）
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      });

      const gmail = google.gmail({ version: 'v1', auth });

      // 過去10分のメールを検索
      const query = buildSearchQuery(targetLabels, SEARCH_MINUTES);
      console.log('Search query:', query);

      const response = await gmail.users.messages.list({
        userId: gmailAccount,
        q: query,
        maxResults: 50,
      });

      const messages = response.data.messages || [];
      console.log(`Found ${messages.length} messages`);

      for (const message of messages) {
        if (!message.id) continue;

        try {
          await processMessage(gmail, gmailAccount, message.id);
        } catch (error) {
          console.error(`Error processing message ${message.id}:`, error);
        }
      }

      console.log('Gmail attachment check completed');
    } catch (error) {
      console.error('Error in checkGmailAttachments:', error);
      throw error;
    }
  }
);

/**
 * Gmail検索クエリを構築
 */
function buildSearchQuery(labels: string[], minutes: number): string {
  const now = new Date();
  const past = new Date(now.getTime() - minutes * 60 * 1000);
  const afterDate = past.toISOString().split('T')[0];

  const labelQuery = labels.map((l: string) => `label:${l}`).join(' OR ');
  return `(${labelQuery}) has:attachment after:${afterDate}`;
}

/**
 * メッセージを処理して添付ファイルを保存
 */
async function processMessage(
  gmail: ReturnType<typeof google.gmail>,
  userId: string,
  messageId: string
): Promise<void> {
  const message = await gmail.users.messages.get({
    userId,
    id: messageId,
    format: 'full',
  });

  const payload = message.data.payload;
  if (!payload?.parts) return;

  const subject = getHeader(payload.headers || [], 'Subject') || 'No Subject';

  for (const part of payload.parts) {
    if (!part.filename || !part.body?.attachmentId) continue;

    // PDF/画像ファイルのみ処理
    const mimeType = part.mimeType || '';
    if (!isTargetMimeType(mimeType)) continue;

    // 添付ファイル取得
    const attachment = await gmail.users.messages.attachments.get({
      userId,
      messageId,
      id: part.body.attachmentId,
    });

    const data = attachment.data.data;
    if (!data) continue;

    const buffer = Buffer.from(data, 'base64');
    const hash = crypto.createHash('md5').update(buffer).digest('hex');

    // 重複チェック
    const existingLog = await db
      .collection('gmailLogs')
      .where('hash', '==', hash)
      .limit(1)
      .get();

    if (!existingLog.empty) {
      console.log(`Skipping duplicate file: ${part.filename}`);
      continue;
    }

    // Cloud Storageに保存
    const bucket = storage.bucket();
    const fileName = `original/${Date.now()}_${part.filename}`;
    const file = bucket.file(fileName);

    await file.save(buffer, {
      metadata: {
        contentType: mimeType,
      },
    });

    const fileUrl = `gs://${bucket.name}/${fileName}`;

    // gmailLogsに記録
    const logRef = db.collection('gmailLogs').doc();
    await logRef.set({
      fileName: part.filename,
      hash,
      fileSizeKB: Math.round(buffer.length / 1024),
      emailSubject: subject,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      fileUrl,
      emailBody: '', // 必要に応じて本文も保存
    });

    // documents（status: pending）を作成
    const docRef = db.collection('documents').doc();
    await docRef.set({
      id: docRef.id,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      fileId: logRef.id,
      fileName: part.filename,
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
    });

    console.log(`Saved attachment: ${part.filename}`);
  }
}

/**
 * ヘッダーから値を取得
 */
function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string
): string | undefined {
  const header = headers.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? undefined;
}

/**
 * 対象のMIMEタイプかチェック
 */
function isTargetMimeType(mimeType: string): boolean {
  const targets = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/gif',
  ];
  return targets.includes(mimeType);
}
