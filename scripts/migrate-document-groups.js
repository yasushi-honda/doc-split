#!/usr/bin/env node
/**
 * ドキュメントグループ マイグレーションスクリプト
 *
 * 既存のdocumentsにグループキーを付与し、documentGroupsコレクションを初期構築
 *
 * Usage:
 *   node scripts/migrate-document-groups.js [--project <project-id>]
 *
 * Options:
 *   --project  Firebase プロジェクトID (デフォルト: doc-split-dev)
 *   --dry-run  実際には書き込まない
 */

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

/**
 * テキストを正規化してグループキーを生成
 */
function normalizeGroupKey(value) {
  if (!value) return '';

  return value
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
    )
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .trim();
}

/**
 * ドキュメントからグループキーを生成
 */
function generateGroupKeys(data) {
  return {
    customerKey: normalizeGroupKey(data.customerName),
    officeKey: normalizeGroupKey(data.officeName),
    documentTypeKey: normalizeGroupKey(data.documentType),
    careManagerKey: normalizeGroupKey(data.careManager),
  };
}

/**
 * グループIDを生成
 */
function generateGroupId(groupType, groupKey) {
  return `${groupType}_${groupKey}`;
}

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

  // 既存のdocumentGroupsを削除
  if (!dryRun) {
    const existingGroups = await db.collection('documentGroups').get();
    if (!existingGroups.empty) {
      console.log(`  既存グループ削除: ${existingGroups.size} 件`);
      const deleteBatch = db.batch();
      existingGroups.docs.forEach(doc => deleteBatch.delete(doc.ref));
      await deleteBatch.commit();
    }
  }

  // グループ集計用のマップ
  const groupMap = new Map();

  // documentsを全件スキャン
  processed = 0;
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

      // 分割済みはスキップ
      if (data.status === 'split') {
        processed++;
        continue;
      }

      const keys = generateGroupKeys(data);

      const types = [
        { type: 'customer', key: keys.customerKey, display: data.customerName || '' },
        { type: 'office', key: keys.officeKey, display: data.officeName || '' },
        { type: 'documentType', key: keys.documentTypeKey, display: data.documentType || '' },
        { type: 'careManager', key: keys.careManagerKey, display: data.careManager || '' },
      ];

      for (const { type, key, display } of types) {
        if (!key) continue;

        const groupId = generateGroupId(type, key);
        const existing = groupMap.get(groupId);

        const previewDoc = {
          id: docSnap.id,
          fileName: data.fileName || '',
          documentType: data.documentType || '',
          processedAt: data.processedAt || admin.firestore.Timestamp.now(),
        };

        if (existing) {
          existing.count++;
          if (existing.latestDocs.length < 3) {
            existing.latestDocs.push(previewDoc);
          }
          if (data.processedAt && data.processedAt.toMillis() > existing.latestAt.toMillis()) {
            existing.latestAt = data.processedAt;
          }
        } else {
          groupMap.set(groupId, {
            groupType: type,
            groupKey: key,
            displayName: display || key,
            count: 1,
            latestAt: data.processedAt || admin.firestore.Timestamp.now(),
            latestDocs: [previewDoc],
          });
        }
      }

      processed++;
    }

    console.log(`  スキャン: ${processed} 件`);
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  // グループデータをFirestoreに書き込み
  if (!dryRun) {
    let batchCount = 0;
    let batch = db.batch();
    let totalBatches = 0;

    for (const [groupId, data] of groupMap) {
      const groupRef = db.collection('documentGroups').doc(groupId);
      batch.set(groupRef, {
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      batchCount++;
      if (batchCount >= 500) {
        await batch.commit();
        totalBatches++;
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
      totalBatches++;
    }

    console.log(`  バッチコミット: ${totalBatches} 回`);
  }

  // 結果サマリー
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(50));
  console.log('📊 マイグレーション結果');
  console.log('='.repeat(50));
  console.log(`  処理ドキュメント: ${processed} 件`);
  console.log(`  キー更新: ${updated} 件`);
  console.log(`  グループ作成: ${groupMap.size} 件`);

  // グループタイプ別内訳
  const typeCounts = { customer: 0, office: 0, documentType: 0, careManager: 0 };
  for (const [, data] of groupMap) {
    typeCounts[data.groupType]++;
  }
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
