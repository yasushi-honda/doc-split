/**
 * Issue #1036 (マスター一括修正用のCSVダウンロード/編集機能) E2E検証用シードスクリプト
 *
 * 固定doc IDの顧客を1件作成する。E2E側でCSVエクスポート→編集→再インポートの
 * ラウンドトリップを検証する際、doc IDを事前に把握できるようにするため固定IDにする。
 *
 * 使用方法:
 *   FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-issue-1036-csv-export.js
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const projectId = process.env.GCLOUD_PROJECT || 'doc-split-dev';
initializeApp({ projectId });
const db = getFirestore();

const CUSTOMER_ID = 'issue1036-cust-1';
const CUSTOMER_NAME = '検証太郎(Issue1036)';
const CLI_CAREMANAGER_NAME = '検証CLI花子(Issue1036)';

async function main() {
  console.log('🚀 Issue #1036検証用シードデータ作成開始');
  console.log(`プロジェクト: ${projectId}\n`);

  await db.collection('masters/customers/items').doc(CUSTOMER_ID).set({
    name: CUSTOMER_NAME,
    furigana: 'ケンショウタロウ(Issue1036)',
    isDuplicate: false,
    careManagerName: '検証花子(Issue1036)', // 空欄=変更しないルールの検証用(E2Eでcareマネ列を空欄にして再インポートしても残ることを確認)
    notes: '初期備考(Issue1036)',
    aliases: ['初期別表記(Issue1036)'],
  });
  console.log(`✅ 顧客マスター1件作成(id=${CUSTOMER_ID}, name=${CUSTOMER_NAME})`);

  // CLI(scripts/import-masters.js importCareManagers)相当のdoc()自動採番IDを再現。
  // UI経由の新規作成(useAddCareManager)はdoc ID=正規化した名前だが、CLI由来は自動ID。
  // 実機確認でこのケアマネへのCSV上書きが実doc IDで成功することを確認する(/plan-crossreview反映#4)
  const cliDocRef = db.collection('masters/caremanagers/items').doc();
  await cliDocRef.set({ name: CLI_CAREMANAGER_NAME });
  console.log(`✅ ケアマネマスター1件作成(CLI相当の自動ID=${cliDocRef.id}, name=${CLI_CAREMANAGER_NAME})`);

  console.log('\n✅ Issue #1036検証用シードデータ作成完了');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
