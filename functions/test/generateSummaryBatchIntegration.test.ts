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
import { randomUUID } from 'node:crypto';
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

/**
 * 既定は「手動依頼の印(summaryManualRequestedAt)つきのpending」。PR-C以降、バッチの実行対象は
 * 印のあるpendingが中心のため。`summaryManualRequestedAt: null`を渡すと印なし(過去の自動・canary
 * 由来のpending)としてシードする。
 */
async function seedDocument(docId: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const docRef = db.collection('documents').doc(docId);
  const data: Record<string, unknown> = {
    fileName: 'test.pdf',
    status: 'processed',
    summaryState: 'pending',
    summaryAttemptCount: 0,
    summaryManualRequestedAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    documentType: '福祉用具貸与確認書',
    ...overrides,
  };
  if (data.summaryManualRequestedAt === null) delete data.summaryManualRequestedAt;
  await docRef.set(data);
  await docRef.collection('detail').doc('main').set({ ocrResult: LONG_OCR_TEXT });
}

/**
 * 別の実行(再OCR等)が文書の所有権を奪った状態を模す(summaryRunIdを別値へ)。PR-Cで手動claimの
 * preemptモードは廃止されたため、「所有権喪失」の再現はテスト側で直接書き換えて行う。
 */
async function simulatePreempt(docRef: FirebaseFirestore.DocumentReference): Promise<void> {
  await docRef.update({
    summaryState: 'processing',
    summaryRunId: randomUUID(),
    summaryStateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    summaryAttemptCount: admin.firestore.FieldValue.increment(1),
  });
}

async function getDoc(docId: string): Promise<FirebaseFirestore.DocumentData> {
  return (await db.doc(`documents/${docId}`).get()).data()!;
}

function fakeSummarize(overrides: Partial<SummaryPassResult> = {}) {
  return async (): Promise<SummaryPassResult> => ({
    provider: 'sarashina',
    summary: { text: 'この書類は福祉用具貸与確認書です。利用者は歩行器を利用しています。', truncated: false },
    finishReason: 'stop',
    sentText: LONG_OCR_TEXT,
    ...overrides,
  });
}

const ENABLED_GATE = async () => ({ enabled: true, allowlist: null, autoOnOcr: false });

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
      getGate: async () => ({ enabled: false, allowlist: null, autoOnOcr: false }),
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
      getGate: async () => ({ enabled: true, allowlist: ['doc-allowed'], autoOnOcr: false }),
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
      const stats = await runFabricatedTick();

      expect(stats.errorByKind.fabrication_suspected).to.equal(1);
      expect(stats.fabricationRetried).to.equal(0);
      const data = await getDoc('doc-fabricated-shared-budget');
      expect(data.summaryState).to.equal('error');
      // 先行するquotaのkindが残らず、fabrication_suspectedで上書きされる
      expect(data.summaryErrorKind).to.equal('fabrication_suspected');
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

    it('エラー文はPII契約(summaryErrorにPIIを含めない)を守り、疑い名を含まず語彙由来のsuffixとcore文字数・試行番号のみを含む', async () => {
      await seedDocument('doc-fabricated-message', { customerName: '三好 陽子' });
      await runFabricatedTick();

      const message: string = (await getDoc('doc-fabricated-message')).summaryError;
      // 「みずほ訪問看護ステーション」は最長スパン優先でsuffix=ステーション、core=「みずほ訪問看護」(7文字)。
      // 文字列全体を固定し、想定外の情報(疑い名・core・利用者名・ファイル名)が混入しないことを保証する。
      expect(message).to.match(
        /^Fabrication scanner detected 1 suspect name\(s\): suffix=ステーション\/coreLen=7 \(configVersion=[0-9a-f]{8}, attempt=1\/3\)$/
      );
      for (const leaked of ['みずほ', 'みずほ訪問看護', 'みずほ訪問看護ステーション', '三好', 'test.pdf']) {
        expect(message, `エラー文に「${leaked}」が含まれていないこと`).to.not.contain(leaked);
      }
    });

    it('検知が4件以上でも、エラー文の詳細は先頭3件までに切り詰める(件数はfabricatedCountの全数)', async () => {
      await seedDocument('doc-fabricated-many');
      await runSummaryBatch({
        firestore: db,
        bucket: FAKE_BUCKET,
        l1Provider: 'sarashina',
        getGate: ENABLED_GATE,
        summarize: fakeSummarize({
          summary: { text: 'さくらクリニック、青空薬局、緑病院、赤井診療所が関与している。', truncated: false },
        }),
      });

      const message: string = (await getDoc('doc-fabricated-many')).summaryError;
      expect(message).to.contain('detected 4 suspect name(s)');
      expect(message.match(/suffix=/g)?.length, '詳細は先頭3件のみ').to.equal(3);
      for (const leaked of ['さくら', '青空', '緑', '赤井']) {
        expect(message).to.not.contain(leaked);
      }
    });

    it('更新対象外フィールドが不変: 再pending時に変わるのは要約状態系のみで、既存のsummary/summaryProviderは温存される(手動生成済み文書の再pending)', async () => {
      await seedDocument('doc-fabricated-invariant', {
        customerName: '三好 陽子',
        officeName: 'テスト事業所',
        summary: { text: '手動生成済みの既存要約です。', truncated: false },
        summaryProvider: 'gemini',
        summaryAttemptCount: 0,
      });
      const before = await getDoc('doc-fabricated-invariant');
      const detailBefore = (await db.doc('documents/doc-fabricated-invariant/detail/main').get()).data();

      await runFabricatedTick();

      const after = await getDoc('doc-fabricated-invariant');
      expect(after.summaryState).to.equal('pending');
      expect(after.summaryRunId, 'claimは解放される').to.equal(null);
      expect(after.summaryAttemptCount, 'claimで+1されるのみ').to.equal(1);
      // 既存の手動生成要約は検知した出力で上書きされず温存される
      expect(after.summary).to.deep.equal(before.summary);
      expect(after.summaryProvider).to.equal('gemini');
      const changed = new Set([
        'summaryState',
        'summaryRunId',
        'summaryStateUpdatedAt',
        'summaryAttemptCount',
        'summaryError',
        'summaryErrorKind',
      ]);
      const pick = (d: FirebaseFirestore.DocumentData) =>
        Object.fromEntries(Object.entries(d).filter(([k]) => !changed.has(k)));
      expect(pick(after), '要約状態系以外のフィールドは一切変わらない').to.deep.equal(pick(before));
      const detailAfter = (await db.doc('documents/doc-fabricated-invariant/detail/main').get()).data();
      expect(detailAfter).to.deep.equal(detailBefore);
    });

    it('混在バッチ: 正常・再試行・終端errorが1tickに混在しても、各文書が独立に処理されstatsが独立に加算される', async () => {
      await seedDocument('doc-mixed-1-ok', { updatedAt: admin.firestore.Timestamp.fromMillis(1000) });
      await seedDocument('doc-mixed-2-retry', { updatedAt: admin.firestore.Timestamp.fromMillis(2000), summaryAttemptCount: 0 });
      await seedDocument('doc-mixed-3-terminal', {
        updatedAt: admin.firestore.Timestamp.fromMillis(3000),
        summaryAttemptCount: MAX_SUMMARY_ATTEMPTS - 1,
      });
      let call = 0;
      const stats = await runSummaryBatch({
        firestore: db,
        bucket: FAKE_BUCKET,
        l1Provider: 'sarashina',
        getGate: ENABLED_GATE,
        // updatedAt昇順で1件目=正常、2件目・3件目=捏造
        summarize: async () => {
          call++;
          return call === 1
            ? fakeSummarize()()
            : fakeSummarize({ summary: { text: '貸与事業所はみずほ訪問看護ステーションです。', truncated: false } })();
        },
      });

      expect(stats.claimed).to.equal(3);
      expect(stats.done).to.equal(1);
      expect(stats.fabricationRetried).to.equal(1);
      expect(stats.errorByKind).to.deep.equal({ fabrication_suspected: 1 });
      expect((await getDoc('doc-mixed-1-ok')).summaryState).to.equal('done');
      expect((await getDoc('doc-mixed-2-retry')).summaryState).to.equal('pending');
      expect((await getDoc('doc-mixed-3-terminal')).summaryState).to.equal('error');
    });

    it('回復: 検知→pending→次tickで正常な要約が返ると、doneになりsummaryError/summaryErrorKindがクリアされる', async () => {
      await seedDocument('doc-fabricated-recovery');
      await runFabricatedTick();
      expect((await getDoc('doc-fabricated-recovery')).summaryState).to.equal('pending');

      const stats = await runSummaryBatch({
        firestore: db,
        bucket: FAKE_BUCKET,
        l1Provider: 'sarashina',
        getGate: ENABLED_GATE,
        summarize: fakeSummarize(),
      });

      expect(stats.done).to.equal(1);
      const data = await getDoc('doc-fabricated-recovery');
      expect(data.summaryState).to.equal('done');
      expect(data.summaryError ?? null, '成功後に古いエラー文が残らない').to.equal(null);
      expect(data.summaryErrorKind ?? null).to.equal(null);
    });

    it('supersede: 検知結果の記録前に手動claimがpreemptした場合は、二重計上せずsupersededのみ計上し文書はprocessingのまま', async () => {
      await seedDocument('doc-fabricated-preempted');
      const docRef = db.doc('documents/doc-fabricated-preempted');
      const stats = await runSummaryBatch({
        firestore: db,
        bucket: FAKE_BUCKET,
        l1Provider: 'sarashina',
        getGate: ENABLED_GATE,
        summarize: async () => {
          // 生成した捏造要約をスキャナが検知した直後・記録前に、手動再生成がこのclaimをpreemptしたことを模す
          await simulatePreempt(docRef);
          return fakeSummarize({
            summary: { text: '貸与事業所はみずほ訪問看護ステーションです。', truncated: false },
          })();
        },
      });

      expect(stats.superseded).to.equal(1);
      expect(stats.fabricationRetried, 'supersede時は再試行として数えない').to.equal(0);
      expect(stats.errorByKind.fabrication_suspected, 'supersede時は終端errorとして数えない').to.equal(undefined);
      const data = await getDoc('doc-fabricated-preempted');
      // 手動claimの結果が保持され、バッチ側の失敗記録で上書きされない
      expect(data.summaryState).to.equal('processing');
      expect(data.summaryError).to.equal(undefined);
    });

    it('recombinedのみ(原典の括弧書き略記の語順入替)は捏造扱いせず、要約を保存する(再試行の対象外)', async () => {
      const RECOMBINED_OCR = '訪問看護（水無月）を週2回利用している。利用者は歩行器を使用している。'.repeat(4);
      await seedDocument('doc-recombined');
      await db
        .collection('documents')
        .doc('doc-recombined')
        .collection('detail')
        .doc('main')
        .set({ ocrResult: RECOMBINED_OCR });
      const stats = await runSummaryBatch({
        firestore: db,
        bucket: FAKE_BUCKET,
        l1Provider: 'sarashina',
        getGate: ENABLED_GATE,
        // 比較対象は実際の送信テキスト(summarizeの戻りsentText)。
        summarize: fakeSummarize({
          summary: { text: '水無月訪問看護を週2回利用している。', truncated: false },
          sentText: RECOMBINED_OCR,
        }),
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
      getGate: async () => ({ enabled: true, allowlist: ['doc-race-allowed'], autoOnOcr: false }),
      summarize: async () => {
        // 1件目(doc-race-allowed)の生成中に、doc-race-not-allowedへの手動再生成が割り込み、
        // 既にprocessingへ遷移したことを模す(allowlist対象外なのでバッチ自身は生成を試みない)。
        await simulatePreempt(raceDocRef);
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
          await simulatePreempt(preemptedDocRef);
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

      const first = await claimSummaryRun(db, docRef, 'fixed-run-id');
      expect(first.claimed).to.equal(true);
      if (!first.claimed) throw new Error('unreachable');
      expect(first.claim.attemptCount).to.equal(1);

      // 同一runIdでの再claim(withBackoffRetryの外側リトライを模す)は
      // 「既にこの実行がcommit済み」として同じclaimを返し、attemptCountを再度incrementしない。
      const second = await claimSummaryRun(db, docRef, 'fixed-run-id');
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
      const claimResult = await claimSummaryRun(db, docRef);
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

    it('recordSummaryFailureも所有権チェックを行い、supersededなら書込みしない', async () => {
      await seedDocument('doc-record-failure-superseded');
      const docRef = db.doc('documents/doc-record-failure-superseded');
      const claimResult = await claimSummaryRun(db, docRef);
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

  describe('PR-C: 手動依頼中心の実行対象・手動依頼の印の寿命・計測ログ', () => {
    /** console.log/warnを捕捉して返す(固定接頭辞のログ契約の検証用)。 */
    async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
      const logs: string[] = [];
      const origLog = console.log;
      const origWarn = console.warn;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      };
      console.warn = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      };
      try {
        return { result: await fn(), logs };
      } finally {
        console.log = origLog;
        console.warn = origWarn;
      }
    }
    const manualResultLogs = (logs: string[]) => logs.filter((l) => l.includes('summary_manual_result'));

    const run = (overrides: Record<string, unknown> = {}) =>
      runSummaryBatch({
        firestore: db,
        bucket: FAKE_BUCKET,
        l1Provider: 'sarashina',
        getGate: ENABLED_GATE,
        summarize: fakeSummarize(),
        ...overrides,
      });

    it('自動生成が無効(既定): 手動依頼の印のないpending(過去の自動・canary由来)は実行されず、状態も変わらない', async () => {
      await seedDocument('doc-legacy-pending', { summaryManualRequestedAt: null });
      const stats = await run();

      expect(stats.claimed).to.equal(0);
      expect(stats.done).to.equal(0);
      const data = await getDoc('doc-legacy-pending');
      expect(data.summaryState).to.equal('pending');
      expect(data.summaryAttemptCount).to.equal(0);
    });

    it('自動生成が無効: 印つき(手動)だけが処理され、印なしが混在していても実行されない', async () => {
      await seedDocument('doc-manual', { updatedAt: admin.firestore.Timestamp.fromMillis(2000) });
      await seedDocument('doc-legacy', { summaryManualRequestedAt: null, updatedAt: admin.firestore.Timestamp.fromMillis(1000) });
      const stats = await run();

      expect(stats.done).to.equal(1);
      expect((await getDoc('doc-manual')).summaryState).to.equal('done');
      expect((await getDoc('doc-legacy')).summaryState).to.equal('pending');
    });

    it('手動依頼は依頼順(summaryManualRequestedAtの昇順)に処理される(先に依頼した文書が先)', async () => {
      await seedDocument('doc-second', { summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(2000) });
      await seedDocument('doc-first', { summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(1000) });
      const order: string[] = [];
      await run({
        limit: 1,
        summarize: async () => {
          order.push('called');
          return fakeSummarize()();
        },
      });
      // limit=1: 先に依頼された方だけが処理される
      expect((await getDoc('doc-first')).summaryState).to.equal('done');
      expect((await getDoc('doc-second')).summaryState).to.equal('pending');
    });

    it('自動生成が有効: 手動依頼を先に処理し、残りの枠をupdatedAt順の印なしpendingで埋める(重複を除いてlimit件)', async () => {
      // 手動の1件は、updatedAt順でも先頭に来る(重複の発生条件)。印なし3件と合わせてlimit=3。
      await seedDocument('doc-manual', { updatedAt: admin.firestore.Timestamp.fromMillis(1000) });
      await seedDocument('doc-auto-1', { summaryManualRequestedAt: null, updatedAt: admin.firestore.Timestamp.fromMillis(2000) });
      await seedDocument('doc-auto-2', { summaryManualRequestedAt: null, updatedAt: admin.firestore.Timestamp.fromMillis(3000) });
      await seedDocument('doc-auto-3', { summaryManualRequestedAt: null, updatedAt: admin.firestore.Timestamp.fromMillis(4000) });
      const stats = await run({
        limit: 3,
        getGate: async () => ({ enabled: true, allowlist: null, autoOnOcr: true }),
      });

      expect(stats.done, '重複(doc-manualが両クエリに含まれる)があっても3件処理される').to.equal(3);
      expect((await getDoc('doc-manual')).summaryState).to.equal('done');
      expect((await getDoc('doc-auto-1')).summaryState).to.equal('done');
      expect((await getDoc('doc-auto-2')).summaryState).to.equal('done');
      expect((await getDoc('doc-auto-3')).summaryState, 'limitを超える分は次tickへ').to.equal('pending');
    });

    it('done: 手動依頼の印が削除され、summary_manual_resultが1行(outcome=done・provider・latencyMs)だけ出る', async () => {
      await seedDocument('doc-done', { summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 5000) });
      const { logs } = await captureLogs(() => run());

      expect((await getDoc('doc-done')).summaryManualRequestedAt).to.equal(undefined);
      const lines = manualResultLogs(logs);
      expect(lines).to.have.length(1);
      expect(lines[0]).to.match(/^\[generateSummaryBatch\] summary_manual_result documentId=doc-done outcome=done kind=none provider=sarashina latencyMs=\d+$/);
      const latency = Number(/latencyMs=(\d+)/.exec(lines[0])![1]);
      expect(latency).to.be.at.least(5000);
    });

    it('自動由来(印なし)の完了ではsummary_manual_resultを出さない(手動依頼の計測だけを数える)', async () => {
      await seedDocument('doc-auto-done', { summaryManualRequestedAt: null });
      const { logs } = await captureLogs(() =>
        run({ getGate: async () => ({ enabled: true, allowlist: null, autoOnOcr: true }) })
      );
      expect((await getDoc('doc-auto-done')).summaryState).to.equal('done');
      expect(manualResultLogs(logs)).to.have.length(0);
    });

    it('終端error: 印が削除され、outcome=error・kindつきで1行出る', async () => {
      await seedDocument('doc-err', { summaryAttemptCount: MAX_SUMMARY_ATTEMPTS - 1 });
      const { logs } = await captureLogs(() =>
        run({
          summarize: async () => {
            throw Object.assign(new Error('429'), { code: 429 });
          },
        })
      );
      const data = await getDoc('doc-err');
      expect(data.summaryState).to.equal('error');
      expect(data.summaryManualRequestedAt).to.equal(undefined);
      const lines = manualResultLogs(logs);
      expect(lines).to.have.length(1);
      expect(lines[0]).to.contain('outcome=error');
      expect(lines[0]).to.contain('kind=quota');
    });

    it('再試行(pendingへ戻る一時失敗)の間は印を保ち、ログも出さない(終端に達するまで優先キューに残る)', async () => {
      await seedDocument('doc-retry');
      const { logs } = await captureLogs(() =>
        run({
          summarize: async () => {
            throw Object.assign(new Error('429'), { code: 429 });
          },
        })
      );
      const data = await getDoc('doc-retry');
      expect(data.summaryState).to.equal('pending');
      expect(data.summaryManualRequestedAt).to.be.instanceOf(admin.firestore.Timestamp);
      expect(manualResultLogs(logs)).to.have.length(0);
    });

    it('allowlist対象外: skippedとして終端し、印が削除され、outcome=skippedが1行出る', async () => {
      await seedDocument('doc-not-allowed');
      const { logs } = await captureLogs(() =>
        run({ getGate: async () => ({ enabled: true, allowlist: ['other'], autoOnOcr: false }) })
      );
      const data = await getDoc('doc-not-allowed');
      expect(data.summaryState).to.equal('skipped');
      expect(data.summaryManualRequestedAt).to.equal(undefined);
      const lines = manualResultLogs(logs);
      expect(lines).to.have.length(1);
      expect(lines[0]).to.contain('outcome=skipped');
    });

    it('OCR未完了(status!==processed): skippedとして終端し、印が削除され1行出る', async () => {
      await seedDocument('doc-ocr-incomplete', { status: 'pending' });
      const { logs } = await captureLogs(() => run());
      const data = await getDoc('doc-ocr-incomplete');
      expect(data.summaryState).to.equal('skipped');
      expect(data.summaryManualRequestedAt).to.equal(undefined);
      expect(manualResultLogs(logs)).to.have.length(1);
    });

    it('rescue: 閾値超過のprocessingが終端errorになる場合も、印が削除され、1行出る(通常ループ外の経路)', async () => {
      const stuckAt = admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000);
      await seedDocument('doc-stuck', {
        summaryState: 'processing',
        summaryRunId: 'dead-run',
        summaryStateUpdatedAt: stuckAt,
        summaryAttemptCount: MAX_SUMMARY_ATTEMPTS,
        summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 10_000),
      });
      const { logs } = await captureLogs(() => rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'sarashina' }));

      const data = await getDoc('doc-stuck');
      expect(data.summaryState).to.equal('error');
      expect(data.summaryManualRequestedAt).to.equal(undefined);
      const lines = manualResultLogs(logs);
      expect(lines).to.have.length(1);
      expect(lines[0]).to.contain('documentId=doc-stuck');
      expect(lines[0]).to.contain('outcome=error');
    });

    it('rescue: 自動生成が無効の間、印のない(自動由来の)processingがstuckしたら、pendingではなく要約なしへ戻す(取り残し防止)', async () => {
      const stuckAt = admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000);
      await seedDocument('doc-stuck-unmarked', {
        summaryState: 'processing',
        summaryRunId: 'dead-run',
        summaryStateUpdatedAt: stuckAt,
        summaryAttemptCount: 1,
        summaryManualRequestedAt: null,
        summary: { text: '旧要約', truncated: false },
        summaryProvider: 'sarashina',
      });
      await rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'sarashina', autoEnabled: false });
      const data = await getDoc('doc-stuck-unmarked');
      expect(data.summaryState).to.equal(undefined);
      expect(data.summaryAttemptCount).to.equal(undefined);
      expect(data.summaryRunId).to.equal(undefined);
      // 更新対象外フィールドは不変: 既存の要約本文と生成元は残る
      expect(data.summary.text).to.equal('旧要約');
      expect(data.summaryProvider).to.equal('sarashina');
    });

    it('rescue: 自動生成が有効なら、印のないprocessingもpendingへ戻す(自動キューで再処理される)', async () => {
      const stuckAt = admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000);
      await seedDocument('doc-stuck-unmarked-auto', {
        summaryState: 'processing',
        summaryRunId: 'dead-run',
        summaryStateUpdatedAt: stuckAt,
        summaryAttemptCount: 1,
        summaryManualRequestedAt: null,
      });
      await rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'sarashina', autoEnabled: true });
      expect((await getDoc('doc-stuck-unmarked-auto')).summaryState).to.equal('pending');
    });

    it('更新対象外フィールドの不変: skipped/done/terminal errorの後も、要約状態系以外のフィールド(verified/customerName/fileName/status)は変わらない', async () => {
      const unrelated = { verified: true, customerName: '山田 太郎', fileName: 'keep.pdf' };
      // 依頼順(印の昇順)で skipped → done → terminal error の順に処理される(errorは最後: quotaでバッチが止まるため)
      await seedDocument('doc-keep-skipped', { ...unrelated, status: 'pending', summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(1000) });
      await seedDocument('doc-keep-done', { ...unrelated, summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(2000) });
      await seedDocument('doc-keep-error', {
        ...unrelated,
        summaryAttemptCount: MAX_SUMMARY_ATTEMPTS - 1,
        summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(3000),
      });
      let calls = 0;
      await run({
        summarize: async () => {
          calls++;
          if (calls === 1) return fakeSummarize()();
          throw Object.assign(new Error('429'), { code: 429 });
        },
      });
      expect((await getDoc('doc-keep-skipped')).summaryState).to.equal('skipped');
      expect((await getDoc('doc-keep-done')).summaryState).to.equal('done');
      expect((await getDoc('doc-keep-error')).summaryState).to.equal('error');
      for (const id of ['doc-keep-skipped', 'doc-keep-done', 'doc-keep-error']) {
        const data = await getDoc(id);
        expect(data.verified, id).to.equal(true);
        expect(data.customerName, id).to.equal('山田 太郎');
        expect(data.fileName, id).to.equal('keep.pdf');
      }
      expect((await getDoc('doc-keep-skipped')).status, 'status!==processedの文書はstatusを書き換えない').to.equal('pending');
    });

    it('limit境界: 手動依頼がlimit件以上ある場合、自動生成が有効でも印なしpendingは処理しない(自動クエリを発行しない)', async () => {
      await seedDocument('doc-m1', { summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(1000) });
      await seedDocument('doc-m2', { summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(2000) });
      await seedDocument('doc-a1', { summaryManualRequestedAt: null });
      const stats = await run({ limit: 2, getGate: async () => ({ enabled: true, allowlist: null, autoOnOcr: true }) });
      expect(stats.done).to.equal(2);
      expect((await getDoc('doc-a1')).summaryState).to.equal('pending');
    });

    it('limit境界: 手動がlimit-1件のとき、残り1枠だけ自動生成(有効時)の印なしpendingで埋める', async () => {
      await seedDocument('doc-m1', { summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(1000) });
      await seedDocument('doc-a1', { summaryManualRequestedAt: null, updatedAt: admin.firestore.Timestamp.fromMillis(1) });
      await seedDocument('doc-a2', { summaryManualRequestedAt: null, updatedAt: admin.firestore.Timestamp.fromMillis(2) });
      const stats = await run({ limit: 2, getGate: async () => ({ enabled: true, allowlist: null, autoOnOcr: true }) });
      expect(stats.done).to.equal(2);
      expect((await getDoc('doc-a1')).summaryState).to.equal('done');
      expect((await getDoc('doc-a2')).summaryState).to.equal('pending');
    });

    it('OCR読込失敗(Storage上の実体なし)のskippedでも、印が削除され、summary_manual_resultが1行出る', async () => {
      const docRef = db.collection('documents').doc('doc-load-fail');
      await docRef.set({
        fileName: 'test.pdf',
        status: 'processed',
        summaryState: 'pending',
        summaryAttemptCount: 0,
        summaryManualRequestedAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        documentType: '福祉用具貸与確認書',
        ocrResultUrl: 'gs://test-bucket/ocr-results/doc-load-fail/run-1.txt',
      });
      await docRef.collection('detail').doc('main').set({ ocrResult: '' });
      const missing = {
        file: () => ({ exists: async () => [false], download: async () => [Buffer.from('')] }),
      } as unknown as Bucket;
      const { logs } = await captureLogs(() => run({ bucket: missing }));
      const data = await getDoc('doc-load-fail');
      expect(data.summaryState).to.equal('skipped');
      expect(data.summaryManualRequestedAt).to.equal(undefined);
      expect(manualResultLogs(logs)).to.have.length(1);
      expect(manualResultLogs(logs)[0]).to.contain('outcome=skipped');
    });

    it('rescue: L1=noneかつ印付きのstuck processingは、errorに確定し、印を削除して1行ログを出す', async () => {
      const stuckAt = admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000);
      await seedDocument('doc-stuck-none', {
        summaryState: 'processing',
        summaryRunId: 'dead-run',
        summaryStateUpdatedAt: stuckAt,
        summaryAttemptCount: 1,
        summaryManualRequestedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 10_000),
      });
      const { logs } = await captureLogs(() => rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'none' }));
      const data = await getDoc('doc-stuck-none');
      expect(data.summaryState).to.equal('error');
      expect(data.summaryManualRequestedAt).to.equal(undefined);
      expect(manualResultLogs(logs)).to.have.length(1);
    });

    it('rescue: 印なしでも試行回数が上限に達していれば、状態消去ではなくerror確定が優先される(順序の固定)', async () => {
      const stuckAt = admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000);
      await seedDocument('doc-stuck-max', {
        summaryState: 'processing',
        summaryRunId: 'dead-run',
        summaryStateUpdatedAt: stuckAt,
        summaryAttemptCount: MAX_SUMMARY_ATTEMPTS,
        summaryManualRequestedAt: null,
      });
      const { logs } = await captureLogs(() => rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'sarashina', autoEnabled: false }));
      expect((await getDoc('doc-stuck-max')).summaryState).to.equal('error');
      expect(manualResultLogs(logs), '印なしは手動依頼ではないため計測ログは出ない').to.have.length(0);
    });

    it('印の型不正(Timestamp以外)は「印なし」として一貫して扱う: claimのmanualRequestedAtMsはnull、rescueは状態消去', async () => {
      await seedDocument('doc-garbage-claim', { summaryManualRequestedAt: 'garbage' });
      const claimResult = await claimSummaryRun(db, db.doc('documents/doc-garbage-claim'));
      if (!claimResult.claimed) throw new Error('unreachable');
      expect(claimResult.claim.manualRequestedAtMs).to.equal(null);

      const stuckAt = admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000);
      await seedDocument('doc-garbage-rescue', {
        summaryState: 'processing',
        summaryRunId: 'dead-run',
        summaryStateUpdatedAt: stuckAt,
        summaryAttemptCount: 1,
        summaryManualRequestedAt: 123,
      });
      await rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'sarashina', autoEnabled: false });
      expect((await getDoc('doc-garbage-rescue')).summaryState).to.equal(undefined);
    });

    it('rescue: pendingへ戻す(再試行)場合は印を保つ', async () => {
      const stuckAt = admin.firestore.Timestamp.fromMillis(Date.now() - SUMMARY_STUCK_THRESHOLD_MS - 60_000);
      await seedDocument('doc-stuck-retry', {
        summaryState: 'processing',
        summaryRunId: 'dead-run',
        summaryStateUpdatedAt: stuckAt,
        summaryAttemptCount: 1,
      });
      await rescueStuckSummaryDocs(db, { now: () => Date.now(), l1: 'sarashina' });
      const data = await getDoc('doc-stuck-retry');
      expect(data.summaryState).to.equal('pending');
      expect(data.summaryManualRequestedAt).to.be.instanceOf(admin.firestore.Timestamp);
    });

    it('英字混入(第1段階はログのみ): 原文にない英単語を含む要約も保存され、language_mix_suspectedが警告ログに出る', async () => {
      await seedDocument('doc-mix');
      const { logs, result: stats } = await captureLogs(() =>
        run({
          summarize: fakeSummarize({
            summary: { text: '訪問看護の指示。folgerende medical instructions を記載。', truncated: false },
          }),
        })
      );
      expect(stats.done).to.equal(1);
      expect(stats.languageMixDetected).to.equal(1);
      expect((await getDoc('doc-mix')).summaryState).to.equal('done');
      expect((await getDoc('doc-mix')).summary.text).to.contain('folgerende');
      const line = logs.find((l) => l.includes('language_mix_suspected'));
      expect(line).to.contain('documentId=doc-mix');
      expect(line).to.contain('count=3');
      // PII対策: 語そのもの(音訳された氏名等になりうる)はログに出さず、文字数だけを出す
      expect(line).to.not.contain('folgerende');
      expect(line).to.not.contain('medical');
      expect(line).to.contain('wordLengths=10,7,12');
    });

    it('英字混入: 原文(実際の送信テキスト)に存在する英単語は検知しない', async () => {
      await seedDocument('doc-mix-ok');
      const stats = await run({
        summarize: fakeSummarize({
          summary: { text: 'Barthel Index を確認した。', truncated: false },
          sentText: 'ADL評価 Barthel Index 85点 を確認。'.repeat(5),
        }),
      });
      expect(stats.languageMixDetected).to.equal(0);
    });

    it('捏造スキャン・英字混入は、元のOCR全文ではなく実際の送信テキスト(summarizeの戻りsentText)と比較する', async () => {
      // sentText(再短縮後)に無い語は、OCR全文に存在しても検知される。
      await seedDocument('doc-sent-text');
      const stats = await run({
        summarize: fakeSummarize({
          summary: { text: 'folgerende を記載。', truncated: false },
          sentText: '短縮後の原文のみ。'.repeat(20),
        }),
      });
      expect(stats.languageMixDetected).to.equal(1);
    });
  });

  describe('ocr-generation-drift (reprocess中の要約commitを実Firestoreパスで検証)', () => {
    it('claim後にreprocess等でocrRunIdが変わると、summaryRunIdは一致していてもcommitはocr-generation-driftでsupersededになる', async () => {
      await seedDocument('doc-ocr-drift', { ocrRunId: 'ocr-run-a' });
      const docRef = db.doc('documents/doc-ocr-drift');
      const claimResult = await claimSummaryRun(db, docRef);
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
        summaryManualRequestedAt: admin.firestore.Timestamp.now(),
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
        summaryManualRequestedAt: admin.firestore.Timestamp.now(),
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
