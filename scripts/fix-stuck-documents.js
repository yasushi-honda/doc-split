#!/usr/bin/env node
/**
 * processing状態でスタックしたドキュメントをpendingに戻すスクリプト
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/fix-stuck-documents.js
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/fix-stuck-documents.js --dry-run
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN（変更なし）' : '実行'}`);
  console.log('---');

  // processing状態のドキュメントを検索
  const snapshot = await db
    .collection('documents')
    .where('status', '==', 'processing')
    .get();

  if (snapshot.empty) {
    console.log('processing状態のドキュメントはありません');
    process.exit(0);
  }

  console.log(`${snapshot.size}件のprocessing状態ドキュメントを検出:`);

  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(`  - ${doc.id}: ${data.fileName || '(no name)'}`);

    if (!dryRun) {
      await db.doc(`documents/${doc.id}`).update({
        status: 'pending',
        lastErrorMessage: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`    → pendingに変更`);
    }
  }

  if (dryRun) {
    console.log('\n--dry-run モードのため変更なし。実行するには --dry-run を外してください。');
  } else {
    console.log(`\n${snapshot.size}件をpendingに変更しました。OCRポーリングが自動で再処理します。`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err.message);
  process.exit(1);
});
