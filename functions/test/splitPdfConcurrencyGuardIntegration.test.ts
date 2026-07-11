/**
 * splitPdf 二重split race防止 integration テスト (Issue #539, Firestore emulator)
 *
 * pdfOperations.ts の splitPdf T4 (Firestore atomic batch write) に追加した
 * lastUpdateTime precondition が、実際の Firestore emulator 上で意図通り機能するかを検証する。
 * splitPdf 自体は pdf-lib / Storage 副作用が大きく直接呼べないため
 * (splitPdfIntegration.test.ts と同方針)、T4 の書込み形 (batch.update(docRef, payload,
 * { lastUpdateTime })) を再現して検証する。grep contract は
 * splitPdfConcurrencyGuardContract.test.ts 側で実装配線を保護する。
 *
 * 実行: firebase emulators:exec --only firestore --project split-pdf-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents'];

// splitPdf T4 の親doc更新 (pdfOperations.ts: batch.update(docRef, payload, { lastUpdateTime }))
// と同等の書き込みを再現する。
async function commitSplitLikeParentUpdate(
  docRef: admin.firestore.DocumentReference,
  createdDocIds: string[],
  lastUpdateTime: admin.firestore.Timestamp
): Promise<void> {
  const batch = db.batch();
  batch.update(
    docRef,
    { splitInto: createdDocIds, status: 'split', isSplitSource: true },
    { lastUpdateTime }
  );
  await batch.commit();
}

describe('splitPdf 二重split race防止 integration (#539)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('drift無し(読取り後に親docが変更されていない)場合、precondition付きbatch.commitは成功する', async () => {
    const docRef = db.collection('documents').doc();
    await docRef.set({ fileName: 'a.pdf', status: 'processed' });

    const snap = await docRef.get();
    await commitSplitLikeParentUpdate(docRef, ['child-A'], snap.updateTime!);

    const after = await docRef.get();
    expect(after.data()!.status).to.equal('split');
    expect(after.data()!.splitInto).to.deep.equal(['child-A']);
  });

  it('drift有り(読取り後に他プロセスが親docを更新済み)の場合、precondition付きbatch.commitはFAILED_PRECONDITIONで失敗する', async () => {
    const docRef = db.collection('documents').doc();
    await docRef.set({ fileName: 'a.pdf', status: 'processed' });

    // 2並行呼出しを模す: 両方とも同じ古いsnapshotのupdateTimeを保持
    const staleSnap = await docRef.get();
    const staleUpdateTime = staleSnap.updateTime!;

    // 1つ目のリクエストが先にsplitを完了させる (親docのupdateTimeが進む)
    await commitSplitLikeParentUpdate(docRef, ['child-A'], staleUpdateTime);

    // 2つ目のリクエストは古いupdateTimeのままcommitしようとして失敗するべき
    let thrown: unknown;
    try {
      await commitSplitLikeParentUpdate(docRef, ['child-B'], staleUpdateTime);
    } catch (err) {
      thrown = err;
    }
    expect(thrown, 'second concurrent commit must throw').to.not.be.undefined;

    // pdfOperations.ts の isPreconditionFailure 判定ロジックと同一条件で検証
    // (実装と同じ3系統OR: gRPC数値code / Cloud Functions文字列code / message fallback)
    const errCode =
      thrown instanceof Error && 'code' in thrown
        ? (thrown as { code: number | string }).code
        : undefined;
    const errMessage = thrown instanceof Error ? thrown.message : String(thrown);
    const isPreconditionFailure =
      errCode === 9 ||
      errCode === 5 ||
      errCode === 'failed-precondition' ||
      errCode === 'not-found' ||
      /FAILED_PRECONDITION|NOT_FOUND|precondition|no document to update/i.test(errMessage);
    expect(
      isPreconditionFailure,
      `expected precondition failure, got code=${errCode} message=${errMessage}`
    ).to.equal(true);

    // 親docは1つ目のリクエストの結果のまま (2つ目の上書きが発生していないこと)
    const after = await docRef.get();
    expect(after.data()!.splitInto).to.deep.equal(['child-A']);
  });

  it('早期拒否をすり抜けたrace windowでも、T4のprecondition側で最終的に守られる', async () => {
    // 早期拒否(docData.status==='split'チェック)はrace window(両方が旧statusを読む場合)を
    // すり抜けうる。その場合でもT4のprecondition側で片方は必ず拒否されることを検証する。
    const docRef = db.collection('documents').doc();
    await docRef.set({ fileName: 'a.pdf', status: 'processed' });
    const staleSnap = await docRef.get();

    await commitSplitLikeParentUpdate(docRef, ['child-A'], staleSnap.updateTime!);

    let thrown = false;
    try {
      await commitSplitLikeParentUpdate(docRef, ['child-B'], staleSnap.updateTime!);
    } catch {
      thrown = true;
    }
    expect(thrown).to.equal(true);
  });
});

// pdfOperations.ts の recheckParentBeforeRetry (Issue #539 fix) と同等のロジックを再現する。
// source-drift retry の backoff 直後にこれを呼び、startUpdateTime を最新化することで
// 「retry中に発生した二重split以外の正当な同時更新」を誤ってabortしなくなることを検証する。
async function recheckParentLikeSplitPdf(
  docRef: admin.firestore.DocumentReference,
  documentId: string
): Promise<admin.firestore.Timestamp> {
  const snap = await docRef.get();
  if (!snap.exists) {
    throw Object.assign(new Error(`Document ${documentId} was deleted during splitPdf retry`), {
      code: 'not-found',
    });
  }
  const data = snap.data()!;
  if (data.status === 'split') {
    throw Object.assign(
      new Error(`Document ${documentId} has already been split (status='split') (detected during retry)`),
      { code: 'already-exists' }
    );
  }
  const updateTime = snap.updateTime;
  if (!updateTime) {
    throw Object.assign(new Error('Document has no updateTime'), {
      code: 'failed-precondition',
    });
  }
  return updateTime;
}

describe('splitPdf drift-retry前の親doc再チェック (Issue #539 fix: stale startUpdateTime誤検知防止)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('retry中に二重splitとは無関係な正当な更新(reprocess等)が入っても、再チェック後のupdateTimeでbatch.commitは成功する', async () => {
    const docRef = db.collection('documents').doc();
    await docRef.set({ fileName: 'a.pdf', status: 'processed' });
    const staleUpdateTime = (await docRef.get()).updateTime!;

    // source-drift retryのbackoff window中に、reprocess等の無関係な正当な操作が親docを更新する想定
    await docRef.update({ status: 'processed', reprocessedAt: 'dummy' });

    // 修正前: staleUpdateTimeのままcommitしようとしてFAILED_PRECONDITIONで誤ってabortしていた
    let thrownWithStale = false;
    try {
      await commitSplitLikeParentUpdate(docRef, ['child-A'], staleUpdateTime);
    } catch {
      thrownWithStale = true;
    }
    expect(thrownWithStale, 'stale updateTimeでは誤ってprecondition失敗するはず(修正前の再現)').to.equal(
      true
    );

    // 修正後: retry前にrecheckParentBeforeRetry相当で再取得したupdateTimeを使えば成功する
    const refreshedUpdateTime = await recheckParentLikeSplitPdf(docRef, docRef.id);
    await commitSplitLikeParentUpdate(docRef, ['child-A'], refreshedUpdateTime);

    const after = await docRef.get();
    expect(after.data()!.status).to.equal('split');
    expect(after.data()!.splitInto).to.deep.equal(['child-A']);
  });

  it('retry前の再チェック時に既にstatus=split済みなら already-exists で即座に拒否する(無駄な再試行を避ける)', async () => {
    const docRef = db.collection('documents').doc();
    await docRef.set({ fileName: 'a.pdf', status: 'processed' });

    // 他プロセスが既に本物のsplitを完了させた状態
    await docRef.update({ status: 'split', splitInto: ['child-X'], isSplitSource: true });

    let thrownCode: unknown;
    try {
      await recheckParentLikeSplitPdf(docRef, docRef.id);
    } catch (err) {
      thrownCode = (err as { code?: unknown }).code;
    }
    expect(thrownCode).to.equal('already-exists');
  });

  it('retry前の再チェック時に親docが削除されていたら not-found で拒否する', async () => {
    const docRef = db.collection('documents').doc();
    await docRef.set({ fileName: 'a.pdf', status: 'processed' });
    await docRef.delete();

    let thrownCode: unknown;
    try {
      await recheckParentLikeSplitPdf(docRef, docRef.id);
    } catch (err) {
      thrownCode = (err as { code?: unknown }).code;
    }
    expect(thrownCode).to.equal('not-found');
  });
});
