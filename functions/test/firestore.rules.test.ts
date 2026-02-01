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
    // ルールファイルを読み込み（functionsディレクトリから実行される想定）
    const rulesPath = path.resolve(process.cwd(), '../firestore.rules');
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

    it('ホワイトリスト登録ユーザーは作成不可（Cloud Functionsのみ）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const docRef = doc(normalUser.firestore(), 'documents', 'doc1');
      await assertFails(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'pending',
        })
      );
    });

    it('ホワイトリスト登録ユーザーは顧客解決フィールドのみ更新可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc1'), {
          fileName: 'test.pdf',
          status: 'pending',
          customerId: null,
          customerName: '不明顧客',
          customerConfirmed: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc1');
      // 顧客解決フィールドの更新は許可される
      await assertSucceeds(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'pending',
          customerId: 'customer-123',
          customerName: '山田太郎',
          customerConfirmed: true,
          confirmedBy: normalUid,
          confirmedAt: new Date(),
        }, { merge: true })
      );
    });

    it('ホワイトリスト登録ユーザーは顧客解決以外のフィールドは更新不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc1'), {
          fileName: 'test.pdf',
          status: 'pending',
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc1');
      // statusフィールドの更新は禁止
      await assertFails(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'processed',
        }, { merge: true })
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

    // ============================================
    // 事業所解決フィールド更新テスト（Phase 8 同名対応）
    // ============================================
    it('ホワイトリスト登録ユーザーは事業所解決フィールドを更新可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-office'), {
          fileName: 'test.pdf',
          status: 'processed',
          officeId: null,
          officeName: '○○事業所',
          officeConfirmed: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-office');
      await assertSucceeds(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'processed',
          officeId: 'office-001',
          officeName: '○○第一事業所',
          officeConfirmed: true,
          officeConfirmedBy: normalUid,
          officeConfirmedAt: new Date(),
        }, { merge: true })
      );
    });

    it('事業所解決時にofficeConfirmedByは自分のUIDのみ設定可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-office-fake'), {
          fileName: 'test.pdf',
          status: 'processed',
          officeId: null,
          officeName: '○○事業所',
          officeConfirmed: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-office-fake');
      await assertFails(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'processed',
          officeId: 'office-001',
          officeName: '○○第一事業所',
          officeConfirmed: true,
          officeConfirmedBy: 'other-user-id', // 他人のUID
          officeConfirmedAt: new Date(),
        }, { merge: true })
      );
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
  // /officeResolutionLogs コレクション（事業所解決監査ログ）
  // ============================================
  describe('/officeResolutionLogs collection', () => {
    it('ホワイトリスト登録ユーザーは監査ログを読み取り可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'officeResolutionLogs', 'log1'), {
          documentId: 'doc-001',
          previousOfficeId: null,
          newOfficeId: 'office-001',
          newOfficeName: 'テスト事業所',
          resolvedBy: normalUid,
          resolvedByEmail: 'user@example.com',
          resolvedAt: new Date(),
        });
      });

      const docRef = doc(normalUser.firestore(), 'officeResolutionLogs', 'log1');
      await assertSucceeds(getDoc(docRef));
    });

    it('ホワイトリスト登録ユーザーは監査ログを作成可能（正常ケース）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const db = normalUser.firestore();

      const logRef = doc(db, 'officeResolutionLogs', 'log-new');
      await assertSucceeds(
        setDoc(logRef, {
          documentId: 'doc-001',
          previousOfficeId: null,
          newOfficeId: 'office-001',
          newOfficeName: 'テスト事業所',
          resolvedBy: normalUid,
          resolvedByEmail: 'user@example.com',
          resolvedAt: new Date(),
        })
      );
    });

    it('ホワイトリスト登録ユーザーは「該当なし」選択時もログ作成可能（newOfficeId=null）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const db = normalUser.firestore();

      const logRef = doc(db, 'officeResolutionLogs', 'log-none');
      await assertSucceeds(
        setDoc(logRef, {
          documentId: 'doc-002',
          previousOfficeId: 'office-old',
          newOfficeId: null,
          newOfficeName: '該当なし',
          resolvedBy: normalUid,
          resolvedByEmail: 'user@example.com',
          resolvedAt: new Date(),
        })
      );
    });

    it('他人のUIDでresolvedByを設定するのは禁止', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const db = normalUser.firestore();

      const logRef = doc(db, 'officeResolutionLogs', 'log-fake');
      await assertFails(
        setDoc(logRef, {
          documentId: 'doc-001',
          previousOfficeId: null,
          newOfficeId: 'office-001',
          newOfficeName: 'テスト事業所',
          resolvedBy: 'other-user-id', // 他人のUID
          resolvedByEmail: 'user@example.com',
          resolvedAt: new Date(),
        })
      );
    });

    it('documentIdが空の場合は作成不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const db = normalUser.firestore();

      const logRef = doc(db, 'officeResolutionLogs', 'log-invalid');
      await assertFails(
        setDoc(logRef, {
          documentId: '', // 空文字
          previousOfficeId: null,
          newOfficeId: 'office-001',
          newOfficeName: 'テスト事業所',
          resolvedBy: normalUid,
          resolvedByEmail: 'user@example.com',
          resolvedAt: new Date(),
        })
      );
    });

    it('newOfficeNameが空の場合は作成不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const db = normalUser.firestore();

      const logRef = doc(db, 'officeResolutionLogs', 'log-invalid-name');
      await assertFails(
        setDoc(logRef, {
          documentId: 'doc-001',
          previousOfficeId: null,
          newOfficeId: 'office-001',
          newOfficeName: '', // 空文字
          resolvedBy: normalUid,
          resolvedByEmail: 'user@example.com',
          resolvedAt: new Date(),
        })
      );
    });

    it('ホワイトリスト未登録ユーザーは作成不可', async () => {
      const unknownUser = testEnv.authenticatedContext(unknownUid);
      const db = unknownUser.firestore();

      const logRef = doc(db, 'officeResolutionLogs', 'log-unauth');
      await assertFails(
        setDoc(logRef, {
          documentId: 'doc-001',
          previousOfficeId: null,
          newOfficeId: 'office-001',
          newOfficeName: 'テスト事業所',
          resolvedBy: unknownUid,
          resolvedByEmail: 'unknown@example.com',
          resolvedAt: new Date(),
        })
      );
    });

    it('監査ログは更新不可（不変性）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'officeResolutionLogs', 'log-immutable'), {
          documentId: 'doc-001',
          newOfficeId: 'office-001',
          newOfficeName: 'テスト事業所',
          resolvedBy: normalUid,
          resolvedByEmail: 'user@example.com',
          resolvedAt: new Date(),
        });
      });

      const db = normalUser.firestore();
      const logRef = doc(db, 'officeResolutionLogs', 'log-immutable');
      await assertFails(
        setDoc(logRef, {
          documentId: 'doc-001',
          newOfficeId: 'office-002', // 変更しようとする
          newOfficeName: '別の事業所',
          resolvedBy: normalUid,
          resolvedByEmail: 'user@example.com',
          resolvedAt: new Date(),
        })
      );
    });

    it('監査ログは削除不可（不変性）', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'officeResolutionLogs', 'log-nodelete'), {
          documentId: 'doc-001',
          newOfficeId: 'office-001',
          newOfficeName: 'テスト事業所',
          resolvedBy: normalUid,
          resolvedByEmail: 'user@example.com',
          resolvedAt: new Date(),
        });
      });

      const db = adminUser.firestore();
      const logRef = doc(db, 'officeResolutionLogs', 'log-nodelete');
      await assertFails(deleteDoc(logRef));
    });
  });

  // ============================================
  // /documents コレクション（OCR結果編集）
  // ============================================
  describe('/documents collection - OCR edit fields', () => {
    it('ホワイトリスト登録ユーザーはOCR編集フィールドを更新可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-edit'), {
          fileName: 'test.pdf',
          status: 'processed',
          documentType: '請求書',
          customerName: '山田太郎',
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-edit');
      await assertSucceeds(
        setDoc(docRef, {
          fileName: 'updated.pdf',
          status: 'processed',
          documentType: '領収書',
          customerName: '田中花子',
          editedBy: normalUid,
          editedAt: new Date(),
          updatedAt: new Date(),
        }, { merge: true })
      );
    });

    it('editedByは自分のUIDのみ設定可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-edit-fake'), {
          fileName: 'test.pdf',
          status: 'processed',
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-edit-fake');
      await assertFails(
        setDoc(docRef, {
          fileName: 'updated.pdf',
          status: 'processed',
          editedBy: 'other-user-id', // 他人のUID
          editedAt: new Date(),
        }, { merge: true })
      );
    });

    it('careManagerKeyの更新が可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-cm'), {
          fileName: 'test.pdf',
          status: 'processed',
          careManagerKey: '',
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-cm');
      await assertSucceeds(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'processed',
          careManagerKey: '担当ケアマネA',
          editedBy: normalUid,
          editedAt: new Date(),
          updatedAt: new Date(),
        }, { merge: true })
      );
    });

    it('fileDateの更新が可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-date'), {
          fileName: 'test.pdf',
          status: 'processed',
          fileDate: null,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-date');
      await assertSucceeds(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'processed',
          fileDate: new Date('2026-01-20'),
          editedBy: normalUid,
          editedAt: new Date(),
          updatedAt: new Date(),
        }, { merge: true })
      );
    });

    it('status/ocrResult/errorの更新は許可される（一括再処理用）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-status'), {
          fileName: 'test.pdf',
          status: 'processed',
          ocrResult: { text: 'test' },
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-status');
      await assertSucceeds(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'pending', // 再処理用にpendingに戻す
          ocrResult: null,   // ocrResultをクリア
        }, { merge: true })
      );
    });

    it('許可されていないフィールドの更新は禁止', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-forbidden'), {
          fileName: 'test.pdf',
          status: 'pending',
          storagePath: '/path/to/file',
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-forbidden');
      await assertFails(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'pending',
          storagePath: '/new/path', // storagePathは更新不可
        }, { merge: true })
      );
    });

    it('verified/verifiedBy/verifiedAtの更新が可能（一括確認用）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-verify'), {
          fileName: 'test.pdf',
          status: 'processed',
          verified: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-verify');
      await assertSucceeds(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'processed',
          verified: true,
          verifiedBy: normalUid,
          verifiedAt: new Date(),
        }, { merge: true })
      );
    });

    it('verifiedByは自分のUIDのみ設定可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-verify-fake'), {
          fileName: 'test.pdf',
          status: 'processed',
          verified: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-verify-fake');
      await assertFails(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'processed',
          verified: true,
          verifiedBy: 'other-user-id', // 他人のUID
          verifiedAt: new Date(),
        }, { merge: true })
      );
    });
  });

  // ============================================
  // /editLogs コレクション（編集監査ログ）
  // ============================================
  describe('/editLogs collection', () => {
    it('ホワイトリスト登録ユーザーは編集ログを読み取り可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'editLogs', 'edit1'), {
          documentId: 'doc-001',
          fieldName: 'customerName',
          oldValue: '山田太郎',
          newValue: '田中花子',
          editedBy: normalUid,
          editedByEmail: 'user@example.com',
          editedAt: new Date(),
        });
      });

      const docRef = doc(normalUser.firestore(), 'editLogs', 'edit1');
      await assertSucceeds(getDoc(docRef));
    });

    it('ホワイトリスト登録ユーザーは編集ログを作成可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const db = normalUser.firestore();

      const logRef = doc(db, 'editLogs', 'edit-new');
      await assertSucceeds(
        setDoc(logRef, {
          documentId: 'doc-001',
          fieldName: 'documentType',
          oldValue: '請求書',
          newValue: '領収書',
          editedBy: normalUid,
          editedByEmail: 'user@example.com',
          editedAt: new Date(),
        })
      );
    });

    it('他人のUIDでeditedByを設定するのは禁止', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const db = normalUser.firestore();

      const logRef = doc(db, 'editLogs', 'edit-fake');
      await assertFails(
        setDoc(logRef, {
          documentId: 'doc-001',
          fieldName: 'customerName',
          oldValue: '山田太郎',
          newValue: '田中花子',
          editedBy: 'other-user-id', // 他人のUID
          editedByEmail: 'user@example.com',
          editedAt: new Date(),
        })
      );
    });

    it('documentIdが空の場合は作成不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const db = normalUser.firestore();

      const logRef = doc(db, 'editLogs', 'edit-invalid');
      await assertFails(
        setDoc(logRef, {
          documentId: '', // 空文字
          fieldName: 'customerName',
          oldValue: '山田太郎',
          newValue: '田中花子',
          editedBy: normalUid,
          editedByEmail: 'user@example.com',
          editedAt: new Date(),
        })
      );
    });

    it('fieldNameが空の場合は作成不可', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);
      const db = normalUser.firestore();

      const logRef = doc(db, 'editLogs', 'edit-invalid-field');
      await assertFails(
        setDoc(logRef, {
          documentId: 'doc-001',
          fieldName: '', // 空文字
          oldValue: '山田太郎',
          newValue: '田中花子',
          editedBy: normalUid,
          editedByEmail: 'user@example.com',
          editedAt: new Date(),
        })
      );
    });

    it('編集ログは更新不可（不変性）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'editLogs', 'edit-immutable'), {
          documentId: 'doc-001',
          fieldName: 'customerName',
          oldValue: '山田太郎',
          newValue: '田中花子',
          editedBy: normalUid,
          editedByEmail: 'user@example.com',
          editedAt: new Date(),
        });
      });

      const db = normalUser.firestore();
      const logRef = doc(db, 'editLogs', 'edit-immutable');
      await assertFails(
        setDoc(logRef, {
          documentId: 'doc-001',
          fieldName: 'customerName',
          oldValue: '山田太郎',
          newValue: '佐藤三郎', // 変更しようとする
          editedBy: normalUid,
          editedByEmail: 'user@example.com',
          editedAt: new Date(),
        })
      );
    });

    it('編集ログは削除不可（不変性）', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'editLogs', 'edit-nodelete'), {
          documentId: 'doc-001',
          fieldName: 'customerName',
          oldValue: '山田太郎',
          newValue: '田中花子',
          editedBy: normalUid,
          editedByEmail: 'user@example.com',
          editedAt: new Date(),
        });
      });

      const db = adminUser.firestore();
      const logRef = doc(db, 'editLogs', 'edit-nodelete');
      await assertFails(deleteDoc(logRef));
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

    // ============================================
    // ドメイン許可リストログインバグ修正テスト
    // ホワイトリスト未登録ユーザーがsettings/authを読めないとログインできない問題の修正確認
    // ============================================
    it('未登録ユーザーはsettings/authを読み取り可能（ドメインチェック用）', async () => {
      const unknownUser = testEnv.authenticatedContext(unknownUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'settings', 'auth'), {
          allowedDomains: ['example.com', 'kanameone.com'],
        });
      });

      const docRef = doc(unknownUser.firestore(), 'settings', 'auth');
      await assertSucceeds(getDoc(docRef));
    });

    it('未登録ユーザーはsettings/appは読み取り不可', async () => {
      const unknownUser = testEnv.authenticatedContext(unknownUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'settings', 'app'), {
          targetLabels: ['請求書'],
        });
      });

      // settings/appは読み取り不可
      const db = unknownUser.firestore();
      const appRef = doc(db, 'settings', 'app');
      await assertFails(getDoc(appRef));
    });

    it('未登録ユーザーはsettings/gmailは読み取り不可', async () => {
      const unknownUser = testEnv.authenticatedContext(unknownUid);

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'settings', 'gmail'), {
          authMode: 'oauth',
        });
      });

      // settings/gmailは読み取り不可
      const db = unknownUser.firestore();
      const gmailRef = doc(db, 'settings', 'gmail');
      await assertFails(getDoc(gmailRef));
    });

    it('未認証ユーザーはsettings/authも読み取り不可', async () => {
      const unauthed = testEnv.unauthenticatedContext();

      // テストデータを作成
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'settings', 'auth'), {
          allowedDomains: ['example.com'],
        });
      });

      const docRef = doc(unauthed.firestore(), 'settings', 'auth');
      await assertFails(getDoc(docRef));
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
