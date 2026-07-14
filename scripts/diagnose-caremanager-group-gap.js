#!/usr/bin/env node
/**
 * 「担当CM別」集計と「顧客別」集計の件数差異を診断するread-onlyスクリプト。
 *
 * 背景: kanameone本番で「顧客別の利用者件数とCM別の利用者件数に差異がある」という
 * 報告があり調査した結果、careManagerフィールドが任意(フォールバックなし)のため
 * 集計から除外されることが判明した(customerName/officeName/documentTypeは
 * 必須フィールドでフォールバック値があるため除外されない)。Task A(#656)でこの
 * 非対称性を修正し、careManagerKeyが空でもcustomerKeyが非空なら予約key
 * (`__UNASSIGNED_CARE_MANAGER__`、表示名「CM未設定」)で集計対象に含めるよう
 * functions/src/utils/groupAggregation.ts の resolveGroupKeyAndDisplay() を実装した。
 *
 * 本スクリプトは、rebuildAllGroupAggregations()/getAffectedGroups()と同一の
 * generateGroupKeys()/resolveGroupKeyAndDisplay()をSSoTから直接requireして動的に
 * 期待集計(groupId単位)を計算し、documentGroupsコレクションの実測値と突合する。
 * 手書きの正規化ロジック(normalizeGroupKeyのみ参照)は使わない — Task A適用前は
 * この方式だったため、A適用後にCM未設定フォールバックを考慮せず偽陽性の不一致を
 * 報告していた(GOAL.md タスクG session131で修正、Codex指摘: 合計一致だけでは
 * 別groupIdの過大・過小が相殺されて見逃すため、groupId単位の個別比較も追加)。
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

// generateGroupKeys/generateGroupId/resolveGroupKeyAndDisplay は
// functions/src/utils/groupAggregation.ts の SSoT を直接require する
// (scripts/lib/loadTokenizer.js と同じ「compiled lib/ を共有」パターン。手書きコピーは
// scripts/migrate-document-groups.js に続く3つ目の独立コピーとなり、本番ロジック変更時に
// 気づかず乖離するリスクがあるため避ける)。
// run-ops-script.yml は本スクリプト実行前に `npm run build` (functions/) を実行済み。
const { generateGroupKeys, generateGroupId, resolveGroupKeyAndDisplay } = require(
  path.resolve(__dirname, '../functions/lib/functions/src/utils/groupAggregation.js'),
);

async function main() {
  // 1. documents全件走査(status別内訳を含む)。母集団はstatus!=='split'に統一する
  //    (rebuildAllGroupAggregations()のFirestoreクエリ `where('status', '!=', 'split')` と同一定義)。
  const docsSnap = await db.collection('documents').get();

  const statusBreakdown = {};
  let totalAll = 0;
  let totalNonSplit = 0;

  // groupId -> { groupType, groupKey, displayName, count }。resolveGroupKeyAndDisplay()の
  // 判定を通過した(=documentGroupsに計上されるべき)組み合わせのみを積み上げる。
  const expectedGroupMap = new Map();
  const recalculated = { customer: 0, office: 0, documentType: 0, careManager: 0 };
  let fumeiCustomer = 0; // customerNameが'不明顧客'相当
  let cmMissing = 0; // careManagerKey空 かつ customerKey非空(=CM未設定に計上される母集団)
  let cmMissingRealCustomer = 0; // customerNameが'不明顧客'でない
  let cmMissingNoCustomerId = 0;
  let cmMissingWithCustomerIdSample = [];

  docsSnap.forEach((doc) => {
    const d = doc.data();
    totalAll++;
    statusBreakdown[d.status] = (statusBreakdown[d.status] || 0) + 1;
    // rebuildAllGroupAggregations()/backfillUnassignedCareManagerGroup()が使う
    // Firestoreの`where('status','!=','split')`クエリと同一の母集団にする。この不等号
    // クエリはstatusフィールド自体が存在しない文書を自動的に除外するため、JS側でも
    // `d.status === 'split'`のみのチェックでは不十分(status未設定文書を誤って含めてしまう
    // 非対称性が生じる、/code-review high指摘)。
    if (d.status === undefined || d.status === 'split') return;
    totalNonSplit++;

    const keys = generateGroupKeys(d);
    const types = [
      { type: 'customer', key: keys.customerKey, display: d.customerName },
      { type: 'office', key: keys.officeKey, display: d.officeName },
      { type: 'documentType', key: keys.documentTypeKey, display: d.documentType },
      { type: 'careManager', key: keys.careManagerKey, display: d.careManager },
    ];

    for (const { type, key, display } of types) {
      const resolved = resolveGroupKeyAndDisplay(type, key, display, !!keys.customerKey);
      if (!resolved) continue;

      recalculated[type]++;
      const groupId = generateGroupId(type, resolved.key);
      const existing = expectedGroupMap.get(groupId);
      if (existing) {
        existing.count++;
      } else {
        expectedGroupMap.set(groupId, {
          groupType: type,
          groupKey: resolved.key,
          displayName: resolved.displayName,
          count: 1,
        });
      }
    }

    const custName = (d.customerName || '').trim();
    if (custName === '不明顧客') fumeiCustomer++;

    if (keys.careManagerKey === '' && keys.customerKey !== '') {
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

  console.log('=== 動的再計算した期待集計(resolveGroupKeyAndDisplay経由、CM未設定フォールバック込み) ===');
  console.log(`customer: ${recalculated.customer}`);
  console.log(`office: ${recalculated.office}`);
  console.log(`documentType: ${recalculated.documentType}`);
  console.log(`careManager(実CM + CM未設定): ${recalculated.careManager}`);
  console.log(`(参考)customerNameが'不明顧客': ${fumeiCustomer}\n`);

  // 2. documentGroupsコレクションの実測値(groupId単位も保持)
  const groupsSnap = await db.collection('documentGroups').get();
  const actualGroupMap = new Map();
  const groupTotals = {};
  const groupCounts = {};
  groupsSnap.forEach((doc) => {
    const d = doc.data();
    actualGroupMap.set(doc.id, {
      groupType: d.groupType,
      groupKey: d.groupKey,
      displayName: d.displayName,
      count: d.count || 0,
    });
    groupTotals[d.groupType] = (groupTotals[d.groupType] || 0) + (d.count || 0);
    groupCounts[d.groupType] = (groupCounts[d.groupType] || 0) + 1;
  });
  console.log('=== documentGroups 実測値(count合計) ===');
  console.log('groupType別グループ数:', groupCounts);
  console.log('groupType別count合計:', groupTotals, '\n');

  // 3. 突合(type別合計)。合計一致は別groupIdの過大・過小が相殺されると成立してしまうため、
  //    参考情報に留め、真の一致性確認は次のgroupId単位比較で行う。
  console.log('=== 突合結果(動的再計算 vs documentGroups実測、type別合計) ===');
  for (const type of ['customer', 'office', 'documentType', 'careManager']) {
    const recalc = recalculated[type];
    const measured = groupTotals[type] || 0;
    const match = recalc === measured;
    console.log(`${type}: 動的再計算=${recalc} / documentGroups実測=${measured} / 一致=${match ? '✅' : `❌ (差${recalc - measured})`}`);
  }

  // 3.5. groupId単位の個別比較(Codex指摘反映: 合計一致だけでは相殺を見逃す)
  console.log('\n=== groupId単位の個別比較(期待値 vs 実測値) ===');
  const allGroupIds = new Set([...expectedGroupMap.keys(), ...actualGroupMap.keys()]);
  let mismatchCount = 0;
  for (const groupId of allGroupIds) {
    const expected = expectedGroupMap.get(groupId);
    const actual = actualGroupMap.get(groupId);
    const expectedCount = expected ? expected.count : 0;
    const actualCount = actual ? actual.count : 0;
    if (expectedCount !== actualCount) {
      mismatchCount++;
      const label = (expected && expected.displayName) || (actual && actual.displayName) || groupId;
      console.log(`  ❌ ${groupId} (${label}): 期待値=${expectedCount} 実測値=${actualCount} (差${expectedCount - actualCount})`);
    }
  }
  console.log(
    mismatchCount === 0
      ? '  ✅ 全groupIdで一致(相殺による見逃しなし)'
      : `  ⚠️  ${mismatchCount} 件のgroupIdで不一致を検出`
  );

  // 4. careManagerKey欠損の内訳分類(CM未設定に計上される母集団の内訳、Codex指摘の数値矛盾検証)
  console.log('\n=== CM未設定計上対象(careManagerKey空 かつ customerKey非空)の内訳 ===');
  console.log(`CM未設定計上対象合計: ${cmMissing}`);
  console.log(`  うち customerName='不明顧客': ${cmMissing - cmMissingRealCustomer}`);
  console.log(`  うち 実在顧客名: ${cmMissingRealCustomer}`);
  console.log(`    うち customerIdなし: ${cmMissingNoCustomerId}`);
  console.log(`    うち customerIdあり: ${cmMissingRealCustomer - cmMissingNoCustomerId}`);

  // 5. 恒等式検証: customer(顧客別合計)は必ずcareManager(実CM+CM未設定合計)と一致するはず
  //    (Task Aの不変条件「顧客別に計上される書類は必ず担当CM別にも計上される」)
  console.log('\n=== 恒等式検証 ===');
  const lhs = recalculated.customer;
  const rhs = recalculated.careManager;
  console.log(`customer(${lhs}) = careManager実CM+CM未設定合計(${rhs})`);
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
