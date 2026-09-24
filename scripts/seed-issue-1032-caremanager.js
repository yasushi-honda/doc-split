/**
 * Issue #1032 (担当CM別の件数不正確) 実機検証用シードスクリプト
 *
 * 担当CM別タブでの無限スクロール多ページ化(pageSize=100)を再現するため、
 * 単一の担当CM配下に150件(2ページ分)の書類を作成する。
 * scripts/seed-e2e-data.js と同様、正規化キー(careManagerKey/customerKey)と
 * documentGroupsはfunctions emulatorのupdateDocumentGroupsトリガーに委ねる
 * (CIのE2Eステップはfunctions emulator込みで実行されるため、documentGroupsを
 * ここで手動書き込みするとトリガーの集計と二重計上になる)。
 *
 * 使用方法:
 *   FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-issue-1032-caremanager.js
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const projectId = process.env.GCLOUD_PROJECT || 'doc-split-dev';
initializeApp({ projectId });
const db = getFirestore();

const CARE_MANAGER = '検証太郎(Issue1032)';
const CUSTOMERS = [
  { id: 'issue1032-cust-a', name: '検証花子(Issue1032)', count: 90 },
  { id: 'issue1032-cust-b', name: '検証次郎(Issue1032)', count: 60 },
];

async function main() {
  console.log('🚀 Issue #1032検証用シードデータ作成開始');
  console.log(`プロジェクト: ${projectId}\n`);

  let seq = 0;
  const now = Date.now();
  const total = CUSTOMERS.reduce((sum, c) => sum + c.count, 0);

  for (const customer of CUSTOMERS) {
    for (let i = 0; i < customer.count; i++) {
      seq += 1;
      const id = `issue1032-doc-${String(seq).padStart(4, '0')}`;
      // processedAt降順ソートのため、seqが大きいほど新しい(先に読み込まれる)日時にする
      const ts = Timestamp.fromMillis(now - (total - seq) * 1000);
      const documentType = i % 2 === 0 ? '請求書' : 'ケアプラン';
      await db.collection('documents').doc(id).set({
        mimeType: 'application/pdf',
        fileName: `E2E_Issue1032_${customer.name}_${i + 1}.pdf`,
        fileUrl: `gs://doc-split-dev-documents/test/${id}.pdf`,
        customerId: customer.id,
        customerName: customer.name,
        customerConfirmed: true,
        officeId: 'office-001',
        officeName: 'テスト第一事業所',
        officeConfirmed: true,
        careManager: CARE_MANAGER,
        documentType,
        totalPages: 1,
        status: 'processed',
        verified: true,
        createdAt: ts,
        processedAt: ts,
        fileDate: ts,
      });
    }
    console.log(`✅ ${customer.name}: ${customer.count}件作成`);
  }

  console.log(`\n✅ Issue #1032検証用シードデータ作成完了(担当CM「${CARE_MANAGER}」配下 ${seq}件)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });