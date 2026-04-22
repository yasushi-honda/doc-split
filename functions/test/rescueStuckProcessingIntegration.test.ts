/**
 * rescueStuckProcessingDocs 統合テスト (Firebaseエミュレータ) - #360
 *
 * PR #359 (Closes #196) の /review-pr で pr-test-analyzer が指摘した
 * 「rescue ロジックテストが pure 数値計算で実コードパス未到達」問題を解消する。
 *
 * 既存 ocrProcessor.test.ts の「processingスタック救済ロジック検証」describe は
 * 境界値の boolean 判定を pure テストで保護するが、以下の要件は dynamic test のみ検証可能:
 *   - AC3/AC4: update payload の key 集合 (CLAUDE.md MUST「更新対象外フィールド不変」)
 *   - AC5:    lastErrorMessage の substring lock-in (運用監視 grep 依存)
 *   - AC2:    errors/ への safeLogError 副作用 (silent-failure-hunter I1)
 *
 * 実行: firebase emulators:exec --only firestore --project rescue-stuck-integration-test \
 *         'npm run test:integration'
 */

// 必ず最初に import: default admin app + emulator host を先行初期化。
// processOCR.ts → rateLimiter.ts は top-level で admin.firestore() を呼ぶため、
// この helper より前に何かを import すると FirebaseAppError で失敗する。
import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { rescueStuckProcessingDocs } from '../src/ocr/processOCR';
import {
  MAX_RETRY_COUNT,
  STUCK_RESCUE_RETRY_AFTER_MS,
  STUCK_PROCESSING_THRESHOLD_MS,
  STUCK_RESCUE_PENDING_MESSAGE,
  STUCK_RESCUE_FATAL_MESSAGE_PREFIX,
} from '../src/ocr/constants';
import { cleanupCollections } from './helpers/cleanupEmulator';

const db = admin.firestore();
// 境界 (10分) より確実に過去になるよう +60s のバッファ
const STUCK_UPDATED_AT_OFFSET_MS = STUCK_PROCESSING_THRESHOLD_MS + 60_000;
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'errors'];

/** rescue 対象ドキュメントの test fixture 型 (any キャスト回避) */
interface StuckDocFixture {
  status: string;
  retryCount?: number;
  retryAfter?: admin.firestore.Timestamp;
  lastErrorMessage?: string;
  updatedAt: admin.firestore.Timestamp;
  fileName?: string;
  customerName?: string;
  officeName?: string;
  mimeType?: string;
  fileId?: string;
  documentType?: string;
}

describe('rescueStuckProcessingDocs 統合テスト (#360)', () => {
  // beforeEach で全削除することで前 test の残骸を次が掃除する pattern。
  // emulator は test 終了で破棄されるため after hook での後始末は不要。
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  describe('pending 分岐 (retryCount < MAX_RETRY_COUNT)', () => {
    it('AC4: pending 分岐で status/retryCount/retryAfter/lastErrorMessage/updatedAt のみ更新される', async () => {
      const docId = 'stuck-pending-case';
      const originalData = {
        status: 'processing',
        updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_UPDATED_AT_OFFSET_MS),
        retryCount: 3,
        // 更新対象外フィールド (CLAUDE.md MUST: これらが変化しないこと)
        fileName: 'original.pdf',
        customerName: '山田太郎',
        officeName: '事業所A',
        mimeType: 'application/pdf',
        fileId: 'file-xyz',
        documentType: '介護保険証',
      };
      await db.doc(`documents/${docId}`).set(originalData);

      const beforeMs = Date.now();
      await rescueStuckProcessingDocs();
      const afterMs = Date.now();

      const updated = (await db.doc(`documents/${docId}`).get()).data() as StuckDocFixture;

      // 更新されたフィールド
      expect(updated.status).to.equal('pending');
      expect(updated.retryCount).to.equal(4);
      expect(updated.retryAfter).to.be.instanceOf(admin.firestore.Timestamp);
      // instanceOf assert 後の non-null narrowing (StuckDocFixture 型では optional)
      const retryAfterMs = updated.retryAfter!.toMillis();
      expect(retryAfterMs).to.be.gte(beforeMs + STUCK_RESCUE_RETRY_AFTER_MS);
      expect(retryAfterMs).to.be.lte(afterMs + STUCK_RESCUE_RETRY_AFTER_MS);
      expect(updated.lastErrorMessage).to.equal(STUCK_RESCUE_PENDING_MESSAGE);
      expect(updated.updatedAt).to.be.instanceOf(admin.firestore.Timestamp);

      // 更新対象外フィールド不変 (CLAUDE.md MUST)
      expect(updated.fileName).to.equal('original.pdf');
      expect(updated.customerName).to.equal('山田太郎');
      expect(updated.officeName).to.equal('事業所A');
      expect(updated.mimeType).to.equal('application/pdf');
      expect(updated.fileId).to.equal('file-xyz');
      expect(updated.documentType).to.equal('介護保険証');
    });

    it('retryCount 未設定 → 1 回目の rescue で retryCount=1 で pending', async () => {
      const docId = 'stuck-no-retry-count';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_UPDATED_AT_OFFSET_MS),
        fileName: 'fresh.pdf',
      });

      await rescueStuckProcessingDocs();

      const updated = (await db.doc(`documents/${docId}`).get()).data() as StuckDocFixture;
      expect(updated.status).to.equal('pending');
      expect(updated.retryCount).to.equal(1);
      expect(updated.retryAfter).to.be.instanceOf(admin.firestore.Timestamp);
    });
  });

  describe('error 分岐 (retryCount >= MAX_RETRY_COUNT)', () => {
    it('AC3: error 分岐で status/retryCount/lastErrorMessage/updatedAt 更新 + retryAfter 削除', async () => {
      const docId = 'stuck-error-case';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_UPDATED_AT_OFFSET_MS),
        retryCount: MAX_RETRY_COUNT - 1, // 次回 +1 で MAX 到達
        // 古い retryAfter (fix-stuck-documents --include-errors で pending 復帰させた時に
        // 即スキップされないよう delete されることの検証)
        retryAfter: admin.firestore.Timestamp.fromMillis(Date.now() + 180_000),
        // 更新対象外フィールド
        fileName: 'doomed.pdf',
        customerName: '田中花子',
        fileId: 'file-abc',
      });

      await rescueStuckProcessingDocs();

      const updated = (await db.doc(`documents/${docId}`).get()).data() as StuckDocFixture;

      expect(updated.status).to.equal('error');
      expect(updated.retryCount).to.equal(MAX_RETRY_COUNT);
      // retryAfter が削除されていること (#196 review: 古い retryAfter 残存防止)
      expect(updated.retryAfter).to.be.undefined;
      expect(updated.updatedAt).to.be.instanceOf(admin.firestore.Timestamp);

      // 更新対象外フィールド不変
      expect(updated.fileName).to.equal('doomed.pdf');
      expect(updated.customerName).to.equal('田中花子');
      expect(updated.fileId).to.equal('file-abc');
    });

    it('retryCount > MAX_RETRY_COUNT (異常値) → error 分岐 (無限 rescue 防止、境界値 ±2)', async () => {
      const docId = 'stuck-error-abnormal';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_UPDATED_AT_OFFSET_MS),
        retryCount: MAX_RETRY_COUNT + 2, // 異常値 (何らかの経緯で MAX 超過、rescue でも error に落ちるべき)
        fileName: 'abnormal.pdf',
      });

      await rescueStuckProcessingDocs();

      const updated = (await db.doc(`documents/${docId}`).get()).data() as StuckDocFixture;
      expect(updated.status).to.equal('error');
      // retryCount 自体はインクリメントされる (MAX+3 = MAX_RETRY_COUNT+3 になる想定)
      expect(updated.retryCount).to.equal(MAX_RETRY_COUNT + 3);
      expect(updated.retryAfter).to.be.undefined;
      expect(updated.lastErrorMessage).to.include(STUCK_RESCUE_FATAL_MESSAGE_PREFIX);
    });

    it('AC5: error 分岐の lastErrorMessage が substring "max retries exceeded (N/M)" を含む (運用監視 grep lock-in)', async () => {
      const docId = 'stuck-error-msg-lockin';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_UPDATED_AT_OFFSET_MS),
        retryCount: MAX_RETRY_COUNT - 1,
        fileName: 'msg-test.pdf',
      });

      await rescueStuckProcessingDocs();

      const updated = (await db.doc(`documents/${docId}`).get()).data() as StuckDocFixture;
      expect(updated.lastErrorMessage).to.be.a('string');
      // 運用監視で grep に使う substring を lock-in (#360 pr-test-analyzer Important)
      expect(updated.lastErrorMessage).to.include(STUCK_RESCUE_FATAL_MESSAGE_PREFIX);
      expect(updated.lastErrorMessage).to.include(`${MAX_RETRY_COUNT}/${MAX_RETRY_COUNT}`);
    });

    it('AC2: error 分岐で errors/ コレクションに記録される (safeLogError 呼出)', async () => {
      const docId = 'stuck-error-logged';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_UPDATED_AT_OFFSET_MS),
        retryCount: MAX_RETRY_COUNT - 1,
        fileName: 'logged.pdf',
      });

      await rescueStuckProcessingDocs();

      // #196 silent-failure-hunter C1: ErrorsPage からの可視化
      const errs = await db
        .collection('errors')
        .where('documentId', '==', docId)
        .get();
      expect(errs.size).to.equal(1);
      const errDoc = errs.docs[0].data();
      expect(errDoc.source).to.equal('ocr');
      expect(errDoc.functionName).to.equal('processOCR');
    });
  });

  describe('per-doc catch 経路 (runTransaction 失敗時) #364', () => {
    // #364: db.runTransaction を一時的に差し替えて tx 失敗を誘発し、per-doc catch の safeLogError
    // 呼出を lock-in する。#360 silent-failure-hunter I1 で実装された outer try/catch を誤削除すると
    // partial failure で silent 未処理が復活するリスクを防ぐ。
    //
    // buildPageResult.test.ts の withWarnSpy と同方針で sinon 依存を新規追加しない polyfill で差し替える。

    const TX_FAILURE_MESSAGE = 'Simulated runTransaction failure for #364 test';

    /**
     * db.runTransaction を一時差し替えして rescue 本体が per-doc catch を通るよう強制する。
     * try/finally で原値復元を保証するため、assertion 内で失敗しても stub がリークしない。
     */
    async function withFailingRunTransaction(fn: () => Promise<void>): Promise<void> {
      const original = db.runTransaction.bind(db);
      // rejects() で tx body を一切呼ばず即 reject する。rescue 本体の per-doc try/catch が発火する。
      (db as unknown as { runTransaction: unknown }).runTransaction = async () => {
        throw new Error(TX_FAILURE_MESSAGE);
      };
      try {
        await fn();
      } finally {
        (db as unknown as { runTransaction: typeof original }).runTransaction = original;
      }
    }

    it('runTransaction 失敗 → errors/ に記録、errorMessage は fatal prefix と異なる', async () => {
      const docId = 'stuck-tx-fail';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_UPDATED_AT_OFFSET_MS),
        retryCount: 1,
        fileName: 'tx-fail.pdf',
      });

      await withFailingRunTransaction(async () => {
        await rescueStuckProcessingDocs();
      });

      // per-doc catch 経路の errors/ 記録 (#360 silent-failure-hunter I1 の完全 lock-in)。
      // silent-failure-hunter I1 (#369 レビュー): 全件 forEach で検証することで、rescue が
      // 同一 docId に対し safeLogError を二重呼出する regression を検知できる。
      const errs = await db.collection('errors').where('documentId', '==', docId).get();
      expect(errs.size, 'errors/ should be written exactly once per doc').to.equal(1);
      errs.docs.forEach((d) => {
        const data = d.data();
        expect(data.source).to.equal('ocr');
        expect(data.functionName).to.equal('processOCR');
        // per-doc catch 由来のメッセージは fatal 分岐 (STUCK_RESCUE_FATAL_MESSAGE_PREFIX) とは異なる。
        // errors/ の errorMessage は safeLogError が params.error.message をそのまま記録するため
        // (errorLogger.ts:175)、TX_FAILURE_MESSAGE を含む。fatal 分岐とは別 Error.message で区別可能。
        const errorMessage = data.errorMessage as string | undefined;
        expect(errorMessage).to.be.a('string');
        expect(errorMessage).to.include(TX_FAILURE_MESSAGE);
        expect(errorMessage).to.not.include(STUCK_RESCUE_FATAL_MESSAGE_PREFIX);
      });

      // tx 失敗のため document 本体には一切の書込みが発生しない invariant。catch 句が fallback で
      // db.update を呼ぶような silent 救済が入った場合、このテストが壊れて検知できる。
      // silent-failure-hunter I4 (#369 レビュー): retryAfter / lastErrorMessage の undefined まで
      // 検証することで tx 外の silent partial write を全て検知する。
      const docAfter = (await db.doc(`documents/${docId}`).get()).data() as StuckDocFixture;
      expect(docAfter.status).to.equal('processing');
      expect(docAfter.retryCount).to.equal(1);
      expect(docAfter.retryAfter).to.be.undefined;
      expect(docAfter.lastErrorMessage).to.be.undefined;
    });

    it('partial failure: 複数 doc の tx が全て失敗しても per-doc catch がループを継続する', async () => {
      // ループ継続性の lock-in (outer try/catch 誤削除で 2 doc 目が silent skip される回帰を検知)。
      // 単一 doc では継続 vs 停止を区別不能なため 2 doc 必須。
      const docIds = ['stuck-partial-1', 'stuck-partial-2'];
      for (const docId of docIds) {
        await db.doc(`documents/${docId}`).set({
          status: 'processing',
          updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_UPDATED_AT_OFFSET_MS),
          retryCount: 1,
          fileName: `${docId}.pdf`,
        });
      }

      await withFailingRunTransaction(async () => {
        await rescueStuckProcessingDocs();
      });

      // 両 doc について errors/ に記録されていること (ループが途中で止まっていない証左)。
      // 差し替えた runTransaction は全 doc に対して throw するため、片方のみ記録されていれば
      // ループが early-return している silent regression を検知できる。
      for (const docId of docIds) {
        const errs = await db.collection('errors').where('documentId', '==', docId).get();
        expect(errs.size, `errors/ for ${docId}`).to.equal(1);
        expect(errs.docs[0].data().functionName).to.equal('processOCR');
      }
    });
  });

  describe('fatal 分岐 safeLogError 失敗時の二重呼出防止 (#370)', () => {
    // #370: processOCR.ts:222-232 の inner try/catch lock-in (PR #369 silent-failure-hunter I2)。
    //
    // 正常実装 (inner try/catch あり):
    //   safeLogError 失敗 → inner catch で console.error に swallow → outer catch 未到達
    //   → rescue ループ内で safeLogError が呼ばれるのは 1 回のみ
    //
    // regression シナリオ (将来の「cleanup」で inner try/catch 削除):
    //   safeLogError 失敗 → outer catch に伝播 → outer catch 内の safeLogError が再度呼ばれ、
    //   同一 docId に対して errors/ が 2 件書き込まれる silent regression
    //
    // safeLogError は現実装で logError 失敗を swallow するため throw しない契約だが、将来の
    // errorLogger 側 cleanup (safeLogError 内部 try/catch 削除) でも二重書込を防ぐ保険として
    // processOCR.ts 側の inner try/catch 単体で regression を防ぐことを call count で lock-in する。

    /**
     * errorLogger.safeLogError を一時的に差し替えて throw を強制する。
     * CommonJS (tsconfig "module": "NodeNext" + package.json "type": "commonjs") 配下では
     * processOCR.ts の `await errorLogger_1.safeLogError(...)` が namespace object の dynamic
     * lookup になるため、namespace property 書き換えが production code 側の呼出に反映される
     * (#369 の withFailingRunTransaction と同方針、sinon 依存なし)。
     *
     * call count で fatal 分岐 (1 回目) と outer catch (2 回目、regression 時のみ) を区別する。
     * try/finally で原値復元を保証し、後続 test への stub leak を防ぐ。
     */
    async function withFailingSafeLogError(
      fn: () => Promise<void>
    ): Promise<{ callCount: number }> {
      const errorLoggerModule = require('../src/utils/errorLogger') as {
        safeLogError: (params: unknown) => Promise<void>;
      };
      const original = errorLoggerModule.safeLogError;
      let callCount = 0;
      errorLoggerModule.safeLogError = async (_params: unknown) => {
        callCount++;
        // 1 回目 (fatal 分岐 inner try) → reject: 正常実装では inner catch で swallow される
        // 2 回目以降 (outer catch、regression 時のみ到達) → no-op resolve で callCount のみ加算
        if (callCount === 1) {
          throw new Error('Simulated safeLogError failure for #370 test');
        }
      };
      try {
        await fn();
      } finally {
        errorLoggerModule.safeLogError = original;
      }
      return { callCount };
    }

    it('fatal 分岐で safeLogError 失敗が inner catch で swallow され outer catch に伝播しない', async () => {
      const docId = 'stuck-fatal-log-fail';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_UPDATED_AT_OFFSET_MS),
        retryCount: MAX_RETRY_COUNT - 1, // tx 内 +1 で MAX 到達 → fatal 分岐
        fileName: 'fatal-log-fail.pdf',
        customerName: '顧客X',
      });

      const { callCount } = await withFailingSafeLogError(async () => {
        await rescueStuckProcessingDocs();
      });

      // 二重呼出防止 invariant (#370 の本体):
      //   callCount === 1: 正常実装 (inner catch で swallow、outer 未到達)
      //   callCount === 2: regression (inner try/catch 削除で outer catch に伝播し再呼出)
      // この厳密等号が将来 inner try/catch を誤削除する cleanup を test で検知する。
      expect(
        callCount,
        'safeLogError must be invoked exactly once (inner catch swallows, outer catch unreachable)'
      ).to.equal(1);

      // tx は成功しているため document 本体は status='error' に更新済み
      const docAfter = (await db.doc(`documents/${docId}`).get()).data() as StuckDocFixture;
      expect(docAfter.status).to.equal('error');
      expect(docAfter.retryCount).to.equal(MAX_RETRY_COUNT);
      expect(docAfter.retryAfter).to.be.undefined;
      expect(docAfter.lastErrorMessage).to.include(STUCK_RESCUE_FATAL_MESSAGE_PREFIX);

      // 更新対象外フィールド不変 (CLAUDE.md MUST: Partial Update は更新対象外の不変性)
      expect(docAfter.fileName).to.equal('fatal-log-fail.pdf');
      expect(docAfter.customerName).to.equal('顧客X');

      // safeLogError を stub している間は errors/ への実書込みが発生しない。
      // callCount による invariant 検証が regression 検知の本体であり、errors/ 件数は
      // 副次的な safety: stub 自身が実 Firestore write を呼ばないことの裏確認。
      const errs = await db.collection('errors').where('documentId', '==', docId).get();
      expect(errs.size, 'errors/ must remain empty while safeLogError is stubbed').to.equal(0);
    });
  });

  describe('既存動作の維持 (境界値)', () => {
    it('閾値未満の processing は対象外 (不変)', async () => {
      // 閾値未満の fixture は THRESHOLD 自体に依存させる (定数変更で test が意味不明化しないよう)
      const docId = 'not-stuck-yet';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_PROCESSING_THRESHOLD_MS / 2),
        retryCount: 1,
        fileName: 'not-stuck.pdf',
      });

      await rescueStuckProcessingDocs();

      const unchanged = (await db.doc(`documents/${docId}`).get()).data() as StuckDocFixture;
      expect(unchanged.status).to.equal('processing');
      expect(unchanged.retryCount).to.equal(1);
    });

    it('status=processed は対象外 (不変、status フィルタ確認)', async () => {
      const docId = 'already-processed';
      await db.doc(`documents/${docId}`).set({
        status: 'processed',
        updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - STUCK_UPDATED_AT_OFFSET_MS),
        retryCount: 1,
        fileName: 'done.pdf',
      });

      await rescueStuckProcessingDocs();

      const unchanged = (await db.doc(`documents/${docId}`).get()).data() as StuckDocFixture;
      expect(unchanged.status).to.equal('processed');
      expect(unchanged.retryCount).to.equal(1);
    });
  });
});
