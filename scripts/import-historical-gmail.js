#!/usr/bin/env node
/**
 * Gmail過去受信分 巻取りスクリプト
 *
 * 指定期間のGmailから添付PDFを取得し、正規スキーマでFirestoreに登録
 *
 * 使用方法:
 *   node import-historical-gmail.js <project-id> --after YYYY-MM-DD --before YYYY-MM-DD [--dry-run]
 *
 * 例:
 *   node import-historical-gmail.js docsplit-kanameone --after 2026-01-01 --before 2026-01-20
 *   node import-historical-gmail.js docsplit-kanameone --after 2026-01-01 --before 2026-01-20 --dry-run
 *
 * 注意: Firebase Storageへの書き込みでエラーが発生する場合、サービスアカウントキーを使用してください:
 *
 *   # 1. firebase-adminsdkサービスアカウントのキーを作成
 *   gcloud iam service-accounts keys create /tmp/sa-key.json \
 *     --iam-account=firebase-adminsdk-fbsvc@<project-id>.iam.gserviceaccount.com \
 *     --project=<project-id>
 *
 *   # 2. Secret Managerアクセス権を付与（初回のみ）
 *   for secret in gmail-oauth-client-id gmail-oauth-client-secret gmail-oauth-refresh-token; do
 *     gcloud secrets add-iam-policy-binding $secret \
 *       --project=<project-id> \
 *       --member="serviceAccount:firebase-adminsdk-fbsvc@<project-id>.iam.gserviceaccount.com" \
 *       --role="roles/secretmanager.secretAccessor" --quiet
 *   done
 *
 *   # 3. キーを使用して実行
 *   GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa-key.json node import-historical-gmail.js <project-id> ...
 *
 *   # 4. 終了後、キーを削除（セキュリティのため）
 *   rm /tmp/sa-key.json
 */

const admin = require('firebase-admin');
const { google } = require('googleapis');
const crypto = require('crypto');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// 引数パース
const args = process.argv.slice(2);
const projectId = args[0];
const afterIndex = args.indexOf('--after');
const beforeIndex = args.indexOf('--before');
const dryRun = args.includes('--dry-run');

if (!projectId || afterIndex === -1 || beforeIndex === -1) {
  console.error('Usage: node import-historical-gmail.js <project-id> --after YYYY-MM-DD --before YYYY-MM-DD [--dry-run]');
  console.error('');
  console.error('Example:');
  console.error('  node import-historical-gmail.js docsplit-kanameone --after 2026-01-01 --before 2026-01-20');
  process.exit(1);
}

const afterDate = args[afterIndex + 1];
const beforeDate = args[beforeIndex + 1];

// 日付フォーマット検証
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
if (!dateRegex.test(afterDate) || !dateRegex.test(beforeDate)) {
  console.error('Error: 日付はYYYY-MM-DD形式で指定してください');
  process.exit(1);
}

if (!process.env.STORAGE_BUCKET) {
  console.error('Error: STORAGE_BUCKET 環境変数が必要です');
  console.error('Example: STORAGE_BUCKET=docsplit-kanameone.firebasestorage.app node import-historical-gmail.js ...');
  process.exit(1);
}

// 環境設定
process.env.GOOGLE_CLOUD_PROJECT = projectId;

admin.initializeApp({
  projectId: projectId,
  storageBucket: process.env.STORAGE_BUCKET
});

const db = admin.firestore();
const storage = admin.storage();

// 統計
const stats = {
  messagesFound: 0,
  attachmentsProcessed: 0,
  duplicatesSkipped: 0,
  errors: 0
};

/**
 * Secret Managerから値を取得
 */
async function getSecret(secretName) {
  const client = new SecretManagerServiceClient();
  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
  const [version] = await client.accessSecretVersion({ name });
  return version.payload.data.toString();
}

/**
 * Gmail APIクライアントを取得（OAuth方式）
 */
async function getGmailClient() {
  console.log('Gmail認証を取得中...');

  const clientId = await getSecret('gmail-oauth-client-id');
  const clientSecret = await getSecret('gmail-oauth-client-secret');
  const refreshToken = await getSecret('gmail-oauth-refresh-token');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * 検索クエリを構築
 */
function buildSearchQuery(labels, afterDate, beforeDate) {
  const labelQuery = labels.map(l => `label:${l}`).join(' OR ');
  return `(${labelQuery}) has:attachment after:${afterDate} before:${beforeDate}`;
}

/**
 * 対象のMIMEタイプかチェック
 */
function isTargetMimeType(mimeType) {
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
function sanitizeFilename(filename) {
  return filename
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 200);
}

/**
 * マルチパートメッセージから全てのパートを再帰的に取得
 */
function getAllParts(payload) {
  const parts = [];

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
function getHeader(headers, name) {
  const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value;
}

/**
 * 添付ファイルを処理
 */
async function processAttachment(gmail, userId, messageId, part, subject, emailBody) {
  const attachmentId = part.body?.attachmentId;
  const filename = part.filename || 'unknown';
  const mimeType = part.mimeType || 'application/octet-stream';

  if (!attachmentId) return 'error';

  // 添付ファイル取得
  const attachment = await gmail.users.messages.attachments.get({
    userId,
    messageId,
    id: attachmentId,
  });

  const data = attachment.data.data;
  if (!data) return 'error';

  const buffer = Buffer.from(data, 'base64');

  // ファイルサイズチェック（10MB上限）
  const fileSizeKB = Math.round(buffer.length / 1024);
  if (fileSizeKB > 10240) {
    console.log(`  ⏭️ スキップ（ファイルサイズ超過）: ${filename} (${fileSizeKB}KB)`);
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
    console.log(`  ⏭️ スキップ（重複）: ${filename}`);
    return 'skipped';
  }

  if (dryRun) {
    console.log(`  📄 [DRY-RUN] 処理対象: ${filename} (${fileSizeKB}KB)`);
    return 'processed';
  }

  // Cloud Storageに保存
  const bucket = storage.bucket();
  const storagePath = `original/${Date.now()}_${sanitizeFilename(filename)}`;
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: {
      contentType: mimeType,
      metadata: {
        originalFilename: filename,
        emailSubject: subject,
        uploadedAt: new Date().toISOString(),
        source: 'historical-import'
      },
    },
  });

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
      source: 'historical-import'
    });

    // 正規スキーマでdocumentsを作成
    transaction.set(docRef, {
      id: docRef.id,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      fileId: logRef.id,
      fileName: filename,               // 正規フィールド名
      mimeType,
      ocrResult: '',
      documentType: '',
      customerName: '',
      officeName: '',
      fileUrl,                          // 正規フィールド名
      fileDate: null,
      isDuplicateCustomer: false,
      totalPages: 0,                    // 正規フィールド名
      targetPageNumber: 1,
      status: 'pending',
      source: 'historical-import',
      // グループキー（初期値）
      customerKey: '',
      officeKey: '',
      documentTypeKey: '',
      careManagerKey: '',
      // 顧客・事業所確定フラグ
      customerConfirmed: false,
      customerCandidates: [],
      officeConfirmed: false,
      officeCandidates: []
    });
  });

  console.log(`  ✅ 保存完了: ${filename} → ${docRef.id}`);
  return 'processed';
}

/**
 * メッセージを処理して添付ファイルを保存
 */
async function processMessage(gmail, userId, messageId) {
  let processed = 0;
  let skipped = 0;

  const message = await gmail.users.messages.get({
    userId,
    id: messageId,
    format: 'full',
  });

  const payload = message.data.payload;
  if (!payload) return { processed, skipped };

  const headers = payload.headers || [];
  const subject = getHeader(headers, 'Subject') || 'No Subject';
  const emailBody = message.data.snippet || '';

  console.log(`📧 メール: ${subject}`);

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
      console.error(`  ❌ エラー: ${part.filename}`, error.message);
      stats.errors++;
    }
  }

  return { processed, skipped };
}

/**
 * メイン処理
 */
async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   Gmail過去受信分 巻取りインポート          ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
  console.log(`Project:  ${projectId}`);
  console.log(`期間:     ${afterDate} 〜 ${beforeDate}`);
  console.log(`Dry Run:  ${dryRun}`);
  console.log('');

  // 設定を取得
  const settingsDoc = await db.doc('settings/app').get();
  if (!settingsDoc.exists) {
    console.error('Error: 設定（settings/app）が見つかりません');
    console.error('先にアプリで設定を保存してください');
    process.exit(1);
  }

  const settings = settingsDoc.data();
  const targetLabels = settings?.targetLabels || [];
  const gmailAccount = settings?.gmailAccount;

  if (!gmailAccount || targetLabels.length === 0) {
    console.error('Error: Gmail設定が不完全です');
    console.error(`  gmailAccount: ${gmailAccount || '未設定'}`);
    console.error(`  targetLabels: ${targetLabels.length > 0 ? targetLabels.join(', ') : '未設定'}`);
    process.exit(1);
  }

  console.log(`Gmail:    ${gmailAccount}`);
  console.log(`Labels:   ${targetLabels.join(', ')}`);
  console.log('---');

  // Gmail APIクライアント取得
  const gmail = await getGmailClient();

  // 検索クエリ構築
  const query = buildSearchQuery(targetLabels, afterDate, beforeDate);
  console.log(`検索クエリ: ${query}`);
  console.log('');

  // メッセージ検索（ページネーション対応）
  let pageToken = undefined;
  let allMessages = [];

  do {
    const response = await gmail.users.messages.list({
      userId: gmailAccount,
      q: query,
      maxResults: 100,
      pageToken: pageToken
    });

    const messages = response.data.messages || [];
    allMessages = allMessages.concat(messages);
    pageToken = response.data.nextPageToken;

    console.log(`メッセージ取得中... ${allMessages.length}件`);
  } while (pageToken);

  stats.messagesFound = allMessages.length;
  console.log(`合計 ${allMessages.length} 件のメッセージが見つかりました`);
  console.log('---');

  if (allMessages.length === 0) {
    console.log('処理対象のメッセージがありません');
    return;
  }

  // 各メッセージを処理
  for (const message of allMessages) {
    if (!message.id) continue;

    try {
      const result = await processMessage(gmail, gmailAccount, message.id);
      stats.attachmentsProcessed += result.processed;
      stats.duplicatesSkipped += result.skipped;
    } catch (error) {
      stats.errors++;
      console.error(`Error processing message ${message.id}:`, error.message);
    }
  }

  console.log('');
  console.log('===================================');
  console.log('📊 処理結果サマリー');
  console.log('===================================');
  console.log(`メッセージ数:     ${stats.messagesFound}`);
  console.log(`処理した添付:     ${stats.attachmentsProcessed}`);
  console.log(`スキップ（重複）: ${stats.duplicatesSkipped}`);
  console.log(`エラー:           ${stats.errors}`);
  console.log('');

  if (dryRun) {
    console.log('⚠️  DRY-RUNモードのため、実際の保存は行われていません');
    console.log('   実行するには --dry-run を外して再実行してください');
  } else if (stats.attachmentsProcessed > 0) {
    console.log('✅ インポート完了');
    console.log('');
    console.log('次のステップ:');
    console.log('  1. processOCR を手動実行してOCR処理を開始');
    console.log('     firebase functions:call processOCR -P ' + projectId);
    console.log('  2. または次回の定期実行（5分間隔）を待つ');
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
