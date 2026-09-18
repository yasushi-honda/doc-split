/**
 * OCR実行所有権ガード integration テスト (Issue #540, Firestore emulator)
 *
 * tryStartProcessing / handleProcessingError はStorage/Gemini副作用を持たないため実関数を
 * そのまま呼び出す。processDocument自体はStorage/Gemini副作用が大きく直接呼べないため
 * (splitPdfIntegration.test.tsと同方針)、最終transaction(confirmed保護マージ書込み前の
 * ownership check)の形を commitFinalWriteLikeProcessDocument() で再現して検証する。
 * grep契約は今回のIssueでは設けず、実transactionの原子性・状態遷移を本ファイルで直接検証する
 * (#622: grep契約だけではvacuous test riskがあるという教訓を踏まえた選択)。
 *
 * 実行: firebase emulators:exec --only firestore --project ocr-run-guard-integration-test \
 *         'npm run test:integration'
 */

// 必ず最初に import: default admin app + emulator host を先行初期化。
import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import {
  tryStartProcessing,
  handleProcessingError,
  checkOcrRunStillOwned,
  OCR_TX_RETRY_ATTEMPTS,
} from '../src/ocr/ocrProcessor';
import { evaluateOcrRunOwnership, OcrRunSupersededError } from '../src/ocr/ocrRunGuard';
import { cleanupCollections } from './helpers/cleanupEmulator';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'errors'];

/**
 * ocrProcessor.ts の processDocument 最終transaction(confirmed保護マージ書込み前の
 * ownership check)の形を再現する。実装と同じ evaluateOcrRunOwnership を使うため、
 * 判定ロジック自体は本番コードと同一のものを検証している。
 */
async function commitFinalWriteLikeProcessDocument(
  docId: string,
  ocrRunId: string,
  expectedFileUrl: string,
  expectedMimeType: string,
  writePayload: FirebaseFirestore.DocumentData
): Promise<void> {
  const docRef = db.collection('documents').doc(docId);
  await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(docRef);
    if (!freshSnap.exists) {
      throw new Error(`Document ${docId} was deleted during OCR processing`);
    }
    const freshData = freshSnap.data()!;
    const ownership = evaluateOcrRunOwnership(freshData, {
      ocrRunId,
      fileUrl: expectedFileUrl,
      mimeType: expectedMimeType,
    });
    if (!ownership.ok) {
      throw new OcrRunSupersededError(`superseded: ${ownership.reason}`, docId, ownership.reason);
    }
    tx.update(docRef, writePayload);
  });
}

describe('OCR実行所有権ガード integration (#540)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('所有権維持時、最終書込みは成功する', async () => {
    const docId = 'doc-ok';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({
      status: 'pending',
      fileUrl: 'gs://bucket/a.pdf',
      mimeType: 'application/pdf',
    });

    const claim = await tryStartProcessing(docId);
    expect(claim, 'claim must succeed for pending doc').to.not.be.null;
    const { ocrRunId, docData } = claim!;

    await commitFinalWriteLikeProcessDocument(
      docId,
      ocrRunId,
      docData.fileUrl as string,
      docData.mimeType as string,
      { status: 'processed', documentType: 'invoice' }
    );

    const after = await docRef.get();
    expect(after.data()!.status).to.equal('processed');
    expect(after.data()!.documentType).to.equal('invoice');
  });

  it('run A claim後、reprocess相当でstatusがpendingに戻りrun Bがclaim・完了した場合、run Aの遅延commitはsupersededとしてrun Bの結果を上書きしない', async () => {
    const docId = 'doc-race';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({
      status: 'pending',
      fileUrl: 'gs://bucket/a.pdf',
      mimeType: 'application/pdf',
    });

    // run A claim
    const claimA = await tryStartProcessing(docId);
    const { ocrRunId: ocrRunIdA, docData: docDataA } = claimA!;

    // FE reprocess相当: OCR実行中にstatusを直接pendingへ戻す
    await docRef.update({ status: 'pending' });

    // run B claim (次のポーリングサイクル相当)
    const claimB = await tryStartProcessing(docId);
    const { ocrRunId: ocrRunIdB, docData: docDataB } = claimB!;
    expect(ocrRunIdB).to.not.equal(ocrRunIdA);

    // run Bが先に完了
    await commitFinalWriteLikeProcessDocument(
      docId,
      ocrRunIdB,
      docDataB.fileUrl as string,
      docDataB.mimeType as string,
      { status: 'processed', documentType: 'run-b-result' }
    );

    // run Aの遅延commit試行 → supersededとしてthrowされ、書込みされない
    let thrown: unknown;
    try {
      await commitFinalWriteLikeProcessDocument(
        docId,
        ocrRunIdA,
        docDataA.fileUrl as string,
        docDataA.mimeType as string,
        { status: 'processed', documentType: 'run-a-stale-result' }
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.be.instanceOf(OcrRunSupersededError);
    expect((thrown as OcrRunSupersededError).reason).to.equal('run-id-mismatch');

    // run Bの結果が保持されている(run Aに上書きされていない)
    const after = await docRef.get();
    expect(after.data()!.documentType).to.equal('run-b-result');
    expect(after.data()!.status).to.equal('processed');
  });

  it('同一ocrRunId・status維持のままfileUrlのみ変化した場合、file-url-driftとしてsupersededされる', async () => {
    const docId = 'doc-drift';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({
      status: 'pending',
      fileUrl: 'gs://bucket/a.pdf',
      mimeType: 'application/pdf',
    });

    const claim = await tryStartProcessing(docId);
    const { ocrRunId, docData } = claim!;

    // rotatePdfPages相当: 処理中にfileUrlが書き換わる(ocrRunId/statusは維持)
    await docRef.update({ fileUrl: 'gs://bucket/a-rotated.pdf' });

    let thrown: unknown;
    try {
      await commitFinalWriteLikeProcessDocument(
        docId,
        ocrRunId,
        docData.fileUrl as string,
        docData.mimeType as string,
        { status: 'processed', documentType: 'stale-orientation-result' }
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.be.instanceOf(OcrRunSupersededError);
    expect((thrown as OcrRunSupersededError).reason).to.equal('file-url-drift');

    // 書込まれず処理中のまま(rescueStuckProcessingDocsの救済対象として残る)
    const after = await docRef.get();
    expect(after.data()!.status).to.equal('processing');
    expect(after.data()!.fileUrl).to.equal('gs://bucket/a-rotated.pdf');
  });

  it('confirmed編集(ocrRunId/status/fileUrl/mimeType不変)はownership checkをpassする(#526 D2回帰確認)', async () => {
    const docId = 'doc-confirmed-edit';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({
      status: 'pending',
      fileUrl: 'gs://bucket/a.pdf',
      mimeType: 'application/pdf',
    });

    const claim = await tryStartProcessing(docId);
    const { ocrRunId, docData } = claim!;

    // ユーザーが処理中にconfirmedフィールドを編集(fileUrl/mimeType/statusは変えない)
    await docRef.update({ customerConfirmed: true, customerName: '田中太郎' });

    await commitFinalWriteLikeProcessDocument(
      docId,
      ocrRunId,
      docData.fileUrl as string,
      docData.mimeType as string,
      { status: 'processed', documentType: 'invoice' }
    );

    // ownership checkがpassし書込みが行われる(confirmed保護マージ自体はapplyConfirmedFieldProtection
    // の責務でありここでは再現しない。ユーザーの編集値が消えていないことのみ確認)
    const after = await docRef.get();
    expect(after.data()!.status).to.equal('processed');
    expect(after.data()!.customerConfirmed).to.equal(true);
    expect(after.data()!.customerName).to.equal('田中太郎');
  });

  it('handleProcessingErrorは所有権不一致時、他runのstatus/retryCountを変更しないが、エラー自体はerrors/に記録する', async () => {
    const docId = 'doc-error-race';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({
      status: 'pending',
      fileUrl: 'gs://bucket/a.pdf',
      mimeType: 'application/pdf',
    });

    // run A claim
    const claimA = await tryStartProcessing(docId);
    const { ocrRunId: ocrRunIdA } = claimA!;

    // reprocess相当でpendingに戻り、run Bがclaim
    await docRef.update({ status: 'pending' });
    const claimB = await tryStartProcessing(docId);
    const { ocrRunId: ocrRunIdB } = claimB!;

    // run A (既にsupersededされているのを知らずに)エラーハンドリングを試みる
    await handleProcessingError(docId, new Error('run A stale error'), 'test', ocrRunIdA);

    // run Bの状態が壊れていないこと(status維持・ocrRunId維持・retryCount未消費)
    const after = await docRef.get();
    expect(after.data()!.status).to.equal('processing');
    expect(after.data()!.ocrRunId).to.equal(ocrRunIdB);
    expect(after.data()!.retryCount).to.be.undefined;

    // run Aのエラー自体はerrors/に記録される(/review-pr silent-failure-hunter指摘反映:
    // 所有権喪失は状態更新を止める理由にはなっても、エラー自体が所有権と無関係な本物の
    // 障害である可能性があるため観測性まで止めてはならない)
    const errors = await db.collection('errors').get();
    expect(errors.empty, '所有権喪失時もエラー自体は errors/ に記録される').to.equal(false);
  });

  it('handleProcessingErrorは所有権維持時、従来通りretryCount/statusを更新する', async () => {
    const docId = 'doc-error-normal';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({
      status: 'pending',
      fileUrl: 'gs://bucket/a.pdf',
      mimeType: 'application/pdf',
    });

    const claim = await tryStartProcessing(docId);
    const { ocrRunId } = claim!;

    await handleProcessingError(docId, new Error('non-transient failure'), 'test', ocrRunId);

    const after = await docRef.get();
    expect(after.data()!.status).to.equal('error');
    expect(after.data()!.retryCount).to.equal(1);

    const errors = await db.collection('errors').get();
    expect(errors.empty, '所有権維持時は従来通りerrors/に記録される').to.equal(false);
  });

  it('handleProcessingErrorはドキュメント削除時、supersededと混同せずerrors/に記録する(/code-review high 指摘の回帰防止)', async () => {
    const docId = 'doc-error-deleted';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({
      status: 'pending',
      fileUrl: 'gs://bucket/a.pdf',
      mimeType: 'application/pdf',
    });

    const claim = await tryStartProcessing(docId);
    const { ocrRunId } = claim!;

    // OCR処理中にドキュメントが削除される
    await docRef.delete();

    await handleProcessingError(
      docId,
      new Error(`Document ${docId} was deleted during OCR processing`),
      'test',
      ocrRunId
    );

    // ドキュメントは再作成されない(更新対象がないため)
    const after = await docRef.get();
    expect(after.exists, '削除済みドキュメントを誤って再作成しない').to.equal(false);

    // 削除エラー自体はsupersededと違いerrors/に記録される(観測性の回帰防止)
    const errors = await db.collection('errors').get();
    expect(errors.empty, 'ドキュメント削除エラーはerrors/に記録されるべき').to.equal(false);
  });
});

describe('handleProcessingError (Issue #957: runTransaction自体の一時的失敗をwithBackoffRetryで防御)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  /**
   * handleProcessingError()はdbをパラメータで受け取らずモジュール直下の`db`
   * (`admin.firestore()`のデフォルトapp singleton)を直接使うため、
   * applyOcrCompletionTransactionのようにfake firestoreをinjectできない。
   * rescueStuckProcessingIntegration.test.ts #364のwithFailingRunTransactionと
   * 同方針(sinon依存を追加しないpolyfill)で、db.runTransaction自体を一時差し替えて
   * 呼び出し回数・失敗回数を制御する。try/finallyで原値復元を保証する。
   */
  async function withCountingFailingRunTransaction<T>(
    failCallIndices: readonly number[],
    errorCode: number,
    fn: () => Promise<T>
  ): Promise<{ result: T; callCount: number }> {
    const original = db.runTransaction.bind(db);
    let callCount = 0;
    (db as unknown as { runTransaction: unknown }).runTransaction = async (
      updateFn: (tx: admin.firestore.Transaction) => Promise<unknown>
    ) => {
      callCount++;
      if (failCallIndices.includes(callCount)) {
        const err = new Error(`simulated runTransaction failure (call #${callCount})`) as Error & {
          code: number;
        };
        err.code = errorCode;
        throw err;
      }
      return original(updateFn);
    };
    try {
      const result = await fn();
      return { result, callCount };
    } finally {
      (db as unknown as { runTransaction: typeof original }).runTransaction = original;
    }
  }

  it('1回だけtransientエラー(code 14)で失敗しても2回目でリトライ成功し、retryCountが二重加算されずstatus:errorが確定する', async () => {
    const docId = 'doc-957-handle-retry-success';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({ status: 'pending', fileUrl: 'gs://bucket/a.pdf', mimeType: 'application/pdf' });
    const claim = await tryStartProcessing(docId);
    const { ocrRunId } = claim!;

    const { callCount } = await withCountingFailingRunTransaction([1], 14, () =>
      handleProcessingError(docId, new Error('non-transient failure'), 'test', ocrRunId)
    );

    expect(callCount, 'リトライにより2回呼ばれるはず').to.equal(2);
    const after = await docRef.get();
    expect(after.data()!.status).to.equal('error');
    // fable-reviewセカンドオピニオン指摘M3: 本テストの合成失敗(withCountingFailingRunTransaction)は
    // 失敗させる回のtransaction body自体を一切実行せずreal dbへ委譲する前にthrowするため、
    // 「bodyが2回実行されても結果が壊れない」という一般的な冪等性の証明にはならない(過大な主張を
    // していた)。本テストが実際に証明しているのは「1回失敗しても最終的にretryCountは1回分しか
    // 加算されない」という、この合成失敗パターン特有の(弱いが正確な)性質のみ。より一般的な
    // 「commitは成功したがクライアントには失敗として返る(ambiguous commit)」ケース、すなわち
    // bodyが実際に2回実行されるケースの冪等性検証は別途必要(driveFolderClaimIntegration.test.ts
    // の「B. ambiguous commit」相当、未実装)。
    expect(after.data()!.retryCount, 'リトライ中の失敗試行(body未実行)ではretryCountが加算されないこと').to.equal(1);
  });

  it(`全attempts(OCR_TX_RETRY_ATTEMPTS=${OCR_TX_RETRY_ATTEMPTS})失敗しても、既存fallback(非transactional docRef.update)でstatus:errorが確定する`, async () => {
    const docId = 'doc-957-handle-retry-exhausted';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({ status: 'pending', fileUrl: 'gs://bucket/a.pdf', mimeType: 'application/pdf' });
    const claim = await tryStartProcessing(docId);
    const { ocrRunId } = claim!;

    const { callCount } = await withCountingFailingRunTransaction(
      Array.from({ length: OCR_TX_RETRY_ATTEMPTS }, (_, i) => i + 1),
      14,
      () => handleProcessingError(docId, new Error('non-transient failure'), 'test', ocrRunId)
    );

    expect(callCount, `${OCR_TX_RETRY_ATTEMPTS}回とも失敗するはず`).to.equal(OCR_TX_RETRY_ATTEMPTS);
    // transaction全滅後はcatch(updateErr)内の既存fallback(非transactional docRef.update)が
    // 発火し、status:errorが確定する(Issue #540 H2のfallback、本変更で新設したものではない)。
    const after = await docRef.get();
    expect(after.data()!.status).to.equal('error');
    // pr-test-analyzerセカンドオピニオン指摘: 既存fallback(docRef.update)はretryCountフィールドを
    // 含まない(コード上明記、functions/src/ocr/ocrProcessor.ts catch(updateErr)節)。この「本経路の
    // 成功時とは異なりretryCountを更新しない」という非自明な仕様を直接lock-inする。
    expect(after.data()!.retryCount, 'fallback経路はretryCountを更新しない(本経路のtx成功時とは非対称)').to.be
      .undefined;
  });

  it('transientな業務エラー(429以外、例: timeout)がFirestore層の一時的失敗と組み合わさっても、リトライ成功後は正しくstatus:pendingへ遷移する(pr-test-analyzerセカンドオピニオン指摘: transient/non-transient × outer-retryの組合せ未検証だった)', async () => {
    const docId = 'doc-957-handle-transient-business-error-with-retry';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({ status: 'pending', fileUrl: 'gs://bucket/a.pdf', mimeType: 'application/pdf' });
    const claim = await tryStartProcessing(docId);
    const { ocrRunId } = claim!;

    const { callCount } = await withCountingFailingRunTransaction([1], 14, () =>
      handleProcessingError(
        docId,
        new Error('Request timeout - exception posting request to model'),
        'test',
        ocrRunId
      )
    );

    expect(callCount, 'Firestore層は1回だけ失敗しリトライで2回呼ばれるはず').to.equal(2);
    const after = await docRef.get();
    // isTransientError(業務エラー側の分類)がtrueのため、外側リトライ成功後は
    // 従来通りstatus:pending(自動リトライ待ち)に遷移する(status:error確定ではない)。
    expect(after.data()!.status, 'transientな業務エラーはリトライ成功後もpendingへ遷移するはず').to.equal(
      'pending'
    );
    expect(after.data()!.retryCount).to.equal(1);
    expect(after.data()!.retryAfter, 'transient分岐ではretryAfterが設定される').to.exist;
  });

  it('非transientコード(例: 7=PERMISSION_DENIED)は1回で諦めリトライされない', async () => {
    const docId = 'doc-957-handle-non-retryable';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({ status: 'pending', fileUrl: 'gs://bucket/a.pdf', mimeType: 'application/pdf' });
    const claim = await tryStartProcessing(docId);
    const { ocrRunId } = claim!;

    const { callCount } = await withCountingFailingRunTransaction([1], 7, () =>
      handleProcessingError(docId, new Error('non-transient failure'), 'test', ocrRunId)
    );

    expect(callCount, '非transientは即座に諦めるため1回のみ').to.equal(1);
    // フォールバックにより最終的な状態はリトライ成功時と同じ(status:error)になるが、
    // 重要なのは無駄なリトライをしていないこと(callCount===1)。
    const after = await docRef.get();
    expect(after.data()!.status).to.equal('error');
  });
});

describe('checkOcrRunStillOwned: PDFページOCRループの早期所有権チェック (Issue #626)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('所有権が維持されている場合 { ok: true } を返す', async () => {
    const docId = 'doc-early-check-ok';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({
      status: 'pending',
      fileUrl: 'gs://bucket/a.pdf',
      mimeType: 'application/pdf',
    });
    const claim = await tryStartProcessing(docId);
    const { ocrRunId, docData } = claim!;

    const result = await checkOcrRunStillOwned(
      docRef,
      { ocrRunId, fileUrl: docData.fileUrl as string, mimeType: docData.mimeType as string },
      docId,
      'test'
    );

    expect(result).to.deep.equal({ ok: true });
  });

  it('reprocess等で別runにclaimし直された場合 run-id-mismatch を返す', async () => {
    const docId = 'doc-early-check-superseded';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({
      status: 'pending',
      fileUrl: 'gs://bucket/a.pdf',
      mimeType: 'application/pdf',
    });
    const claimA = await tryStartProcessing(docId);
    const { ocrRunId: ocrRunIdA, docData: docDataA } = claimA!;

    // run Aのページループ処理中に、reprocess相当でrun Bがclaimする
    await docRef.update({ status: 'pending' });
    await tryStartProcessing(docId);

    const result = await checkOcrRunStillOwned(
      docRef,
      {
        ocrRunId: ocrRunIdA,
        fileUrl: docDataA.fileUrl as string,
        mimeType: docDataA.mimeType as string,
      },
      docId,
      'test'
    );

    expect(result).to.deep.equal({ ok: false, reason: 'run-id-mismatch' });
  });

  it('ドキュメントが処理中に削除された場合 run-id-mismatch を返す(ocrRunIdがundefinedになるため)', async () => {
    const docId = 'doc-early-check-deleted';
    const docRef = db.collection('documents').doc(docId);
    await docRef.set({
      status: 'pending',
      fileUrl: 'gs://bucket/a.pdf',
      mimeType: 'application/pdf',
    });
    const claim = await tryStartProcessing(docId);
    const { ocrRunId, docData } = claim!;

    await docRef.delete();

    const result = await checkOcrRunStillOwned(
      docRef,
      { ocrRunId, fileUrl: docData.fileUrl as string, mimeType: docData.mimeType as string },
      docId,
      'test'
    );

    expect(result).to.deep.equal({ ok: false, reason: 'run-id-mismatch' });
  });

  it('Firestore read自体が失敗した場合、false positiveを避けるため { ok: true } (継続) を返す', async () => {
    const docId = 'doc-early-check-read-failure';
    // docRef.get()自体がrejectするモック(admin appの初期化に依存しない純粋な差し替え)。
    // 実運用のdocRefと同じshapeを満たせばよいため、テスト目的でキャストする。
    const failingDocRef = {
      get: () => Promise.reject(new Error('simulated transient Firestore read failure')),
    } as unknown as FirebaseFirestore.DocumentReference;

    const result = await checkOcrRunStillOwned(
      failingDocRef,
      { ocrRunId: 'run-x', fileUrl: 'gs://bucket/a.pdf', mimeType: 'application/pdf' },
      docId,
      'test'
    );

    expect(result).to.deep.equal({ ok: true });
  });
});
