#!/usr/bin/env ts-node
/**
 * displayFileName バックフィルスクリプト
 *
 * 既存の processed ドキュメントに displayFileName を一括設定する。
 * メタ情報（書類名・事業所・日付・顧客名）から自動生成。
 * Storage上の実ファイルは変更しない（表示用ラベルのみ）。
 *
 * #334 で shared/generateDisplayFileName + shared/timestampHelpers 統合済み。
 * 旧 inline は shared 化 (#181) の取りこぼしで、以下の silent bug を抱えていた:
 * - OS 禁止文字サニタイズ欠落 (#183 半角 + #335 全角) → shared 版で `_` 置換
 * - epoch (seconds=0) / NaN / Infinity の silent drop (#346) → shared 版で isFinite guard
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-display-filename.ts --dry-run
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-display-filename.ts
 *
 * オプション:
 *   --dry-run    変更を行わず対象と生成結果をプレビュー
 *   --force      既に displayFileName が設定済みのドキュメントも上書き
 */

import * as admin from 'firebase-admin';
import { generateDisplayFileName } from '../shared/generateDisplayFileName';
import { timestampToDateString, type TimestampLike } from '../shared/timestampHelpers';
import { detectDisplayFileNameChange } from '../shared/detectDisplayFileNameChange';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

admin.initializeApp({ projectId });
const db = admin.firestore();

const BATCH_SIZE = 500;

async function main(): Promise<void> {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN（変更なし）' : '実行'}`);
  console.log(`上書き: ${force ? 'あり（既存displayFileNameも再生成）' : 'なし（未設定のみ対象）'}`);
  if (force) {
    // #334: shared 版サニタイズ (半角 \ / : * ? " < > | + 全角相当 + 制御文字 → "_") を適用。
    // 詳細は shared/generateDisplayFileName.ts 参照。operator が変化を把握できるよう old → new 差分を CHANGE ログで出す。
    console.log('⚠️  --force: 既存 displayFileName を shared 版サニタイズで再生成します。');
    console.log('    禁止文字 (\\ / : * ? " < > |) や全角相当・制御文字を含む既存値は変換されます（shared 版サニタイズ適用のため）。');
  }
  console.log('---');

  const targetStatuses = ['processed', 'split'];
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNoMeta = 0;
  let totalChanged = 0;

  for (const status of targetStatuses) {
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
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

        if (data.displayFileName && !force) {
          totalSkipped++;
          continue;
        }

        const displayFileName = generateDisplayFileName({
          documentType: data.documentType || undefined,
          customerName: data.customerName || undefined,
          officeName: data.officeName || undefined,
          fileDate: timestampToDateString(data.fileDate as TimestampLike | null | undefined),
        });

        if (!displayFileName) {
          totalNoMeta++;
          if (dryRun) {
            console.log(`  SKIP (メタ不足): ${docSnap.id} [${data.fileName || '(no name)'}]`);
          }
          continue;
        }

        // #334: --force 時の silent 書き換え検知用。判定は純粋関数 detectDisplayFileNameChange
        // に委譲 (#358 I1 でテスト lock-in 済み)。
        const oldDisplayFileName: string | undefined = data.displayFileName;
        const action = detectDisplayFileNameChange(oldDisplayFileName, displayFileName);

        if (action === 'noop') {
          // 既存 displayFileName が新生成値と一致 → 書き込み不要
          totalSkipped++;
          continue;
        }
        // noop 以降は 'change' | 'set' のみ。将来の enum 拡張で silent に SET に落ちるのを
        // 防ぐため exhaustive 判定で assertNever する (#358 code-simplifier S2)。
        if (action === 'change') {
          console.log(`  CHANGE: ${docSnap.id} "${oldDisplayFileName}" → "${displayFileName}"`);
        } else if (action === 'set') {
          console.log(`  SET: ${docSnap.id} ${data.fileName || '(no name)'} → ${displayFileName}`);
        } else {
          const _exhaustive: never = action;
          throw new Error(`Unexpected DisplayFileNameChange: ${String(_exhaustive)}`);
        }

        if (!dryRun) {
          batch.update(docSnap.ref, {
            displayFileName,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          batchCount++;
        }
        // totalChanged は totalUpdated の subset (change + set の合計 = totalUpdated)。
        if (action === 'change') totalChanged++;
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

  if (!dryRun && totalUpdated > 0) {
    await db.collection('_migrations').doc('display_filename_backfill').set({
      status: 'completed',
      processedCount: totalProcessed,
      updatedCount: totalUpdated,
      skippedCount: totalSkipped,
      noMetaCount: totalNoMeta,
      changedCount: totalChanged,
      force,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  console.log('\n--- 結果 ---');
  console.log(`検査: ${totalProcessed}件`);
  console.log(`更新${dryRun ? '予定' : '済み'}: ${totalUpdated}件`);
  if (force) {
    console.log(`  うち既存値からの変更: ${totalChanged}件`);
  }
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
