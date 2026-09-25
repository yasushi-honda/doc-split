/**
 * deleteDocument handler 統合テスト (Issue #1037)
 *
 * 目的: PDF削除機能を管理者限定から一般ユーザーにも許可する変更で、
 * `deleteDocument` Cloud Function本体の認可ロジック(ホワイトリスト判定)を
 * 実際にハンドラを呼び出して検証する。firestore.rulesはAdmin SDKで動く
 * この関数には適用されないため、ルールテストでは代替できない
 * (/plan-crossreview codex pass1/pass2の指摘、詳細はdocs/handoff/GOAL.md参照)。
 *
 * 検証する契約:
 *   - 未認証 → unauthenticated
 *   - ホワイトリスト外(users/{uid}未登録) → permission-denied
 *   - ホワイトリスト済み・role=user → 削除成功(今回の変更の核心)
 *   - ホワイトリスト済み・role=admin → 削除成功(回帰)
 *
 * Storage/gmailLogs/uploadLogs削除処理はfileUrl/fileIdを持たないdocumentを
 * seedすることで経路をスキップし、権限ロジックの検証に絞る。
 *
 * 実行: npm run test:integration (firebase emulators:exec --only firestore 経由)
 */

// helpers/initFirestoreEmulator を最初に import して default app + emulator host を初期化。
// deleteDocument.ts が module-level で admin.firestore()/admin.storage() を評価するため、
// import 順序が重要。
import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import functionsTest from 'firebase-functions-test';
import { HttpsError } from 'firebase-functions/v2/https';
import { deleteDocument } from '../src/documents/deleteDocument';
import { cleanupCollections } from './helpers/cleanupEmulator';

const test = functionsTest();
const wrapped = test.wrap(deleteDocument);
const db = admin.firestore();

const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'users'];

/** users/{uid} にロール付きでユーザーを作成 */
async function seedUser(uid: string, role: 'user' | 'admin'): Promise<void> {
  await db.doc(`users/${uid}`).set({ email: `${uid}@example.com`, role });
}

/** documents/{docId} を fileUrl/fileId なしで seed(Storage/ログ削除経路をスキップさせる) */
async function seedDocument(docId: string): Promise<void> {
  await db.doc(`documents/${docId}`).set({
    fileName: `${docId}.pdf`,
    status: 'processed',
  });
}

/** Callable wrap 呼出しの省略形 (auth context + data) */
async function callDelete(
  documentId: string,
  uid: string | null
): Promise<{ success: boolean; warnings?: string[] }> {
  const auth = uid === null ? undefined : { uid, token: {} as Record<string, unknown> };
  // rawRequest は CallableRequest 型で要求されるが handler 側で参照しないため空 object。
  const request = { auth, data: { documentId }, rawRequest: {} } as unknown as Parameters<
    typeof wrapped
  >[0];
  return wrapped(request);
}

/**
 * HttpsError を期待する非同期処理を assert するヘルパー。
 * instanceof HttpsError の厳密チェックで、他の例外の.code偶然一致による誤合格を防ぐ。
 */
async function expectHttpsError(
  action: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  let caught: unknown = undefined;
  try {
    await action();
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected HttpsError(${expectedCode}) to be thrown`).to.be.instanceOf(
    HttpsError
  );
  expect((caught as HttpsError).code).to.equal(expectedCode);
}

describe('deleteDocument handler integration (Issue #1037)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('未認証 → unauthenticated', async () => {
    await expectHttpsError(() => callDelete('doc-1037-unauth', null), 'unauthenticated');
  });

  it('ホワイトリスト外(users/{uid}未登録) → permission-denied', async () => {
    await seedDocument('doc-1037-nonwhitelisted');
    await expectHttpsError(
      () => callDelete('doc-1037-nonwhitelisted', 'unknown-user-uid'),
      'permission-denied'
    );
  });

  it('ホワイトリスト済み・role=userは削除に成功する(Issue #1037の核心)', async () => {
    await seedUser('user-1037-a', 'user');
    await seedDocument('doc-1037-user-success');

    const result = await callDelete('doc-1037-user-success', 'user-1037-a');

    expect(result.success).to.be.true;
    const snapshot = await db.doc('documents/doc-1037-user-success').get();
    expect(snapshot.exists).to.be.false;
  });

  it('ホワイトリスト済み・role=adminも引き続き削除に成功する(回帰)', async () => {
    await seedUser('admin-1037-a', 'admin');
    await seedDocument('doc-1037-admin-success');

    const result = await callDelete('doc-1037-admin-success', 'admin-1037-a');

    expect(result.success).to.be.true;
    const snapshot = await db.doc('documents/doc-1037-admin-success').get();
    expect(snapshot.exists).to.be.false;
  });
});
