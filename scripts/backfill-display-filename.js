#!/usr/bin/env node
/**
 * displayFileName バックフィルスクリプト
 *
 * 既存の processed ドキュメントに displayFileName を一括設定する。
 * メタ情報（書類名・事業所・日付・顧客名）から自動生成。
 * Storage上の実ファイルは変更しない（表示用ラベルのみ）。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/backfill-display-filename.js --dry-run
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/backfill-display-filename.js
 *
 * オプション:
 *   --dry-run    変更を行わず対象と生成結果をプレビュー
 *   --force      既に displayFileName が設定済みのドキュメントも上書き
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

admin.initializeApp({ projectId });
const db = admin.firestore();

// --- generateDisplayFileName ロジック（functions/src/utils/displayFileNameGenerator.ts と同一） ---

const DEFAULT_VALUES = new Set(['未判定', '不明顧客']);

function generateDisplayFileName(input) {
  const ext = input.extension || '.pdf';
  const parts = [];

  if (input.documentType && !DEFAULT_VALUES.has(input.documentType)) {
    parts.push(input.documentType);
  }
  if (input.officeName && !DEFAULT_VALUES.has(input.officeName)) {
    parts.push(input.officeName);
  }
  if (input.fileDate) {
    const dateStr = input.fileDate.replace(/[/-]/g, '');
    if (dateStr.length >= 8) {
      parts.push(dateStr.slice(0, 8));
    }
  }
  if (input.customerName && !DEFAULT_VALUES.has(input.customerName)) {
    parts.push(input.customerName);
  }

  if (parts.length === 0) return null;

  const hasNonDatePart = parts.some((p) => !/^\d{8}$/.test(p));
  if (!hasNonDatePart) return null;

  return parts.join('_') + ext;
}

function timestampToDateString(ts) {
  if (!ts || !ts.seconds) return undefined;
  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

// --- メイン処理 ---

const BATCH_SIZE = 500;

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN（変更なし）' : '実行'}`);
  console.log(`上書き: ${force ? 'あり（既存displayFileNameも再生成）' : 'なし（未設定のみ対象）'}`);
  console.log('---');

  // processed ドキュメントを取得（split含む：分割後のドキュメントも対象）
  const targetStatuses = ['processed', 'split'];
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNoMeta = 0;

  for (const status of targetStatuses) {
    let lastDoc = null;
    let hasMore = true;

    while (hasMore) {
      let query = db
        .collection('documents')
        .where('status', '==', status)
        .orderBy('processedAt', 'desc')
        .limit(BATCH_SIZE);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) {
        hasMore = false;
        break;
      }

      const batch = db.batch();
      let batchCount = 0;

      for (const docSnap of snapshot.docs) {
        totalProcessed++;
        const data = docSnap.data();

        // 既にdisplayFileNameがある場合はスキップ（--force時は上書き）
        if (data.displayFileName && !force) {
          totalSkipped++;
          continue;
        }

        const displayFileName = generateDisplayFileName({
          documentType: data.documentType || undefined,
          customerName: data.customerName || undefined,
          officeName: data.officeName || undefined,
          fileDate: timestampToDateString(data.fileDate),
        });

        if (!displayFileName) {
          totalNoMeta++;
          if (dryRun) {
            console.log(`  SKIP (メタ不足): ${docSnap.id} [${data.fileName || '(no name)'}]`);
          }
          continue;
        }

        if (dryRun) {
          console.log(`  SET: ${docSnap.id}`);
          console.log(`       ${data.fileName || '(no name)'} → ${displayFileName}`);
        } else {
          batch.update(docSnap.ref, {
            displayFileName,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          batchCount++;
        }
        totalUpdated++;
      }

      if (!dryRun && batchCount > 0) {
        await batch.commit();
        console.log(`  ${batchCount}件を更新（${status}）`);
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      hasMore = snapshot.docs.length === BATCH_SIZE;
    }
  }

  // _migrations に記録
  if (!dryRun && totalUpdated > 0) {
    await db.collection('_migrations').doc('display_filename_backfill').set({
      status: 'completed',
      processedCount: totalProcessed,
      updatedCount: totalUpdated,
      skippedCount: totalSkipped,
      noMetaCount: totalNoMeta,
      force,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  console.log('\n--- 結果 ---');
  console.log(`検査: ${totalProcessed}件`);
  console.log(`更新${dryRun ? '予定' : '済み'}: ${totalUpdated}件`);
  console.log(`スキップ（設定済み）: ${totalSkipped}件`);
  console.log(`スキップ（メタ不足）: ${totalNoMeta}件`);

  if (dryRun) {
    console.log('\n--dry-run モードのため変更なし。実行するには --dry-run を外してください。');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
