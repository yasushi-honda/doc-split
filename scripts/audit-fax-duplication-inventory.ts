#!/usr/bin/env ts-node
/**
 * 複数顧客FAX複製 既存doc read-only棚卸し(PR-D、docs/adr/0024-multi-customer-detection.md Stage3)
 *
 * `distributionId`で紐付いた既存の複製グループ(元doc + 複製コピー)の構造・確定/確認状態・
 * Drive出力状態・時系列・新旧突合(`multiCustomerDetected`との比較)を集計する。
 * read-only。書込みは一切行わない(AC-7、下記grepで検証可能)。
 *
 * デフォルトは `orderBy('distributionId')` による効率スキャン(当該フィールドを持つdocのみ
 * 返るため全件スキャン不要・新規インデックス不要)。`--full-scan` で全件走査にフォールバック
 * できる(index異常や集計の食い違いを疑う場合の検証用)。
 *
 * 既存の複製docは棚卸しのみ。統合・削除は本スクリプトのスコープ外
 * (各コピーは個別の顧客確定・Drive出力状態・手編集差分を持ちうるため自動削除は危険。
 * `scripts/lib/faxDuplicationCleanupHelpers.js` のJSDoc参照)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/audit-fax-duplication-inventory.ts
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/audit-fax-duplication-inventory.ts --full-scan
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/audit-fax-duplication-inventory.ts --json-out /tmp/inventory.json
 *
 * オプション:
 *   --full-scan        distributionId有無に関わらずdocumentsコレクション全件を走査する
 *                       (デフォルトのorderBy('distributionId')効率スキャンとの集計差異を
 *                       検証したい場合に使う。documents件数に比例してコストが増える)
 *   --json-out <path>  集計結果(グループ一覧込み)をJSONファイルへ出力する
 *                       (GHA実行時はartifact経由で取得する。Cloud Loggingのsecret masking
 *                       で`{`が伏字になる既知問題の回避)
 */

import * as fs from 'fs';
import * as admin from 'firebase-admin';
import {
  summarizeAllGroups,
  aggregateGroups,
  type InventoryDoc,
  type GroupSummary,
} from './lib/faxDuplicationInventory';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const fullScan = process.argv.includes('--full-scan');

function getOpt(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const jsonOutPath = getOpt('--json-out');

admin.initializeApp({ projectId });
const db = admin.firestore();

const PAGE_SIZE = 500;

function toInventoryDoc(docSnap: FirebaseFirestore.QueryDocumentSnapshot): InventoryDoc {
  const data = docSnap.data();
  const processedAt = data.processedAt as FirebaseFirestore.Timestamp | undefined;
  return {
    id: docSnap.id,
    distributionId: (data.distributionId as string | undefined) ?? null,
    customerConfirmed: data.customerConfirmed === true,
    verified: data.verified === true,
    driveExportStatus: (data.driveExportStatus as string | undefined) ?? null,
    multiCustomerDetected: data.multiCustomerDetected === true,
    multiCustomerCount: typeof data.multiCustomerCount === 'number' ? data.multiCustomerCount : null,
    processedAtMs: processedAt?.toMillis?.() ?? null,
  };
}

/** デフォルト経路: distributionIdを持つdocのみをorderBy('distributionId')で効率的に取得する。 */
async function fetchDistributedDocs(): Promise<InventoryDoc[]> {
  const results: InventoryDoc[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;

  while (hasMore) {
    let query = db
      .collection('documents')
      .orderBy('distributionId')
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
      results.push(toInventoryDoc(docSnap));
    }
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.docs.length === PAGE_SIZE;
  }

  return results;
}

/** --full-scan経路: documentsコレクション全件を走査する(distributionId有無を問わない)。 */
async function fetchAllDocsFullScan(): Promise<InventoryDoc[]> {
  const results: InventoryDoc[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;

  while (hasMore) {
    let query = db.collection('documents').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
    const snapshot = await query.get();
    if (snapshot.empty) {
      hasMore = false;
      break;
    }
    for (const docSnap of snapshot.docs) {
      results.push(toInventoryDoc(docSnap));
    }
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.docs.length === PAGE_SIZE;
  }

  return results;
}

function msToIso(ms: number | null): string {
  return ms !== null ? new Date(ms).toISOString() : '(不明)';
}

function printReport(docs: InventoryDoc[], groups: GroupSummary[]): void {
  const agg = aggregateGroups(groups);

  console.log(`プロジェクト: ${projectId}`);
  console.log('モード: read-only(書込みなし)');
  console.log(`走査方式: ${fullScan ? '--full-scan(documents全件走査)' : "orderBy('distributionId')効率スキャン"}`);
  console.log(`走査したdocument数: ${docs.length}件`);
  console.log('---');

  console.log('=== グループ構造 ===');
  console.log(`グループ数: ${agg.groupCount}`);
  console.log(`グループに属するdoc総数: ${agg.totalDocCount}`);
  const sizes = Object.keys(agg.sizeDistribution)
    .map(Number)
    .sort((a, b) => a - b);
  for (const size of sizes) {
    console.log(`  サイズ${size}(1元doc+${size - 1}コピー): ${agg.sizeDistribution[size]}グループ`);
  }
  if (agg.missingOriginalGroupIds.length > 0) {
    console.log(`⚠️  元doc欠落グループ: ${agg.missingOriginalGroupIds.length}件(データ異常の可能性)`);
    for (const id of agg.missingOriginalGroupIds) {
      console.log(`    - ${id}`);
    }
  } else {
    console.log('元doc欠落グループ: 0件');
  }
  console.log('---');

  console.log('=== 確定・確認状態 ===');
  console.log(
    `顧客確定(customerConfirmed): 全員確定済み ${agg.fullyConfirmedGroupCount}グループ / 一部のみ ${agg.partiallyConfirmedGroupCount}グループ / 未確定メンバー総数 ${agg.totalDocCount - agg.totalConfirmedMemberCount}件`
  );
  console.log(
    `確認(verified): 全員確認済み ${agg.fullyVerifiedGroupCount}グループ / 一部のみ ${agg.partiallyVerifiedGroupCount}グループ / 未確認メンバー総数 ${agg.totalDocCount - agg.totalVerifiedMemberCount}件`
  );
  console.log('---');

  console.log('=== Drive出力状態 ===');
  console.log(`Drive出力済みメンバーを含むグループ数: ${agg.groupsWithDriveExportedMemberCount}`);
  console.log(`Drive出力済みメンバー総数: ${agg.totalDriveExportedMemberCount}`);
  console.log('---');

  console.log('=== 新旧突合(multiCustomerDetectedとの比較) ===');
  console.log(
    `multiCustomerDetected:trueのメンバーを含む複製グループ数: ${agg.groupsWithMultiCustomerDetectedMemberCount}` +
      '(Stage1併走以前は0が正常。Stage1中は複製発火集合との一致率確認に使う)'
  );
  console.log('---');

  console.log('=== 時系列(processedAt基準) ===');
  console.log(`最古のグループ内doc: ${msToIso(agg.oldestGroupProcessedAtMs)}`);
  console.log(`最新のグループ内doc: ${msToIso(agg.newestGroupProcessedAtMs)}`);
}

async function main(): Promise<void> {
  const docs = fullScan ? await fetchAllDocsFullScan() : await fetchDistributedDocs();
  const groups = summarizeAllGroups(docs);

  printReport(docs, groups);

  if (jsonOutPath) {
    const agg = aggregateGroups(groups);
    fs.writeFileSync(
      jsonOutPath,
      JSON.stringify(
        {
          projectId,
          fullScan,
          scannedDocCount: docs.length,
          aggregate: agg,
          groups,
        },
        null,
        2
      ),
      'utf-8'
    );
    console.log('---');
    console.log(`JSON出力: ${jsonOutPath}`);
  }

  await admin.app().delete();
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
