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
import { tryStartProcessing, handleProcessingError } from '../src/ocr/ocrProcessor';
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
