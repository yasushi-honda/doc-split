/**
 * `functions/src/drive/executeDriveExport.ts` 統合テスト(ADR-0022, Firestore emulator)
 *
 * code-review CONFIRMED指摘対応(所有権トークンによる並行実行保護)の回帰テスト。
 * `driveExportScheduled.ts`が長時間'exporting'のdocを再クレームした場合、2つの
 * `executeDriveExport()`実行が並走しうる。後から完了した(=古い)実行の書戻しが、
 * 先に完了し確定済みの新しい実行の状態を上書きしないことを検証する。
 *
 * 決定的な検証のため、`downloadFile`をブロック用のPromiseで制御し、実行順序を
 * テストコードから明示的に制御する。
 *
 * 実行: firebase emulators:exec --only firestore --project execute-drive-export-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { drive_v3 } from 'googleapis';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { executeDriveExport } from '../src/drive/executeDriveExport';
import { MASTER_PATHS } from '../src/utils/masterPaths';
import type { DriveFolderTemplate } from '../../shared/types';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'settings', MASTER_PATHS.customers];

const TEMPLATE: DriveFolderTemplate = [{ type: 'fixed', value: '事業所A' }];

interface FakeFile {
  id: string;
  name: string;
}

function makeFakeDrive(opts: { createdIds?: string[] } = {}) {
  let createIndex = 0;
  const createCalls: Record<string, unknown>[] = [];
  const drive = {
    files: {
      list: async () => ({ data: { files: [] as FakeFile[] } }),
      create: async (params: Record<string, unknown>) => {
        createCalls.push(params);
        const id = opts.createdIds?.[createIndex] ?? `created-${createIndex}`;
        createIndex++;
        return { data: { id } };
      },
    },
  } as unknown as drive_v3.Drive;
  return { drive, createCalls };
}

function makeDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** `driveExportRunId`が最初にセットされるまでポーリングで待機する(claimトランザクション完了を待つ)。 */
async function waitForRunIdClaim(docId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const snap = await db.doc(`documents/${docId}`).get();
    if (snap.data()?.driveExportRunId) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`driveExportRunId claim not observed for ${docId} within timeout`);
}

async function seedDocument(overrides: Record<string, unknown> = {}): Promise<string> {
  const docRef = db.collection('documents').doc();
  await docRef.set({
    fileId: 'gmail-file-1',
    fileName: 'original.pdf',
    mimeType: 'application/pdf',
    documentType: 'ケアプラン',
    customerName: '鈴木花子',
    officeName: '事業所A',
    fileUrl: 'gs://test-bucket/original/test.pdf',
    fileDate: admin.firestore.Timestamp.fromDate(new Date(2026, 0, 1)),
    isDuplicateCustomer: false,
    totalPages: 1,
    targetPageNumber: 1,
    status: 'processed',
    careManager: '田中太郎',
    customerId: 'customer-1',
    verified: true,
    ...overrides,
  });
  return docRef.id;
}

async function seedCustomer(): Promise<void> {
  await db.doc(`${MASTER_PATHS.customers}/customer-1`).set({
    name: '鈴木花子',
    furigana: 'スズキハナコ',
  });
}

async function seedDriveSettings(): Promise<void> {
  await db.doc('settings/drive').set({
    rootFolderId: 'root-folder-id',
    template: TEMPLATE,
    furiganaFallback: 'stop',
  });
}

async function getDoc(docId: string) {
  const snap = await db.doc(`documents/${docId}`).get();
  return snap.data()!;
}

describe('executeDriveExport (ADR-0022 code-review CONFIRMED指摘対応: 所有権トークン)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
    await seedCustomer();
    await seedDriveSettings();
  });

  it('claimFromStatusと現在の状態が一致しない場合はクレームせずfalseを返す', async () => {
    const docId = await seedDocument({ driveExportStatus: 'error' });
    const { drive, createCalls } = makeFakeDrive();

    const claimed = await executeDriveExport(db, docId, { drive, downloadFile: async () => Buffer.from('x') }, 'exporting');

    expect(claimed).to.be.false;
    expect(createCalls).to.have.lengthOf(0);
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.equal('error'); // 変化なし
  });

  it('claimFromStatus=undefinedはdriveExportStatus未設定のdocのみクレームする', async () => {
    const docId = await seedDocument({ driveExportStatus: 'exported' });
    const { drive, createCalls } = makeFakeDrive();

    const claimed = await executeDriveExport(db, docId, { drive, downloadFile: async () => Buffer.from('x') }, undefined);

    expect(claimed).to.be.false;
    expect(createCalls).to.have.lengthOf(0);
  });

  it('並行実行: 後から完了した古い実行(runId不一致)の成功書戻しは、先に完了した新しい実行のexported状態を上書きしない', async () => {
    const docId = await seedDocument({ driveExportStatus: 'exporting' }); // スイープによる再クレームを想定
    const blockA = makeDeferred<void>();
    const { drive: driveA, createCalls: createCallsA } = makeFakeDrive({ createdIds: ['folder-a', 'file-a'] });
    const { drive: driveB, createCalls: createCallsB } = makeFakeDrive({ createdIds: ['folder-b', 'file-b'] });

    // Run A: クレームには成功するが、downloadFileでブロックされ完了しない
    const runAPromise = executeDriveExport(
      db,
      docId,
      { drive: driveA, downloadFile: async () => { await blockA.promise; return Buffer.from('a'); } },
      'exporting'
    );
    await waitForRunIdClaim(docId);

    // Run B: 同じ'exporting'状態を再クレーム(driveExportScheduled.tsの再クレームを模す)。ブロックなしで即完了。
    const claimedB = await executeDriveExport(
      db,
      docId,
      { drive: driveB, downloadFile: async () => Buffer.from('b') },
      'exporting'
    );
    expect(claimedB).to.be.true;

    const afterB = await getDoc(docId);
    expect(afterB.driveExportStatus).to.equal('exported');
    expect(afterB.driveFileId).to.equal('file-b'); // makeFakeDrive内のcreatedIds順(folder→file)で2番目
    const runIdAfterB = afterB.driveExportRunId;
    expect(runIdAfterB).to.be.a('string');

    // Run Aを解放し完了させる(runIdは既にBに上書きされている)
    blockA.resolve();
    await runAPromise;

    const afterA = await getDoc(docId);
    // Run Aの書戻しは(driveExportRunId不一致のため)スキップされ、Bの状態が保持される
    expect(afterA.driveExportStatus).to.equal('exported');
    expect(afterA.driveFileId).to.equal('file-b');
    expect(afterA.driveExportRunId).to.equal(runIdAfterB);
    expect(createCallsA).to.have.lengthOf(2); // Run A自体はDrive APIを実行している(冪等性チェックはexportDocument側の別懸念)
    expect(createCallsB).to.have.lengthOf(2);
  });

  it('並行実行: 後から完了した古い実行(runId不一致)のエラー書戻しは、先に完了した新しい実行のexported状態を上書きしない', async () => {
    const docId = await seedDocument({ driveExportStatus: 'exporting' });
    const blockA = makeDeferred<void>();
    const { drive: driveA } = makeFakeDrive({ createdIds: ['folder-a'] });
    const { drive: driveB, createCalls: createCallsB } = makeFakeDrive({ createdIds: ['folder-b', 'file-b'] });

    // Run A: クレーム成功後ブロックし、解放後にエラーをthrowする
    const runAPromise = executeDriveExport(
      db,
      docId,
      { drive: driveA, downloadFile: async () => { await blockA.promise; throw new Error('simulated late failure'); } },
      'exporting'
    );
    await waitForRunIdClaim(docId);

    // Run B: 再クレームして正常完了
    await executeDriveExport(db, docId, { drive: driveB, downloadFile: async () => Buffer.from('b') }, 'exporting');
    const afterB = await getDoc(docId);
    expect(afterB.driveExportStatus).to.equal('exported');
    const runIdAfterB = afterB.driveExportRunId;

    // Run Aを解放。エラーが発生しexecuteDriveExport内のcatch節が書戻しを試みるが、
    // driveExportRunIdが既にBのものになっているためスキップされるはず。
    blockA.resolve();
    await runAPromise;

    const afterA = await getDoc(docId);
    expect(afterA.driveExportStatus).to.equal('exported'); // 'error'に巻き戻っていない
    expect(afterA.driveExportRunId).to.equal(runIdAfterB);
    expect(afterA.driveExportError).to.be.undefined;
    expect(createCallsB).to.have.lengthOf(2);
  });

  it('更新対象外フィールド(customerName/careManager/officeName等)の値が変化しない(CLAUDE.md MUST)', async () => {
    const docId = await seedDocument({
      driveExportStatus: 'error',
      fileName: 'keep-me.pdf',
      customerName: '不変花子',
      officeName: '不変事業所',
      careManager: '不変太郎',
    });
    const { drive } = makeFakeDrive({ createdIds: ['folder-x', 'file-x'] });

    await executeDriveExport(db, docId, { drive, downloadFile: async () => Buffer.from('x') }, 'error');

    const data = await getDoc(docId);
    expect(data.fileName).to.equal('keep-me.pdf');
    expect(data.customerName).to.equal('不変花子');
    expect(data.officeName).to.equal('不変事業所');
    expect(data.careManager).to.equal('不変太郎');
  });
});
