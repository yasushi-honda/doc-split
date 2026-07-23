#!/usr/bin/env ts-node
/**
 * Google Drive エクスポート 状態分布レポート(Phase D/E再設計、Codex High指摘#5対応)
 *
 * read-only。段階的展開(Stage D/E)の完了時間・異常停止判定に使う`driveExportStatus`
 * 分布を集計する。書込みは一切行わない。
 *
 * - Firestoreは「フィールド不在」を直接queryできないため、残backfill候補数は
 *   `verified==true総数 - (exported+exporting+error)`で算出する。
 * - errorは「backfillが一時的にセットしたsentinelメッセージ」と「実際のDrive APIエラー」を
 *   分割表示する(前者はcanary/backfillの進捗、後者はStage Eの異常停止基準の主要シグナル)。
 * - Stage D entry gate(GOAL.md runbook): flag ONの前に error=0 かつ exporting=0 を
 *   確認するためにも使う(既存の滞留docがある状態でflagを上げると「1件だけexport」の
 *   前提が崩れる)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/drive-export-status-report.ts
 */

import * as admin from 'firebase-admin';
import { BACKFILL_ERROR_MESSAGE } from './lib/driveExportBackfillHelpers';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const PAGE_SIZE = 500;

interface StatusCounts {
  totalVerified: number;
  exported: number;
  exporting: number;
  errorBackfillMarker: number;
  errorReal: number;
  fieldAbsent: number;
}

async function computeStatusCounts(): Promise<StatusCounts> {
  const counts: StatusCounts = {
    totalVerified: 0,
    exported: 0,
    exporting: 0,
    errorBackfillMarker: 0,
    errorReal: 0,
    fieldAbsent: 0,
  };

  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;

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

    for (const docSnap of snapshot.docs) {
      counts.totalVerified++;
      const data = docSnap.data();
      const status = data.driveExportStatus as string | undefined;
      if (status === 'exported') {
        counts.exported++;
      } else if (status === 'exporting') {
        counts.exporting++;
      } else if (status === 'error') {
        if (data.driveExportError === BACKFILL_ERROR_MESSAGE) {
          counts.errorBackfillMarker++;
        } else {
          counts.errorReal++;
        }
      } else {
        counts.fieldAbsent++;
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.docs.length === PAGE_SIZE;
  }

  return counts;
}

async function main(): Promise<void> {
  console.log(`プロジェクト: ${projectId}`);
  console.log('モード: read-only(書込みなし)');
  console.log('---');

  const counts = await computeStatusCounts();
  const realErrorRatio = counts.totalVerified > 0 ? counts.errorReal / counts.totalVerified : 0;

  console.log(`verified==true 総数: ${counts.totalVerified}件`);
  console.log(`  exported:                  ${counts.exported}件`);
  console.log(`  exporting(処理中):          ${counts.exporting}件`);
  console.log(`  error(backfillマーカー):    ${counts.errorBackfillMarker}件`);
  console.log(`  error(実エラー):            ${counts.errorReal}件  (実エラー比率: ${(realErrorRatio * 100).toFixed(1)}%)`);
  console.log(`  フィールド不在(未backfill): ${counts.fieldAbsent}件`);
  console.log('---');
  console.log(
    `Stage D entry gate(flag ON前提): error=0 かつ exporting=0 ${
      counts.exporting === 0 && counts.errorBackfillMarker === 0 && counts.errorReal === 0
        ? '✅ 満たしている'
        : '❌ 満たしていない(既存の滞留docがあるため、flag ONで意図しないdocも巻き込まれうる)'
    }`
  );
  if (realErrorRatio > 0.2) {
    console.log('⚠️  実エラー比率が20%を超えています。異常停止基準(Codex High指摘#5)に該当する可能性があります。');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
