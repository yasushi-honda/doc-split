#!/usr/bin/env node
/**
 * 事業所名一括書き換え + 旧マスター削除スクリプト（kanameone「ケア21上飯田0」重複対応で初版作成）
 *
 * 処理:
 *   1. --from / --to のマスター実体を取得し、両方が完全一致 1 件で存在することを assert
 *   2. documents.officeName == --from の書類を全件取得し、JSON バックアップを保存
 *   3. --execute 時のみ:
 *      a. 書類の officeName / officeId を --to のものに batch update
 *      b. --delete-from-master 指定時は --from マスターを delete
 *   4. 検証クエリで残存件数を出力
 *
 * 使用方法（GitHub Actions 推奨）:
 *   gh workflow run 'Run Operations Script' \
 *     -f environment=kanameone \
 *     -f script='cleanup-office-name --dry-run' \
 *     -f from_name='ケア21上飯田0' -f to_name='ケア21上飯田' \
 *     -f delete_from_master=true -f expected_count=9
 *
 * オプション:
 *   --from <事業所名>          (必須) 書き換え元の名前
 *   --to <事業所名>            (必須) 書き換え先の名前
 *   --delete-from-master       (任意) 書き換え後に --from のマスターを削除
 *   --expected-count <N>       (任意) 影響件数の事前確認（race condition 防止）
 *   --dry-run                  (default) 変更なし、影響範囲のみ表示
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

// === 引数 parse ===
const args = process.argv.slice(2);
let from = null;
let to = null;
let deleteFromMaster = false;
let expectedCount = null;
let execute = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from' && args[i + 1]) {
    from = args[i + 1];
    i++;
  } else if (args[i] === '--to' && args[i + 1]) {
    to = args[i + 1];
    i++;
  } else if (args[i] === '--delete-from-master') {
    deleteFromMaster = true;
  } else if (args[i] === '--expected-count' && args[i + 1]) {
    expectedCount = Number.parseInt(args[i + 1], 10);
    if (!Number.isFinite(expectedCount) || expectedCount < 0) {
      console.error(`ERROR: --expected-count は 0 以上の整数を指定してください（受領: "${args[i + 1]}"）`);
      process.exit(1);
    }
    i++;
  } else if (args[i] === '--execute') {
    execute = true;
  } else if (args[i] === '--dry-run') {
    execute = false;
  }
}

if (!from || !to) {
  console.error('Usage: --from <旧事業所名> --to <新事業所名> [--delete-from-master] [--expected-count N] [--dry-run|--execute]');
  process.exit(1);
}
if (from === to) {
  console.error('ERROR: --from と --to が同じです');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const BATCH_CHUNK_SIZE = 400;

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${execute ? '実行 (--execute)' : 'DRY RUN（--execute で実行）'}`);
  console.log(`書き換え: officeName / officeId  "${from}" → "${to}"`);
  console.log(`旧マスター削除: ${deleteFromMaster ? 'YES' : 'NO'}`);
  if (expectedCount !== null) {
    console.log(`期待件数: ${expectedCount}`);
  }
  console.log('---\n');

  // === 1. マスター実体の取得 + assertion ===
  console.log('=== マスター存在確認 ===');
  const fromQuery = await db.collection('masters/offices/items').where('name', '==', from).get();
  if (fromQuery.size === 0) {
    console.error(`ERROR: "from" マスター "${from}" が存在しません`);
    process.exit(1);
  }
  if (fromQuery.size > 1) {
    console.error(`ERROR: "from" マスター "${from}" が ${fromQuery.size} 件存在します（1 件のみ想定）`);
    process.exit(1);
  }
  const fromMaster = { id: fromQuery.docs[0].id, data: fromQuery.docs[0].data() };
  console.log(`from: id=${fromMaster.id} name="${fromMaster.data.name}"`);

  const toQuery = await db.collection('masters/offices/items').where('name', '==', to).get();
  if (toQuery.size === 0) {
    console.error(`ERROR: "to" マスター "${to}" が存在しません`);
    process.exit(1);
  }
  if (toQuery.size > 1) {
    console.error(`ERROR: "to" マスター "${to}" が ${toQuery.size} 件存在します（1 件のみ想定）`);
    process.exit(1);
  }
  const toMaster = { id: toQuery.docs[0].id, data: toQuery.docs[0].data() };
  console.log(`to:   id=${toMaster.id} name="${toMaster.data.name}"`);

  // === 2. 影響書類取得 + 期待件数チェック ===
  console.log('\n=== 影響書類 ===');
  const docsSnap = await db.collection('documents').where('officeName', '==', from).get();
  console.log(`officeName == "${from}" の書類: ${docsSnap.size} 件`);

  if (expectedCount !== null && docsSnap.size !== expectedCount) {
    console.error(
      `ERROR: 期待件数 ${expectedCount} と実際の件数 ${docsSnap.size} が一致しません。データに変更があった可能性があります。`
    );
    console.error('   --expected-count を最新の件数に更新するか、再度 dry-run で内容を確認してください。');
    process.exit(1);
  }

  if (docsSnap.size === 0 && !deleteFromMaster) {
    console.log('影響書類なし、削除フラグもなし → 処理対象なし');
    process.exit(0);
  }

  // === 3. バックアップ JSON 保存 ===
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `office-name-cleanup-${projectId}-${Date.now()}.json`);

  const backupData = {
    exportedAt: new Date().toISOString(),
    projectId,
    from: { id: fromMaster.id, name: fromMaster.data.name, master: fromMaster.data },
    to: { id: toMaster.id, name: toMaster.data.name, master: toMaster.data },
    deleteFromMaster,
    affectedDocuments: docsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };

  // Firestore Timestamp を ISO 文字列にシリアライズ
  const serializable = JSON.parse(
    JSON.stringify(backupData, (_key, value) => {
      if (value && typeof value === 'object' && '_seconds' in value && '_nanoseconds' in value) {
        return new Date(value._seconds * 1000).toISOString();
      }
      return value;
    })
  );
  fs.writeFileSync(backupFile, JSON.stringify(serializable, null, 2));
  console.log(`\nバックアップ: ${backupFile}`);

  // === 4. 影響書類サンプル表示 ===
  console.log('\n=== 影響書類一覧（最大 30 件まで表示） ===');
  const sample = docsSnap.docs.slice(0, 30);
  for (const d of sample) {
    const data = d.data();
    console.log(
      `  id=${d.id} fileName="${data.fileName || ''}" customerName="${data.customerName || ''}" ` +
        `officeId="${data.officeId || ''}" fileDate="${data.fileDateFormatted || ''}"`
    );
  }
  if (docsSnap.size > 30) {
    console.log(`  ... 他 ${docsSnap.size - 30} 件`);
  }

  // === 5. dry-run なら終了 ===
  if (!execute) {
    console.log('\nDRY RUN モード。--execute で実行します。');
    process.exit(0);
  }

  // === 6. 書類更新（batch、500件上限対策で chunk 分割） ===
  console.log('\n=== 書類更新実行 ===');
  let updated = 0;
  for (let i = 0; i < docsSnap.docs.length; i += BATCH_CHUNK_SIZE) {
    const chunk = docsSnap.docs.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = db.batch();
    for (const d of chunk) {
      batch.update(d.ref, {
        officeName: to,
        officeId: toMaster.id,
      });
    }
    await batch.commit();
    updated += chunk.length;
    console.log(`  ${updated}/${docsSnap.size} 件更新`);
  }

  // === 7. 旧マスター削除 ===
  if (deleteFromMaster) {
    console.log('\n=== 旧マスター削除 ===');
    await db.collection('masters/offices/items').doc(fromMaster.id).delete();
    console.log(`  削除完了: id=${fromMaster.id} name="${fromMaster.data.name}"`);
  }

  // === 8. 検証 ===
  console.log('\n=== 検証 ===');
  const verifyDocs = await db.collection('documents').where('officeName', '==', from).get();
  console.log(
    `officeName == "${from}" の残書類: ${verifyDocs.size} 件 ${verifyDocs.size === 0 ? '✅' : '⚠️ 残存'}`
  );

  if (deleteFromMaster) {
    const masterCheck = await db.collection('masters/offices/items').doc(fromMaster.id).get();
    console.log(`旧マスター ${fromMaster.id}: ${masterCheck.exists ? '⚠️ 残存' : '✅ 削除済'}`);
  }

  const toVerify = await db.collection('documents').where('officeName', '==', to).get();
  console.log(`officeName == "${to}" の書類（統合後）: ${toVerify.size} 件`);

  console.log('\n完了');
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
