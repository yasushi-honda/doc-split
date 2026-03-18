/**
 * OCRリトライ統合テスト (Firebaseエミュレータ)
 *
 * PR #195で導入されたretryAfter/429エラー対策の実動作を検証する。
 * 既存のocrProcessor.test.tsはモック/純粋ロジックテスト。
 * このファイルでは実際のFirestore Timestampの読み書きを検証する。
 *
 * 実行: firebase emulators:exec --only firestore 'npx mocha --require ts-node/register --timeout 10000 test/ocrRetryIntegration.test.ts'
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { isTransientError, is429Error } from '../src/utils/retry';

// エミュレータ接続設定
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8085';

// firebase-admin初期化（エミュレータ用 — 認証不要）
const app = admin.initializeApp(
  { projectId: 'ocrretry-integration-test' },
  'ocrRetryIntegrationTest'
);
const db = app.firestore();

describe('OCRリトライ統合テスト (エミュレータ)', () => {
  // テスト間でコレクションをクリーンアップ
  afterEach(async () => {
    const docs = await db.collection('documents').get();
    const batch = db.batch();
    docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  });

  after(async () => {
    await app.delete();
  });

  describe('retryAfter Timestamp往復', () => {
    it('Timestamp.fromMillis → Firestore書き込み → 読み戻し → toMillis で正しい値が得られる', async () => {
      const futureMs = Date.now() + 180000; // 3分後
      const timestamp = admin.firestore.Timestamp.fromMillis(futureMs);

      // 書き込み
      const docRef = db.collection('documents').doc('retry-roundtrip-test');
      await docRef.set({
        status: 'pending',
        retryAfter: timestamp,
        retryCount: 1,
      });

      // 読み戻し
      const snapshot = await docRef.get();
      const data = snapshot.data()!;

      // toMillis()で往復確認
      const readBack = data.retryAfter.toMillis();
      // Firestoreはミリ秒精度を保持するので完全一致を期待
      expect(readBack).to.equal(futureMs);
    });

    it('retryAfterがない場合、toMillis呼び出しでエラーにならない（processOCRのガード確認）', async () => {
      const docRef = db.collection('documents').doc('no-retry-after-test');
      await docRef.set({
        status: 'pending',
        retryCount: 0,
      });

      const snapshot = await docRef.get();
      const data = snapshot.data()!;

      // processOCR.tsと同じガードパターン: data.retryAfter?.toMillis?.() || 0
      const retryAfter = data.retryAfter?.toMillis?.() || 0;
      expect(retryAfter).to.equal(0);
    });

    it('serverTimestampとretryAfterが共存できる', async () => {
      const futureMs = Date.now() + 60000;
      const docRef = db.collection('documents').doc('mixed-timestamp-test');
      await docRef.set({
        status: 'pending',
        retryAfter: admin.firestore.Timestamp.fromMillis(futureMs),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        retryCount: 1,
      });

      const snapshot = await docRef.get();
      const data = snapshot.data()!;

      expect(data.retryAfter.toMillis()).to.equal(futureMs);
      expect(data.updatedAt).to.be.instanceOf(admin.firestore.Timestamp);
    });
  });

  describe('retryAfterスキップ判定', () => {
    // processOCR.tsのスキップロジックを再現:
    //   const retryAfter = data.retryAfter?.toMillis?.() || 0;
    //   if (retryAfter > Date.now()) { skip }
    function shouldSkip(data: admin.firestore.DocumentData): boolean {
      const retryAfter = data.retryAfter?.toMillis?.() || 0;
      return retryAfter > Date.now();
    }

    it('retryAfterが未来のドキュメントはスキップされる', async () => {
      const docRef = db.collection('documents').doc('future-retry');
      await docRef.set({
        status: 'pending',
        retryAfter: admin.firestore.Timestamp.fromMillis(Date.now() + 300000), // 5分後
        retryCount: 1,
      });

      const snapshot = await docRef.get();
      expect(shouldSkip(snapshot.data()!)).to.be.true;
    });

    it('retryAfterが過去のドキュメントは処理対象になる', async () => {
      const docRef = db.collection('documents').doc('past-retry');
      await docRef.set({
        status: 'pending',
        retryAfter: admin.firestore.Timestamp.fromMillis(Date.now() - 60000), // 1分前
        retryCount: 1,
      });

      const snapshot = await docRef.get();
      expect(shouldSkip(snapshot.data()!)).to.be.false;
    });

    it('retryAfterがないドキュメントは処理対象になる', async () => {
      const docRef = db.collection('documents').doc('no-retry');
      await docRef.set({
        status: 'pending',
        retryCount: 0,
      });

      const snapshot = await docRef.get();
      expect(shouldSkip(snapshot.data()!)).to.be.false;
    });

    it('3件のドキュメントで正しく分類される（統合シナリオ）', async () => {
      // 3件セットアップ
      const batch = db.batch();
      batch.set(db.collection('documents').doc('doc-skip'), {
        status: 'pending',
        retryAfter: admin.firestore.Timestamp.fromMillis(Date.now() + 180000),
        retryCount: 1,
      });
      batch.set(db.collection('documents').doc('doc-ready'), {
        status: 'pending',
        retryAfter: admin.firestore.Timestamp.fromMillis(Date.now() - 10000),
        retryCount: 2,
      });
      batch.set(db.collection('documents').doc('doc-new'), {
        status: 'pending',
        retryCount: 0,
      });
      await batch.commit();

      // 全件取得して分類
      const pendingDocs = await db
        .collection('documents')
        .where('status', '==', 'pending')
        .get();

      expect(pendingDocs.size).to.equal(3);

      const processable: string[] = [];
      const skipped: string[] = [];

      for (const docSnapshot of pendingDocs.docs) {
        if (shouldSkip(docSnapshot.data())) {
          skipped.push(docSnapshot.id);
        } else {
          processable.push(docSnapshot.id);
        }
      }

      expect(skipped).to.deep.equal(['doc-skip']);
      expect(processable).to.have.members(['doc-ready', 'doc-new']);
      expect(processable).to.have.lengthOf(2);
    });
  });

  describe('handleProcessingError書き込みパターン検証', () => {
    it('429エラー時のretryAfter・retryCount・statusが正しく書き込まれる', async () => {
      const docRef = db.collection('documents').doc('error-429-test');
      // 初期状態: processing中
      await docRef.set({
        status: 'processing',
        retryCount: 0,
      });

      // handleProcessingErrorと同じトランザクション更新を再現
      const is429 = true;
      const retryAfterMs = is429 ? 3 * 60 * 1000 : 1 * 60 * 1000;
      const beforeUpdate = Date.now();

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(docRef);
        const currentRetryCount = (doc.data()?.retryCount as number) || 0;

        tx.update(docRef, {
          status: 'pending',
          retryCount: currentRetryCount + 1,
          retryAfter: admin.firestore.Timestamp.fromMillis(
            Date.now() + retryAfterMs
          ),
          lastErrorMessage: 'got status: 429 Too Many Requests',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // 読み戻して検証
      const snapshot = await docRef.get();
      const data = snapshot.data()!;

      expect(data.status).to.equal('pending');
      expect(data.retryCount).to.equal(1);
      expect(data.lastErrorMessage).to.equal(
        'got status: 429 Too Many Requests'
      );

      // retryAfterが約3分後に設定されている
      const retryAfterValue = data.retryAfter.toMillis();
      const expectedMin = beforeUpdate + retryAfterMs - 1000; // 1秒の余裕
      const expectedMax = beforeUpdate + retryAfterMs + 5000; // 5秒の余裕
      expect(retryAfterValue).to.be.within(expectedMin, expectedMax);
    });

    it('非429 transientエラー時のretryAfterは1分後に設定される', async () => {
      const docRef = db.collection('documents').doc('error-transient-test');
      await docRef.set({
        status: 'processing',
        retryCount: 0,
      });

      const is429 = false;
      const retryAfterMs = is429 ? 3 * 60 * 1000 : 1 * 60 * 1000;
      const beforeUpdate = Date.now();

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(docRef);
        const currentRetryCount = (doc.data()?.retryCount as number) || 0;

        tx.update(docRef, {
          status: 'pending',
          retryCount: currentRetryCount + 1,
          retryAfter: admin.firestore.Timestamp.fromMillis(
            Date.now() + retryAfterMs
          ),
          lastErrorMessage: 'ETIMEDOUT',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      const snapshot = await docRef.get();
      const data = snapshot.data()!;
      const retryAfterValue = data.retryAfter.toMillis();
      const expectedMin = beforeUpdate + 60000 - 1000;
      const expectedMax = beforeUpdate + 60000 + 5000;
      expect(retryAfterValue).to.be.within(expectedMin, expectedMax);
    });
  });

  describe('isTransientError / is429Error（実メッセージ検証）', () => {
    // 実際にVertex AIから返るエラーメッセージで分類が正しいことを確認
    const vertexAiErrors = [
      {
        msg: 'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Resource exhausted"}}',
        transient: true,
        is429: true,
      },
      {
        msg: 'GoogleGenerativeAIError: exception posting request to model',
        transient: true,
        is429: false,
      },
      {
        msg: 'Error: 13 INTERNAL: An internal error has occurred',
        transient: false,
        is429: false,
      },
      {
        msg: 'RESOURCE_EXHAUSTED: Quota exceeded for quota metric',
        transient: true,
        is429: true,
      },
    ];

    for (const { msg, transient, is429: expected429 } of vertexAiErrors) {
      it(`"${msg.slice(0, 60)}..." → transient=${transient}, is429=${expected429}`, () => {
        const error = new Error(msg);
        expect(isTransientError(error)).to.equal(transient);
        expect(is429Error(error)).to.equal(expected429);
      });
    }
  });
});
