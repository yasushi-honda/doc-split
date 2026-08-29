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
  computeDetectionOnlyStats,
  type InventoryDoc,
  type GroupSummary,
  type DetectionOnlyStats,
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

/**
 * 新旧突合(Stage1併走検証)用: multiCustomerDetected===trueのdocのみを対象クエリで取得する。
 * デフォルトのdistributionId効率スキャンはdistributionId保持docしか返さないため、
 * 「検出はされたが複製は発火していない」docを見るには本関数の専用クエリが必須
 * (codex review P1指摘対応、2026-08-30)。--full-scan時は既に全件取得済みのため呼ばない。
 */
async function fetchMultiCustomerDetectedDocs(): Promise<InventoryDoc[]> {
  const results: InventoryDoc[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;

  while (hasMore) {
    let query = db
      .collection('documents')
      .where('multiCustomerDetected', '==', true)
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

function msToIso(ms: number | null): string {
  return ms !== null ? new Date(ms).toISOString() : '(不明)';
}

function printReport(docs: InventoryDoc[], groups: GroupSummary[], detectionStats: DetectionOnlyStats): void {
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

  console.log('=== 新旧突合(multiCustomerDetectedとの比較、Stage1併走検証用) ===');
  // イベント(=1複製グループ or 1検出のみdoc)単位で比較する。複製グループのメンバー全員に
  // multiCustomerDetected:trueが伝播するため、doc実数(totalDetectedCount)をそのまま
  // グループ数と比較すると人数分に水増しされ偽の不一致に見える(codex review P2指摘対応)。
  const groupsWithoutDetection = agg.groupCount - agg.groupsWithMultiCustomerDetectedMemberCount;
  console.log(`複製グループ総数: ${agg.groupCount}件`);
  console.log(`  うち検出も伴う(multiCustomerDetected:trueのメンバーを含む): ${agg.groupsWithMultiCustomerDetectedMemberCount}件`);
  console.log(
    `  うち検出を伴わない: ${groupsWithoutDetection}件` +
      '(Stage1開始=multiCustomerDetectionフラグ有効化より前に処理された既存グループはこちらに入るのが正常。' +
      'Stage1開始後に生成されたグループでこの値が増える場合は検出条件と複製発火条件のズレを疑う)'
  );
  console.log(
    `検出のみ(distributionId無し、複製は発火していない)doc数: ${detectionStats.detectionOnlyCount}件` +
      '(検出条件==複製発火条件のため、Stage1併走中はこの件数が0付近で推移するのが正常。' +
      '増加傾向が続く場合は検出条件と複製発火条件のズレを疑う)'
  );
  console.log(
    `参考: multiCustomerDetected:trueが立っているdoc実数(document-level): ${detectionStats.totalDetectedCount}件` +
      '(複製が同時発火している場合、1件のグループに対して複数docへ同じフラグが伝播するため、' +
      '上記のイベント単位の件数とは一致しない。直接比較しないこと)'
  );
  console.log('---');

  console.log('=== 時系列(processedAt基準) ===');
  console.log(`最古のグループ内doc: ${msToIso(agg.oldestGroupProcessedAtMs)}`);
  console.log(`最新のグループ内doc: ${msToIso(agg.newestGroupProcessedAtMs)}`);
}

async function main(): Promise<void> {
  const docs = fullScan ? await fetchAllDocsFullScan() : await fetchDistributedDocs();
  const groups = summarizeAllGroups(docs);

  // --full-scan時はdocsに既に全件(distributionId無しも含む)が含まれているため追加クエリ不要。
  // デフォルト経路はdistributionId保持docしか取得していないため、検出のみ(distributionId無し)の
  // docを見るために専用クエリを別途実行する(codex review P1指摘対応)。
  const detectionSourceDocs = fullScan ? docs : await fetchMultiCustomerDetectedDocs();
  const detectionStats = computeDetectionOnlyStats(detectionSourceDocs);

  printReport(docs, groups, detectionStats);

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
          detectionStats,
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
