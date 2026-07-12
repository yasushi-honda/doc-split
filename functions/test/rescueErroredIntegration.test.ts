/**
 * rescueErroredDocuments + handleProcessingError (429 専用 retry policy) 統合テスト
 *
 * Vertex AI 429 Resilience (2026-06-12) で導入した以下を Firestore emulator 経由で検証する:
 * - 429 系 transient error は MAX_RETRY_COUNT_429 (8) まで pending retry
 * - 非 429 transient は既存 MAX_RETRY_COUNT (5) で error 確定 (既存挙動維持)
 * - rescueErroredDocuments: 1h+ 経過した 429 系 error doc を pending 復帰
 * - errorRescueCount >= 3 で rescue 対象外 (永続ループ防止)
 * - rescueErroredDocumentsIfDue: 1h interval ガード (meta/ocrRescueState 経由)
 *
 * 実行:
 *   firebase emulators:exec --only firestore --project rescue-stuck-integration-test \
 *     'npx mocha --require ts-node/register --timeout 10000 test/rescueErroredIntegration.test.ts'
 *
 * 本ファイルは rescueStuckProcessingIntegration.test.ts と同じ default app + emulator init helper を使う。
 */

// 必ず最初に import: default admin app + emulator host を先行初期化。
import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { handleProcessingError } from '../src/ocr/ocrProcessor';
import {
  rescueErroredDocuments,
  rescueErroredDocumentsIfDue,
} from '../src/ocr/processOCR';
import {
  MAX_RETRY_COUNT,
  RETRY_DELAYS_429_MS,
  RETRY_JITTER_FACTOR,
  ERROR_RESCUE_THRESHOLD_MS,
  ERROR_RESCUE_RETRY_AFTER_MS,
  ERROR_RESCUE_SCAN_INTERVAL_MS,
  MAX_ERROR_RESCUE_COUNT,
  RESCUE_STATE_DOC_PATH,
} from '../src/ocr/constants';
import { cleanupCollections } from './helpers/cleanupEmulator';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'errors', 'meta'];

/** Vertex AI 429 を模した Error (handleProcessingError の is429Error 判定が true になる) */
function make429Error(): Error {
  const err = new Error(
    '[VertexAI.ClientError]: got status: 429 Too Many Requests. ' +
      '{"error":{"code":429,"message":"Resource exhausted. Please try again later.",' +
      '"status":"RESOURCE_EXHAUSTED"}}'
  );
  return err;
}

/** 非 429 transient (timeout 等) を模した Error */
function makeTimeoutError(): Error {
  return new Error('Request timeout - exception posting request to model');
}

/** rescue 対象になる error doc を fixture として作成 */
async function createErrorDoc(params: {
  id: string;
  lastErrorMessage: string;
  updatedAtMs?: number;
  errorRescueCount?: number;
  retryCount?: number;
}): Promise<void> {
  const data: Record<string, unknown> = {
    status: 'error',
    fileName: `${params.id}.pdf`,
    lastErrorMessage: params.lastErrorMessage,
    retryCount: params.retryCount ?? MAX_RETRY_COUNT,
    updatedAt: admin.firestore.Timestamp.fromMillis(
      params.updatedAtMs ?? Date.now() - ERROR_RESCUE_THRESHOLD_MS - 60_000
    ),
  };
  if (params.errorRescueCount !== undefined) {
    data.errorRescueCount = params.errorRescueCount;
  }
  await db.doc(`documents/${params.id}`).set(data);
}

describe('429 専用 retry policy + rescueErroredDocuments 統合テスト', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  after(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  describe('handleProcessingError: 429 系 transient (MAX_RETRY_COUNT_429=8)', () => {
    it('429 + retryCount=0 → pending, retryCount=1 (1 min ± 20% retryAfter)', async () => {
      const docId = 'handle-429-first-retry';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        retryCount: 0,
        fileName: `${docId}.pdf`,
        ocrRunId: 'test-run',
      });

      const before = Date.now();
      await handleProcessingError(docId, make429Error(), 'test-fn', 'test-run');

      const snap = await db.doc(`documents/${docId}`).get();
      const data = snap.data()!;
      expect(data.status).to.equal('pending');
      expect(data.retryCount).to.equal(1);
      const retryAfterMs = data.retryAfter.toMillis() - before;
      const baseMs = RETRY_DELAYS_429_MS[0]; // 1 min
      const lower = baseMs * (1 - RETRY_JITTER_FACTOR);
      const upper = baseMs * (1 + RETRY_JITTER_FACTOR);
      expect(retryAfterMs).to.be.at.least(Math.floor(lower) - 100);
      expect(retryAfterMs).to.be.at.most(Math.ceil(upper) + 5_000);
    });

    it('429 + retryCount=6 → pending (newRetryCount=7, MAX_RETRY_COUNT_429=8 未満、最後の retry)', async () => {
      // 実装: newRetryCount = (currentRetryCount || 0) + 1; if (newRetryCount < maxRetries) pending
      const docId = 'handle-429-just-before-max';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        retryCount: 6,
        fileName: `${docId}.pdf`,
        ocrRunId: 'test-run',
      });

      await handleProcessingError(docId, make429Error(), 'test-fn', 'test-run');

      const snap = await db.doc(`documents/${docId}`).get();
      const data = snap.data()!;
      expect(data.status).to.equal('pending');
      expect(data.retryCount).to.equal(7);
    });

    it('429 + retryCount=7 → error 確定 (newRetryCount=8, MAX_RETRY_COUNT_429 到達)', async () => {
      const docId = 'handle-429-max-reached';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        retryCount: 7,
        fileName: `${docId}.pdf`,
        ocrRunId: 'test-run',
      });

      await handleProcessingError(docId, make429Error(), 'test-fn', 'test-run');

      const snap = await db.doc(`documents/${docId}`).get();
      const data = snap.data()!;
      expect(data.status).to.equal('error');
      expect(data.retryCount).to.equal(8);
      expect(data.lastErrorMessage).to.include('429');
    });

    it('429 が旧 MAX_RETRY_COUNT=5 を超えても粘る (currentRetryCount=4 → newRetryCount=5, MAX_RETRY_COUNT_429=8 未満)', async () => {
      // 旧挙動 (MAX_RETRY_COUNT=5 単独) なら currentRetryCount=4 で newRetryCount=5 → 5<5=false → error 確定。
      // 新挙動は 429 系のみ MAX_RETRY_COUNT_429=8 適用 → 5<8=true → pending 継続。
      const docId = 'handle-429-beyond-old-max';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        retryCount: 4,
        fileName: `${docId}.pdf`,
        ocrRunId: 'test-run',
      });

      await handleProcessingError(docId, make429Error(), 'test-fn', 'test-run');

      const snap = await db.doc(`documents/${docId}`).get();
      const data = snap.data()!;
      expect(data.status).to.equal('pending');
      expect(data.retryCount).to.equal(5);
    });
  });

  describe('handleProcessingError: 非 429 transient (MAX_RETRY_COUNT=5、既存挙動維持)', () => {
    it('非 429 transient + retryCount=3 → pending, retryAfter=1min (newRetryCount=4 < MAX_RETRY_COUNT=5)', async () => {
      const docId = 'handle-non429-pending';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        retryCount: 3,
        fileName: `${docId}.pdf`,
        ocrRunId: 'test-run',
      });

      const before = Date.now();
      await handleProcessingError(docId, makeTimeoutError(), 'test-fn', 'test-run');

      const snap = await db.doc(`documents/${docId}`).get();
      const data = snap.data()!;
      expect(data.status).to.equal('pending');
      expect(data.retryCount).to.equal(4);
      // retryAfter ≈ 1 min (60_000ms 固定、jitter なし)
      const retryAfterMs = data.retryAfter.toMillis() - before;
      expect(retryAfterMs).to.be.at.least(60_000 - 100);
      expect(retryAfterMs).to.be.at.most(60_000 + 5_000);
    });

    it('非 429 transient + retryCount=4 → error 確定 (newRetryCount=5, MAX_RETRY_COUNT 到達、既存挙動)', async () => {
      const docId = 'handle-non429-max';
      await db.doc(`documents/${docId}`).set({
        status: 'processing',
        retryCount: 4,
        fileName: `${docId}.pdf`,
        ocrRunId: 'test-run',
      });

      await handleProcessingError(docId, makeTimeoutError(), 'test-fn', 'test-run');

      const snap = await db.doc(`documents/${docId}`).get();
      const data = snap.data()!;
      expect(data.status).to.equal('error');
      expect(data.retryCount).to.equal(5);
    });
  });

  describe('rescueErroredDocuments: 429 系 error doc 救済 (backstop)', () => {
    it('1h+ 経過 + 429 系 error doc は pending 復帰、errorRescueCount=1', async () => {
      const docId = 'rescue-429-target';
      await createErrorDoc({
        id: docId,
        lastErrorMessage:
          '[VertexAI.ClientError]: got status: 429 Too Many Requests. RESOURCE_EXHAUSTED',
      });

      const before = Date.now();
      await rescueErroredDocuments();

      const snap = await db.doc(`documents/${docId}`).get();
      const data = snap.data()!;
      expect(data.status).to.equal('pending');
      expect(data.retryCount).to.equal(0); // リセット
      expect(data.errorRescueCount).to.equal(1);
      expect(data.lastRescuedAt).to.exist;
      // retryAfter は now + 10 min
      const retryAfterMs = data.retryAfter.toMillis() - before;
      expect(retryAfterMs).to.be.at.least(ERROR_RESCUE_RETRY_AFTER_MS - 100);
      expect(retryAfterMs).to.be.at.most(ERROR_RESCUE_RETRY_AFTER_MS + 5_000);
    });

    it('1h 未満経過の error doc は対象外 (誤発火防止)', async () => {
      const docId = 'rescue-too-recent';
      await createErrorDoc({
        id: docId,
        lastErrorMessage: 'RESOURCE_EXHAUSTED',
        updatedAtMs: Date.now() - 30 * 60 * 1000, // 30 分前
      });

      await rescueErroredDocuments();

      const snap = await db.doc(`documents/${docId}`).get();
      expect(snap.data()!.status).to.equal('error'); // unchanged
    });

    it('非 429 系 error doc (lastErrorMessage に 429 系キーワードなし) は対象外', async () => {
      const docId = 'rescue-non-429';
      await createErrorDoc({
        id: docId,
        lastErrorMessage: 'Invalid argument: malformed PDF',
      });

      await rescueErroredDocuments();

      const snap = await db.doc(`documents/${docId}`).get();
      expect(snap.data()!.status).to.equal('error'); // unchanged
    });

    it('errorRescueCount >= MAX_ERROR_RESCUE_COUNT (3) の doc は対象外 (永続ループ防止)', async () => {
      const docId = 'rescue-max-reached';
      await createErrorDoc({
        id: docId,
        lastErrorMessage: 'RESOURCE_EXHAUSTED quota exhausted',
        errorRescueCount: MAX_ERROR_RESCUE_COUNT,
      });

      await rescueErroredDocuments();

      const snap = await db.doc(`documents/${docId}`).get();
      const data = snap.data()!;
      expect(data.status).to.equal('error');
      expect(data.errorRescueCount).to.equal(MAX_ERROR_RESCUE_COUNT); // unchanged
    });

    it('errorRescueCount = MAX_ERROR_RESCUE_COUNT - 1 は最後の rescue で MAX 到達', async () => {
      const docId = 'rescue-last-chance';
      await createErrorDoc({
        id: docId,
        lastErrorMessage: 'Too Many Requests 429',
        errorRescueCount: MAX_ERROR_RESCUE_COUNT - 1,
      });

      await rescueErroredDocuments();

      const snap = await db.doc(`documents/${docId}`).get();
      const data = snap.data()!;
      expect(data.status).to.equal('pending');
      expect(data.errorRescueCount).to.equal(MAX_ERROR_RESCUE_COUNT);
    });

    it('対象 0 件 (error doc 全くなし) は安全に no-op', async () => {
      await rescueErroredDocuments();
      // no throw, no side effect
    });

    it('対象 doc が並列で他処理によって status 変更 → no-op (race condition safety)', async () => {
      const docId = 'rescue-race-condition';
      // 1 時間前で error 状態に作る
      await createErrorDoc({
        id: docId,
        lastErrorMessage: 'RESOURCE_EXHAUSTED',
      });
      // 並列を simulate: scan が走る直前に status を pending に変える
      await db.doc(`documents/${docId}`).update({ status: 'pending' });

      await rescueErroredDocuments();

      // 変更後 status を尊重 (rescue は status=error の transaction 内 check で空振り)
      const snap = await db.doc(`documents/${docId}`).get();
      expect(snap.data()!.status).to.equal('pending');
      // rescue が動いていれば errorRescueCount=1 になるはずだが、status check で no-op
      expect(snap.data()!.errorRescueCount).to.be.undefined;
    });
  });

  describe('rescueErroredDocumentsIfDue: 1 時間 interval ガード', () => {
    it('lastErrorRescueAt 不在 (初回) → 即時 scan + state doc 作成', async () => {
      const docId = 'if-due-first-scan';
      await createErrorDoc({
        id: docId,
        lastErrorMessage: 'RESOURCE_EXHAUSTED',
      });

      await rescueErroredDocumentsIfDue();

      // scan 実行確認: doc が pending に変わる
      const docSnap = await db.doc(`documents/${docId}`).get();
      expect(docSnap.data()!.status).to.equal('pending');

      // state doc が作成される
      const stateSnap = await db.doc(RESCUE_STATE_DOC_PATH).get();
      expect(stateSnap.exists).to.be.true;
      expect(stateSnap.data()!.lastErrorRescueAt).to.exist;
    });

    it('lastErrorRescueAt < ERROR_RESCUE_SCAN_INTERVAL_MS (1h) → scan skip', async () => {
      // 直前に scan 完了したと仮定
      await db.doc(RESCUE_STATE_DOC_PATH).set({
        lastErrorRescueAt: admin.firestore.Timestamp.fromMillis(
          Date.now() - 30 * 60 * 1000 // 30 分前
        ),
      });
      const docId = 'if-due-too-recent-scan';
      await createErrorDoc({
        id: docId,
        lastErrorMessage: 'RESOURCE_EXHAUSTED',
      });

      await rescueErroredDocumentsIfDue();

      // scan skip により doc は error のまま
      const docSnap = await db.doc(`documents/${docId}`).get();
      expect(docSnap.data()!.status).to.equal('error');
    });

    it('lastErrorRescueAt >= ERROR_RESCUE_SCAN_INTERVAL_MS (1h) → scan 実行 + timestamp 更新', async () => {
      const oldTimestamp = Date.now() - 2 * ERROR_RESCUE_SCAN_INTERVAL_MS;
      await db.doc(RESCUE_STATE_DOC_PATH).set({
        lastErrorRescueAt: admin.firestore.Timestamp.fromMillis(oldTimestamp),
      });
      const docId = 'if-due-scan-runs';
      await createErrorDoc({
        id: docId,
        lastErrorMessage: 'RESOURCE_EXHAUSTED',
      });

      const beforeScan = Date.now();
      await rescueErroredDocumentsIfDue();

      // scan 実行 → doc が pending に
      const docSnap = await db.doc(`documents/${docId}`).get();
      expect(docSnap.data()!.status).to.equal('pending');

      // state timestamp 更新
      const stateSnap = await db.doc(RESCUE_STATE_DOC_PATH).get();
      const newTimestamp = (stateSnap.data()!.lastErrorRescueAt as admin.firestore.Timestamp).toMillis();
      expect(newTimestamp).to.be.at.least(beforeScan);
    });
  });

  describe('AC9 (kanameone 2026-06-11 事象の予防)', () => {
    it('39 分間 quota 枯渇 → MAX_RETRY_COUNT_429=8 + exponential delay で吸収可能', () => {
      // base delay 累計: 1+3+6+12+24+48+60+60 = 214 分 ≈ 3.5h
      const cumulativeMs = RETRY_DELAYS_429_MS.reduce((acc, d) => acc + d, 0);
      const cumulativeMinutes = cumulativeMs / 60_000;
      expect(cumulativeMinutes).to.equal(214);
      // 39 分時点で retry 5 (累計 46 分) 進行中 → error 確定せず
      const cumulativeAtRetry5 = RETRY_DELAYS_429_MS.slice(0, 5).reduce((a, d) => a + d, 0) / 60_000;
      expect(cumulativeAtRetry5).to.be.greaterThan(39);
    });
  });
});
