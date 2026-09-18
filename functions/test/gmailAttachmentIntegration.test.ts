/**
 * checkGmailAttachments 統合テスト (Firebase emulator) - Issue #200 AC1/AC4
 *
 * PR #199 (Gmail 重複取得の根本対策) で導入された:
 *   - messageId based 早期 skip (gmailLogs collection)
 *   - isSplitSource=true の場合の再取り込み許可ロジック (documents collection)
 * を Firestore 実クエリで検証する。
 *
 * 方式 (Issue #375 以降): 判定ロジック本体は pure helper
 *   `src/gmail/reimportPolicy.ts` の evaluateReimportDecision に集約され、
 *   production (checkGmailAttachments.ts) と本 integration test で共有される。
 *   本テストは helper を呼び出すための Firestore query パターンを検証する位置づけ。
 *   helper 単体の分岐は `reimportPolicy.test.ts` で unit test 済み。
 *
 * 実行: firebase emulators:exec --only firestore --project gmail-attachment-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import {
  evaluateReimportDecision,
  resolveExistingLogData,
  type ReimportVerdict,
} from '../src/gmail/reimportPolicy';
import { createGmailAttachmentRecords } from '../src/gmail/checkGmailAttachments';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['gmailLogs', 'documents', 'uploadLogs'];

// checkGmailAttachments.ts の messageId skip ロジックを再現
async function isAlreadyProcessedByMessageId(messageId: string): Promise<boolean> {
  const existing = await db
    .collection('gmailLogs')
    .where('messageId', '==', messageId)
    .limit(1)
    .get();
  return !existing.empty;
}

/**
 * integration test 専用の I/O wrapper: Firestore query パターンを production と
 * 独立に実装し、判定ロジック本体は helper `evaluateReimportDecision` に委譲する。
 *
 * 設計意図 (Issue #375):
 *   - 判定分岐は production と同じ helper を経由するため、分岐ロジック drift は
 *     helper unit test (reimportPolicy.test.ts) と本 integration test の両方で検知
 *   - Firestore query pattern (collection 名・where 条件・gmailLogs 優先) は
 *     production (checkGmailAttachments.ts) と本 wrapper で**独立に**実装することで、
 *     production 側 query の structural drift を integration test で検知できる
 *   - 優先順位ロジック自体は helper の `resolveExistingLogData` を共有するため、
 *     「gmailLogs 優先」の 3 重管理 (production / helper 内部 / test) を回避
 */
async function queryAndEvaluateReimport(hash: string): Promise<ReimportVerdict> {
  const [existingGmailLog, existingUploadLog] = await Promise.all([
    db.collection('gmailLogs').where('hash', '==', hash).limit(1).get(),
    db.collection('uploadLogs').where('hash', '==', hash).limit(1).get(),
  ]);

  const existingGmailLogData = existingGmailLog.empty
    ? null
    : (existingGmailLog.docs[0].data() as { fileUrl?: string });
  const existingUploadLogData = existingUploadLog.empty
    ? null
    : (existingUploadLog.docs[0].data() as { fileUrl?: string });

  const existingFileUrl =
    resolveExistingLogData(existingGmailLogData, existingUploadLogData)?.fileUrl ?? null;

  let relatedDocsData: Array<{ isSplitSource?: boolean }> = [];
  if (existingFileUrl) {
    const relatedDocs = await db
      .collection('documents')
      .where('fileUrl', '==', existingFileUrl)
      .get();
    relatedDocsData = relatedDocs.docs.map(
      (d) => d.data() as { isSplitSource?: boolean },
    );
  }

  return evaluateReimportDecision({
    existingGmailLogData,
    existingUploadLogData,
    relatedDocsData,
  }).verdict;
}

describe('checkGmailAttachments 統合テスト (#200)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  describe('AC1: messageId based 早期 skip', () => {
    it('既存 gmailLog あり (同一 messageId) → skip=true', async () => {
      const messageId = 'msg-duplicate-001';
      await db.collection('gmailLogs').add({
        messageId,
        fileName: 'existing.pdf',
        hash: 'hash-abc',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const skip = await isAlreadyProcessedByMessageId(messageId);
      expect(skip).to.equal(true);
    });

    it('既存 gmailLog なし (新規 messageId) → skip=false', async () => {
      const skip = await isAlreadyProcessedByMessageId('msg-new-001');
      expect(skip).to.equal(false);
    });

    it('異なる messageId が混在 → 対象の messageId のみ skip', async () => {
      await db.collection('gmailLogs').add({
        messageId: 'msg-existing-A',
        fileName: 'a.pdf',
        hash: 'hash-a',
      });
      await db.collection('gmailLogs').add({
        messageId: 'msg-existing-B',
        fileName: 'b.pdf',
        hash: 'hash-b',
      });

      const skipA = await isAlreadyProcessedByMessageId('msg-existing-A');
      const skipB = await isAlreadyProcessedByMessageId('msg-existing-B');
      const skipC = await isAlreadyProcessedByMessageId('msg-new-C');

      expect(skipA).to.equal(true);
      expect(skipB).to.equal(true);
      expect(skipC).to.equal(false);
    });
  });

  describe('AC4: isSplitSource=true 再取り込み許可', () => {
    it('関連 documents が全て isSplitSource=true → 再取り込み許可 (reimport)', async () => {
      const hash = 'hash-split-all';
      const fileUrl = 'gs://bucket/original/1700000000_all-split.pdf';

      await db.collection('gmailLogs').add({
        messageId: 'msg-A',
        fileName: 'all-split.pdf',
        hash,
        fileUrl,
      });
      await db.collection('documents').add({
        fileUrl,
        isSplitSource: true,
        status: 'split',
      });
      await db.collection('documents').add({
        fileUrl,
        isSplitSource: true,
        status: 'split',
      });

      const verdict = await queryAndEvaluateReimport(hash);
      expect(verdict).to.equal('reimport');
    });

    it('関連 documents にアクティブ (isSplitSource=false or 未設定) あり → skip', async () => {
      const hash = 'hash-mixed';
      const fileUrl = 'gs://bucket/original/1700000000_mixed.pdf';

      await db.collection('gmailLogs').add({
        messageId: 'msg-B',
        fileName: 'mixed.pdf',
        hash,
        fileUrl,
      });
      // 1件はアクティブ (isSplitSource 未設定)
      await db.collection('documents').add({
        fileUrl,
        status: 'processed',
      });
      // もう1件は分割元
      await db.collection('documents').add({
        fileUrl,
        isSplitSource: true,
        status: 'split',
      });

      const verdict = await queryAndEvaluateReimport(hash);
      expect(verdict).to.equal('skip');
    });

    it('関連 documents が 1 件も存在しない + fileUrl あり → 再取り込み許可', async () => {
      // hasActiveDocs は some() なので、空配列では false を返す。
      // 既存 fileUrl に紐づくドキュメントが 1 件もない状態 = 全削除後などは reimport。
      const hash = 'hash-no-docs';
      const fileUrl = 'gs://bucket/original/1700000000_no-docs.pdf';

      await db.collection('gmailLogs').add({
        messageId: 'msg-C',
        fileName: 'no-docs.pdf',
        hash,
        fileUrl,
      });

      const verdict = await queryAndEvaluateReimport(hash);
      expect(verdict).to.equal('reimport');
    });

    it('既存 log に fileUrl が欠損 → 従来通り skip (後方互換性)', async () => {
      const hash = 'hash-no-fileurl';
      await db.collection('gmailLogs').add({
        messageId: 'msg-D',
        fileName: 'legacy.pdf',
        hash,
        // fileUrl 未設定 (古いレコード想定)
      });

      const verdict = await queryAndEvaluateReimport(hash);
      expect(verdict).to.equal('skip');
    });

    it('hash 一致がない → new (新規処理)', async () => {
      const verdict = await queryAndEvaluateReimport('hash-unknown');
      expect(verdict).to.equal('new');
    });

    it('uploadLogs 側の hash 一致でも同じ判定', async () => {
      const hash = 'hash-uploadlogs';
      const fileUrl = 'gs://bucket/uploaded/file.pdf';

      await db.collection('uploadLogs').add({
        fileName: 'uploaded.pdf',
        hash,
        fileUrl,
      });
      await db.collection('documents').add({
        fileUrl,
        status: 'processed',
      });

      const verdict = await queryAndEvaluateReimport(hash);
      expect(verdict).to.equal('skip');
    });
  });
});

describe('createGmailAttachmentRecords (Issue #958: runTransaction自体の一時的失敗をwithBackoffRetryで防御)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  /**
   * runTransactionだけを差し替えたfirestoreラッパ。failTxCallIndices回目のtxは実dbへ
   * 委譲せず合成エラーを投げる。driveFolderClaimIntegration.test.ts/
   * ocrCompletionTransactionIntegration.test.tsのmakeFailingCommitFirestoreと同方針
   * (Issue #954で確立済みのテストパターン)。code-reviewer/pr-test-analyzerセカンドオピニオン
   * 指摘(Issue #958、PR #964): checkGmailAttachments.ts側のwithBackoffRetryにリトライ注入
   * テストが1件もなかったため、transaction部分を`createGmailAttachmentRecords`として
   * db注入可能な形にexportし、Gmail API/Storageのモック基盤なしでこのtransaction単体の
   * リトライ挙動を直接検証できるようにした。
   */
  function makeFailingCommitFirestore(
    realDb: admin.firestore.Firestore,
    failTxCallIndices: readonly number[],
    errorCode = 14
  ): { firestore: admin.firestore.Firestore; getTxCallCount: () => number } {
    let txCalls = 0;
    const firestore = {
      collection: (path: string) => realDb.collection(path),
      doc: (path: string) => realDb.doc(path),
      runTransaction: async (updateFn: (tx: admin.firestore.Transaction) => Promise<unknown>) => {
        txCalls++;
        if (failTxCallIndices.includes(txCalls)) {
          const err = new Error(`simulated Firestore transaction failure (call #${txCalls})`) as Error & {
            code: number;
          };
          err.code = errorCode;
          throw err;
        }
        return realDb.runTransaction(updateFn);
      },
    } as unknown as admin.firestore.Firestore;
    return { firestore, getTxCallCount: () => txCalls };
  }

  const FIELDS = {
    messageId: 'msg-958',
    filename: 'invoice.pdf',
    hash: 'hash-958',
    fileSizeKB: 123,
    subject: 'テスト件名',
    fileUrl: 'gs://bucket/original/1234_invoice.pdf',
    emailBody: '本文',
    mimeType: 'application/pdf',
  };

  it('1回だけtransientエラー(code 14)で失敗しても2回目でリトライ成功し、gmailLogs/documents/detail/mainが作成される', async () => {
    const logRef = db.collection('gmailLogs').doc();
    const docRef = db.collection('documents').doc();
    const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(db, [1]);

    await createGmailAttachmentRecords(failingDb, logRef, docRef, FIELDS);

    expect(getTxCallCount(), 'リトライにより2回呼ばれるはず').to.equal(2);
    const logSnap = await logRef.get();
    expect(logSnap.exists, 'gmailLogsが作成されること').to.equal(true);
    expect(logSnap.data()?.messageId).to.equal(FIELDS.messageId);
    const docSnap = await docRef.get();
    expect(docSnap.exists, 'documentsが作成されること').to.equal(true);
    expect(docSnap.data()?.status).to.equal('pending');
    const detailSnap = await docRef.collection('detail').doc('main').get();
    expect(detailSnap.exists, 'detail/mainが作成されること').to.equal(true);
  });

  it('全attempts失敗すると、gmailLogs/documents共に作成されないままエラーがthrowされる', async () => {
    const logRef = db.collection('gmailLogs').doc();
    const docRef = db.collection('documents').doc();
    const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(db, [1, 2, 3]);

    try {
      await createGmailAttachmentRecords(failingDb, logRef, docRef, FIELDS);
      expect.fail('全attempts失敗時はthrowされるはず');
    } catch (error) {
      expect((error as Error).message).to.include('simulated Firestore transaction failure');
    }
    expect(getTxCallCount(), '3回とも失敗するはず').to.equal(3);

    expect((await logRef.get()).exists, 'transaction全滅時はgmailLogsが作成されないこと').to.equal(false);
    expect((await docRef.get()).exists, 'transaction全滅時はdocumentsが作成されないこと').to.equal(false);
  });

  it('非transientコード(例: 7=PERMISSION_DENIED)は1回で諦めリトライされない', async () => {
    const logRef = db.collection('gmailLogs').doc();
    const docRef = db.collection('documents').doc();
    const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(db, [1], 7);

    try {
      await createGmailAttachmentRecords(failingDb, logRef, docRef, FIELDS);
      expect.fail('非transientエラーはリトライされずthrowされるはず');
    } catch (error) {
      expect((error as Error).message).to.include('simulated Firestore transaction failure');
    }
    expect(getTxCallCount(), '非transientは即座に諦めるため1回のみ').to.equal(1);
  });

  it('logRefが既に存在する場合(ambiguous commit後の再試行を想定)、docRefへの書込みをスキップし他の書き手の変更を巻き戻さない(fable-reviewセカンドオピニオン指摘M1の回帰防止)', async () => {
    const logRef = db.collection('gmailLogs').doc();
    const docRef = db.collection('documents').doc();

    // 1回目のcommitが既に成功した状態を再現(gmailLogs作成済み)。
    await logRef.set({
      messageId: FIELDS.messageId,
      fileName: FIELDS.filename,
      hash: FIELDS.hash,
      fileSizeKB: FIELDS.fileSizeKB,
      emailSubject: FIELDS.subject,
      fileUrl: FIELDS.fileUrl,
      emailBody: FIELDS.emailBody,
    });
    // その後processOCRのcronが先にclaimした状態を再現。
    await docRef.set({ status: 'processing', ocrRunId: 'cron-claimed-run-id', messageId: FIELDS.messageId });

    await createGmailAttachmentRecords(db, logRef, docRef, FIELDS);

    const docSnap = await docRef.get();
    expect(docSnap.data()?.status, '他の書き手(cron)によるstatus:processingを巻き戻さないこと').to.equal(
      'processing'
    );
    expect(docSnap.data()?.ocrRunId, '他の書き手のocrRunIdを消さないこと').to.equal('cron-claimed-run-id');
  });
});
