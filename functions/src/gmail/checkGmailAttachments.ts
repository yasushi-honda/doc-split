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
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { gmail_v1 } from 'googleapis';
import * as crypto from 'crypto';
import { getGmailClient } from '../utils/gmailAuth';
import { withRetry, RETRY_CONFIGS } from '../utils/retry';
import { logError } from '../utils/errorLogger';

const db = admin.firestore();
const storage = admin.storage();

// 設定
const SEARCH_MINUTES = 10; // 過去何分のメールを検索するか
const FUNCTION_NAME = 'checkGmailAttachments';

/** 処理統計 */
interface ProcessingStats {
  messagesFound: number;
  attachmentsProcessed: number;
  duplicatesSkipped: number;
  errors: number;
}

export const checkGmailAttachments = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: 'asia-northeast1',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    console.log('Starting Gmail attachment check...');
    const stats: ProcessingStats = {
      messagesFound: 0,
      attachmentsProcessed: 0,
      duplicatesSkipped: 0,
      errors: 0,
    };

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

      // Gmail APIクライアント取得（認証方式自動切替）
      const gmail = await withRetry(
        () => getGmailClient(),
        RETRY_CONFIGS.gmail
      );

      // 過去10分のメールを検索
      const query = buildSearchQuery(targetLabels, SEARCH_MINUTES);
      console.log('Search query:', query);

      const response = await withRetry(
        () =>
          gmail.users.messages.list({
            userId: gmailAccount,
            q: query,
            maxResults: 50,
          }),
        RETRY_CONFIGS.gmail
      );

      const messages = response.data.messages || [];
      stats.messagesFound = messages.length;
      console.log(`Found ${messages.length} messages`);

      // 各メッセージを処理
      for (const message of messages) {
        if (!message.id) continue;

        try {
          const result = await processMessage(gmail, gmailAccount, message.id);
          stats.attachmentsProcessed += result.processed;
          stats.duplicatesSkipped += result.skipped;
        } catch (error) {
          stats.errors++;
          const err = error instanceof Error ? error : new Error(String(error));
          console.error(`Error processing message ${message.id}:`, err.message);

          await logError({
            error: err,
            source: 'gmail',
            functionName: FUNCTION_NAME,
          });
        }
      }

      console.log('Gmail attachment check completed', stats);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Fatal error in checkGmailAttachments:', err.message);

      await logError({
        error: err,
        source: 'gmail',
        functionName: FUNCTION_NAME,
      });

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
  gmail: gmail_v1.Gmail,
  userId: string,
  messageId: string
): Promise<{ processed: number; skipped: number }> {
  let processed = 0;
  let skipped = 0;

  const message = await withRetry(
    () =>
      gmail.users.messages.get({
        userId,
        id: messageId,
        format: 'full',
      }),
    RETRY_CONFIGS.gmail
  );

  const payload = message.data.payload;
  if (!payload) return { processed, skipped };

  const subject = getHeader(payload.headers || [], 'Subject') || 'No Subject';
  const emailBody = message.data.snippet || '';

  // 添付ファイルを再帰的に処理（マルチパート対応）
  const parts = getAllParts(payload);

  for (const part of parts) {
    if (!part.filename || !part.body?.attachmentId) continue;

    // PDF/画像ファイルのみ処理
    const mimeType = part.mimeType || '';
    if (!isTargetMimeType(mimeType)) continue;

    try {
      const result = await processAttachment(
        gmail,
        userId,
        messageId,
        part,
        subject,
        emailBody
      );

      if (result === 'processed') {
        processed++;
      } else if (result === 'skipped') {
        skipped++;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`Error processing attachment ${part.filename}:`, err.message);

      await logError({
        error: err,
        source: 'gmail',
        functionName: FUNCTION_NAME,
        fileId: part.body?.attachmentId,
      });
    }
  }

  return { processed, skipped };
}

/**
 * 添付ファイルを処理
 */
async function processAttachment(
  gmail: gmail_v1.Gmail,
  userId: string,
  messageId: string,
  part: gmail_v1.Schema$MessagePart,
  subject: string,
  emailBody: string
): Promise<'processed' | 'skipped' | 'error'> {
  const attachmentId = part.body?.attachmentId;
  const filename = part.filename || 'unknown';
  const mimeType = part.mimeType || 'application/octet-stream';

  if (!attachmentId) return 'error';

  // 添付ファイル取得
  const attachment = await withRetry(
    () =>
      gmail.users.messages.attachments.get({
        userId,
        messageId,
        id: attachmentId,
      }),
    RETRY_CONFIGS.gmail
  );

  const data = attachment.data.data;
  if (!data) return 'error';

  const buffer = Buffer.from(data, 'base64');

  // ファイルサイズチェック（10MB上限）
  const fileSizeKB = Math.round(buffer.length / 1024);
  if (fileSizeKB > 10240) {
    console.log(`Skipping large file: ${filename} (${fileSizeKB}KB)`);
    return 'skipped';
  }

  // MD5ハッシュで重複チェック
  const hash = crypto.createHash('md5').update(buffer).digest('hex');

  const existingLog = await db
    .collection('gmailLogs')
    .where('hash', '==', hash)
    .limit(1)
    .get();

  if (!existingLog.empty) {
    console.log(`Skipping duplicate file: ${filename}`);
    return 'skipped';
  }

  // Cloud Storageに保存
  const bucket = storage.bucket();
  const storagePath = `original/${Date.now()}_${sanitizeFilename(filename)}`;
  const file = bucket.file(storagePath);

  await withRetry(
    () =>
      file.save(buffer, {
        metadata: {
          contentType: mimeType,
          metadata: {
            originalFilename: filename,
            emailSubject: subject,
            uploadedAt: new Date().toISOString(),
          },
        },
      }),
    RETRY_CONFIGS.storage
  );

  const fileUrl = `gs://${bucket.name}/${storagePath}`;

  // トランザクションで gmailLogs と documents を同時作成
  const logRef = db.collection('gmailLogs').doc();
  const docRef = db.collection('documents').doc();

  await db.runTransaction(async (transaction) => {
    // gmailLogsに記録
    transaction.set(logRef, {
      fileName: filename,
      hash,
      fileSizeKB,
      emailSubject: subject,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      fileUrl,
      emailBody,
    });

    // documents（status: pending）を作成
    transaction.set(docRef, {
      id: docRef.id,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      fileId: logRef.id,
      fileName: filename,
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
  });

  console.log(`Saved attachment: ${filename} → ${docRef.id}`);
  return 'processed';
}

/**
 * マルチパートメッセージから全てのパートを再帰的に取得
 */
function getAllParts(payload: gmail_v1.Schema$MessagePart): gmail_v1.Schema$MessagePart[] {
  const parts: gmail_v1.Schema$MessagePart[] = [];

  if (payload.filename && payload.body?.attachmentId) {
    parts.push(payload);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      parts.push(...getAllParts(part));
    }
  }

  return parts;
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

/**
 * ファイル名をサニタイズ
 */
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 200); // 長すぎるファイル名を切り詰め
}
