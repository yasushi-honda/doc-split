#!/usr/bin/env node
/**
 * officeName / officeId 完全一致の documents を status=pending に reset するスクリプト
 * (Issue #504, PR #502 #501 v2 cleanup tail)
 *
 * 短文字列マスター (「ケア」「ニック」等) を削除した後、誤分類された関連 documents を
 * BE OCR processor で再処理させるため status を pending に reset する。OCR processor は
 * documents.onDocumentWritten trigger で起動し、現行 (PR #502 v2 deploy 済) の
 * classifier collision-based 抑制を適用して再分類する。
 *
 * 処理:
 *   1. --office-name / --office-id で指定された値の documents を全件取得 (read-only)
 *   2. --expected-count 指定時は事前件数 assertion
 *   3. --execute 時のみ:
 *      a. バックアップ JSON 保存 (backups/reset-documents-<env>-<ts>.json)
 *      b. 各 document を status=pending に batch update (chunk 単位、retryCount=0 reset)
 *
 * 使用方法 (GitHub Actions 推奨):
 *   gh workflow run 'Run Operations Script' \
 *     -f environment=kanameone \
 *     -f script='reset-documents-by-office --dry-run' \
 *     -f office_names='ケア,ニック' -f expected_count='675'
 *
 * オプション:
 *   --office-name <name>       officeName 完全一致 (複数指定可)
 *   --office-id <id>           officeId 完全一致 (複数指定可)
 *   --expected-count <N>       影響件数の事前確認 (指定時は不一致で abort)
 *   --dry-run                  (default) 変更なし、対象件数のみ表示
 *   --execute                  実行
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
const officeNames = [];
const officeIds = [];
let expectedCount = null;
let mode = 'dry-run';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--office-name' && args[i + 1]) {
    officeNames.push(args[i + 1]);
    i++;
  } else if (args[i] === '--office-id' && args[i + 1]) {
    officeIds.push(args[i + 1]);
    i++;
  } else if (args[i] === '--expected-count' && args[i + 1]) {
    const n = parseInt(args[i + 1], 10);
    if (!Number.isInteger(n) || n < 0) {
      console.error(`--expected-count は非負整数を指定してください (got: ${args[i + 1]})`);
      process.exit(1);
    }
    expectedCount = n;
    i++;
  } else if (args[i] === '--execute') {
    mode = 'execute';
  } else if (args[i] === '--dry-run') {
    mode = 'dry-run';
  }
}

if (officeNames.length === 0 && officeIds.length === 0) {
  console.error('--office-name <name> または --office-id <id> を 1 つ以上指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const BATCH_CHUNK_SIZE = 400; // Firestore batch 上限 500 に余裕

function serializeTimestamps(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof admin.firestore.Timestamp) return obj.toDate().toISOString();
  if (Array.isArray(obj)) return obj.map(serializeTimestamps);
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeTimestamps(value);
    }
    return result;
  }
  return obj;
}

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${mode === 'dry-run' ? 'DRY RUN (変更なし)' : '実行'}`);
  if (officeNames.length > 0) {
    console.log(`officeName 完全一致: ${officeNames.map((n) => `"${n}"`).join(', ')}`);
  }
  if (officeIds.length > 0) {
    console.log(`officeId 完全一致: ${officeIds.map((id) => `"${id}"`).join(', ')}`);
  }
  console.log('');

  // 対象 documents を集める (officeName と officeId は OR 結合、ID 集合で重複排除)
  const docMap = new Map(); // id -> doc snapshot
  for (const name of officeNames) {
    const snap = await db.collection('documents').where('officeName', '==', name).get();
    for (const doc of snap.docs) {
      docMap.set(doc.id, doc);
    }
    console.log(`  officeName=="${name}": ${snap.size}件`);
  }
  for (const id of officeIds) {
    const snap = await db.collection('documents').where('officeId', '==', id).get();
    for (const doc of snap.docs) {
      docMap.set(doc.id, doc);
    }
    console.log(`  officeId=="${id}": ${snap.size}件`);
  }

  const totalCount = docMap.size;
  console.log(`\n=== 対象 documents (重複排除後): ${totalCount}件 ===`);

  if (totalCount === 0) {
    console.log('対象なし。終了。');
    return;
  }

  // 件数 assertion
  if (expectedCount !== null) {
    if (totalCount !== expectedCount) {
      console.error(
        `ERROR: --expected-count (${expectedCount}) と実際の件数 (${totalCount}) が不一致。abort。`,
      );
      process.exit(1);
    }
    console.log(`✓ --expected-count assertion pass\n`);
  }

  // status 別集計 (再処理が必要な状態かを表示)
  const statusCounts = {};
  for (const doc of docMap.values()) {
    const status = doc.data().status || '(unknown)';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  console.log('status 別:');
  for (const [status, count] of Object.entries(statusCounts).sort()) {
    console.log(`  ${status}: ${count}件`);
  }

  if (mode === 'dry-run') {
    console.log('\nDRY RUN: reset は実行しません。--execute で実行してください。');
    return;
  }

  // バックアップ
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const backupPath = path.join(backupDir, `reset-documents-${projectId}-${ts}.json`);
  const backup = Array.from(docMap.values()).map((doc) => ({
    id: doc.id,
    data: serializeTimestamps(doc.data()),
  }));
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\n✓ バックアップ保存: ${backupPath} (${backup.length}件)\n`);

  // chunk 単位で batch reset
  console.log('=== reset 実行 (chunk 単位 batch) ===');
  const allIds = Array.from(docMap.keys());
  let committedCount = 0;

  for (let i = 0; i < allIds.length; i += BATCH_CHUNK_SIZE) {
    const chunk = allIds.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = db.batch();
    for (const id of chunk) {
      batch.update(db.doc(`documents/${id}`), {
        status: 'pending',
        retryCount: 0,
        lastErrorMessage: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    try {
      await batch.commit();
      committedCount += chunk.length;
      console.log(`  chunk ${Math.floor(i / BATCH_CHUNK_SIZE) + 1}: ${chunk.length}件 commit`);
    } catch (err) {
      console.error(`  chunk ${Math.floor(i / BATCH_CHUNK_SIZE) + 1}: 失敗`, err);
      console.error(`委託済み: ${committedCount}件 / バックアップ: ${backupPath}`);
      process.exit(1);
    }
  }

  console.log(`\n=== サマリー ===`);
  console.log(`reset 完了: ${committedCount}/${totalCount}件`);
  console.log(`バックアップ: ${backupPath}`);
  console.log(`OCR processor が onDocumentWritten trigger 経由で再処理を開始します`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
