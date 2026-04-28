#!/usr/bin/env node
/**
 * 事業所マスター重複調査スクリプト（read-only）
 *
 * 指定した事業所名に対して以下を調査する:
 *   1. マスター（masters/offices/items）の完全一致レコード
 *   2. 関連マスター（部分一致 / aliases 含む）の参考列挙
 *   3. documents コレクションで officeName 完全一致の書類件数
 *   4. 各マスター ID を officeId 参照する書類件数
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/investigate-office-duplicate.js \
 *     --name "ケア21上飯田" --name "ケア21上飯田0"
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) {
    names.push(args[i + 1]);
    i++;
  }
}
if (names.length === 0) {
  console.error('--name <事業所名> を 1 つ以上指定してください（例: --name "ケア21上飯田" --name "ケア21上飯田0"）');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const SAMPLE_LIMIT = 30;

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`調査対象: ${names.map((n) => `"${n}"`).join(', ')}\n`);

  // 1. マスター全件取得（一度だけ）
  const mastersSnap = await db.collection('masters/offices/items').get();
  console.log(`masters/offices/items 全件: ${mastersSnap.size}\n`);

  // 2. 完全一致マスター
  console.log('=== 完全一致マスター ===');
  const matchedMasters = []; // { id, data } の配列
  for (const name of names) {
    const exact = mastersSnap.docs.filter((d) => d.data().name === name);
    console.log(`\n[name == "${name}"] -> ${exact.length}件`);
    for (const doc of exact) {
      const d = doc.data();
      console.log(`  id=${doc.id}`);
      console.log(`    name="${d.name}"`);
      console.log(`    shortName="${d.shortName || ''}"`);
      console.log(`    aliases=${JSON.stringify(d.aliases || [])}`);
      console.log(`    isDuplicate=${d.isDuplicate ?? false}`);
      console.log(`    notes="${d.notes || ''}"`);
      console.log(`    createdAt=${d.createdAt ? d.createdAt.toDate().toISOString() : 'N/A'}`);
      console.log(`    updatedAt=${d.updatedAt ? d.updatedAt.toDate().toISOString() : 'N/A'}`);
      matchedMasters.push({ id: doc.id, data: d, queryName: name });
    }
  }

  // 3. 参考: 部分一致マスター（指定名以外で前方共通部分を含むもの）
  if (names.length > 0) {
    const longestCommonPrefix = names.reduce((acc, n) => {
      if (acc === null) return n;
      let i = 0;
      while (i < acc.length && i < n.length && acc[i] === n[i]) i++;
      return acc.slice(0, i);
    }, null);
    if (longestCommonPrefix && longestCommonPrefix.length >= 2) {
      console.log(`\n\n=== 参考: 部分一致 "${longestCommonPrefix}" を含む他のマスター ===`);
      const partial = mastersSnap.docs.filter((d) => {
        const data = d.data();
        const name = data.name || '';
        const aliases = data.aliases || [];
        const matchesName = name.includes(longestCommonPrefix) && !names.includes(name);
        const matchesAlias = aliases.some((a) => typeof a === 'string' && a.includes(longestCommonPrefix));
        return matchesName || matchesAlias;
      });
      if (partial.length === 0) {
        console.log('  該当なし');
      } else {
        for (const doc of partial) {
          const d = doc.data();
          console.log(`  id=${doc.id} name="${d.name}" aliases=${JSON.stringify(d.aliases || [])}`);
        }
      }
    }
  }

  // 4. officeName 完全一致の書類件数 + サンプル
  console.log('\n\n=== documents.officeName 完全一致 ===');
  for (const name of names) {
    const snap = await db.collection('documents').where('officeName', '==', name).get();
    console.log(`\n[officeName == "${name}"] -> ${snap.size}件`);
    const sample = snap.docs.slice(0, SAMPLE_LIMIT);
    for (const doc of sample) {
      const d = doc.data();
      console.log(
        `  id=${doc.id} fileName="${d.fileName || ''}" customerName="${d.customerName || ''}" ` +
          `officeId="${d.officeId || ''}" fileDate="${d.fileDateFormatted || ''}"`
      );
    }
    if (snap.size > SAMPLE_LIMIT) {
      console.log(`  ... 他 ${snap.size - SAMPLE_LIMIT} 件（サンプル ${SAMPLE_LIMIT} 件まで表示）`);
    }
  }

  // 5. officeId 参照書類数
  console.log('\n\n=== documents.officeId == 各マスターID ===');
  for (const m of matchedMasters) {
    const snap = await db.collection('documents').where('officeId', '==', m.id).get();
    console.log(`\n[officeId == "${m.id}" (name="${m.data.name}", queried="${m.queryName}")] -> ${snap.size}件`);
    const sample = snap.docs.slice(0, 10);
    for (const doc of sample) {
      const d = doc.data();
      console.log(
        `  id=${doc.id} fileName="${d.fileName || ''}" officeName="${d.officeName || ''}" customerName="${d.customerName || ''}"`
      );
    }
    if (snap.size > 10) {
      console.log(`  ... 他 ${snap.size - 10} 件`);
    }
  }

  console.log('\n調査完了。');
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err.message);
  process.exit(1);
});
