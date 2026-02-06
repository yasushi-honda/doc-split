/**
 * E2Eテスト用シードデータ作成スクリプト
 *
 * Firebase Emulator環境で実行
 * - テストユーザー作成
 * - 事業所未確定テストドキュメント作成
 * - あかさたなフィルターテスト用の顧客マスター・書類データ作成
 * - 主要フローテスト用（ステータス別・書類種別別ドキュメント）
 *
 * 使用方法:
 *   FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-e2e-data.js
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

// Firebase Admin初期化
const projectId = process.env.GCLOUD_PROJECT || 'doc-split-dev';

initializeApp({
  projectId,
});

const db = getFirestore();
const auth = getAuth();

// テストユーザー情報
const TEST_USER = {
  uid: 'test-user-e2e',
  email: 'test@example.com',
  password: 'testpassword123',
  displayName: 'E2E Test User',
};

async function createTestUser() {
  console.log('👤 テストユーザーを作成中...');

  try {
    // 既存ユーザーを削除（あれば）
    try {
      await auth.deleteUser(TEST_USER.uid);
    } catch (e) {
      // ユーザーが存在しない場合は無視
    }

    // テストユーザー作成
    await auth.createUser({
      uid: TEST_USER.uid,
      email: TEST_USER.email,
      password: TEST_USER.password,
      displayName: TEST_USER.displayName,
      emailVerified: true,
    });

    console.log(`✅ テストユーザー作成: ${TEST_USER.email}`);

    // Firestoreにユーザードキュメント作成（ホワイトリスト登録）
    await db.collection('users').doc(TEST_USER.uid).set({
      email: TEST_USER.email,
      role: 'admin', // 管理者権限
      createdAt: Timestamp.now(),
      lastLoginAt: null,
    });

    console.log('✅ ホワイトリスト登録完了');
  } catch (error) {
    console.error('❌ テストユーザー作成失敗:', error.message);
    throw error;
  }
}

async function seedTestDocuments() {
  console.log('\n📄 テストドキュメントを作成中...');

  const testDocuments = [
    {
      id: 'e2e-office-pending-001',
      data: {
        fileName: 'E2E_テスト請求書_事業所未確定.pdf',
        fileUrl: 'gs://doc-split-dev-documents/test/e2e-001.pdf',
        mimeType: 'application/pdf',
        totalPages: 1,
        status: 'processed',
        // 顧客は確定済み
        customerId: 'customer-001',
        customerName: '山田太郎',
        customerConfirmed: true,
        // 事業所は未確定
        officeId: null,
        officeName: 'テスト事業所',
        officeConfirmed: false,
        officeCandidates: [
          {
            officeId: 'office-001',
            officeName: 'テスト第一事業所',
            shortName: 'テスト第一',
            isDuplicate: true,
            score: 90,
            matchType: 'partial',
          },
          {
            officeId: 'office-002',
            officeName: 'テスト第二事業所',
            shortName: 'テスト第二',
            isDuplicate: true,
            score: 85,
            matchType: 'partial',
          },
        ],
        documentType: '請求書',
        processedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
      },
    },
  ];

  for (const doc of testDocuments) {
    await db.collection('documents').doc(doc.id).set(doc.data);
    console.log(`✅ 作成: ${doc.id}`);
  }
}

/**
 * あかさたなフィルターテスト用の顧客マスター作成
 * 各行に1名以上の顧客を配置
 */
async function seedCustomerMasters() {
  console.log('\n👥 顧客マスターを作成中...');

  const customers = [
    { id: 'e2e-cust-a', name: '阿部太郎', furigana: 'あべたろう', notes: '' },
    { id: 'e2e-cust-i', name: '伊藤花子', furigana: 'いとうはなこ', notes: '' },
    { id: 'e2e-cust-ka', name: '加藤次郎', furigana: 'かとうじろう', notes: '' },
    { id: 'e2e-cust-sa', name: '佐藤三郎', furigana: 'さとうさぶろう', notes: '' },
    { id: 'e2e-cust-ta', name: '田中四郎', furigana: 'たなかしろう', notes: '' },
    { id: 'e2e-cust-na', name: '中村五郎', furigana: 'なかむらごろう', notes: '' },
    { id: 'e2e-cust-ha', name: '浜田六郎', furigana: 'はまだろくろう', notes: '' },
    { id: 'e2e-cust-ma', name: '松本七郎', furigana: 'まつもとしちろう', notes: '' },
    { id: 'e2e-cust-ya', name: '山本八郎', furigana: 'やまもとはちろう', notes: '' },
    { id: 'e2e-cust-wa', name: '渡辺九郎', furigana: 'わたなべくろう', notes: '' },
    // ふりがな空の顧客（フィルター除外テスト用）
    { id: 'e2e-cust-nofuri', name: 'テスト株式会社', furigana: '', notes: '' },
  ];

  for (const cust of customers) {
    await db.collection('masters').doc('customers').collection('items').doc(cust.id).set({
      name: cust.name,
      furigana: cust.furigana,
      notes: cust.notes,
      createdAt: Timestamp.now(),
    });
  }
  console.log(`✅ 顧客マスター ${customers.length}件作成`);
  return customers;
}

/**
 * あかさたなフィルターテスト用の書類データ作成
 * 各顧客に1件ずつ書類を紐付け
 */
async function seedFilterTestDocuments(customers) {
  console.log('\n📄 フィルターテスト用書類を作成中...');

  const docs = customers
    .filter((c) => c.furigana) // ふりがなありのみ書類作成
    .map((cust, i) => ({
      id: `e2e-filter-doc-${String(i + 1).padStart(3, '0')}`,
      data: {
        fileName: `E2E_フィルターテスト_${cust.name}.pdf`,
        fileUrl: `gs://doc-split-dev-documents/test/e2e-filter-${i + 1}.pdf`,
        mimeType: 'application/pdf',
        totalPages: 1,
        status: 'processed',
        customerId: cust.id,
        customerName: cust.name,
        customerConfirmed: true,
        officeId: 'office-001',
        officeName: 'テスト第一事業所',
        officeConfirmed: true,
        documentType: '請求書',
        processedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
      },
    }));

  // ふりがな空の顧客にも書類を紐付け
  const nofuriCust = customers.find((c) => !c.furigana);
  if (nofuriCust) {
    docs.push({
      id: 'e2e-filter-doc-nofuri',
      data: {
        fileName: `E2E_フィルターテスト_${nofuriCust.name}.pdf`,
        fileUrl: 'gs://doc-split-dev-documents/test/e2e-filter-nofuri.pdf',
        mimeType: 'application/pdf',
        totalPages: 1,
        status: 'processed',
        customerId: nofuriCust.id,
        customerName: nofuriCust.name,
        customerConfirmed: true,
        officeId: 'office-001',
        officeName: 'テスト第一事業所',
        officeConfirmed: true,
        documentType: '請求書',
        processedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
      },
    });
  }

  for (const doc of docs) {
    await db.collection('documents').doc(doc.id).set(doc.data);
  }
  console.log(`✅ フィルターテスト用書類 ${docs.length}件作成`);
}

/**
 * 主要フローテスト用書類データ作成
 * - 各ステータスの書類（統計カード・フィルター検証用）
 * - 詳細メタ情報付き書類（詳細モーダル検証用）
 * - 異なる書類種別（領収書等）
 */
async function seedMainFlowTestDocuments() {
  console.log('\n📄 主要フローテスト用書類を作成中...');

  const docs = [
    {
      id: 'e2e-detail-001',
      data: {
        fileName: 'E2E_テスト請求書_詳細確認用.pdf',
        fileUrl: 'gs://doc-split-dev-documents/test/e2e-detail-001.pdf',
        mimeType: 'application/pdf',
        totalPages: 3,
        status: 'processed',
        customerId: 'e2e-cust-a',
        customerName: '阿部太郎',
        customerConfirmed: true,
        officeId: 'office-001',
        officeName: 'テスト第一事業所',
        officeConfirmed: true,
        documentType: '請求書',
        fileDate: Timestamp.fromDate(new Date('2026-01-15')),
        processedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
        summary: 'テスト請求書のAI要約です。金額10,000円。',
        verified: false,
      },
    },
    {
      id: 'e2e-pending-001',
      data: {
        fileName: 'E2E_テスト_待機中.pdf',
        fileUrl: 'gs://doc-split-dev-documents/test/e2e-pending-001.pdf',
        mimeType: 'application/pdf',
        totalPages: 1,
        status: 'pending',
        customerName: '',
        documentType: '',
        createdAt: Timestamp.now(),
      },
    },
    {
      id: 'e2e-processing-001',
      data: {
        fileName: 'E2E_テスト_処理中.pdf',
        fileUrl: 'gs://doc-split-dev-documents/test/e2e-processing-001.pdf',
        mimeType: 'application/pdf',
        totalPages: 1,
        status: 'processing',
        customerName: '',
        documentType: '',
        createdAt: Timestamp.now(),
      },
    },
    {
      id: 'e2e-error-001',
      data: {
        fileName: 'E2E_テスト_エラー.pdf',
        fileUrl: 'gs://doc-split-dev-documents/test/e2e-error-001.pdf',
        mimeType: 'application/pdf',
        totalPages: 1,
        status: 'error',
        customerName: '',
        documentType: '',
        errorMessage: 'OCR処理に失敗しました',
        createdAt: Timestamp.now(),
      },
    },
    {
      id: 'e2e-receipt-001',
      data: {
        fileName: 'E2E_テスト領収書_山本八郎.pdf',
        fileUrl: 'gs://doc-split-dev-documents/test/e2e-receipt-001.pdf',
        mimeType: 'application/pdf',
        totalPages: 1,
        status: 'processed',
        customerId: 'e2e-cust-ya',
        customerName: '山本八郎',
        customerConfirmed: true,
        officeId: 'office-001',
        officeName: 'テスト第一事業所',
        officeConfirmed: true,
        documentType: '領収書',
        fileDate: Timestamp.fromDate(new Date('2026-01-20')),
        processedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
      },
    },
  ];

  for (const doc of docs) {
    await db.collection('documents').doc(doc.id).set(doc.data);
  }
  console.log(`✅ 主要フローテスト用書類 ${docs.length}件作成`);
}

async function main() {
  console.log('🚀 E2Eテスト用シードデータ作成開始');
  console.log(`プロジェクト: ${projectId}\n`);

  await createTestUser();
  await seedTestDocuments();
  const customers = await seedCustomerMasters();
  await seedFilterTestDocuments(customers);
  await seedMainFlowTestDocuments();

  console.log('\n✅ シードデータ作成完了');
  console.log('\nテストユーザー情報:');
  console.log(`  Email: ${TEST_USER.email}`);
  console.log(`  Password: ${TEST_USER.password}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
