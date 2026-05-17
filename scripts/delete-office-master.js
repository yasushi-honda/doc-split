#!/usr/bin/env node
/**
 * 事業所マスター削除スクリプト (read-only dry-run + --execute、Issue #504)
 *
 * 指定された ID 集合のマスターを安全に削除する。CSV import 由来の汚染マスター
 * (「ケア」「ニック」等、PR #502 #501 v2 collision-based 抑制と組み合わせて使用) の
 * cleanup tail を想定。
 *
 * 処理:
 *   1. --id で指定された ID 集合のマスターを Firestore から取得 (read-only)
 *   2. 各マスターの関連 documents 件数 (officeId 参照 / officeName 完全一致) を集計
 *   3. --expected-count 指定時は事前件数 assertion (race condition 防止)
 *   4. --execute 時のみ:
 *      a. バックアップ JSON 保存 (backups/office-master-delete-<env>-<ts>.json)
 *      b. 削除実行 (ID 集合の再取得 → 集合比較 → batch delete、chunk 単位 try/catch)
 *   5. 検証クエリで残存件数を出力
 *
 * 使用方法 (GitHub Actions 推奨):
 *   gh workflow run 'Run Operations Script' \
 *     -f environment=kanameone \
 *     -f script='delete-office-master --dry-run' \
 *     -f delete_ids='6umj52B2r7pYLYWJjPx8,ケア,ニック' -f expected_count='3'
 *
 * オプション:
 *   --id <ID>                  削除対象の Firestore document ID (複数指定可)
 *   --expected-count <N>       影響件数の事前確認 (指定時は不一致で abort)
 *   --dry-run                  (default) 変更なし、削除対象と影響範囲のみ表示
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

// 引数解析
const args = process.argv.slice(2);
const ids = [];
let expectedCount = null;
let mode = 'dry-run';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--id' && args[i + 1]) {
    ids.push(args[i + 1]);
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

if (ids.length === 0) {
  console.error('--id <ID> を 1 つ以上指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

/** Firestore Timestamp を ISO 文字列にシリアライズ (バックアップ JSON 用) */
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
  console.log(`削除対象 ID: ${ids.length}件 (${ids.map((id) => `"${id}"`).join(', ')})\n`);

  // Phase 1: read-only 集計
  const targets = []; // { id, exists, data, byOfficeId, byOfficeName }
  for (const id of ids) {
    const ref = db.doc(`masters/offices/items/${id}`);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : null;
    const name = data?.name || '';

    const [byId, byName] = await Promise.all([
      db.collection('documents').where('officeId', '==', id).count().get(),
      name
        ? db.collection('documents').where('officeName', '==', name).count().get()
        : Promise.resolve({ data: () => ({ count: 0 }) }),
    ]);
    targets.push({
      id,
      exists: snap.exists,
      data,
      byOfficeId: byId.data().count,
      byOfficeName: byName.data().count,
    });
  }

  // 表示
  console.log('=== 削除対象マスター ===');
  for (const t of targets) {
    if (!t.exists) {
      console.log(`id=${t.id} → 存在しない (skip)`);
      continue;
    }
    console.log(`id=${t.id}`);
    console.log(`  name="${t.data.name || ''}" (length=${(t.data.name || '').length})`);
    console.log(`  shortName="${t.data.shortName || ''}"`);
    console.log(`  aliases=${JSON.stringify(t.data.aliases || [])}`);
    console.log(`  関連 documents (officeId 参照): ${t.byOfficeId}件`);
    console.log(`  関連 documents (officeName 完全一致): ${t.byOfficeName}件`);
  }

  const existingCount = targets.filter((t) => t.exists).length;
  console.log(`\n存在: ${existingCount}/${ids.length}件\n`);

  // Phase 2: 件数 assertion
  if (expectedCount !== null) {
    if (existingCount !== expectedCount) {
      console.error(
        `ERROR: --expected-count (${expectedCount}) と実際の存在件数 (${existingCount}) が不一致。abort。`,
      );
      process.exit(1);
    }
    console.log(`✓ --expected-count assertion pass (${existingCount}件)\n`);
  }

  if (mode === 'dry-run') {
    console.log('DRY RUN: 削除は実行しません。--execute で実行してください。');
    return;
  }

  // Phase 3: バックアップ
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const backupPath = path.join(backupDir, `office-master-delete-${projectId}-${ts}.json`);
  const backup = targets
    .filter((t) => t.exists)
    .map((t) => ({
      id: t.id,
      data: serializeTimestamps(t.data),
      byOfficeId: t.byOfficeId,
      byOfficeName: t.byOfficeName,
    }));
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`✓ バックアップ保存: ${backupPath}\n`);

  // Phase 4: 削除実行 (再取得 + 集合比較で stale snapshot 防止)
  console.log('=== 削除実行 ===');
  const batch = db.batch();
  let queued = 0;
  for (const t of targets) {
    const ref = db.doc(`masters/offices/items/${t.id}`);
    const reSnap = await ref.get();
    if (!reSnap.exists) {
      console.log(`  ${t.id} → 既に存在しない (skip)`);
      continue;
    }
    batch.delete(ref);
    queued++;
    console.log(`  ${t.id} → delete queued`);
  }

  if (queued === 0) {
    console.log('削除対象なし。終了。');
    return;
  }

  try {
    await batch.commit();
    console.log(`\n✓ ${queued}件削除完了`);
  } catch (err) {
    console.error('ERROR: batch.commit() 失敗:', err);
    console.error(`バックアップから復元する場合は ${backupPath} を参照`);
    process.exit(1);
  }

  // Phase 5: 検証
  console.log('\n=== 削除後検証 ===');
  let remaining = 0;
  for (const t of targets) {
    const snap = await db.doc(`masters/offices/items/${t.id}`).get();
    if (snap.exists) {
      console.error(`  ⚠ id=${t.id} が依然存在 (削除失敗)`);
      remaining++;
    } else {
      console.log(`  ✓ id=${t.id} 削除確認`);
    }
  }
  if (remaining > 0) {
    console.error(`\nERROR: ${remaining}件が残存。再実行が必要。`);
    process.exit(1);
  }
  console.log(`\n=== サマリー ===`);
  console.log(`削除完了: ${queued}件 / バックアップ: ${backupPath}`);
  console.log(`次の工程: reprocess-master-matching で関連 documents を再分類してください`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
