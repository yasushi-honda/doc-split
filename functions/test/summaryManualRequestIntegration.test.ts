/**
 * `functions/src/ocr/summaryManualRequest.ts` 統合テスト (PR-C、Firestore emulator)
 *
 * 手動要約依頼は「キューへの登録」だけを行う(`summaryState:'pending'`と`summaryManualRequestedAt`)。
 * 生成はバッチ(`generateSummaryBatch`)が直列に実行する。
 *
 * 実行: firebase emulators:exec --only firestore --project summary-manual-request-integration-test \
 *         'npx mocha --require ts-node/register --timeout 15000 test/summaryManualRequestIntegration.test.ts'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { enqueueManualSummary, ManualSummaryRejectedError } from '../src/ocr/summaryManualRequest';
import type { SummaryProviderSetting } from '../src/utils/config';
import type { SarashinaSummaryGate } from '../src/utils/featureFlags';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents'];

const ENABLED_GATE = async (): Promise<SarashinaSummaryGate> => ({ enabled: true, allowlist: null, autoOnOcr: false });

async function seed(docId: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await db.collection('documents').doc(docId).set({
    fileName: 'test.pdf',
    status: 'processed',
    documentType: '訪問看護指示書',
    updatedAt: admin.firestore.Timestamp.fromMillis(1000),
    // 更新対象外フィールドが不変であることの検証用
    verified: true,
    customerName: '山田 太郎',
    ...overrides,
  });
}

async function get(docId: string): Promise<FirebaseFirestore.DocumentData> {
  return (await db.doc(`documents/${docId}`).get()).data()!;
}

async function rejection(promise: Promise<unknown>): Promise<ManualSummaryRejectedError> {
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(ManualSummaryRejectedError);
    return err as ManualSummaryRejectedError;
  }
  throw new Error('rejectedになるはずが成功した');
}

function enqueue(
  docId: string,
  l1: SummaryProviderSetting = 'sarashina',
  getGate: () => Promise<SarashinaSummaryGate> = ENABLED_GATE
) {
  return enqueueManualSummary({ firestore: db, docId, l1Provider: l1, getGate });
}

describe('enqueueManualSummary (PR-C)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('要約のない書類: pending+手動依頼の印を書き、他のフィールドは変えない(更新対象外フィールドの不変)', async () => {
    await seed('doc-new');
    const result = await enqueue('doc-new');

    expect(result).to.deep.equal({ alreadyQueued: false });
    const data = await get('doc-new');
    expect(data.summaryState).to.equal('pending');
    expect(data.summaryAttemptCount).to.equal(0);
    expect(data.summaryManualRequestedAt).to.be.instanceOf(admin.firestore.Timestamp);
    expect(data.summaryStateUpdatedAt).to.be.instanceOf(admin.firestore.Timestamp);
    // 不変であるべきフィールド
    expect(data.verified).to.equal(true);
    expect(data.customerName).to.equal('山田 太郎');
    expect(data.fileName).to.equal('test.pdf');
    expect(data.status).to.equal('processed');
  });

  it('印の型不正(Timestamp以外)の既存pendingは「印なし」として扱い、正しいTimestampの印へ書き直す(判定をclaim/rescueと一致させる)', async () => {
    await seed('doc-garbage-marker', { summaryState: 'pending', summaryManualRequestedAt: 'garbage' });
    const result = await enqueue('doc-garbage-marker');
    expect(result).to.deep.equal({ alreadyQueued: false });
    expect((await get('doc-garbage-marker')).summaryManualRequestedAt).to.be.instanceOf(admin.firestore.Timestamp);
  });

  it('再生成: 既存の要約本文は消さず、エラー系フィールドだけを消す(完了時に上書きされるまで旧要約を残す)', async () => {
    await seed('doc-regen', {
      summary: { text: '旧要約', truncated: false },
      summaryState: 'error',
      summaryError: 'Fabrication scanner detected',
      summaryErrorKind: 'fabrication_suspected',
      summaryRunId: 'old-run',
      summaryAttemptCount: 3,
      summaryProvider: 'sarashina',
    });
    await enqueue('doc-regen');

    const data = await get('doc-regen');
    expect(data.summaryState).to.equal('pending');
    expect(data.summaryAttemptCount).to.equal(0);
    expect(data.summary.text).to.equal('旧要約');
    expect(data.summaryProvider).to.equal('sarashina');
    expect(data.summaryError).to.equal(undefined);
    expect(data.summaryErrorKind).to.equal(undefined);
    expect(data.summaryRunId).to.equal(undefined);
    // 更新対象外フィールドの不変
    expect(data.verified).to.equal(true);
    expect(data.customerName).to.equal('山田 太郎');
    expect(data.fileName).to.equal('test.pdf');
    expect(data.status).to.equal('processed');
  });

  it('冪等: processing中の依頼は何も書かずalreadyQueued=trueで返る(二重実行・二重課金を防ぐ)', async () => {
    await seed('doc-processing', { summaryState: 'processing', summaryRunId: 'run-1', summaryAttemptCount: 1 });
    const before = await get('doc-processing');
    const result = await enqueue('doc-processing');

    expect(result).to.deep.equal({ alreadyQueued: true });
    const after = await get('doc-processing');
    expect(after.summaryState).to.equal('processing');
    expect(after.summaryRunId).to.equal('run-1');
    expect(after.summaryManualRequestedAt).to.equal(undefined);
    expect(after).to.deep.equal(before);
  });

  it('冪等: 手動依頼の印がある pending への再依頼は何も書かない', async () => {
    const requestedAt = admin.firestore.Timestamp.fromMillis(5000);
    await seed('doc-pending-manual', { summaryState: 'pending', summaryManualRequestedAt: requestedAt });
    const result = await enqueue('doc-pending-manual');

    expect(result).to.deep.equal({ alreadyQueued: true });
    expect((await get('doc-pending-manual')).summaryManualRequestedAt.toMillis()).to.equal(5000);
  });

  it('印のない既存 pending(過去の自動・canary由来)への依頼は、印を付けて実行対象にし、試行回数は0へ戻す(手動依頼の再試行枠を確保する)', async () => {
    await seed('doc-pending-legacy', { summaryState: 'pending', summaryAttemptCount: 1 });
    const result = await enqueue('doc-pending-legacy');

    expect(result).to.deep.equal({ alreadyQueued: false });
    const data = await get('doc-pending-legacy');
    expect(data.summaryState).to.equal('pending');
    expect(data.summaryAttemptCount).to.equal(0);
    expect(data.summaryManualRequestedAt).to.be.instanceOf(admin.firestore.Timestamp);
  });

  it('skipped の書類(短文などで過去にskip)も再依頼でき、pendingになる', async () => {
    await seed('doc-skipped', { summaryState: 'skipped' });
    await enqueue('doc-skipped');
    expect((await get('doc-skipped')).summaryState).to.equal('pending');
  });

  describe('拒否', () => {
    it('L1=none: 準備中として拒否し、何も書かない(Geminiも呼ばない)', async () => {
      await seed('doc-l1-none');
      const err = await rejection(enqueue('doc-l1-none', 'none'));
      expect(err.reason).to.equal('disabled');
      expect(err.message).to.contain('準備中');
      expect((await get('doc-l1-none')).summaryState).to.equal(undefined);
    });

    it('L1=sarashina かつ L2フラグ無効: 準備中として拒否する', async () => {
      await seed('doc-l2-off');
      const err = await rejection(enqueue('doc-l2-off', 'sarashina', async () => ({ enabled: false, allowlist: null, autoOnOcr: false })));
      expect(err.reason).to.equal('disabled');
    });

    it('L1=sarashina かつ allowlist外: 対象外として拒否する(境界: 空配列は全拒否)', async () => {
      await seed('doc-not-allowed');
      const err = await rejection(enqueue('doc-not-allowed', 'sarashina', async () => ({ enabled: true, allowlist: [], autoOnOcr: false })));
      expect(err.reason).to.equal('not-allowed');
      const err2 = await rejection(
        enqueue('doc-not-allowed', 'sarashina', async () => ({ enabled: true, allowlist: ['other'], autoOnOcr: false }))
      );
      expect(err2.reason).to.equal('not-allowed');
    });

    it('L1=sarashina かつ allowlistに含まれる: 受け付ける', async () => {
      await seed('doc-allowed');
      await enqueue('doc-allowed', 'sarashina', async () => ({ enabled: true, allowlist: ['doc-allowed'], autoOnOcr: false }));
      expect((await get('doc-allowed')).summaryState).to.equal('pending');
    });

    it('L1=gemini(ロールバック運用): L2を読まずに受け付ける', async () => {
      await seed('doc-gemini');
      await enqueue('doc-gemini', 'gemini', async () => {
        throw new Error('L1=geminiではL2を読まないはず');
      });
      expect((await get('doc-gemini')).summaryState).to.equal('pending');
    });

    it('L1=sarashina かつ allowlist=null(制限なし)の場合は、明示的に受け付ける', async () => {
      await seed('doc-allow-null');
      const result = await enqueue('doc-allow-null', 'sarashina', async () => ({ enabled: true, allowlist: null, autoOnOcr: false }));
      expect(result).to.deep.equal({ alreadyQueued: false });
    });

    it('ゲート取得(getGate)が失敗した場合は例外を伝播し、何も書かない(fail-closed)', async () => {
      await seed('doc-gate-fail');
      let caught: unknown;
      try {
        await enqueue('doc-gate-fail', 'sarashina', async () => {
          throw new Error('firestore unavailable');
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
      expect(caught).to.not.be.instanceOf(ManualSummaryRejectedError);
      expect((await get('doc-gate-fail')).summaryState).to.equal(undefined);
    });

    it('オフロード文書(ocrResultUrlあり・detailのocrResultは空)でも受け付ける(登録はOCR本文を読まない)', async () => {
      await seed('doc-offloaded', { ocrResultUrl: 'gs://bucket/ocr-results/doc-offloaded/run-1.txt' });
      const result = await enqueue('doc-offloaded');
      expect(result).to.deep.equal({ alreadyQueued: false });
      expect((await get('doc-offloaded')).summaryState).to.equal('pending');
    });

    it('存在しない書類: not-found', async () => {
      const err = await rejection(enqueue('doc-missing'));
      expect(err.reason).to.equal('not-found');
    });

    it('OCR未完了(status!==processed)の書類: not-processedとして拒否し、何も書かない', async () => {
      await seed('doc-pending-ocr', { status: 'pending' });
      const err = await rejection(enqueue('doc-pending-ocr'));
      expect(err.reason).to.equal('not-processed');
      expect((await get('doc-pending-ocr')).summaryState).to.equal(undefined);
    });
  });
});
