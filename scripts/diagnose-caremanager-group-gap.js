#!/usr/bin/env node
/**
 * 「担当CM別」集計と「顧客別」集計の件数差異を診断するread-onlyスクリプト。
 *
 * 背景: kanameone本番で「顧客別の利用者件数とCM別の利用者件数に差異がある」という
 * 報告があり調査した結果、careManagerフィールドが任意(フォールバックなし)のため
 * 集計から除外されることが判明した(customerName/officeName/documentTypeは
 * 必須フィールドでフォールバック値があるため除外されない)。
 *
 * 本スクリプトは、functions/src/utils/groupAggregation.ts の
 * rebuildAllGroupAggregations() と同一の母集団定義(status !== 'split')・
 * 同一の正規化ロジック(normalizeGroupKey)で customer/office/documentType/
 * careManager の集計を再現し、documentGroups コレクションの実測値と突合する。
 * あわせて、careManagerKey欠損の内訳(不明顧客/customerIdなし/マスターCM未設定/
 * 同期漏れ疑い)を分類する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/diagnose-caremanager-group-gap.js
 */

const path = require('path');
const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

// normalizeGroupKey は functions/src/utils/groupAggregation.ts の SSoT を直接require する
// (scripts/lib/loadTokenizer.js と同じ「compiled lib/ を共有」パターン。手書きコピーは
// scripts/migrate-document-groups.js に続く3つ目の独立コピーとなり、本番ロジック変更時に
// 気づかず乖離するリスクがあるため避ける)。
// run-ops-script.yml は本スクリプト実行前に `npm run build` (functions/) を実行済み。
const { normalizeGroupKey } = require(
  path.resolve(__dirname, '../functions/lib/functions/src/utils/groupAggregation.js'),
);

async function main() {
  // 1. documents全件走査(status別内訳を含む)。母集団はstatus!=='split'に統一する
  //    (rebuildAllGroupAggregations()のFirestoreクエリ `where('status', '!=', 'split')` と同一定義)。
  const docsSnap = await db.collection('documents').get();

  const statusBreakdown = {};
  let totalAll = 0;
  let totalNonSplit = 0;

  const recalculated = { customer: 0, office: 0, documentType: 0, careManager: 0 };
  let fumeiCustomer = 0; // customerKey正規化後 '不明顧客' 相当
  let cmMissing = 0;
  let cmMissingRealCustomer = 0; // customerNameが'不明顧客'でない
  let cmMissingNoCustomerId = 0;
  let cmMissingWithCustomerIdSample = [];

  docsSnap.forEach((doc) => {
    const d = doc.data();
    totalAll++;
    statusBreakdown[d.status] = (statusBreakdown[d.status] || 0) + 1;
    if (d.status === 'split') return;
    totalNonSplit++;

    const custKey = normalizeGroupKey(d.customerName);
    const officeKey = normalizeGroupKey(d.officeName);
    const dtKey = normalizeGroupKey(d.documentType);
    const cmKey = normalizeGroupKey(d.careManager);

    if (custKey) recalculated.customer++;
    if (officeKey) recalculated.office++;
    if (dtKey) recalculated.documentType++;
    if (cmKey) recalculated.careManager++;

    const custName = (d.customerName || '').trim();
    if (custName === '不明顧客') fumeiCustomer++;

    if (!cmKey) {
      cmMissing++;
      if (custName && custName !== '不明顧客') {
        cmMissingRealCustomer++;
        if (!d.customerId) {
          cmMissingNoCustomerId++;
        } else if (cmMissingWithCustomerIdSample.length < 50) {
          cmMissingWithCustomerIdSample.push({ id: doc.id, customerName: custName, customerId: d.customerId });
        }
      }
    }
  });

  console.log('=== documents 母集団確認 ===');
  console.log(`総件数(全status): ${totalAll}`);
  console.log('status内訳:', statusBreakdown);
  console.log(`status!=='split' (documentGroups集計対象母集団): ${totalNonSplit}\n`);

  console.log('=== customerName/officeName/documentType/careManager から動的再計算した集計 ===');
  console.log(`customerKey非空: ${recalculated.customer}`);
  console.log(`officeKey非空: ${recalculated.office}`);
  console.log(`documentTypeKey非空: ${recalculated.documentType}`);
  console.log(`careManagerKey非空: ${recalculated.careManager}`);
  console.log(`(参考)customerNameが'不明顧客': ${fumeiCustomer}\n`);

  // 2. documentGroupsコレクションの実測値
  const groupsSnap = await db.collection('documentGroups').get();
  const groupTotals = {};
  const groupCounts = {};
  groupsSnap.forEach((doc) => {
    const d = doc.data();
    groupTotals[d.groupType] = (groupTotals[d.groupType] || 0) + (d.count || 0);
    groupCounts[d.groupType] = (groupCounts[d.groupType] || 0) + 1;
  });
  console.log('=== documentGroups 実測値(count合計) ===');
  console.log('groupType別グループ数:', groupCounts);
  console.log('groupType別count合計:', groupTotals, '\n');

  // 3. 突合(動的再計算 vs documentGroups実測)
  console.log('=== 突合結果(動的再計算 vs documentGroups実測) ===');
  for (const type of ['customer', 'office', 'documentType', 'careManager']) {
    const recalc = recalculated[type];
    const measured = groupTotals[type] || 0;
    const match = recalc === measured;
    console.log(`${type}: 動的再計算=${recalc} / documentGroups実測=${measured} / 一致=${match ? '✅' : `❌ (差${recalc - measured})`}`);
  }

  // 4. careManagerKey欠損の内訳分類(Codex指摘の数値矛盾検証)
  console.log('\n=== careManagerKey欠損の内訳(status!=split母集団) ===');
  console.log(`careManagerKey欠損合計: ${cmMissing}`);
  console.log(`  うち customerName='不明顧客': ${cmMissing - cmMissingRealCustomer}`);
  console.log(`  うち 実在顧客名: ${cmMissingRealCustomer}`);
  console.log(`    うち customerIdなし: ${cmMissingNoCustomerId}`);
  console.log(`    うち customerIdあり: ${cmMissingRealCustomer - cmMissingNoCustomerId}`);

  // 5. 恒等式検証: customerKey非空(=顧客別合計) は 「careManagerKey非空(実在CM別合計)」+「careManagerKey欠損合計」に一致するはず
  console.log('\n=== 恒等式検証 ===');
  const lhs = recalculated.customer;
  const rhs = recalculated.careManager + cmMissing;
  console.log(`customerKey非空(${lhs}) = careManagerKey非空(${recalculated.careManager}) + careManagerKey欠損(${cmMissing}) = ${rhs}`);
  console.log(`一致: ${lhs === rhs ? '✅' : `❌ (差${lhs - rhs})`}`);

  // customerIdありでCM欠落しているものの、マスターのcareManagerName有無を突合(同期漏れ検出)。
  // 各取得は独立(前イテレーションの結果に依存しない)なのでPromise.allで並列化する。
  if (cmMissingWithCustomerIdSample.length > 0) {
    console.log(`\n=== customerIdありでCM欠落のサンプル最大50件、マスター突合 ===`);
    const custDocs = await Promise.all(
      cmMissingWithCustomerIdSample.map((item) =>
        db.collection('masters/customers/items').doc(item.customerId).get(),
      ),
    );

    let syncGap = 0;
    let masterAlsoEmpty = 0;
    cmMissingWithCustomerIdSample.forEach((item, i) => {
      const custDoc = custDocs[i];
      const masterCm = custDoc.exists ? (custDoc.data().careManagerName || '').trim() : '';
      if (masterCm) {
        syncGap++;
        console.log(`  [同期漏れ疑い] doc=${item.id} customer=${item.customerName} master.careManagerName="${masterCm}"`);
      } else {
        masterAlsoEmpty++;
      }
    });
    console.log(`\nサンプル内訳: 同期漏れ疑い=${syncGap}件 / マスターもCM未設定=${masterAlsoEmpty}件`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
