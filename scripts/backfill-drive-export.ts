#!/usr/bin/env ts-node
/**
 * Google Drive エクスポート バックフィルスクリプト(ADR-0022 Phase 1、code-review指摘#43対応)
 *
 * Feature Flag(`settings/features.driveExport`)がOFFの間にverifiedされたdocumentは、
 * `functions/src/drive/driveExportTrigger.ts`が早期return(完全no-op)するため
 * `driveExportStatus`フィールド自体が一切書き込まれない。флаgをONにした後も、この
 * 「フィールド不在」のdocumentはトリガー(verified false→trueのrising edge検知のみ)にも
 * 定期スイープ(`driveExportScheduled.ts`、`driveExportStatus in ['error','exporting']`
 * のみが対象)にも一生乗らない — cocoro/kanameoneが「既存の確認済み書類を後から
 * Driveへ遡及エクスポートしたい」という本機能導入の主動機に直結する既知の穴。
 *
 * 本スクリプトはこの「バックフィル対象」docを見つけ、`driveExportStatus:'error'`を
 * 一時的にセットする。実際のDrive API呼び出し・Secret Manager アクセス・フォルダ解決等は
 * 本スクリプトでは一切行わない — 次回の定期スイープ(`driveExportScheduled.ts`、15分毎)が
 * error状態のdocを拾い、Cloud Functions内(Drive API/Secret Manager等への正規のアクセス権を
 * 持つ実行環境)で実際のエクスポートを行う。`updatedAt`を意図的にバックデートすることで、
 * 通常のエラーリトライ用1時間cooldown(直近の失敗を連続リトライしないためのガード)を
 * 待たず、次回のスイープ(最大15分後)で即座に拾われるようにする。
 *
 * 新規Cloud Function(onCall)は作らない設計方針(decision-maker確認済み、2026-07-22):
 * `scripts/fix-stuck-documents.js`等の既存の管理スクリプト慣習(--dry-run対応、
 * GitHub Actionsの"Run Operations Script"経由でも実行可能)に倣う。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-drive-export.ts --dry-run
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-drive-export.ts
 *
 * オプション:
 *   --dry-run    書込みを行わず対象件数・docIdをプレビュー
 *
 * バックログが大きい場合、`driveExportScheduled.ts`の定期スイープ(15分毎・1回10件)に
 * わたって段階的に解消される(例: 500件なら概算約12.5時間)。進捗はFEの「エラー履歴」
 * 画面のDriveエクスポートエラータブ、またはFirestore `documents`コレクションの
 * `driveExportStatus`推移で確認できる。
 */

import * as admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

admin.initializeApp({ projectId });
const db = admin.firestore();

const PAGE_SIZE = 200;

/**
 * `functions/src/drive/driveExportScheduled.ts`の`DRIVE_EXPORT_ERROR_RETRY_THRESHOLD_MS`
 * (1時間)と同じ値。`functions/src`配下のモジュールをそのままimportしない理由: それらは
 * `admin.firestore()`等のモジュールレベル副作用を持ち、TypeScriptのimportは常にファイル
 * 先頭へhoistされるため、本スクリプトの`admin.initializeApp()`より先に評価されて
 * "The default Firebase app does not exist" 等のエラーで壊れる(`scripts/`から
 * `functions/src`を安全にimportできるのは副作用のない純粋関数モジュールのみ、
 * 既存の`backfill-detail-subcollection.ts`の`ocrExcerpt.ts` import等が前例)。
 * 値を変更する場合は両方揃えること。
 */
const ERROR_RETRY_THRESHOLD_MS = 60 * 60 * 1000;
/** 次回スイープ(最大15分後)で確実に拾われるためのバッファ(閾値ちょうどの境界値レースを避ける)。 */
const BACKFILL_BACKDATE_BUFFER_MS = 5 * 60 * 1000;

const BACKFILL_ERROR_MESSAGE =
  '[backfill] Feature Flag有効化前にverifiedされたdocumentの遡及エクスポート待ち';

/** 定期スイープ側の1回あたり再エンキュー上限(DRIVE_EXPORT_SCHEDULED_BATCH_SIZE)と同じ値。 */
const SWEEP_BATCH_SIZE = 10;
const SWEEP_INTERVAL_MINUTES = 15;

async function main(): Promise<void> {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN（変更なし）' : '実行'}`);
  console.log('---');

  let totalScanned = 0;
  let totalAlreadyTracked = 0;
  let totalTargets = 0;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;

  const backdatedUpdatedAt = admin.firestore.Timestamp.fromMillis(
    Date.now() - ERROR_RETRY_THRESHOLD_MS - BACKFILL_BACKDATE_BUFFER_MS
  );

  while (hasMore) {
    let query = db
      .collection('documents')
      .where('verified', '==', true)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
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
      totalScanned++;
      const data = docSnap.data();

      // 「フィールド不在」= executeDriveExport.ts が使う「未エクスポート」の既存規約。
      // 既にexported/exporting/errorのいずれかを持つdocは通常経路(トリガー/手動リトライ/
      // 定期スイープ)で既に管理されているため対象外(二重マーク防止)。
      if ('driveExportStatus' in data) {
        totalAlreadyTracked++;
        continue;
      }

      totalTargets++;
      console.log(`  対象: ${docSnap.id} [${(data.fileName as string) || '(no name)'}]`);

      if (!dryRun) {
        batch.update(docSnap.ref, {
          driveExportStatus: 'error',
          driveExportError: BACKFILL_ERROR_MESSAGE,
          updatedAt: backdatedUpdatedAt,
        });
        batchCount++;
      }
    }

    if (!dryRun && batchCount > 0) {
      await batch.commit();
      console.log(`  ${batchCount}件を対象にマーク`);
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.docs.length === PAGE_SIZE;
  }

  console.log('\n--- 結果 ---');
  console.log(`検査: ${totalScanned}件 (verified=true)`);
  console.log(`スキップ（既にdriveExportStatus管理下）: ${totalAlreadyTracked}件`);
  console.log(`バックフィル対象${dryRun ? '(予定)' : ''}: ${totalTargets}件`);

  if (!dryRun && totalTargets > 0) {
    const estimatedRuns = Math.ceil(totalTargets / SWEEP_BATCH_SIZE);
    const estimatedMinutes = estimatedRuns * SWEEP_INTERVAL_MINUTES;
    console.log(
      `\n次回以降の定期スイープ(${SWEEP_INTERVAL_MINUTES}分毎・1回${SWEEP_BATCH_SIZE}件)で段階的に解消されます。` +
        `概算: 約${estimatedRuns}回(${estimatedMinutes}分 ≒ ${(estimatedMinutes / 60).toFixed(1)}時間)で完了見込み。` +
        '進捗はFEの「エラー履歴」画面のDriveエクスポートエラータブで確認できます。'
    );
  }

  if (dryRun) {
    console.log('\n--dry-run モードのため変更なし。実行するには --dry-run を外してください。');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
