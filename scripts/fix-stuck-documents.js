#!/usr/bin/env node
/**
 * スタックしたドキュメントをpendingに戻すスクリプト
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/fix-stuck-documents.js
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/fix-stuck-documents.js --dry-run
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/fix-stuck-documents.js --include-errors
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/fix-stuck-documents.js --include-errors --dry-run
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/fix-stuck-documents.js --doc-id <id>
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/fix-stuck-documents.js --doc-id <id> --dry-run
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const includeErrors = process.argv.includes('--include-errors');
const docIdIndex = process.argv.indexOf('--doc-id');
const targetDocId = docIdIndex >= 0 ? process.argv[docIdIndex + 1] : null;

if (docIdIndex >= 0 && !targetDocId) {
  console.error('--doc-id にはドキュメントIDを指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function resetDoc(docRef, data) {
  console.log(`  - ${docRef.id}: ${data.fileName || '(no name)'} [${data.status}]`);
  if (dryRun) return;
  await docRef.update({
    status: 'pending',
    retryCount: 0,
    lastErrorMessage: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`    → pendingに変更（retryCount: 0）`);
}

async function runSingle() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN（変更なし）' : '実行'}`);
  console.log(`対象: 単一指定 (${targetDocId})`);
  console.log('---');

  const docRef = db.collection('documents').doc(targetDocId);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    console.warn(`⚠️ 書類が見つかりません: ${targetDocId}`);
    process.exit(1);
  }

  await resetDoc(docRef, docSnap.data());

  if (dryRun) {
    console.log('\n--dry-run モードのため変更なし。実行するには --dry-run を外してください。');
  } else {
    console.log('\n対象書類をpendingに変更しました。OCRポーリングが自動で再処理します。');
  }
  process.exit(0);
}

async function main() {
  if (targetDocId) {
    await runSingle();
    return;
  }

  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN（変更なし）' : '実行'}`);
  console.log(`対象: processing${includeErrors ? ' + error' : ''}`);
  console.log('---');

  // 対象ステータスのドキュメントを検索
  const targetStatuses = includeErrors ? ['processing', 'error'] : ['processing'];
  const snapshot = await db
    .collection('documents')
    .where('status', 'in', targetStatuses)
    .get();

  if (snapshot.empty) {
    console.log('対象のドキュメントはありません');
    process.exit(0);
  }

  // status: 'split' のドキュメントは除外（分割済みドキュメントを誤ってリセットしない）
  const docs = snapshot.docs.filter((doc) => doc.data().status !== 'split');

  if (docs.length === 0) {
    console.log('対象のドキュメントはありません（split除外後）');
    process.exit(0);
  }

  console.log(`${docs.length}件のドキュメントを検出:`);

  for (const doc of docs) {
    await resetDoc(doc.ref, doc.data());
  }

  if (dryRun) {
    console.log('\n--dry-run モードのため変更なし。実行するには --dry-run を外してください。');
  } else {
    console.log(`\n${docs.length}件をpendingに変更しました。OCRポーリングが自動で再処理します。`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err.message);
  process.exit(1);
});
