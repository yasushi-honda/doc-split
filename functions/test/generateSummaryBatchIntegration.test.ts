/**
 * `functions/src/ocr/generateSummaryBatch.ts` + `summaryRunStore.ts` 統合テスト
 * (ADR-0027 PR4、Firestore emulator)
 *
 * `onSchedule`のCloudEvent配管から独立させた`runSummaryBatch`を直接テストする
 * (`rescueStuckProcessingDocs`/`sweepStuckDriveExports`と同型パターン)。
 *
 * 実行: firebase emulators:exec --only firestore --project generate-summary-batch-integration-test \
 *         'npx mocha --require ts-node/register --timeout 15000 test/generateSummaryBatchIntegration.test.ts'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import type { Bucket } from '@google-cloud/storage';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { runSummaryBatch } from '../src/ocr/generateSummaryBatch';
import {
  claimSummaryRun,
  commitSummaryResult,
  recordSummaryFailure,
  rescueStuckSummaryDocs,
} from '../src/ocr/summaryRunStore';
import { SummarySupersededError, MAX_SUMMARY_ATTEMPTS, SUMMARY_STUCK_THRESHOLD_MS } from '../src/ocr/summaryRunGuard';
import { SarashinaSummaryError } from '../src/ocr/sarashinaSummaryClient';
import type { SummaryPassResult } from '../src/ocr/summaryPass';

const db = admin.firestore();
// loadOcrTextForSummaryはocrResultUrl不在時はbucketに一切アクセスしないため、
// テストではダミーオブジェクトで足りる(実Storage接続は不要)。
const FAKE_BUCKET = {} as unknown as Bucket;
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents'];

const LONG_OCR_TEXT = '福祉用具貸与確認書。利用者：三好 陽子様。品目：歩行器。'.repeat(5);

async function seedDocument(docId: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const docRef = db.collection('documents').doc(docId);
  await docRef.set({
    fileName: 'test.pdf',
    status: 'processed',
    summaryState: 'pending',
    summaryAttemptCount: 0,
    updatedAt: admin.firestore.Timestamp.now(),
    documentType: '福祉用具貸与確認書',
    ...overrides,
  });
  await docRef.collection('detail').doc('main').set({ ocrResult: LONG_OCR_TEXT });
}

async function getDoc(docId: string): Promise<FirebaseFirestore.DocumentData> {
  return (await db.doc(`documents/${docId}`).get()).data()!;
}

function fakeSummarize(overrides: Partial<SummaryPassResult> = {}) {
  return async (): Promise<SummaryPassResult> => ({
    provider: 'sarashina',
    summary: { text: 'この書類は福祉用具貸与確認書です。利用者は歩行器を利用しています。', truncated: false },
    finishReason: 'stop',
    ...overrides,
  });
}

const ENABLED_GATE = async () => ({ enabled: true, allowlist: null });

describe('runSummaryBatch (ADR-0027 PR4)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('L1=none: 新規claimは行わずrescueのみ実行する(バックフィル防止)', async () => {
    await seedDocument('doc-l1-none');
    const stats = await runSummaryBatch({ firestore: db, bucket: FAKE_BUCKET, l1Provider: 'none' });

    expect(stats.claimed).to.equal(0);
    expect(stats.done).to.equal(0);
    const data = await getDoc('doc-l1-none');
    expect(data.summaryState).to.equal('pending');
  });

  it('L2ゲート無効: キュー全体を一時停止し新規claimは行わない', async () => {
    await seedDocument('doc-l2-disabled');
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: async () => ({ enabled: false, allowlist: null }),
    });

    expect(stats.claimed).to.equal(0);
    const data = await getDoc('doc-l2-disabled');
    expect(data.summaryState).to.equal('pending');
  });

  it('allowlist対象外のdocはskippedになり、対象内のdocは処理される(先頭固定によるキュー閉塞防止)', async () => {
    await seedDocument('doc-not-allowed');
    await seedDocument('doc-allowed');
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: async () => ({ enabled: true, allowlist: ['doc-allowed'] }),
      summarize: fakeSummarize(),
    });

    expect(stats.skipped).to.equal(1);
    expect(stats.done).to.equal(1);
    expect((await getDoc('doc-not-allowed')).summaryState).to.equal('skipped');
    expect((await getDoc('doc-allowed')).summaryState).to.equal('done');
  });

  it('正常系: pending文書をclaimしてcommitし、summaryState:doneになる(旧フラットフィールドも削除される)', async () => {
    await seedDocument('doc-happy', { summaryTruncated: true, summaryOriginalLength: 999 });
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: ENABLED_GATE,
      summarize: fakeSummarize(),
    });

    expect(stats.claimed).to.equal(1);
    expect(stats.done).to.equal(1);
    const data = await getDoc('doc-happy');
    expect(data.summaryState).to.equal('done');
    expect(data.summaryProvider).to.equal('sarashina');
    expect(data.summaryRunId).to.equal(null);
    expect(data.summary.text).to.equal('この書類は福祉用具貸与確認書です。利用者は歩行器を利用しています。');
    expect(data.summaryTruncated).to.equal(undefined);
    expect(data.summaryOriginalLength).to.equal(undefined);
  });

  it('L1=gemini: L2ゲートを経由せずGemini経路で生成する', async () => {
    await seedDocument('doc-gemini');
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'gemini',
      summarize: fakeSummarize({ provider: 'gemini', finishReason: null }),
    });

    expect(stats.done).to.equal(1);
    expect((await getDoc('doc-gemini')).summaryProvider).to.equal('gemini');
  });

  it('固有名詞捏造検知: fabricatedCount>0なら要約を保存せずerror/fabrication_suspectedになる', async () => {
    await seedDocument('doc-fabricated');
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: ENABLED_GATE,
      // D9実データで実証済みの捏造パターン(ADR-0027 PR0/PR2a): 事業所名の記載が
      // 一切ない書類に対し、実在しない「みずほ訪問看護ステーション」を捏造する。
      summarize: fakeSummarize({ summary: { text: '貸与事業所はみずほ訪問看護ステーションです。', truncated: false } }),
    });

    expect(stats.errorByKind.fabrication_suspected).to.equal(1);
    const data = await getDoc('doc-fabricated');
    expect(data.summaryState).to.equal('error');
    expect(data.summaryErrorKind).to.equal('fabrication_suspected');
    expect(data.summary).to.equal(undefined);
  });

  it('ソフトデッドライン超過: 残りの文書はclaimせず次tickへ委ねる(deferred)', async () => {
    await seedDocument('doc-deadline-1', { updatedAt: admin.firestore.Timestamp.fromMillis(1000) });
    await seedDocument('doc-deadline-2', { updatedAt: admin.firestore.Timestamp.fromMillis(2000) });
    let callCount = 0;
    // 1件目のclaim前に既にソフトデッドラインを超過させる(now()を固定超過値にする)。
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: ENABLED_GATE,
      softDeadlineMs: 100,
      now: () => {
        callCount++;
        // 1・2回目(rescueStuckSummaryDocsの閾値計算・startedAt計測)は基準時刻、
        // 3回目以降(ループ内判定)は超過させる。
        return callCount <= 2 ? 0 : 200;
      },
      summarize: fakeSummarize(),
    });

    expect(stats.claimed).to.equal(0);
    expect(stats.deferred).to.equal(2);
    expect((await getDoc('doc-deadline-1')).summaryState).to.equal('pending');
    expect((await getDoc('doc-deadline-2')).summaryState).to.equal('pending');
  });

  it('Sarashina timeout: summaryStateはprocessingのまま残し、以降のclaimを打ち切る(二重推論防止)', async () => {
    await seedDocument('doc-timeout-1', { updatedAt: admin.firestore.Timestamp.fromMillis(1000) });
    await seedDocument('doc-timeout-2', { updatedAt: admin.firestore.Timestamp.fromMillis(2000) });
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: ENABLED_GATE,
      summarize: async () => {
        throw new SarashinaSummaryError('timeout', 'timeout');
      },
    });

    expect(stats.claimed).to.equal(1);
    expect(stats.done).to.equal(0);
    expect(stats.deferred).to.equal(1);
    const data = await getDoc('doc-timeout-1');
    expect(data.summaryState).to.equal('processing');
    expect((await getDoc('doc-timeout-2')).summaryState).to.equal('pending');
  });

  it('quota/transient失敗: attemptCountがMAX_SUMMARY_ATTEMPTS未満ならpendingへ戻す', async () => {
    await seedDocument('doc-quota', { summaryAttemptCount: 0 });
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: ENABLED_GATE,
      summarize: async () => {
        throw Object.assign(new Error('429'), { code: 429 });
      },
    });

    expect(stats.errorByKind.quota).to.equal(1);
    const data = await getDoc('doc-quota');
    expect(data.summaryState).to.equal('pending');
    expect(data.summaryErrorKind).to.equal('quota');
  });

  it('quota/transient失敗: attemptCountがMAX_SUMMARY_ATTEMPTSに達したらerrorへ倒す', async () => {
    await seedDocument('doc-quota-exhausted', { summaryAttemptCount: MAX_SUMMARY_ATTEMPTS - 1 });
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: ENABLED_GATE,
      summarize: async () => {
        throw Object.assign(new Error('429'), { code: 429 });
      },
    });

    expect(stats.errorByKind.quota).to.equal(1);
    expect((await getDoc('doc-quota-exhausted')).summaryState).to.equal('error');
  });

  describe('claim/所有権保護', () => {
    it('claim冪等性: 同一runIdでの再claimは同じ試行として扱われる(ambiguous commit回復)', async () => {
      await seedDocument('doc-idempotent');
      const docRef = db.doc('documents/doc-idempotent');

      const first = await claimSummaryRun(db, docRef, 'batch', 'fixed-run-id');
      expect(first.claimed).to.equal(true);
      if (!first.claimed) throw new Error('unreachable');
      expect(first.claim.attemptCount).to.equal(1);

      // 同一runIdでの再claim(withBackoffRetryの外側リトライを模す)は
      // 「既にこの実行がcommit済み」として同じclaimを返し、attemptCountを再度incrementしない。
      const second = await claimSummaryRun(db, docRef, 'batch', 'fixed-run-id');
      expect(second.claimed).to.equal(true);
      if (!second.claimed) throw new Error('unreachable');
      expect(second.claim.attemptCount).to.equal(1);
      expect(second.claim.runId).to.equal('fixed-run-id');

      const data = await getDoc('doc-idempotent');
      expect(data.summaryAttemptCount).to.equal(1);
    });

    it('superseded破棄(バッチ側): claim後に別の実行(reprocess)がsummaryRunIdを変えると、commitはSummarySupersededErrorで破棄され書込みされない', async () => {
      await seedDocument('doc-superseded');
      const docRef = db.doc('documents/doc-superseded');
      const claimResult = await claimSummaryRun(db, docRef, 'batch');
      expect(claimResult.claimed).to.equal(true);
      if (!claimResult.claimed) throw new Error('unreachable');

      // reprocess等で別の実行が割り込んだことを模す(summaryRunIdが変わる)。
      await docRef.update({ summaryRunId: 'someone-elses-run-id' });

      let caught: unknown;
      try {
        await commitSummaryResult(db, docRef, claimResult.claim, {
          summary: { text: '破棄されるはずの要約', truncated: false },
          provider: 'sarashina',
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(SummarySupersededError);

      const data = await getDoc('doc-superseded');
      expect(data.summary).to.equal(undefined);
      expect(data.summaryRunId).to.equal('someone-elses-run-id');
    });

    it('superseded破棄(手動側): 手動claimが実行中のバッチをpreemptした後、バッチ側のcommit/recordSummaryFailureはSummarySupersededErrorで破棄される', async () => {
      await seedDocument('doc-manual-preempt');
      const docRef = db.doc('documents/doc-manual-preempt');
      const batchClaim = await claimSummaryRun(db, docRef, 'batch');
      expect(batchClaim.claimed).to.equal(true);
      if (!batchClaim.claimed) throw new Error('unreachable');

      // ユーザーが手動再生成を実行し、バッチのclaimを無条件でpreemptする。
      const manualClaim = await claimSummaryRun(db, docRef, 'manual');
      expect(manualClaim.claimed).to.equal(true);
      if (!manualClaim.claimed) throw new Error('unreachable');
      expect(manualClaim.claim.runId).to.not.equal(batchClaim.claim.runId);

      let caught: unknown;
      try {
        await commitSummaryResult(db, docRef, batchClaim.claim, {
          summary: { text: 'バッチ側の結果(破棄されるはず)', truncated: false },
          provider: 'sarashina',
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(SummarySupersededError);

      // 手動側のcommitは自分がまだ所有者のため成功する。
      await commitSummaryResult(db, docRef, manualClaim.claim, {
        summary: { text: '手動側の結果', truncated: false },
        provider: 'gemini',
      });
      const data = await getDoc('doc-manual-preempt');
      expect(data.summary.text).to.equal('手動側の結果');
      expect(data.summaryProvider).to.equal('gemini');
    });

    it('recordSummaryFailureも所有権チェックを行い、supersededなら書込みしない', async () => {
      await seedDocument('doc-record-failure-superseded');
      const docRef = db.doc('documents/doc-record-failure-superseded');
      const claimResult = await claimSummaryRun(db, docRef, 'batch');
      if (!claimResult.claimed) throw new Error('unreachable');

      await docRef.update({ summaryRunId: 'someone-elses-run-id' });

      let caught: unknown;
      try {
        await recordSummaryFailure(db, docRef, claimResult.claim, {
          state: 'error',
          kind: 'unknown',
          message: '破棄されるはずのエラー',
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(SummarySupersededError);
      expect((await getDoc('doc-record-failure-superseded')).summaryError).to.equal(undefined);
    });
  });

  describe('rescueStuckSummaryDocs', () => {
    it('閾値超過したprocessing文書をpendingへ戻す(attemptCount未達)', async () => {
      await seedDocument('doc-stuck-rescuable', {
        summaryState: 'processing',
        summaryRunId: 'stuck-run-id',
        summaryAttemptCount: 1,
        summaryStateUpdatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000),
      });

      const result = await rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'sarashina' });
      expect(result.rescued).to.equal(1);
      expect(result.errored).to.equal(0);
      const data = await getDoc('doc-stuck-rescuable');
      expect(data.summaryState).to.equal('pending');
      expect(data.summaryRunId).to.equal(null);
    });

    it('attemptCountがMAX_SUMMARY_ATTEMPTSに達したprocessing文書はerrorへ倒す', async () => {
      await seedDocument('doc-stuck-exhausted', {
        summaryState: 'processing',
        summaryRunId: 'stuck-run-id',
        summaryAttemptCount: MAX_SUMMARY_ATTEMPTS,
        summaryStateUpdatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000),
      });

      const result = await rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'sarashina' });
      expect(result.errored).to.equal(1);
      expect((await getDoc('doc-stuck-exhausted')).summaryState).to.equal('error');
    });

    it('L1=noneの間はattemptCount未達でもpendingへ戻さずerrorにする(U4: pendingへ戻すとバッチが処理しないため蓄積し続ける)', async () => {
      await seedDocument('doc-stuck-l1-none', {
        summaryState: 'processing',
        summaryRunId: 'stuck-run-id',
        summaryAttemptCount: 1,
        summaryStateUpdatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000),
      });

      const result = await rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'none' });
      expect(result.errored).to.equal(1);
      expect((await getDoc('doc-stuck-l1-none')).summaryState).to.equal('error');
    });

    it('閾値未満のprocessing文書はそのまま残す', async () => {
      await seedDocument('doc-not-stuck-yet', {
        summaryState: 'processing',
        summaryRunId: 'fresh-run-id',
        summaryAttemptCount: 1,
        summaryStateUpdatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60_000),
      });

      const result = await rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'sarashina' });
      expect(result.rescued).to.equal(0);
      expect(result.errored).to.equal(0);
      expect((await getDoc('doc-not-stuck-yet')).summaryState).to.equal('processing');
    });

    it('runSummaryBatchは毎tickrescueを実行する(L1=noneでも)', async () => {
      await seedDocument('doc-rescued-via-batch', {
        summaryState: 'processing',
        summaryRunId: 'stuck-run-id',
        summaryAttemptCount: 1,
        summaryStateUpdatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000),
      });

      const stats = await runSummaryBatch({ firestore: db, bucket: FAKE_BUCKET, l1Provider: 'none' });
      expect(stats.rescued).to.equal(0);
      expect(stats.rescueErrored).to.equal(1);
      expect((await getDoc('doc-rescued-via-batch')).summaryState).to.equal('error');
    });
  });
});
