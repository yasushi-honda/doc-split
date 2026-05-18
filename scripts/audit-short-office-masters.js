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
 *   --max-length N         name.length <= N のエントリを出力 (default: 3)
 *   --fail-on-detected     length<=N のエントリが 1件でも見つかれば exit 1 (legitimate 含む)
 *   --fail-on-collision    PR #507 review Critical #2 対応: legitimate 短マスター (collision なし)
 *                          を除外し、common short master (PR #502 v2 と同じ collision 判定)
 *                          のみで exit 1 する。scheduled audit から呼ぶ場合の推奨 flag。
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
let failOnCollision = false;
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
    // length<=N で 1 件でも検出 → exit 1 (legitimate 短マスター含む)
    failOnDetected = true;
  } else if (args[i] === '--fail-on-collision') {
    // #507 review Critical #2: legitimate (collision なし) を除外し、common short master のみで exit 1
    failOnCollision = true;
  }
}

// shared collision 判定 (PR #502 v2 と同等)。Bridge 経由で ts-node から TS を require
const { computeCommonShortMasters } = require('./lib/officeMasterValidationBridge');

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

  // #507 review Critical #2: collision 判定で legitimate と汚染を区別
  const allMasters = snap.docs.map((doc) => ({
    id: doc.id,
    name: typeof doc.data().name === 'string' ? doc.data().name : '',
  }));
  const commonShortIds = computeCommonShortMasters(allMasters);
  const collisionDetected = short.filter((s) => commonShortIds.has(s.id));

  console.log(`\n=== サマリー ===`);
  console.log(`プロジェクト: ${projectId}`);
  console.log(`全件: ${snap.size}`);
  console.log(`length <= ${maxLength}: ${short.length}件`);
  console.log(`うち common short master (collision 検出): ${collisionDetected.length}件`);
  if (collisionDetected.length > 0) {
    console.log('common short master id:');
    for (const c of collisionDetected) {
      console.log(`  - ${c.id} (name="${c.name}")`);
    }
  }
  return { detectedCount: short.length, collisionCount: collisionDetected.length };
}

main()
  .then(({ detectedCount, collisionCount }) => {
    // #507 review: --fail-on-collision (新規) を優先評価 → legitimate 短マスターでは
    // exit 0、bug pattern (collision 検出) でのみ exit 1。scheduled audit からは
    // 本 flag を使うことで false-positive Issue を抑制する。
    if (failOnCollision && collisionCount > 0) {
      console.error(`\n[FAIL] --fail-on-collision: common short master ${collisionCount}件が検出されたため exit 1`);
      process.exit(1);
    }
    if (failOnDetected && detectedCount > 0) {
      console.error(`\n[FAIL] --fail-on-detected: ${detectedCount}件の短マスターが検出されたため exit 1 (legitimate 含む)`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
