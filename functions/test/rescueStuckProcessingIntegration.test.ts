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
