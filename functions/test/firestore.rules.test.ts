/**
 * Firestoreセキュリティルールのテスト
 *
 * 実行方法:
 *   1. エミュレータ起動: firebase emulators:start --only firestore
 *   2. テスト実行: npm run test:rules
 */

import * as testing from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const { assertFails, assertSucceeds, initializeTestEnvironment } = testing;

describe('Firestore Security Rules', () => {
  let testEnv: testing.RulesTestEnvironment;

  // テスト用ユーザーID
  const adminUid = 'admin-user-123';
  const normalUid = 'normal-user-456';
  const unknownUid = 'unknown-user-789';

  before(async () => {
    // ルールファイルを読み込み
    const rulesPath = path.join(__dirname, '../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: 'docsplit-test',
      firestore: {
        rules,
        host: 'localhost',
        port: 8085,
      },
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    // テスト用ユーザーデータを設定
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // 管理者ユーザー
      await setDoc(doc(db, 'users', adminUid), {
        email: 'admin@example.com',
        role: 'admin',
        createdAt: new Date(),
        lastLoginAt: new Date(),
      });

      // 一般ユーザー
      await setDoc(doc(db, 'users', normalUid), {
        email: 'user@example.com',
        role: 'user',
        createdAt: new Date(),
        lastLoginAt: new Date(),
      });
    });
  });

  // ============================================
  // /documents コレクション
  // ============================================
  describe('/documents collection', () => {
    it('未認証ユーザーは読み取り不可', async () => {
      const unauthed = testEnv.unauthenticatedContext();
      const docRef = doc(unauthed.firestore(), 'documents', 'doc1');
      await assertFails(getDoc(docRef));
    });

    it('ホワイトリスト未登録ユーザーは読み取り不可', async () => {
      const unknownUser = testEnv.authenticatedContext(unknownUid);
      const docRef = doc(unknownUser.firestore(), 'documents', 'doc1');
      await assertFails(getDoc(docRef));
    });

    it('ホワイトリスト登録ユーザーは読み取り可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc1'), {
          fileName: 'test.pdf',
          status: 'pending',
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc1');
      await assertSucceeds(getDoc(docRef));
    });

    it('ホワイトリスト登録ユーザーは作成可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const docRef = doc(normalUser.firestore(), 'documents', 'doc1');
      await assertSucceeds(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'pending',
        })
      );
    });

    it('一般ユーザーは削除不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc1'), {
          fileName: 'test.pdf',
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc1');
      await assertFails(deleteDoc(docRef));
    });

    it('管理者は削除可能', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc1'), {
          fileName: 'test.pdf',
        });
      });

      const docRef = doc(adminUser.firestore(), 'documents', 'doc1');
      await assertSucceeds(deleteDoc(docRef));
    });
  });

  // ============================================
  // /masters コレクション
  // ============================================
  describe('/masters collection', () => {
    it('ホワイトリスト登録ユーザーはマスターデータを読み取り可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'masters/customers/items', 'customer1'), {
          name: '山田太郎',
          furigana: 'ヤマダタロウ',
        });
      });

      const docRef = doc(normalUser.firestore(), 'masters/customers/items', 'customer1');
      await assertSucceeds(getDoc(docRef));
    });

    it('一般ユーザーはマスターデータを編集不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const docRef = doc(normalUser.firestore(), 'masters/customers/items', 'customer1');
      await assertFails(
        setDoc(docRef, {
          name: '山田太郎',
          furigana: 'ヤマダタロウ',
        })
      );
    });

    it('管理者はマスターデータを編集可能', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);
      const docRef = doc(adminUser.firestore(), 'masters/customers/items', 'customer1');
      await assertSucceeds(
        setDoc(docRef, {
          name: '山田太郎',
          furigana: 'ヤマダタロウ',
        })
      );
    });
  });

  // ============================================
  // /errors コレクション
  // ============================================
  describe('/errors collection', () => {
    it('ホワイトリスト登録ユーザーはエラー履歴を読み取り可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'errors', 'error1'), {
          errorType: 'OCR完全失敗',
          status: '未対応',
        });
      });

      const docRef = doc(normalUser.firestore(), 'errors', 'error1');
      await assertSucceeds(getDoc(docRef));
    });

    it('一般ユーザーはエラー履歴を編集不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const docRef = doc(normalUser.firestore(), 'errors', 'error1');
      await assertFails(
        setDoc(docRef, {
          errorType: 'OCR完全失敗',
          status: '対応中',
        })
      );
    });

    it('管理者はエラー履歴を編集可能', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);
      const docRef = doc(adminUser.firestore(), 'errors', 'error1');
      await assertSucceeds(
        setDoc(docRef, {
          errorType: 'OCR完全失敗',
          status: '対応中',
        })
      );
    });
  });

  // ============================================
  // /gmailLogs コレクション
  // ============================================
  describe('/gmailLogs collection', () => {
    it('ホワイトリスト登録ユーザーはGmailログを読み取り可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'gmailLogs', 'log1'), {
          fileName: 'attachment.pdf',
          hash: 'abc123',
        });
      });

      const docRef = doc(normalUser.firestore(), 'gmailLogs', 'log1');
      await assertSucceeds(getDoc(docRef));
    });

    it('誰もGmailログを編集できない（Cloud Functionsのみ）', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);
      const docRef = doc(adminUser.firestore(), 'gmailLogs', 'log1');
      await assertFails(
        setDoc(docRef, {
          fileName: 'attachment.pdf',
          hash: 'abc123',
        })
      );
    });
  });

  // ============================================
  // /users コレクション
  // ============================================
  describe('/users collection', () => {
    it('ユーザーは自分のデータのみ読み取り可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const ownDocRef = doc(normalUser.firestore(), 'users', normalUid);
      await assertSucceeds(getDoc(ownDocRef));
    });

    it('一般ユーザーは他人のデータを読み取り不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const otherDocRef = doc(normalUser.firestore(), 'users', adminUid);
      await assertFails(getDoc(otherDocRef));
    });

    it('管理者は全ユーザーのデータを読み取り可能', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);
      const otherDocRef = doc(adminUser.firestore(), 'users', normalUid);
      await assertSucceeds(getDoc(otherDocRef));
    });

    it('管理者はユーザーを追加可能', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);
      const newUserRef = doc(adminUser.firestore(), 'users', 'new-user-001');
      await assertSucceeds(
        setDoc(newUserRef, {
          email: 'newuser@example.com',
          role: 'user',
          createdAt: new Date(),
          lastLoginAt: null,
        })
      );
    });

    it('一般ユーザーはユーザーを追加不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const newUserRef = doc(normalUser.firestore(), 'users', 'new-user-001');
      await assertFails(
        setDoc(newUserRef, {
          email: 'newuser@example.com',
          role: 'user',
          createdAt: new Date(),
          lastLoginAt: null,
        })
      );
    });
  });

  // ============================================
  // /settings コレクション
  // ============================================
  describe('/settings collection', () => {
    it('ホワイトリスト登録ユーザーは設定を読み取り可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'settings', 'app'), {
          targetLabels: ['請求書'],
          labelSearchOperator: 'OR',
        });
      });

      const docRef = doc(normalUser.firestore(), 'settings', 'app');
      await assertSucceeds(getDoc(docRef));
    });

    it('一般ユーザーは設定を編集不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const docRef = doc(normalUser.firestore(), 'settings', 'app');
      await assertFails(
        setDoc(docRef, {
          targetLabels: ['請求書'],
          labelSearchOperator: 'OR',
        })
      );
    });

    it('管理者は設定を編集可能', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);
      const docRef = doc(adminUser.firestore(), 'settings', 'app');
      await assertSucceeds(
        setDoc(docRef, {
          targetLabels: ['請求書', '領収書'],
          labelSearchOperator: 'AND',
        })
      );
    });
  });
});
