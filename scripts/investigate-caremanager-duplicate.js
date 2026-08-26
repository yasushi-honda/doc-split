#!/usr/bin/env node
/**
 * ケアマネジャー名重複調査スクリプト（read-only）
 *
 * Issue #811: kanameone環境でケアマネのGoogle Driveフォルダが自動作成時に重複する
 * (findOrCreateFolder.tsがcareManagerName文字列の完全一致でしかフォルダを解決せず、
 * 全角半角・異体字・typo等の表記ゆれを正規化しないため)。
 *
 * 指定したケアマネ名に対して以下を調査する:
 *   1. masters/caremanagers/items の完全一致・類似候補(Levenshtein距離しきい値以内)
 *   2. masters/customers/items.careManagerName の完全一致・類似候補と件数
 *   3. documents.careManager の完全一致・類似候補と件数
 * 各文字列はUTF-8バイト列(hex)も併記し、全角半角・異体字・不可視文字の差異を可視化する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/investigate-caremanager-duplicate.js \
 *     --name "森奈穂美"
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
const names = [];
let maxDistance = 2;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) {
    names.push(args[i + 1]);
    i++;
  } else if (args[i] === '--max-distance' && args[i + 1]) {
    maxDistance = parseInt(args[i + 1], 10);
    i++;
  }
}
if (names.length === 0) {
  console.error('--name <ケアマネ名> を1つ以上指定してください（例: --name "森奈穂美"）');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const SAMPLE_LIMIT = 10;
const DOCUMENTS_PAGE_SIZE = 1000;

function hexOf(s) {
  return Buffer.from(s, 'utf8').toString('hex');
}

/** 単純Levenshtein距離（正規化なし、生文字列比較） */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

function isExact(value) {
  return names.includes(value);
}

function isCandidate(value) {
  if (!value) return false;
  return names.some((name) => value !== name && levenshtein(value, name) <= maxDistance);
}

function printGroup(label, entries) {
  if (entries.length === 0) {
    console.log('  該当なし');
    return;
  }
  for (const [name, ids] of entries) {
    const tag = isExact(name) ? '完全一致' : '類似候補';
    console.log(`  [${tag}] "${name}" (hex=${hexOf(name)}) : ${ids.length}件 (例: ${ids.slice(0, SAMPLE_LIMIT).join(', ')})`);
  }
}

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`調査対象: ${names.map((n) => `"${n}" (hex=${hexOf(n)})`).join(', ')}`);
  console.log(`類似候補の距離しきい値: <=${maxDistance}\n`);

  // 1. masters/caremanagers/items
  const cmSnap = await db.collection('masters/caremanagers/items').get();
  console.log(`masters/caremanagers/items 全件: ${cmSnap.size}`);
  console.log('\n=== 完全一致 / 類似候補 (caremanagers master) ===');
  const cmMatches = [];
  for (const doc of cmSnap.docs) {
    const d = doc.data();
    const name = d.name || '';
    if (isExact(name) || isCandidate(name)) {
      const tag = isExact(name) ? '完全一致' : '類似候補';
      console.log(`  [${tag}] id=${doc.id} name="${name}" (hex=${hexOf(name)}) office="${d.office || ''}"`);
      cmMatches.push({ id: doc.id, name });
    }
  }
  if (cmMatches.length === 0) {
    console.log('  該当なし');
  }

  // 2. masters/customers/items.careManagerName
  const custSnap = await db.collection('masters/customers/items').get();
  console.log(`\nmasters/customers/items 全件: ${custSnap.size}`);
  console.log('\n=== 完全一致 / 類似候補 (customers.careManagerName) 集計 ===');
  const custByName = new Map();
  for (const doc of custSnap.docs) {
    const cmName = doc.data().careManagerName || '';
    if (isExact(cmName) || isCandidate(cmName)) {
      if (!custByName.has(cmName)) custByName.set(cmName, []);
      custByName.get(cmName).push(doc.id);
    }
  }
  printGroup('customers.careManagerName', Array.from(custByName.entries()));

  // 3. documents.careManager (select + __name__ ページングで全件走査、大規模コレクション対応)
  console.log('\n=== 完全一致 / 類似候補 (documents.careManager) 集計 ===');
  const docsByName = new Map();
  let scanned = 0;
  let lastDoc = null;
  for (;;) {
    let q = db.collection('documents').select('careManager').orderBy('__name__').limit(DOCUMENTS_PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned++;
      const cmName = doc.data().careManager || '';
      if (isExact(cmName) || isCandidate(cmName)) {
        if (!docsByName.has(cmName)) docsByName.set(cmName, []);
        docsByName.get(cmName).push(doc.id);
      }
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < DOCUMENTS_PAGE_SIZE) break;
  }
  console.log(`documents 走査件数: ${scanned}`);
  printGroup('documents.careManager', Array.from(docsByName.entries()));

  console.log('\n調査完了。');
  process.exit(0);
}

main().catch((err) => {
  // err 全体を渡して node に stack trace を自動印字させる（Firestore SDK の code/details 保持）
  console.error('エラー:', err);
  process.exit(1);
});
