#!/usr/bin/env node
/**
 * 事業所名一括書き換え + 旧マスター削除スクリプト（汎用ツール、初版: kanameone「ケア21上飯田0」重複対応 PR #420）
 *
 * 処理:
 *   1. --from / --to のマスター実体を取得し、両方が完全一致 1 件で存在することを assert
 *   2. documents.officeName == --from の書類を全件取得し、JSON バックアップを保存
 *   3. --expected-count 指定時は事前件数チェック（race condition 防止）
 *   4. --execute 時のみ:
 *      a. 影響対象の再取得 + ID 集合比較（stale snapshot 防止）
 *      b. 書類の officeName / officeId を --to のものに batch update（chunk 単位 try/catch、失敗時 committedCount 報告）
 *      c. --delete-from-master 指定時は --from マスターを delete（中間状態警告付き）
 *   5. 検証クエリで残存件数を出力（書き込み完了後の検証エラーは process.exit 0 で終了）
 *
 * 使用方法（GitHub Actions 推奨）:
 *   gh workflow run 'Run Operations Script' \
 *     -f environment=kanameone \
 *     -f script='cleanup-office-name --dry-run' \
 *     -f from_name='ケア21上飯田0' -f to_name='ケア21上飯田' \
 *     -f delete_from_master='true' -f expected_count='9'
 *
 * 実行後の確認事項（trigger 連鎖の確認）:
 *   - documents の onDocumentWrite trigger により officeKey / documentGroups が
 *     再集計される（数秒～数十秒の非同期処理）。Firestore Console で確認。
 *   - searchIndexer の onDocumentWritten trigger により search_index トークンが
 *     更新される。`force-reindex --all-drift --dry-run` で drift がないか確認推奨。
 *
 * バックアップからの復元:
 *   - backups/office-name-cleanup-<project>-<ts>.json に影響対象を保存
 *   - JSON 内の Timestamp 系フィールドは ISO 文字列にシリアライズ済。復元時は
 *     admin.firestore.Timestamp.fromDate(new Date(iso)) で型復元が必要
 *
 * オプション:
 *   --from <事業所名>          (必須) 書き換え元の名前
 *   --to <事業所名>            (必須) 書き換え先の名前
 *   --delete-from-master       (任意) 書き換え後に --from のマスターを削除
 *   --expected-count <N>       (任意) 影響件数の事前確認（指定時は不一致で中断、未指定ならチェック無効）
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

  // === 6. stale snapshot 対策: --execute 直前に再取得して ID 集合を比較 ===
  console.log('\n=== stale snapshot チェック（実行直前の再取得） ===');
  const recheckSnap = await db.collection('documents').where('officeName', '==', from).get();
  const recheckIds = new Set(recheckSnap.docs.map((d) => d.id));
  const originalIds = new Set(docsSnap.docs.map((d) => d.id));
  const missingFromRecheck = [...originalIds].filter((id) => !recheckIds.has(id));
  const newInRecheck = [...recheckIds].filter((id) => !originalIds.has(id));
  if (missingFromRecheck.length > 0 || newInRecheck.length > 0) {
    console.error('ERROR: 影響対象の ID 集合が初回取得時と異なります。データに変更があった可能性があります。');
    console.error(
      `  初回にあって再取得時にない: ${missingFromRecheck.length} 件 ${missingFromRecheck.slice(0, 5).join(', ')}${missingFromRecheck.length > 5 ? ' ...' : ''}`
    );
    console.error(
      `  再取得時に新規追加: ${newInRecheck.length} 件 ${newInRecheck.slice(0, 5).join(', ')}${newInRecheck.length > 5 ? ' ...' : ''}`
    );
    console.error('  --dry-run で再確認してから再実行してください。');
    process.exit(1);
  }
  console.log(`  ID 集合一致 ✅ (${recheckSnap.size} 件)`);

  // === 7. 書類更新（batch、500件上限対策で chunk 分割。chunk 単位の commit 失敗を捕捉） ===
  console.log('\n=== 書類更新実行 ===');
  let updated = 0;
  const totalChunks = Math.ceil(docsSnap.docs.length / BATCH_CHUNK_SIZE);
  try {
    for (let i = 0; i < docsSnap.docs.length; i += BATCH_CHUNK_SIZE) {
      const chunk = docsSnap.docs.slice(i, i + BATCH_CHUNK_SIZE);
      const chunkNum = Math.floor(i / BATCH_CHUNK_SIZE) + 1;
      const batch = db.batch();
      for (const d of chunk) {
        batch.update(d.ref, {
          officeName: to,
          officeId: toMaster.id,
        });
      }
      await batch.commit();
      updated += chunk.length;
      console.log(`  batch ${chunkNum}/${totalChunks}: ${chunk.length} 件 commit (累計 ${updated}/${docsSnap.size})`);
    }
  } catch (commitErr) {
    const skipped = docsSnap.docs.slice(updated).map((d) => d.id);
    console.error(
      `\n⚠️ batch.commit() 失敗: ${updated}/${docsSnap.size} 件は書き込み済、${skipped.length} 件は未処理`
    );
    console.error(
      `未処理 docId（最初の 20 件）: ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ` ...(他 ${skipped.length - 20} 件)` : ''}`
    );
    console.error('復旧手順: backup JSON の affectedDocuments[].id を参照して未処理書類の officeName/officeId を確認');
    console.error(
      '再実行する場合は --expected-count を残件数に更新してから --dry-run で確認してください。'
    );
    throw commitErr;
  }

  // === 8. 旧マスター削除（書類更新成功後の中間状態警告付き） ===
  if (deleteFromMaster) {
    console.log('\n=== 旧マスター削除 ===');
    try {
      await db.collection('masters/offices/items').doc(fromMaster.id).delete();
      console.log(`  削除完了: id=${fromMaster.id} name="${fromMaster.data.name}"`);
    } catch (deleteErr) {
      console.error(
        `\n⚠️ マスター delete 失敗: 書類 ${updated} 件は更新済、旧マスターが残存している中間状態です。`
      );
      console.error(`  対象: id=${fromMaster.id} name="${fromMaster.data.name}"`);
      console.error('  Firestore Console で手動削除してください。');
      throw deleteErr;
    }
  }

  // === 9. 検証（書き込み完了後なので、検証クエリ失敗は exit 0 で終了し警告のみ） ===
  console.log('\n=== 検証 ===');
  try {
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
  } catch (verifyErr) {
    console.error('\n⚠️ 検証クエリ失敗（書き込みは完了済の可能性が高いため exit 0 で終了します）:', verifyErr);
    console.error('  Firestore Console で officeName=旧 の書類数 / 旧マスター存在を必ず手動確認してください。');
  }

  console.log('\n完了');
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
