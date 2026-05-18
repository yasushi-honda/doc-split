#!/usr/bin/env node
/**
 * 短文字列 office マスター監査スクリプト (read-only)
 *
 * `masters/offices/items` 全件を取得し、name.length が閾値以下のエントリを列挙する。
 * Issue #501 の 3 層防御 (sanitize length>=4 ガード) が legitimate な短マスターを
 * 巻き込まないか確認するために使用。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=<project-id> node scripts/audit-short-office-masters.js [--max-length N]
 *
 * オプション:
 *   --max-length N  name.length <= N のエントリを出力 (default: 3)
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
let maxLength = 3;
let failOnDetected = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-length' && args[i + 1]) {
    const n = parseInt(args[i + 1], 10);
    if (!Number.isInteger(n) || n < 0) {
      console.error(`--max-length は非負整数を指定してください (got: ${args[i + 1]})`);
      process.exit(1);
    }
    maxLength = n;
    i++;
  } else if (args[i] === '--fail-on-detected') {
    // #506: scheduled audit から workflow が exit code で検知できるよう non-zero exit を選択可能化
    failOnDetected = true;
  }
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`抽出条件: name.length <= ${maxLength}\n`);

  const snap = await db.collection('masters/offices/items').get();
  console.log(`masters/offices/items 全件: ${snap.size}\n`);

  const short = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const name = typeof data.name === 'string' ? data.name : '';
    if (name.length === 0) {
      short.push({ id: doc.id, name, length: 0, data });
      continue;
    }
    if (name.length <= maxLength) {
      short.push({ id: doc.id, name, length: name.length, data });
    }
  }

  console.log(`=== name.length <= ${maxLength} のマスター: ${short.length}件 ===\n`);
  if (short.length === 0) {
    console.log('該当なし');
    return;
  }

  for (const entry of short) {
    console.log(`id=${entry.id}`);
    console.log(`  name="${entry.name}" (length=${entry.length})`);
    console.log(`  shortName="${entry.data.shortName || ''}"`);
    console.log(`  aliases=${JSON.stringify(entry.data.aliases || [])}`);
    console.log(`  isDuplicate=${entry.data.isDuplicate ?? false}`);
    console.log(`  notes="${entry.data.notes || ''}"`);

    // 関連 documents の件数 (officeName 完全一致 / officeId 参照)
    const [byName, byId] = await Promise.all([
      db.collection('documents').where('officeName', '==', entry.name).count().get(),
      db.collection('documents').where('officeId', '==', entry.id).count().get(),
    ]);
    console.log(`  関連 documents (officeName=="${entry.name}"): ${byName.data().count}件`);
    console.log(`  関連 documents (officeId=="${entry.id}"): ${byId.data().count}件`);
    console.log('');
  }

  console.log(`\n=== サマリー ===`);
  console.log(`プロジェクト: ${projectId}`);
  console.log(`全件: ${snap.size}`);
  console.log(`length <= ${maxLength}: ${short.length}件`);
  return short.length;
}

main()
  .then((detectedCount) => {
    // #506: --fail-on-detected が指定された場合、検出件数>0 で non-zero exit
    // (scheduled workflow から exit code 経由で Slack 通知 / Issue 自動作成を分岐可能に)
    if (failOnDetected && detectedCount > 0) {
      console.error(`\n[FAIL] --fail-on-detected: ${detectedCount}件の短マスターが検出されたため exit 1`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
