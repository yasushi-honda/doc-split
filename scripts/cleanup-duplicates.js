#!/usr/bin/env node
/**
 * 重複ドキュメント整理スクリプト
 *
 * 同一fileName（messageId未設定・gmail sourceType）の重複ドキュメントを検出し、
 * 各グループから最適な1件を残して他を削除する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-cocoro node scripts/cleanup-duplicates.js                # dry-run（デフォルト）
 *   FIREBASE_PROJECT_ID=docsplit-cocoro node scripts/cleanup-duplicates.js --execute      # 実行
 *   FIREBASE_PROJECT_ID=docsplit-cocoro node scripts/cleanup-duplicates.js --backup-only  # バックアップのみ
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const execute = process.argv.includes('--execute');
const backupOnly = process.argv.includes('--backup-only');

admin.initializeApp({ projectId });
const db = admin.firestore();

/**
 * ドキュメントのスコアを計算（高いほど「残すべき」）
 */
function scoreDocument(data) {
  let score = 0;

  // 顧客名が特定されている（最重要）
  if (data.customerName && data.customerName !== '不明顧客') {
    score += 1000;
  }

  // confirmed状態
  if (data.customerConfirmed === true) score += 100;
  if (data.officeConfirmed === true) score += 100;

  // extractionScoresの合計
  const scores = data.extractionScores || {};
  score += (scores.customerName || 0) + (scores.officeName || 0) +
           (scores.documentType || 0) + (scores.date || 0);

  // fileDateFormattedがある
  if (data.fileDateFormatted) score += 50;

  // careManagerが設定されている
  if (data.careManager) score += 50;

  // summaryがある
  if (data.summary) score += 10;

  return score;
}

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${execute ? '実行' : backupOnly ? 'バックアップのみ' : 'DRY RUN（変更なし）'}`);
  console.log('---\n');

  // 全ドキュメント取得
  const snap = await db.collection('documents').get();
  console.log(`総ドキュメント数: ${snap.size}`);

  // fileName でグルーピング
  const byFileName = {};
  snap.forEach((doc) => {
    const data = doc.data();
    const key = data.fileName || 'unknown';
    if (!byFileName[key]) byFileName[key] = [];
    byFileName[key].push({ id: doc.id, data });
  });

  // 重複グループのみ抽出
  const duplicateGroups = Object.entries(byFileName)
    .filter(([, docs]) => docs.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  if (duplicateGroups.length === 0) {
    console.log('重複ドキュメントはありません');
    process.exit(0);
  }

  console.log(`重複グループ: ${duplicateGroups.length}件\n`);

  const allToKeep = [];
  const allToDelete = [];
  const backupData = { exportedAt: new Date().toISOString(), projectId, groups: [] };

  for (const [fileName, docs] of duplicateGroups) {
    // スコア計算してソート（高い順）
    const scored = docs.map((d) => ({
      ...d,
      score: scoreDocument(d.data),
    })).sort((a, b) => b.score - a.score);

    const keeper = scored[0];
    const toDelete = scored.slice(1);

    console.log(`【${fileName}】 ${docs.length}件 → 残す: ${keeper.id} (score=${keeper.score}, customer="${keeper.data.customerName}")`);
    for (const d of toDelete) {
      console.log(`  削除: ${d.id} (score=${d.score}, customer="${d.data.customerName}")`);
    }
    console.log('');

    allToKeep.push(keeper);
    allToDelete.push(...toDelete);

    // バックアップデータ構築
    backupData.groups.push({
      fileName,
      totalCount: docs.length,
      keeperId: keeper.id,
      keeperScore: keeper.score,
      documents: docs.map((d) => ({ id: d.id, ...d.data })),
    });
  }

  console.log('---');
  console.log(`残す: ${allToKeep.length}件`);
  console.log(`削除対象: ${allToDelete.length}件`);

  // バックアップ保存
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `duplicate-backup-${projectId}-${Date.now()}.json`);

  // Timestampオブジェクトをシリアライズ可能に変換
  const serializable = JSON.parse(JSON.stringify(backupData, (key, value) => {
    if (value && typeof value === 'object' && '_seconds' in value && '_nanoseconds' in value) {
      return new Date(value._seconds * 1000).toISOString();
    }
    return value;
  }));

  fs.writeFileSync(backupFile, JSON.stringify(serializable, null, 2));
  console.log(`\nバックアップ保存: ${backupFile}`);

  if (backupOnly) {
    console.log('\n--backup-only モード。バックアップのみ保存しました。');
    process.exit(0);
  }

  if (!execute) {
    console.log('\nDRY RUN モード。実行するには --execute を指定してください。');
    process.exit(0);
  }

  // 実行モード: Firestoreから削除
  console.log(`\n削除実行中...`);
  const BATCH_SIZE = 500;
  for (let i = 0; i < allToDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = allToDelete.slice(i, i + BATCH_SIZE);
    for (const doc of chunk) {
      batch.delete(db.doc(`documents/${doc.id}`));
    }
    await batch.commit();
    console.log(`  ${Math.min(i + BATCH_SIZE, allToDelete.length)}/${allToDelete.length} 件削除`);
  }

  // Storage ファイル削除
  console.log('\nStorage ファイル削除中...');
  const storage = admin.storage();
  const bucket = storage.bucket();

  const keeperFileUrls = new Set(allToKeep.map((d) => d.data.fileUrl));
  let storageDeleted = 0;
  let storageSkipped = 0;

  for (const doc of allToDelete) {
    const fileUrl = doc.data.fileUrl;
    if (!fileUrl || keeperFileUrls.has(fileUrl)) {
      storageSkipped++;
      continue;
    }

    // gs://bucket/path → path 部分を抽出
    const match = fileUrl.match(/^gs:\/\/[^/]+\/(.+)$/);
    if (!match) {
      console.log(`  スキップ（URL解析不可）: ${fileUrl}`);
      storageSkipped++;
      continue;
    }

    try {
      await bucket.file(match[1]).delete();
      storageDeleted++;
    } catch (err) {
      if (err.code === 404) {
        storageSkipped++;
      } else {
        console.error(`  Storage削除エラー: ${match[1]} - ${err.message}`);
      }
    }
  }

  console.log(`  削除: ${storageDeleted}件, スキップ: ${storageSkipped}件`);

  // 最終確認
  const afterSnap = await db.collection('documents').get();
  console.log(`\n完了。ドキュメント数: ${snap.size} → ${afterSnap.size}`);

  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err.message);
  process.exit(1);
});
