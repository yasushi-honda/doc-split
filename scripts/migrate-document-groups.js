#!/usr/bin/env node
/**
 * ドキュメントグループ マイグレーションスクリプト
 *
 * 既存のdocumentsにグループキーを付与し、documentGroupsコレクションを初期構築
 *
 * 注意: キー導出(normalizeGroupKey/generateGroupKeys)とグループ集計ロジック
 * (resolveGroupKeyAndDisplay/rebuildAllGroupAggregations、careManager未設定書類の
 * 「CM未設定」グループへのフォールバックを含む)は functions/src/utils/groupAggregation.ts
 * を唯一の実装源とし、functions/lib/functions/src/utils/groupAggregation.js から直接
 * requireする(scripts/diagnose-caremanager-group-gap.jsと同一パターン)。手書きコピーは
 * 持たない — 本体だけ直して本スクリプトを直さないと、次回実行時に旧ロジックで
 * documentGroupsが再構築され、修正済みの集計バグ(担当CM別集計の非対称性)が本番で
 * 再発するため(GOAL.md タスクD)。
 *
 * 実行前に functions/ で `npm run build` を実行し lib/ を最新化すること
 * (GitHub Actions run-ops-script.yml は実行前に自動でnpm run buildする)。
 *
 * Usage:
 *   node scripts/migrate-document-groups.js [--project <project-id>]
 *
 * Options:
 *   --project  Firebase プロジェクトID (デフォルト: doc-split-dev)
 *   --dry-run  実際には書き込まない
 */

const path = require('path');
const admin = require('firebase-admin');

// コマンドライン引数解析
const args = process.argv.slice(2);
let projectId = 'doc-split-dev';
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project' && args[i + 1]) {
    projectId = args[i + 1];
    i++;
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  }
}

console.log(`📦 プロジェクト: ${projectId}`);
console.log(`🔧 ドライラン: ${dryRun ? 'はい' : 'いいえ'}`);
console.log('');

// Firebase Admin 初期化
admin.initializeApp({
  projectId,
});

const db = admin.firestore();

// groupAggregation.ts のSSoTを直接require（手書きコピー禁止）
const {
  generateGroupKeys,
  generateGroupId,
  resolveGroupKeyAndDisplay,
  rebuildAllGroupAggregations,
} = require(
  path.resolve(__dirname, '../functions/lib/functions/src/utils/groupAggregation.js'),
);

/**
 * メイン処理
 */
async function main() {
  const startTime = Date.now();

  console.log('🚀 マイグレーション開始...\n');

  // Phase 1: 既存documentsにグループキーを付与
  console.log('📝 Phase 1: グループキー付与');
  let processed = 0;
  let updated = 0;
  let lastDoc = null;
  const batchSize = 500;

  while (true) {
    let query = db.collection('documents')
      .orderBy('processedAt', 'desc')
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let batchUpdates = 0;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const keys = generateGroupKeys(data);

      const needsUpdate =
        data.customerKey !== keys.customerKey ||
        data.officeKey !== keys.officeKey ||
        data.documentTypeKey !== keys.documentTypeKey ||
        data.careManagerKey !== keys.careManagerKey;

      if (needsUpdate) {
        if (!dryRun) {
          batch.update(docSnap.ref, keys);
        }
        batchUpdates++;
        updated++;
      }

      processed++;
    }

    if (batchUpdates > 0 && !dryRun) {
      await batch.commit();
    }

    console.log(`  処理: ${processed} 件 (更新: ${updated} 件)`);
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  console.log(`\n✅ Phase 1 完了: ${processed} 件処理, ${updated} 件更新\n`);

  // Phase 2: documentGroupsを再構築
  console.log('📊 Phase 2: グループ集計');

  let scanned;
  let groupCount;
  const typeCounts = { customer: 0, office: 0, documentType: 0, careManager: 0 };

  if (dryRun) {
    // rebuildAllGroupAggregations()は削除+書き込みを行うためdry-runでは呼べない。
    // 同一のkey導出・フォールバック関数(generateGroupKeys/resolveGroupKeyAndDisplay)を
    // 使った読み取り専用プレビューで代替する(書き込みロジックはFirestoreへ触れない)。
    const groupMap = new Map();
    scanned = 0;
    lastDoc = null;

    while (true) {
      let query = db.collection('documents')
        .orderBy('processedAt', 'desc')
        .limit(batchSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();

        if (data.status === 'split') {
          // rebuildAllGroupAggregations()のFirestoreクエリ(status !== 'split')と
          // 同一母集団にするため、分割済みはカウントに含めない(実行モードと比較可能にする)
          continue;
        }

        const keys = generateGroupKeys(data);
        const types = [
          { type: 'customer', key: keys.customerKey, display: data.customerName },
          { type: 'office', key: keys.officeKey, display: data.officeName },
          { type: 'documentType', key: keys.documentTypeKey, display: data.documentType },
          { type: 'careManager', key: keys.careManagerKey, display: data.careManager },
        ];

        for (const { type, key, display } of types) {
          const resolved = resolveGroupKeyAndDisplay(type, key, display, !!keys.customerKey);
          if (!resolved) continue;

          const groupId = generateGroupId(type, resolved.key);
          const existing = groupMap.get(groupId);
          if (existing) {
            existing.count++;
          } else {
            groupMap.set(groupId, { groupType: type, count: 1 });
          }
        }

        scanned++;
      }

      console.log(`  スキャン: ${scanned} 件`);
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    groupCount = groupMap.size;
    for (const { groupType } of groupMap.values()) {
      typeCounts[groupType]++;
    }

    console.log('\n⚠️  ドライランのためdocumentGroupsは変更していません（プレビューのみ）。');
  } else {
    const result = await rebuildAllGroupAggregations(db, batchSize);
    scanned = result.processed;
    groupCount = result.groups;

    const groupsSnap = await db.collection('documentGroups').get();
    groupsSnap.forEach((doc) => {
      const groupType = doc.data().groupType;
      if (typeCounts[groupType] !== undefined) {
        typeCounts[groupType]++;
      }
    });
  }

  // 結果サマリー
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(50));
  console.log('📊 マイグレーション結果');
  console.log('='.repeat(50));
  console.log(`  処理ドキュメント: ${scanned} 件`);
  console.log(`  キー更新: ${updated} 件`);
  console.log(`  グループ作成: ${groupCount} 件`);

  console.log('\n  グループ内訳:');
  console.log(`    - 顧客別: ${typeCounts.customer} グループ`);
  console.log(`    - 事業所別: ${typeCounts.office} グループ`);
  console.log(`    - 書類種別: ${typeCounts.documentType} グループ`);
  console.log(`    - 担当CM別: ${typeCounts.careManager} グループ`);

  console.log(`\n⏱️  実行時間: ${elapsed} 秒`);
  console.log(dryRun ? '\n⚠️  ドライランモードで実行しました。実際の書き込みは行われていません。' : '\n✅ マイグレーション完了!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ エラー:', error);
    process.exit(1);
  });
