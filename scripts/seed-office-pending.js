/**
 * 事業所未確定テストデータ作成スクリプト
 *
 * 使用方法:
 *   node scripts/seed-office-pending.js
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

// Firebase Admin初期化
const projectId = process.env.GCLOUD_PROJECT || 'doc-split-dev';

initializeApp({
  projectId,
});

const db = getFirestore();

async function seedOfficePendingDocuments() {
  console.log(`プロジェクト: ${projectId}`);
  console.log('事業所未確定テストデータを作成中...\n');

  const testDocuments = [
    {
      id: 'test-office-pending-001',
      data: {
        fileName: 'テスト請求書_事業所未確定_001.pdf',
        fileUrl: 'gs://doc-split-dev-documents/test/test-001.pdf',
        mimeType: 'application/pdf',
        totalPages: 1,
        status: 'processed',
        // 顧客は確定済み
        customerId: 'customer-001',
        customerName: '山田太郎',
        customerConfirmed: true,
        // 事業所は未確定（複数候補あり）
        officeId: null,
        officeName: '○○事業所',
        officeConfirmed: false,
        officeCandidates: [
          {
            officeId: 'office-001',
            officeName: '○○第一事業所',
            shortName: '○○第一',
            isDuplicate: true,
            score: 90,
            matchType: 'partial',
          },
          {
            officeId: 'office-002',
            officeName: '○○第二事業所',
            shortName: '○○第二',
            isDuplicate: true,
            score: 85,
            matchType: 'partial',
          },
          {
            officeId: 'office-003',
            officeName: '○○本社事業所',
            shortName: '○○本社',
            isDuplicate: false,
            score: 70,
            matchType: 'fuzzy',
          },
        ],
        documentType: '請求書',
        processedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
      },
    },
    {
      id: 'test-office-pending-002',
      data: {
        fileName: 'テスト領収書_事業所未確定_002.pdf',
        fileUrl: 'gs://doc-split-dev-documents/test/test-002.pdf',
        mimeType: 'application/pdf',
        totalPages: 2,
        status: 'processed',
        // 顧客も未確定
        customerId: null,
        customerName: '不明顧客',
        customerConfirmed: false,
        customerCandidates: [
          {
            customerId: 'customer-002',
            customerName: '佐藤花子',
            furigana: 'サトウハナコ',
            isDuplicate: false,
            score: 80,
            matchType: 'fuzzy',
          },
        ],
        // 事業所も未確定
        officeId: null,
        officeName: 'ABC事業所',
        officeConfirmed: false,
        officeCandidates: [
          {
            officeId: 'office-004',
            officeName: 'ABC介護事業所',
            shortName: 'ABC',
            isDuplicate: false,
            score: 95,
            matchType: 'exact',
          },
        ],
        documentType: '領収書',
        processedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
      },
    },
  ];

  for (const doc of testDocuments) {
    await db.collection('documents').doc(doc.id).set(doc.data);
    console.log(`✅ 作成: ${doc.id}`);
    console.log(`   - ファイル名: ${doc.data.fileName}`);
    console.log(`   - 顧客確定: ${doc.data.customerConfirmed}`);
    console.log(`   - 事業所確定: ${doc.data.officeConfirmed}`);
    console.log(`   - 事業所候補数: ${doc.data.officeCandidates.length}`);
    console.log('');
  }

  console.log('✅ テストデータ作成完了');
  console.log('\n確認方法:');
  console.log('1. https://doc-split-dev.web.app にアクセス');
  console.log('2. 「確認待ち」タブを開く');
  console.log('3. テストドキュメントをクリックして詳細モーダルを開く');
  console.log('4. 「事業所を確定」ボタンをクリック');
}

seedOfficePendingDocuments()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
