#!/usr/bin/env node
/**
 * 管理者ユーザー追加スクリプト
 *
 * 使用方法:
 *   node add-admin-user.js <email>
 */

const admin = require('firebase-admin');

// Firebase初期化
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function addAdminUser(email) {
  if (!email) {
    console.error('使用方法: node add-admin-user.js <email>');
    process.exit(1);
  }

  // Firebase AuthでユーザーUIDを取得（存在しない場合はメールで仮ID）
  let uid;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    uid = userRecord.uid;
    console.log(`既存ユーザーを発見: ${uid}`);
  } catch (error) {
    // ユーザーがまだ存在しない場合、メールアドレスをベースにIDを生成
    // 実際のログイン時にFirebase Authが正しいUIDを割り当てる
    console.log('ユーザーがまだFirebase Authに存在しません。');
    console.log('Googleログイン後にUIDが確定します。');

    // 一時的なプレースホルダー（後で更新が必要）
    uid = `pending_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  const userData = {
    email: email,
    name: email.split('@')[0],
    role: 'admin',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('users').doc(uid).set(userData, { merge: true });
  console.log(`ユーザーを追加しました: ${email} (UID: ${uid})`);

  // 注意メッセージ
  if (uid.startsWith('pending_')) {
    console.log('\n⚠️  注意: ユーザーがまだログインしていないため、仮のUIDで登録しました。');
    console.log('   ユーザーが初めてログインした後、正しいUIDに更新する必要があります。');
    console.log('   または、先にGoogleログインを試行してからこのスクリプトを再実行してください。');
  }
}

const email = process.argv[2];
addAdminUser(email)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
