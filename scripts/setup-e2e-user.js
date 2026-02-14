/**
 * dev環境E2Eテスト用ユーザー作成スクリプト
 *
 * Firebase Auth にテストユーザーを作成し、
 * Firestore users/{uid} にドキュメントを作成する（ProtectedRoute通過に必要）。
 *
 * 前提条件:
 *   - Firebase Auth で Email/Password プロバイダーが有効化済み
 *   - gcloud / firebase CLI で対象プロジェクトに認証済み
 *
 * 使用方法:
 *   node scripts/setup-e2e-user.js
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/setup-e2e-user.js
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const projectId = process.env.FIREBASE_PROJECT_ID || 'doc-split-dev';

initializeApp({ projectId });

const db = getFirestore();
const auth = getAuth();

const TEST_USER = {
  email: 'test@example.com',
  password: 'testpassword123',
  displayName: 'E2E Test User',
};

async function main() {
  console.log(`🚀 E2Eテストユーザー作成開始 (project: ${projectId})\n`);

  // 1. 既存ユーザーを確認・削除
  let existingUser = null;
  try {
    existingUser = await auth.getUserByEmail(TEST_USER.email);
    console.log(`⚠️  既存ユーザー検出 (uid: ${existingUser.uid})、削除します...`);
    await auth.deleteUser(existingUser.uid);
    console.log('✅ 既存ユーザー削除完了');
  } catch (e) {
    if (e.code !== 'auth/user-not-found') {
      throw e;
    }
    console.log('ℹ️  既存ユーザーなし、新規作成します');
  }

  // 2. テストユーザー作成
  const user = await auth.createUser({
    email: TEST_USER.email,
    password: TEST_USER.password,
    displayName: TEST_USER.displayName,
    emailVerified: true,
  });
  console.log(`✅ テストユーザー作成: ${user.email} (uid: ${user.uid})`);

  // 3. Firestoreにユーザードキュメント作成（ProtectedRoute通過に必要）
  await db.collection('users').doc(user.uid).set({
    email: TEST_USER.email,
    role: 'admin',
    createdAt: Timestamp.now(),
    lastLoginAt: null,
  });
  console.log('✅ Firestoreユーザードキュメント作成完了');

  console.log('\n✅ セットアップ完了');
  console.log('\nテストユーザー情報:');
  console.log(`  Email:    ${TEST_USER.email}`);
  console.log(`  Password: ${TEST_USER.password}`);
  console.log(`  UID:      ${user.uid}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ エラー:', err.message);
    process.exit(1);
  });
