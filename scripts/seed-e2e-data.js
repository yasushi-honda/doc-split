/**
 * E2Eテスト用シードデータ作成スクリプト
 *
 * Firebase Emulator環境で実行
 * - テストユーザー作成
 * - 事業所未確定テストドキュメント作成
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

async function main() {
  console.log('🚀 E2Eテスト用シードデータ作成開始');
  console.log(`プロジェクト: ${projectId}\n`);

  await createTestUser();
  await seedTestDocuments();

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
