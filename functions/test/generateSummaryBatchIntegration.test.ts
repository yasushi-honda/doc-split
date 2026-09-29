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
  releaseManualSummaryRun,
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

  describe('固有名詞捏造検知(fabrication_suspected): 総試行上限内で再試行し、上限到達でerror', () => {
    // D9実データで実証済みの捏造パターン(ADR-0027 PR0/PR2a): 事業所名の記載が
    // 一切ない書類に対し、実在しない「みずほ訪問看護ステーション」を捏造する。
    const fabricatedSummarize = fakeSummarize({
      summary: { text: '貸与事業所はみずほ訪問看護ステーションです。', truncated: false },
    });

    async function runFabricatedTick(): Promise<Awaited<ReturnType<typeof runSummaryBatch>>> {
      return runSummaryBatch({
        firestore: db,
        bucket: FAKE_BUCKET,
        l1Provider: 'sarashina',
        getGate: ENABLED_GATE,
        summarize: fabricatedSummarize,
      });
    }

    it('attempt未達: 要約を保存せずpendingへ戻し、fabricationRetriedへ加算する(終端errorとして数えない)', async () => {
      await seedDocument('doc-fabricated-retry', { summaryAttemptCount: 0 });
      const stats = await runFabricatedTick();

      expect(stats.fabricationRetried).to.equal(1);
      expect(stats.errorByKind.fabrication_suspected).to.equal(undefined);
      const data = await getDoc('doc-fabricated-retry');
      expect(data.summaryState).to.equal('pending');
      expect(data.summaryErrorKind).to.equal('fabrication_suspected');
      expect(data.summary).to.equal(undefined);
    });

    it('attemptがMAX_SUMMARY_ATTEMPTSに達したらerror終端(要約は保存されず、終端errorとして数える)', async () => {
      await seedDocument('doc-fabricated-exhausted', { summaryAttemptCount: MAX_SUMMARY_ATTEMPTS - 1 });
      const stats = await runFabricatedTick();

      expect(stats.errorByKind.fabrication_suspected).to.equal(1);
      expect(stats.fabricationRetried).to.equal(0);
      const data = await getDoc('doc-fabricated-exhausted');
      expect(data.summaryState).to.equal('error');
      expect(data.summaryErrorKind).to.equal('fabrication_suspected');
      expect(data.summary).to.equal(undefined);
    });

    it('総試行上限の共有(仕様): quota等で試行を先に消費済みの文書は、初回の検知で即errorになる', async () => {
      // summaryAttemptCountはquota/transient/手動再生成と共有の総claim回数のため、
      // 「fabricationが3回連続で初めてerror」にはならない(この仕様をプランで明示的に受容した)。
      await seedDocument('doc-fabricated-shared-budget', { summaryAttemptCount: 2, summaryErrorKind: 'quota' });
      await runFabricatedTick();

      expect((await getDoc('doc-fabricated-shared-budget')).summaryState).to.equal('error');
    });

    it('連続tick: 検知→pending→検知→pending→検知→error(3回目で終端)', async () => {
      await seedDocument('doc-fabricated-sequence');
      const states: string[] = [];
      for (let tick = 0; tick < MAX_SUMMARY_ATTEMPTS; tick++) {
        await runFabricatedTick();
        states.push((await getDoc('doc-fabricated-sequence')).summaryState);
      }

      expect(states).to.deep.equal(['pending', 'pending', 'error']);
      expect((await getDoc('doc-fabricated-sequence')).summaryAttemptCount).to.equal(MAX_SUMMARY_ATTEMPTS);
    });

    it('エラー文はPII契約(summaryErrorにPIIを含めない)を守り、疑い名を含まず語彙由来のsuffixとcore文字数のみを含む', async () => {
      await seedDocument('doc-fabricated-message');
      await runFabricatedTick();

      const message: string = (await getDoc('doc-fabricated-message')).summaryError;
      expect(message).to.contain('Fabrication scanner detected 1 suspect name(s)');
      // 「みずほ訪問看護ステーション」は最長スパン優先でsuffix=ステーション、core=「みずほ訪問看護」(7文字)。
      expect(message).to.contain('suffix=ステーション/coreLen=7');
      expect(message).to.match(/configVersion=[0-9a-f]{8}/);
      // モデル出力の疑い名(実在しない事業所名)は保存しない。
      expect(message).to.not.contain('みずほ');
    });

    it('recombinedのみ(原典の括弧書き略記の語順入替)は捏造扱いせず、要約を保存する(再試行の対象外)', async () => {
      await seedDocument('doc-recombined');
      await db
        .collection('documents')
        .doc('doc-recombined')
        .collection('detail')
        .doc('main')
        .set({ ocrResult: '訪問看護（水無月）を週2回利用している。利用者は歩行器を使用している。'.repeat(4) });
      const stats = await runSummaryBatch({
        firestore: db,
        bucket: FAKE_BUCKET,
        l1Provider: 'sarashina',
        getGate: ENABLED_GATE,
        summarize: fakeSummarize({ summary: { text: '水無月訪問看護を週2回利用している。', truncated: false } }),
      });

      expect(stats.done).to.equal(1);
      expect(stats.fabricationRetried).to.equal(0);
      expect((await getDoc('doc-recombined')).summaryState).to.equal('done');
    });
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

  it('Sarashina config失敗(サービスURL不正等): attemptCount未達ならpendingへ戻し、以降のclaimを打ち切る', async () => {
    await seedDocument('doc-config-error-1', { updatedAt: admin.firestore.Timestamp.fromMillis(1000) });
    await seedDocument('doc-config-error-2', { updatedAt: admin.firestore.Timestamp.fromMillis(2000) });
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: ENABLED_GATE,
      summarize: async () => {
        throw new SarashinaSummaryError('bad url', 'config');
      },
    });

    expect(stats.claimed).to.equal(1);
    expect(stats.errorByKind.config).to.equal(1);
    expect(stats.deferred).to.equal(1);
    const data = await getDoc('doc-config-error-1');
    expect(data.summaryState).to.equal('pending');
    expect((await getDoc('doc-config-error-2')).summaryState).to.equal('pending');
  });

  it('pr-test-analyzer指摘反映(実バグ): Sarashina config失敗がattemptCountの上限に達しても放置せず、errorへ確定させ無限リトライを止める', async () => {
    await seedDocument('doc-config-error-exhausted', { summaryAttemptCount: MAX_SUMMARY_ATTEMPTS - 1 });
    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: ENABLED_GATE,
      summarize: async () => {
        throw new SarashinaSummaryError('bad url', 'config');
      },
    });

    expect(stats.errorByKind.config).to.equal(1);
    const data = await getDoc('doc-config-error-exhausted');
    expect(data.summaryState, 'attemptCount上限到達時はpendingで無限リトライさせずerrorへ確定する').to.equal(
      'error'
    );
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

  it('allowlist対象外のskip書込みはトランザクション化されており、処理中に手動claimされた文書を上書きしない(codex review P2指摘の回帰防止)', async () => {
    await seedDocument('doc-race-allowed', { updatedAt: admin.firestore.Timestamp.fromMillis(1000) });
    await seedDocument('doc-race-not-allowed', { updatedAt: admin.firestore.Timestamp.fromMillis(2000) });
    const raceDocRef = db.doc('documents/doc-race-not-allowed');

    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: async () => ({ enabled: true, allowlist: ['doc-race-allowed'] }),
      summarize: async () => {
        // 1件目(doc-race-allowed)の生成中に、doc-race-not-allowedへの手動再生成が割り込み、
        // 既にprocessingへ遷移したことを模す(allowlist対象外なのでバッチ自身は生成を試みない)。
        await claimSummaryRun(db, raceDocRef, 'manual');
        return fakeSummarize()();
      },
    });

    expect(stats.done).to.equal(1);
    expect(stats.skipped, 'doc-race-not-allowedは既にprocessingのためskip書込みは適用されないはず').to.equal(0);
    const raceDocData = await getDoc('doc-race-not-allowed');
    expect(
      raceDocData.summaryState,
      '手動claimの結果(processing)が保持されること(誤ってskippedへ上書きされない)'
    ).to.equal('processing');
  });

  it('recordSummaryFailureの所有権喪失(手動claimによるpreempt)を吸収し、バッチ全体を止めずに残りの文書を処理する(codex review P2指摘の回帰防止)', async () => {
    await seedDocument('doc-preempt-during-failure', { updatedAt: admin.firestore.Timestamp.fromMillis(1000) });
    await seedDocument('doc-after-preempted', { updatedAt: admin.firestore.Timestamp.fromMillis(2000) });
    const preemptedDocRef = db.doc('documents/doc-preempt-during-failure');
    let callCount = 0;

    const stats = await runSummaryBatch({
      firestore: db,
      bucket: FAKE_BUCKET,
      l1Provider: 'sarashina',
      getGate: ENABLED_GATE,
      summarize: async () => {
        callCount++;
        if (callCount === 1) {
          // providerがtransient失敗する直前に、手動再生成がこのclaimをpreemptしたことを模す。
          // recordSummaryFailure自身がSummarySupersededErrorをthrowするケースを再現する。
          await claimSummaryRun(db, preemptedDocRef, 'manual');
          throw Object.assign(new Error('429'), { code: 429 });
        }
        return fakeSummarize()();
      },
    });

    expect(stats.superseded, '1件目はpreemptによりsupersededとして計上されること').to.equal(1);
    expect(stats.done, '2件目は通常通り処理され、バッチ全体が例外で止まらないこと').to.equal(1);
    const preemptedData = await getDoc('doc-preempt-during-failure');
    // 手動claimの結果(processing)が保持されること。バッチ側の失敗記録で上書きされない。
    expect(preemptedData.summaryState).to.equal('processing');
    expect((await getDoc('doc-after-preempted')).summaryState).to.equal('done');
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

  describe('releaseManualSummaryRun (pr-test-analyzer指摘反映: 直接のテストが0件だったため追加)', () => {
    it('claim前にsummaryState系フィールドが一切存在しなかった場合、7フィールド全て削除される', async () => {
      const docId = 'doc-release-prior-absent';
      await db.collection('documents').doc(docId).set({
        fileName: 'test.pdf',
        status: 'processed',
        updatedAt: admin.firestore.Timestamp.now(),
      });
      const docRef = db.doc(`documents/${docId}`);
      const claimResult = await claimSummaryRun(db, docRef, 'manual');
      if (!claimResult.claimed) throw new Error('unreachable');
      expect(claimResult.claim.priorState, 'claim前はフィールド不在だったのでpriorStateはnull').to.equal(null);

      await releaseManualSummaryRun(db, docRef, claimResult.claim, 'unknown');

      const data = await getDoc(docId);
      expect(data).to.not.have.property('summaryState');
      expect(data).to.not.have.property('summaryRunId');
      expect(data).to.not.have.property('summaryStateUpdatedAt');
      expect(data).to.not.have.property('summaryError');
      expect(data).to.not.have.property('summaryErrorKind');
      expect(data).to.not.have.property('summaryProvider');
      expect(data).to.not.have.property('summaryAttemptCount');
    });

    it("claim前がpendingだった場合、pendingへ復元される(summaryRunIdはnullへ)", async () => {
      await seedDocument('doc-release-prior-pending');
      const docRef = db.doc('documents/doc-release-prior-pending');
      const claimResult = await claimSummaryRun(db, docRef, 'manual');
      if (!claimResult.claimed) throw new Error('unreachable');
      expect(claimResult.claim.priorState).to.equal('pending');

      await releaseManualSummaryRun(db, docRef, claimResult.claim, 'transient');

      const data = await getDoc('doc-release-prior-pending');
      expect(data.summaryState).to.equal('pending');
      expect(data.summaryRunId).to.equal(null);
    });

    it("claim前がprocessing(実行中の別claimをpreemptした)だった場合、pendingへは戻さずerrorへ倒す(所有者不在のclaimを復活させない)", async () => {
      await seedDocument('doc-release-prior-processing', {
        summaryState: 'processing',
        summaryRunId: 'orphaned-batch-run-id',
        summaryAttemptCount: 1,
      });
      const docRef = db.doc('documents/doc-release-prior-processing');
      const claimResult = await claimSummaryRun(db, docRef, 'manual');
      if (!claimResult.claimed) throw new Error('unreachable');
      expect(claimResult.claim.priorState, 'preempt前はprocessingだった').to.equal('processing');

      await releaseManualSummaryRun(db, docRef, claimResult.claim, 'quota');

      const data = await getDoc('doc-release-prior-processing');
      expect(data.summaryState, 'processingへは戻さずerrorへ倒す(所有者不在のclaimを復活させない)').to.equal(
        'error'
      );
      expect(data.summaryRunId).to.equal(null);
      expect(data.summaryErrorKind).to.equal('quota');
    });

    it('release前に別の実行(さらに新しいclaim)へ所有権が移っていた場合、SummarySupersededErrorをthrowし書込みしない', async () => {
      await seedDocument('doc-release-superseded');
      const docRef = db.doc('documents/doc-release-superseded');
      const claimResult = await claimSummaryRun(db, docRef, 'manual');
      if (!claimResult.claimed) throw new Error('unreachable');

      // release前に、さらに新しい実行がこのclaimをpreemptしたことを模す。
      await claimSummaryRun(db, docRef, 'manual');

      let caught: unknown;
      try {
        await releaseManualSummaryRun(db, docRef, claimResult.claim, 'unknown');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(SummarySupersededError);
    });
  });

  describe('ocr-generation-drift (reprocess中の要約commitを実Firestoreパスで検証)', () => {
    it('claim後にreprocess等でocrRunIdが変わると、summaryRunIdは一致していてもcommitはocr-generation-driftでsupersededになる', async () => {
      await seedDocument('doc-ocr-drift', { ocrRunId: 'ocr-run-a' });
      const docRef = db.doc('documents/doc-ocr-drift');
      const claimResult = await claimSummaryRun(db, docRef, 'batch');
      if (!claimResult.claimed) throw new Error('unreachable');
      expect(claimResult.claim.ocrRunId, 'claim時点のocrRunIdを記憶していること').to.equal('ocr-run-a');

      // reprocess完了(新しいOCR実行)により、summaryRunIdはそのままocrRunIdだけが変わったことを模す。
      await docRef.update({ ocrRunId: 'ocr-run-b' });

      let caught: unknown;
      try {
        await commitSummaryResult(db, docRef, claimResult.claim, {
          summary: { text: '古いOCR結果に基づく要約(破棄されるはず)', truncated: false },
          provider: 'sarashina',
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(SummarySupersededError);
      expect((caught as InstanceType<typeof SummarySupersededError>).reason).to.equal('ocr-generation-drift');
      expect((await getDoc('doc-ocr-drift')).summary).to.equal(undefined);
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

  describe('loadOcrTextForSummary: Storageオフロード分岐 (pr-test-analyzer指摘反映: 唯一の存在意義である分岐が未テストだったため追加)', () => {
    function makeFakeBucketWithFile(opts: { exists: boolean; content?: string }): Bucket {
      const file = {
        exists: async () => [opts.exists],
        download: async () => [Buffer.from(opts.content ?? '', 'utf-8')],
      };
      return {
        name: 'test-bucket',
        file: () => file,
      } as unknown as Bucket;
    }

    it('ocrResultUrlが設定されている場合、detail/mainのocrResult(空文字)ではなくStorageからダウンロードした内容を使う', async () => {
      const docId = 'doc-offloaded-ocr-text';
      const offloadedText = 'x'.repeat(150_000);
      const docRef = db.collection('documents').doc(docId);
      await docRef.set({
        fileName: 'test.pdf',
        status: 'processed',
        summaryState: 'pending',
        summaryAttemptCount: 0,
        updatedAt: admin.firestore.Timestamp.now(),
        documentType: '福祉用具貸与確認書',
        ocrResultUrl: 'gs://test-bucket/ocr-results/doc-offloaded-ocr-text/run-1.txt',
      });
      // 10万字超でオフロードされた文書はdetail/main.ocrResultが空文字列のまま(ADR-0018)。
      await docRef.collection('detail').doc('main').set({ ocrResult: '' });

      const bucket = makeFakeBucketWithFile({ exists: true, content: offloadedText });
      const stats = await runSummaryBatch({
        firestore: db,
        bucket,
        l1Provider: 'sarashina',
        getGate: ENABLED_GATE,
        summarize: async (ocrResult) => {
          // detail/mainの空文字ではなく、Storageからダウンロードした実文字数が渡ること。
          expect(ocrResult.length).to.equal(offloadedText.length);
          return fakeSummarize()();
        },
      });

      expect(stats.done).to.equal(1);
    });

    it('ocrResultUrlはあるがStorageに実体が存在しない場合、空文字列にフォールバックしskippedとして記録する(安全網)', async () => {
      const docId = 'doc-offloaded-missing-file';
      const docRef = db.collection('documents').doc(docId);
      await docRef.set({
        fileName: 'test.pdf',
        status: 'processed',
        summaryState: 'pending',
        summaryAttemptCount: 0,
        updatedAt: admin.firestore.Timestamp.now(),
        documentType: '福祉用具貸与確認書',
        ocrResultUrl: 'gs://test-bucket/ocr-results/doc-offloaded-missing-file/run-1.txt',
      });
      await docRef.collection('detail').doc('main').set({ ocrResult: '' });

      const bucket = makeFakeBucketWithFile({ exists: false });
      const stats = await runSummaryBatch({
        firestore: db,
        bucket,
        l1Provider: 'sarashina',
        getGate: ENABLED_GATE,
        summarize: fakeSummarize(),
      });

      expect(stats.skipped, 'Storageから読めなかった安全網(loadOcrTextForSummaryがOCR結果を返せない)').to.equal(1);
      const data = await getDoc(docId);
      expect(data.summaryState).to.equal('skipped');
    });
  });
});
