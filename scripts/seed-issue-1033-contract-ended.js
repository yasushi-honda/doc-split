/**
 * Issue #1033 (契約終了した利用者を書類画面から既定で非表示にする) 実機検証用シードスクリプト
 *
 * scripts/seed-issue-1032-caremanager.js と同様、正規化キー(customerKey/careManagerKey)と
 * documentGroupsはfunctions emulatorのupdateDocumentGroupsトリガーに委ねる。
 *
 * 使用方法:
 *   FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-issue-1033-contract-ended.js
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const projectId = process.env.GCLOUD_PROJECT || 'doc-split-dev';
initializeApp({ projectId });
const db = getFirestore();

const CARE_MANAGER = '検証三郎(Issue1033)';
const CUSTOMER_ENDED = { id: 'issue1033-cust-ended', name: '契約終了太郎(Issue1033)' };
const CUSTOMER_ACTIVE = { id: 'issue1033-cust-active', name: '契約中花子(Issue1033)' };

async function main() {
  console.log('🚀 Issue #1033検証用シードデータ作成開始');
  console.log(`プロジェクト: ${projectId}\n`);

  // 顧客マスター(契約終了フラグ付き)
  await db.collection('masters/customers/items').doc(CUSTOMER_ENDED.id).set({
    name: CUSTOMER_ENDED.name,
    furigana: 'ケイヤクシュウリョウタロウ(Issue1033)',
    isDuplicate: false,
    isContractEnded: true,
  });
  await db.collection('masters/customers/items').doc(CUSTOMER_ACTIVE.id).set({
    name: CUSTOMER_ACTIVE.name,
    furigana: 'ケイヤクチュウハナコ(Issue1033)',
    isDuplicate: false,
    isContractEnded: false,
  });
  console.log('✅ 顧客マスター2件作成(契約終了1件・契約中1件)');

  const now = Timestamp.now();

  // 契約終了太郎: 確認済み書類(既定で非表示になる対象) + 未確認書類(常に表示され続ける対象)
  await db.collection('documents').doc('issue1033-doc-ended-verified').set({
    mimeType: 'application/pdf',
    fileName: 'E2E_Issue1033_契約終了太郎_確認済み.pdf',
    fileUrl: 'gs://doc-split-dev-documents/test/issue1033-doc-ended-verified.pdf',
    customerId: CUSTOMER_ENDED.id,
    customerName: CUSTOMER_ENDED.name,
    customerConfirmed: true,
    officeId: 'office-001',
    officeName: 'テスト第一事業所',
    officeConfirmed: true,
    careManager: CARE_MANAGER,
    documentType: '請求書',
    totalPages: 1,
    status: 'processed',
    verified: true,
    createdAt: now,
    processedAt: now,
    fileDate: now,
  });
  await db.collection('documents').doc('issue1033-doc-ended-unverified').set({
    mimeType: 'application/pdf',
    fileName: 'E2E_Issue1033_契約終了太郎_未確認.pdf',
    fileUrl: 'gs://doc-split-dev-documents/test/issue1033-doc-ended-unverified.pdf',
    customerId: CUSTOMER_ENDED.id,
    customerName: CUSTOMER_ENDED.name,
    customerConfirmed: false,
    officeId: 'office-001',
    officeName: 'テスト第一事業所',
    officeConfirmed: true,
    careManager: CARE_MANAGER,
    documentType: 'ケアプラン',
    totalPages: 1,
    status: 'processed',
    verified: false,
    createdAt: now,
    processedAt: now,
    fileDate: now,
  });

  // 契約中花子: 確認済み書類(常に表示され続ける対象)
  await db.collection('documents').doc('issue1033-doc-active-verified').set({
    mimeType: 'application/pdf',
    fileName: 'E2E_Issue1033_契約中花子_確認済み.pdf',
    fileUrl: 'gs://doc-split-dev-documents/test/issue1033-doc-active-verified.pdf',
    customerId: CUSTOMER_ACTIVE.id,
    customerName: CUSTOMER_ACTIVE.name,
    customerConfirmed: true,
    officeId: 'office-001',
    officeName: 'テスト第一事業所',
    officeConfirmed: true,
    careManager: CARE_MANAGER,
    documentType: '請求書',
    totalPages: 1,
    status: 'processed',
    verified: true,
    createdAt: now,
    processedAt: now,
    fileDate: now,
  });

  console.log('✅ 書類3件作成(契約終了:確認済み1件+未確認1件、契約中:確認済み1件)');
  console.log('\n✅ Issue #1033検証用シードデータ作成完了');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
