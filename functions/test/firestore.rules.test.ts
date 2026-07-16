/**
 * Firestoreセキュリティルールのテスト
 *
 * 実行方法:
 *   1. エミュレータ起動: firebase emulators:start --only firestore
 *   2. テスト実行: npm run test:rules
 */

import * as testing from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, updateDoc, deleteField } from 'firebase/firestore';
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
      // storagePathフィールドの更新は禁止（許可リスト外）
      await assertFails(
        setDoc(docRef, {
          fileName: 'test.pdf',
          storagePath: '/new/path',
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

    // ============================================
    // 書類種別確定フィールド更新テスト (Issue #526)
    // ============================================
    it('ホワイトリスト登録ユーザーはdocumentTypeConfirmedフィールドを更新可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-doctype'), {
          fileName: 'test.pdf',
          status: 'processed',
          documentType: '未判定',
          documentTypeConfirmed: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-doctype');
      await assertSucceeds(
        setDoc(docRef, {
          fileName: 'test.pdf',
          status: 'processed',
          documentType: '請求書',
          documentTypeConfirmed: true,
        }, { merge: true })
      );
    });

    // ============================================
    // 集計所属変更メンテナンスゲート (ADR-0019, GOAL.md タスクG)
    // ============================================
    it('メンテナンスフラグ未設定時、careManagerの更新は許可される(安全側デフォルト)', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-gate-default'), {
          fileName: 'test.pdf',
          status: 'processed',
          careManager: '',
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-gate-default');
      await assertSucceeds(
        setDoc(docRef, { fileName: 'test.pdf', status: 'processed', careManager: '佐藤花子' }, { merge: true })
      );
    });

    it('メンテナンスフラグdocは存在するがgroupAggregationGateOpenフィールド自体が未設定の場合も、careManagerの更新は許可される(安全側デフォルト、/code-review high指摘の回帰防止)', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-gate-field-missing'), {
          fileName: 'test.pdf', status: 'processed', careManager: '',
        });
        // フラグdoc自体は存在するが、groupAggregationGateOpenフィールドは設定されていない状態
        // (Firestore Rulesは存在しないフィールドへの`.`アクセスで評価エラーになるため、
        // `in`演算子での存在チェックがないと安全側デフォルトの意図に反し更新拒否側に倒れる)
        await setDoc(doc(db, 'system', 'maintenanceFlags'), { someUnrelatedField: true });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-gate-field-missing');
      await assertSucceeds(
        setDoc(docRef, { fileName: 'test.pdf', status: 'processed', careManager: '佐藤花子' }, { merge: true })
      );
    });

    it('groupAggregationGateOpen: trueの場合、careManagerの更新は許可される', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-gate-open'), {
          fileName: 'test.pdf', status: 'processed', careManager: '',
        });
        await setDoc(doc(db, 'system', 'maintenanceFlags'), {
          groupAggregationGateOpen: true,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-gate-open');
      await assertSucceeds(
        setDoc(docRef, { fileName: 'test.pdf', status: 'processed', careManager: '佐藤花子' }, { merge: true })
      );
    });

    it('groupAggregationGateOpen: falseの場合、careManagerの更新は拒否される(バックフィル中のFE直接編集を防止)', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-gate-closed'), {
          fileName: 'test.pdf', status: 'processed', careManager: '',
        });
        await setDoc(doc(db, 'system', 'maintenanceFlags'), {
          groupAggregationGateOpen: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-gate-closed');
      await assertFails(
        setDoc(docRef, { fileName: 'test.pdf', status: 'processed', careManager: '佐藤花子' }, { merge: true })
      );
    });

    it('groupAggregationGateOpen: falseでも、customer/office/documentType/careManagerに触れない更新は許可される', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-gate-closed-unrelated'), {
          fileName: 'test.pdf', status: 'processed', verified: false,
        });
        await setDoc(doc(db, 'system', 'maintenanceFlags'), {
          groupAggregationGateOpen: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-gate-closed-unrelated');
      await assertSucceeds(
        setDoc(docRef, { fileName: 'test.pdf', status: 'processed', verified: true, verifiedBy: normalUid }, { merge: true })
      );
    });

    it('groupAggregationGateOpen: falseの場合、customerName/officeName/documentTypeの更新も拒否される', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-gate-closed-multi'), {
          fileName: 'test.pdf', status: 'processed',
          customerName: '不明顧客', officeName: '不明事業所', documentType: '未判定',
        });
        await setDoc(doc(db, 'system', 'maintenanceFlags'), {
          groupAggregationGateOpen: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-gate-closed-multi');
      await assertFails(
        setDoc(docRef, {
          fileName: 'test.pdf', status: 'processed',
          customerName: '山田太郎', officeName: '事業所A', documentType: '契約書',
        }, { merge: true })
      );
    });

    it('groupAggregationGateOpen: falseの場合、careManagerKeyのみの更新(careManagerを伴わない)も拒否される(comment-analyzer指摘: useDocumentEdit.tsのeditedFields.careManagerKey単独書込み経路の回帰防止)', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-gate-closed-key-only'), {
          fileName: 'test.pdf', status: 'processed', careManagerKey: '',
        });
        await setDoc(doc(db, 'system', 'maintenanceFlags'), {
          groupAggregationGateOpen: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-gate-closed-key-only');
      await assertFails(
        setDoc(docRef, { fileName: 'test.pdf', status: 'processed', careManagerKey: 'sato-hanako' }, { merge: true })
      );
    });

    it('groupAggregationGateOpen: falseの場合、statusのみの更新(split遷移等)も拒否される(/codex review P2指摘: getAffectedGroups()はstatus:splitへの遷移を全グループからの除外として扱うため回帰防止)', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-gate-closed-status-only'), {
          fileName: 'test.pdf', status: 'processed', customerName: '山田太郎',
        });
        await setDoc(doc(db, 'system', 'maintenanceFlags'), {
          groupAggregationGateOpen: false,
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-gate-closed-status-only');
      await assertFails(
        setDoc(docRef, { fileName: 'test.pdf', status: 'split', customerName: '山田太郎' }, { merge: true })
      );
    });
  });

  // ============================================
  // /documentAggregationEvents コレクション（集計イベント冪等台帳、Issue #660 / ADR-0020）
  // ============================================
  describe('/documentAggregationEvents collection', () => {
    it('ホワイトリスト登録ユーザーでも台帳を読み取り不可（Cloud Functionsのみ）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documentAggregationEvents', 'event-1'), {
          source: '//firestore.googleapis.com/projects/test/databases/(default)',
          eventTime: '2026-07-15T00:00:00.000Z',
        });
      });

      const docRef = doc(normalUser.firestore(), 'documentAggregationEvents', 'event-1');
      await assertFails(getDoc(docRef));
    });

    it('管理者でも台帳を読み取り不可（Cloud Functionsのみ）', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documentAggregationEvents', 'event-2'), {
          source: '//firestore.googleapis.com/projects/test/databases/(default)',
          eventTime: '2026-07-15T00:00:00.000Z',
        });
      });

      const docRef = doc(adminUser.firestore(), 'documentAggregationEvents', 'event-2');
      await assertFails(getDoc(docRef));
    });

    it('誰も台帳を作成・編集できない（Cloud Functionsのみ）', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);
      const docRef = doc(adminUser.firestore(), 'documentAggregationEvents', 'event-3');
      await assertFails(
        setDoc(docRef, {
          source: '//firestore.googleapis.com/projects/test/databases/(default)',
          eventTime: '2026-07-15T00:00:00.000Z',
        })
      );
    });
  });

  // ============================================
  // /documentAggregationStates コレクション（contribution状態、Issue #664 / ADR-0021）
  // ============================================
  describe('/documentAggregationStates collection', () => {
    it('ホワイトリスト登録ユーザーでも状態を読み取り不可（Cloud Functionsのみ）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documentAggregationStates', 'doc-1'), {
          contribution: [],
        });
      });

      const docRef = doc(normalUser.firestore(), 'documentAggregationStates', 'doc-1');
      await assertFails(getDoc(docRef));
    });

    it('管理者でも状態を読み取り不可（Cloud Functionsのみ）', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documentAggregationStates', 'doc-2'), {
          contribution: [],
        });
      });

      const docRef = doc(adminUser.firestore(), 'documentAggregationStates', 'doc-2');
      await assertFails(getDoc(docRef));
    });

    it('誰も状態を作成・編集できない（Cloud Functionsのみ）', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);
      const docRef = doc(adminUser.firestore(), 'documentAggregationStates', 'doc-3');
      await assertFails(
        setDoc(docRef, {
          contribution: [],
        })
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

    it('getReprocessClearFieldsの全フィールド更新が許可される（再処理用、対象フィールド全てが実在するdocで検証）', async () => {
      // fixture drift防止(Codex/Fable5レビュー由来): clearFieldsが削除しようとする
      // 全キーを「実在させた」docに対してテストする。フィールドが元々存在しない
      // docへのdeleteFieldは「diffのaffectedKeysに含まれない」ため見かけ上成功するが、
      // 実在するフィールドをdeleteFieldする場合のみwhitelist漏れが顕在化する
      // (retryCount/provenance等7フィールドがwhitelist未登録だった実バグの再発防止)。
      const normalUser = testEnv.authenticatedContext(normalUid);

      // テストデータを作成（再処理前の状態、getReprocessClearFields()が消す全フィールドを実在させる）
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-reprocess-full'), {
          fileName: 'test.pdf',
          status: 'error',
          ocrResult: 'some text',
          ocrResultUrl: 'gs://bucket/ocr.json',
          summary: 'summary text',
          summaryTruncated: false,
          summaryOriginalLength: 100,
          ocrExtraction: { version: 'v1', extractedAt: new Date() },
          pageResults: [{ pageNumber: 1, text: 'page text' }],
          displayFileName: '請求書_山田太郎_20260115.pdf',
          provenance: { sourcePath: 'original/foo.pdf' },
          customerName: '山田太郎',
          customerId: 'cust-001',
          officeName: 'テスト事業所',
          officeId: 'office-001',
          documentType: '請求書',
          documentTypeConfirmed: true,
          fileDate: new Date(),
          fileDateFormatted: '2026-01-15',
          careManager: 'ケアマネA',
          category: '介護',
          customerCandidates: [{ id: 'cust-001', name: '山田太郎', score: 0.9 }],
          officeCandidates: [{ id: 'office-001', name: 'テスト事業所', score: 0.9 }],
          extractionScores: { customer: 0.9, office: 0.9, documentType: 0.9 },
          extractionDetails: { reason: 'test' },
          isDuplicateCustomer: false,
          needsManualCustomerSelection: false,
          allCustomerCandidates: [{ id: 'cust-001', name: '山田太郎', score: 0.9 }],
          suggestedNewOffice: 'テスト新規事業所',
          customerConfirmed: true,
          confirmedBy: normalUid,
          confirmedAt: new Date(),
          officeConfirmed: true,
          officeConfirmedBy: normalUid,
          officeConfirmedAt: new Date(),
          verified: true,
          verifiedBy: normalUid,
          verifiedAt: new Date(),
          error: 'some error',
          lastErrorMessage: 'some error message',
          // handleProcessingError (functions/src/ocr/ocrProcessor.ts) がerror確定時に
          // 必ず書き込むフィールド。本番のエラー文書再処理で典型的に実在する。
          retryCount: 3,
          retryAfter: new Date(),
          errorRescueCount: 1,
          lastRescuedAt: new Date(),
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-reprocess-full');
      // getReprocessClearFields() と完全に同一のフィールドセットで更新
      await assertSucceeds(
        updateDoc(docRef, {
          status: 'pending',
          // deleteField() でフィールド削除
          ocrResult: deleteField(),
          ocrResultUrl: deleteField(),
          summary: deleteField(),
          summaryTruncated: deleteField(),
          summaryOriginalLength: deleteField(),
          ocrExtraction: deleteField(),
          pageResults: deleteField(),
          displayFileName: deleteField(),
          provenance: deleteField(),
          customerName: deleteField(),
          customerId: deleteField(),
          officeName: deleteField(),
          officeId: deleteField(),
          documentType: deleteField(),
          fileDate: deleteField(),
          fileDateFormatted: deleteField(),
          careManager: deleteField(),
          category: deleteField(),
          customerCandidates: deleteField(),
          officeCandidates: deleteField(),
          extractionScores: deleteField(),
          extractionDetails: deleteField(),
          isDuplicateCustomer: deleteField(),
          needsManualCustomerSelection: deleteField(),
          allCustomerCandidates: deleteField(),
          suggestedNewOffice: deleteField(),
          error: deleteField(),
          lastErrorMessage: deleteField(),
          lastErrorId: deleteField(),
          retryCount: deleteField(),
          retryAfter: deleteField(),
          errorRescueCount: deleteField(),
          lastRescuedAt: deleteField(),
          // 値をリセット
          customerConfirmed: false,
          confirmedBy: null,
          confirmedAt: null,
          officeConfirmed: false,
          officeConfirmedBy: null,
          officeConfirmedAt: null,
          documentTypeConfirmed: false,
          verified: false,
          verifiedBy: null,
          verifiedAt: null,
        })
      );
    });

    it('サーバー専有フィールド(retryCount等)への新規値の上書きは拒否される（Codex review #569 P2反映）', async () => {
      // getReprocessClearFields()はこれらのフィールドをdeleteField()する用途のみで、
      // 値を新規設定・上書きする経路はFEに存在しない。ホワイトリスト登録ユーザーが
      // 任意の値を書き込めてしまうと、retryAfterを未来日時にして再処理を妨害したり、
      // provenanceを改ざんしてrotatePdfPagesの整合性検証を無効化する等の悪用経路になる。
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-server-owned-fields'), {
          fileName: 'test.pdf',
          status: 'error',
          retryCount: 1,
          retryAfter: new Date('2026-01-01'),
          errorRescueCount: 0,
          provenance: { sourcePath: 'original/legit.pdf' },
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-server-owned-fields');
      // retryAfterを遠い未来に書き換えて再処理を妨害しようとするケース
      await assertFails(updateDoc(docRef, { retryAfter: new Date('2099-01-01') }));
      // provenanceを改ざんしようとするケース
      await assertFails(updateDoc(docRef, { provenance: { sourcePath: 'original/tampered.pdf' } }));
      // retryCount/errorRescueCountを任意値に書き換えようとするケース
      await assertFails(updateDoc(docRef, { retryCount: 0 }));
      await assertFails(updateDoc(docRef, { errorRescueCount: 99 }));
    });

    it('サーバー専有フィールドの削除(deleteField)は引き続き許可される', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-server-owned-fields-clear'), {
          fileName: 'test.pdf',
          status: 'error',
          retryCount: 1,
          retryAfter: new Date('2026-01-01'),
          errorRescueCount: 0,
          lastRescuedAt: new Date('2026-01-01'),
          provenance: { sourcePath: 'original/legit.pdf' },
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-server-owned-fields-clear');
      await assertSucceeds(
        updateDoc(docRef, {
          retryCount: deleteField(),
          retryAfter: deleteField(),
          errorRescueCount: deleteField(),
          lastRescuedAt: deleteField(),
          provenance: deleteField(),
        })
      );
    });

    it('サーバー専有フィールドが不在のdocへnull値を新規注入するのは拒否される（Codex review #569 2nd round P2反映）', async () => {
      // resource.data.get(field, null) を使った素朴な「無変更判定」だと、フィールド不在の
      // docに対してクライアントが`field: null`を新規設定しても
      // resource.data.get(field, null)===null と一致してしまい通過する脆弱性があった。
      // これは「フィールドが存在するが値がnull」という不正状態を作り、Phase C backfillの
      // presence判定やrotatePdfPagesのlegacy provenance guardを誤動作させうる。
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-no-server-fields-yet'), {
          fileName: 'test.pdf',
          status: 'processed',
          // retryCount/retryAfter/errorRescueCount/lastRescuedAt/provenance はいずれも未設定
        });
      });

      const docRef = doc(normalUser.firestore(), 'documents', 'doc-no-server-fields-yet');
      await assertFails(updateDoc(docRef, { provenance: null }));
      await assertFails(updateDoc(docRef, { retryCount: null }));
      await assertFails(updateDoc(docRef, { retryAfter: null }));
      await assertFails(updateDoc(docRef, { errorRescueCount: null }));
      await assertFails(updateDoc(docRef, { lastRescuedAt: null }));
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
  // /documents/{docId}/detail/{detailId} サブコレクション (ADR-0018, Issue #547)
  // ============================================
  describe('/documents/{docId}/detail/{detailId} subcollection', () => {
    it('親docが存在する場合、ホワイトリスト登録ユーザーはdetail/mainを読み取り可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        // context.firestore() は同一コールバック内で複数回呼ぶと
        // "Firestore has already been started" エラーになるため、1回だけ呼び再利用する。
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-with-detail'), {
          fileName: 'test.pdf',
          status: 'processed',
        });
        await setDoc(doc(db, 'documents', 'doc-with-detail', 'detail', 'main'), {
          ocrResult: 'full text',
          pageResults: [],
        });
      });

      const detailRef = doc(normalUser.firestore(), 'documents', 'doc-with-detail', 'detail', 'main');
      await assertSucceeds(getDoc(detailRef));
    });

    it('親docが存在しない場合、detail/mainの読み取りは拒否される（孤児detail防御）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        // 親docを作らず detail/main のみ作成（削除同期漏れ・孤児状態を再現）
        await setDoc(doc(context.firestore(), 'documents', 'doc-orphan-detail', 'detail', 'main'), {
          ocrResult: 'full text',
          pageResults: [],
        });
      });

      const detailRef = doc(normalUser.firestore(), 'documents', 'doc-orphan-detail', 'detail', 'main');
      await assertFails(getDoc(detailRef));
    });

    it('detail/mainへの新規作成(setDoc)はpermission-deniedで拒否される（Functions専用）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-create-detail'), {
          fileName: 'test.pdf',
          status: 'pending',
        });
      });

      const detailRef = doc(normalUser.firestore(), 'documents', 'doc-create-detail', 'detail', 'main');
      // resource.data == null (未作成) への書込は create ルールで評価される。
      // update() ではなく setDoc() を使うのは、update() は対象doc不在時に
      // SDK/サーバー側の存在チェックで NOT_FOUND となりルール評価に届かないため
      // (allow create: if false による permission-denied を検証するにはこちらが正しい)。
      await assertFails(setDoc(detailRef, { ocrResult: 'x', pageResults: [] }));
    });

    it('ホワイトリスト登録ユーザーはocrResult/pageResultsの削除(deleteField)が可能', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-update-detail'), {
          fileName: 'test.pdf',
          status: 'processed',
        });
        await setDoc(doc(db, 'documents', 'doc-update-detail', 'detail', 'main'), {
          ocrResult: 'old text',
          pageResults: [],
        });
      });

      const detailRef = doc(normalUser.firestore(), 'documents', 'doc-update-detail', 'detail', 'main');
      await assertSucceeds(
        updateDoc(detailRef, { ocrResult: deleteField(), pageResults: deleteField() })
      );
    });

    it('ocrResult/pageResultsへの新しい値の上書きは拒否される（Codex review #569 P2反映、OCR内容改ざん防止）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-update-detail-overwrite'), {
          fileName: 'test.pdf',
          status: 'processed',
        });
        await setDoc(doc(db, 'documents', 'doc-update-detail-overwrite', 'detail', 'main'), {
          ocrResult: 'old text',
          pageResults: [],
        });
      });

      const detailRef = doc(
        normalUser.firestore(),
        'documents',
        'doc-update-detail-overwrite',
        'detail',
        'main'
      );
      await assertFails(
        updateDoc(detailRef, { ocrResult: 'new text', pageResults: [{ pageNumber: 1 }] })
      );
    });

    it('ocrResult/pageResults以外のフィールド更新は拒否される', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-update-detail-forbidden'), {
          fileName: 'test.pdf',
          status: 'processed',
        });
        await setDoc(
          doc(db, 'documents', 'doc-update-detail-forbidden', 'detail', 'main'),
          { ocrResult: 'old text', pageResults: [] }
        );
      });

      const detailRef = doc(
        normalUser.firestore(),
        'documents',
        'doc-update-detail-forbidden',
        'detail',
        'main'
      );
      await assertFails(updateDoc(detailRef, { unrelatedField: 'x' }));
    });

    it('detail/main不在のdocへのupdate()は失敗する（resource.dataがnullでdiff()評価不能、set()のcreateルール拒否とは別経路）', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'documents', 'doc-no-detail-yet'), {
          fileName: 'test.pdf',
          status: 'pending',
        });
      });

      const detailRef = doc(normalUser.firestore(), 'documents', 'doc-no-detail-yet', 'detail', 'main');
      // 実測(emulator): update() は対象doc不在時もクライアントにNOT_FOUNDを返すのではなく、
      // resource.data が null になった状態で allow update の diff() 評価が失敗し、
      // 結果としてPERMISSION_DENIED (evaluation error, "Null value error") になる。
      // set()によるcreateルール拒否(allow create: if false → false for 'create')とは
      // ログ上のエラー内容が異なる、別の評価パスであることを確認する。
      await assertFails(updateDoc(detailRef, { ocrResult: 'x' }));
    });

    it('管理者はdetail/mainを削除可能', async () => {
      const adminUser = testEnv.authenticatedContext(adminUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-delete-detail-admin'), {
          fileName: 'test.pdf',
          status: 'processed',
        });
        await setDoc(
          doc(db, 'documents', 'doc-delete-detail-admin', 'detail', 'main'),
          { ocrResult: 'x', pageResults: [] }
        );
      });

      const detailRef = doc(adminUser.firestore(), 'documents', 'doc-delete-detail-admin', 'detail', 'main');
      await assertSucceeds(deleteDoc(detailRef));
    });

    it('一般ユーザーはdetail/mainを削除できない', async () => {
      const normalUser = testEnv.authenticatedContext(normalUid);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-delete-detail-normal'), {
          fileName: 'test.pdf',
          status: 'processed',
        });
        await setDoc(
          doc(db, 'documents', 'doc-delete-detail-normal', 'detail', 'main'),
          { ocrResult: 'x', pageResults: [] }
        );
      });

      const detailRef = doc(
        normalUser.firestore(),
        'documents',
        'doc-delete-detail-normal',
        'detail',
        'main'
      );
      await assertFails(deleteDoc(detailRef));
    });

    it('未認証ユーザーはdetail/mainを読み取れない', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'documents', 'doc-unauth-detail'), {
          fileName: 'test.pdf',
          status: 'processed',
        });
        await setDoc(doc(db, 'documents', 'doc-unauth-detail', 'detail', 'main'), {
          ocrResult: 'x',
          pageResults: [],
        });
      });

      const unauthedContext = testEnv.unauthenticatedContext();
      const detailRef = doc(unauthedContext.firestore(), 'documents', 'doc-unauth-detail', 'detail', 'main');
      await assertFails(getDoc(detailRef));
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
