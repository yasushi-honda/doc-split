#!/usr/bin/env node
/**
 * 許可ドメインの確認・追加スクリプト
 *
 * 使用方法:
 *   node check-allowed-domains.js <project-id>
 *   node check-allowed-domains.js <project-id> --add <domain>
 *
 * 例:
 *   node check-allowed-domains.js docsplit-kanameone
 *   node check-allowed-domains.js docsplit-kanameone --add kanameone.com
 */

const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// コマンドライン引数
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('使用方法: node check-allowed-domains.js <project-id> [--add <domain>]');
  console.error('例: node check-allowed-domains.js docsplit-kanameone');
  console.error('例: node check-allowed-domains.js docsplit-kanameone --add kanameone.com');
  process.exit(1);
}

const projectId = args[0];
const addFlag = args.indexOf('--add');
const domainToAdd = addFlag !== -1 ? args[addFlag + 1] : null;

// Firebase Admin初期化
admin.initializeApp({
  projectId: projectId
});

const db = getFirestore();

async function main() {
  console.log(`\n=== プロジェクト: ${projectId} ===\n`);

  const docRef = db.collection('settings').doc('auth');
  const doc = await docRef.get();

  if (!doc.exists) {
    console.log('⚠️  settings/auth ドキュメントが存在しません！');
    console.log('');
    console.log('セットアップ時に作成されていない可能性があります。');
    console.log('新規作成する場合は管理者に連絡してください。');
    process.exit(1);
  }

  const data = doc.data();
  const allowedDomains = data.allowedDomains || [];

  console.log('現在の許可ドメイン:');
  if (allowedDomains.length === 0) {
    console.log('  (なし - 空配列)');
  } else {
    allowedDomains.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d}`);
    });
  }

  // ドメイン追加モード
  if (domainToAdd) {
    console.log('');

    if (allowedDomains.includes(domainToAdd)) {
      console.log(`✓ "${domainToAdd}" は既に許可リストに含まれています`);
    } else {
      console.log(`"${domainToAdd}" を追加しています...`);

      await docRef.update({
        allowedDomains: FieldValue.arrayUnion(domainToAdd),
        updatedAt: FieldValue.serverTimestamp()
      });

      console.log(`✓ "${domainToAdd}" を許可ドメインに追加しました`);
    }
  }

  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('エラー:', e.message);
    process.exit(1);
  });
