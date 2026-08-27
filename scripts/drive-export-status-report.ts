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
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/drive-export-status-report.ts --breakdown
 *
 * オプション:
 *   --breakdown  error(実エラー)をdriveExportErrorメッセージの先頭40文字でグルーピングし、
 *                件数・最古/最新updatedAtを表示する(2026-08-27追加。PR #840の一時的な回帰
 *                (AmbiguousFolderError)がどの程度の実エラー滞留に寄与しているか切り分ける用途)
 */

import * as admin from 'firebase-admin';
import { classifyDriveExportError } from './lib/driveExportBackfillHelpers';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const showBreakdown = process.argv.includes('--breakdown');

admin.initializeApp({ projectId });
const db = admin.firestore();

const PAGE_SIZE = 500;

interface StatusCounts {
  totalVerified: number;
  exported: number;
  exporting: number;
  errorBackfillMarker: number;
  errorCustomerUnconfirmed: number;
  errorReal: number;
  fieldAbsent: number;
  realErrorEntries: { message: string; updatedAtMs: number | null }[];
}

async function computeStatusCounts(): Promise<StatusCounts> {
  const counts: StatusCounts = {
    totalVerified: 0,
    exported: 0,
    exporting: 0,
    errorBackfillMarker: 0,
    errorCustomerUnconfirmed: 0,
    errorReal: 0,
    fieldAbsent: 0,
    realErrorEntries: [],
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
        const errorClass = classifyDriveExportError(data.driveExportError);
        if (errorClass === 'backfill-marker') {
          counts.errorBackfillMarker++;
        } else if (errorClass === 'customer-unconfirmed') {
          counts.errorCustomerUnconfirmed++;
        } else {
          counts.errorReal++;
          if (showBreakdown) {
            const updatedAt = data.updatedAt as FirebaseFirestore.Timestamp | undefined;
            counts.realErrorEntries.push({
              message: String(data.driveExportError ?? '(メッセージなし)'),
              updatedAtMs: updatedAt?.toMillis?.() ?? null,
            });
          }
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
  console.log(
    `  error(顧客未確定):          ${counts.errorCustomerUnconfirmed}件  → 書類詳細で顧客を確定すると自動再試行されます(同姓同名リスク対応)`
  );
  console.log(`  error(実エラー):            ${counts.errorReal}件  (実エラー比率: ${(realErrorRatio * 100).toFixed(1)}%)`);
  console.log(`  フィールド不在(未backfill): ${counts.fieldAbsent}件`);
  console.log('---');
  // entry gateの error=0 条件には顧客未確定分も含める(滞留docゼロという意図を維持)。
  // 一方、realErrorRatio(異常停止基準)には含めない(顧客未確定は運用課題でありDrive API異常のシグナルではないため)。
  console.log(
    `Stage D entry gate(flag ON前提): error=0 かつ exporting=0 ${
      counts.exporting === 0 &&
      counts.errorBackfillMarker === 0 &&
      counts.errorCustomerUnconfirmed === 0 &&
      counts.errorReal === 0
        ? '✅ 満たしている'
        : '❌ 満たしていない(既存の滞留docがあるため、flag ONで意図しないdocも巻き込まれうる)'
    }`
  );
  if (realErrorRatio > 0.2) {
    console.log('⚠️  実エラー比率が20%を超えています。異常停止基準(Codex High指摘#5)に該当する可能性があります。');
  }

  if (showBreakdown) {
    console.log('---');
    console.log('=== error(実エラー)内訳(メッセージ先頭40文字でグルーピング) ===');
    const groups = new Map<string, { count: number; oldestMs: number | null; newestMs: number | null }>();
    for (const entry of counts.realErrorEntries) {
      const key = entry.message.slice(0, 40);
      const g = groups.get(key) ?? { count: 0, oldestMs: null, newestMs: null };
      g.count++;
      if (entry.updatedAtMs !== null) {
        if (g.oldestMs === null || entry.updatedAtMs < g.oldestMs) g.oldestMs = entry.updatedAtMs;
        if (g.newestMs === null || entry.updatedAtMs > g.newestMs) g.newestMs = entry.updatedAtMs;
      }
      groups.set(key, g);
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [key, g] of sorted) {
      const oldest = g.oldestMs !== null ? new Date(g.oldestMs).toISOString() : '(不明)';
      const newest = g.newestMs !== null ? new Date(g.newestMs).toISOString() : '(不明)';
      console.log(`  ${g.count}件  最古=${oldest} 最新=${newest}  "${key}..."`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
