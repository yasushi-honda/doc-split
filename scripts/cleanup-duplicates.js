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
const { planGroupCleanup } = require('./lib/faxDuplicationCleanupHelpers');

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
  const escalatedGroups = [];
  // 複製配信docのfileUrl(D2: Storage実体は共有)。同一fileNameグループ内の非配信重複を
  // 削除する際、偶然同じfileUrlを参照していても複製配信doc側がまだ生きている限り
  // Storage実体を削除してはならない(誤削除防止、AC-h)。
  const allDistributedFileUrls = [];
  const backupData = { exportedAt: new Date().toISOString(), projectId, groups: [] };

  for (const [fileName, docs] of duplicateGroups) {
    // kanameone現場要件「複数顧客FAX複製機能」(GOAL.md D4/AC-d) v1中間案:
    // distributionId保持docは削除対象から除外する。同一fileNameグループに複数の
    // distributionId(=複数の複製グループ)が混在する場合は想定外の複合事象のため、
    // 自動削除はせずWARNで人間にエスカレーションする(フル案=distributionId単位の
    // スコアリング削除は、実際の複合事象が観測されてから検討する)。判定ロジック自体は
    // lib/faxDuplicationCleanupHelpers.js に抽出しユニットテスト済み。
    const { escalate, distributionIds, distributedDocs, plainDocs } = planGroupCleanup(docs);

    if (escalate) {
      console.warn(
        `⚠️  【${fileName}】 同一ファイル名内に複数のdistributionId(複製グループ)が混在しています: ` +
          `${distributionIds.join(', ')}。自動削除はスキップします。人手で確認してください。`
      );
      escalatedGroups.push({ fileName, distributionIds });
      continue;
    }

    if (distributedDocs.length > 0) {
      console.log(
        `【${fileName}】 ${docs.length}件中${distributedDocs.length}件は複製配信` +
          `(distributionId=${distributionIds[0]})のため削除対象から除外`
      );
      allDistributedFileUrls.push(...distributedDocs.map((d) => d.data.fileUrl));
    }

    if (plainDocs.length <= 1) {
      // distributionId保持分を除くと重複ではない(複製配信のみのグループ等)
      if (plainDocs.length === 1) console.log('');
      continue;
    }

    // スコア計算してソート（高い順）: 以降はdistributionId非保持docのみを対象にする
    const scored = plainDocs.map((d) => ({
      ...d,
      score: scoreDocument(d.data),
    })).sort((a, b) => b.score - a.score);

    const keeper = scored[0];
    const toDelete = scored.slice(1);

    console.log(`【${fileName}】 ${plainDocs.length}件 → 残す: ${keeper.id} (score=${keeper.score}, customer="${keeper.data.customerName}")`);
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
  if (escalatedGroups.length > 0) {
    console.log(`⚠️  エスカレーション(複数distributionId混在・要人手確認): ${escalatedGroups.length}件`);
    for (const g of escalatedGroups) {
      console.log(`  ${g.fileName}: ${g.distributionIds.join(', ')}`);
    }
  }

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
  // ADR-0018 (Issue #547) Phase B: 本体+detail/main の2書込のため
  // batch内訳は 2N ≤ 500 → N ≤ 250 が安全な上限
  const BATCH_SIZE = 250;
  for (let i = 0; i < allToDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = allToDelete.slice(i, i + BATCH_SIZE);
    for (const doc of chunk) {
      batch.delete(db.doc(`documents/${doc.id}`));
      batch.delete(db.doc(`documents/${doc.id}/detail/main`));
    }
    await batch.commit();
    console.log(`  ${Math.min(i + BATCH_SIZE, allToDelete.length)}/${allToDelete.length} 件削除`);
  }

  // Storage ファイル削除
  console.log('\nStorage ファイル削除中...');
  const storage = admin.storage();
  const bucket = storage.bucket();

  const keeperFileUrls = new Set([
    ...allToKeep.map((d) => d.data.fileUrl),
    ...allDistributedFileUrls,
  ]);
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
