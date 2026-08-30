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
import { buildFolderLockId, FOLDER_LOCKS_COLLECTION } from '../src/drive/driveFolderClaim';
import { MASTER_PATHS } from '../src/utils/masterPaths';
import type { DriveFolderTemplate } from '../../shared/types';

const db = admin.firestore();
// Issue #871 claimプロトコル(PR-4): findOrCreateFolderが書き込むdriveFolderLocksを
// クリアしないと、テスト間で残留したclaimが後続テストのfake drive状態と食い違い、
// DivergentFolderClaimErrorで失敗する。
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'settings', MASTER_PATHS.customers, 'driveFolderLocks'];

const TEMPLATE: DriveFolderTemplate = [{ type: 'fixed', value: '事業所A' }];

interface FakeFile {
  id: string;
  name: string;
}

function makeFakeDrive(opts: { createdIds?: string[]; sharedIdToParents?: Map<string, string[]> } = {}) {
  let createIndex = 0;
  const createCalls: Record<string, unknown>[] = [];
  // Issue #871 claimプロトコル(PR-4): beginCreationが「既にresolved」を検知した場合、
  // verifyFolderClaimがfiles.getで健全性確認する。作成時のparentsを記憶し、そのfileId
  // へのgetに正しく応答できるようにする(未対応だと"drive.files.get is not a function"
  // で並行実行テストが全滅する)。並行実行テストではRun A/Run Bが別々のdriveインスタンス
  // を持つが実Drive上は同じフォルダを指すため、sharedIdToParentsで状態を共有できるように
  // する(共有しないと、他方が作成したfolderIdへのgetがparents不一致でdivergent誤判定になる)。
  const idToParents = opts.sharedIdToParents ?? new Map<string, string[]>();
  const drive = {
    files: {
      list: async () => ({ data: { files: [] as FakeFile[] } }),
      create: async (params: Record<string, unknown>) => {
        createCalls.push(params);
        const id = opts.createdIds?.[createIndex] ?? `created-${createIndex}`;
        createIndex++;
        const requestBody = params.requestBody as { parents?: string[] } | undefined;
        idToParents.set(id, requestBody?.parents ?? []);
        return { data: { id } };
      },
      get: async (params: Record<string, unknown>) => ({
        data: { parents: idToParents.get(params.fileId as string) ?? [], trashed: false },
      }),
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

/**
 * Issue #871 claimプロトコル(PR-4)導入後、並行実行テストがRun A/Bどちらが先に
 * フォルダclaimをresolvedへ確定させるかは非決定的になる(waitForRunIdClaimはクレーム
 * トランザクション完了のみを見ており、その後のfindOrCreateFolder完了は保証しない)。
 * Run Aの完了(claim resolved)を明示的に待ってからRun Bを実行することで、
 * createCalls件数のassertionを決定論的にする。
 */
async function waitForFolderClaimResolved(parentId: string, name: string): Promise<void> {
  const ref = db.collection(FOLDER_LOCKS_COLLECTION).doc(buildFolderLockId(parentId, name));
  for (let i = 0; i < 100; i++) {
    const snap = await ref.get();
    if (snap.data()?.state === 'resolved') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`folder claim not resolved for ${parentId}/${name} within timeout`);
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

async function seedCustomer(name = '鈴木花子'): Promise<void> {
  await db.doc(`${MASTER_PATHS.customers}/customer-1`).set({
    name,
    furigana: 'スズキハナコ',
  });
}

/**
 * 同名の顧客マスターを`count`件登録する(顧客未確定ゲートの曖昧性判定テスト用、
 * ADR-0022再設計)。1件目のidは`customer-1`(seedDocumentの既定customerIdと一致)。
 */
async function seedCollidingCustomers(name: string, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      db.doc(`${MASTER_PATHS.customers}/customer-${i + 1}`).set({
        name,
        ...(i === 0 ? { furigana: 'スズキハナコ' } : {}),
      })
    )
  );
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
    // Issue #871 claimプロトコル(PR-4)対応: Run A/Bは同じdocId(=同じフォルダパス)を
    // 扱うため、実Drive上は同一フォルダを共有する。sharedIdToParentsでその状態を模倣する。
    const sharedIdToParents = new Map<string, string[]>();
    const { drive: driveA, createCalls: createCallsA } = makeFakeDrive({
      createdIds: ['folder-a', 'file-a'],
      sharedIdToParents,
    });
    // Run BはRun Aが先に確定させたclaim(folder-a)を再利用するため、フォルダは作成しない。
    const { drive: driveB, createCalls: createCallsB } = makeFakeDrive({
      createdIds: ['file-b'],
      sharedIdToParents,
    });

    // Run A: クレームには成功するが、downloadFileでブロックされ完了しない
    const runAPromise = executeDriveExport(
      db,
      docId,
      { drive: driveA, downloadFile: async () => { await blockA.promise; return Buffer.from('a'); } },
      'exporting'
    );
    await waitForRunIdClaim(docId);
    // claimプロトコル導入後、フォルダclaim確定(findOrCreateFolder完了)はrunIdクレームより
    // 後で非同期に進むため、Run Aのフォルダ作成が完了するまで待ってからRun Bを実行する
    // (待たないとRun A/Bどちらが先にfolder確定するか非決定的になり、createCalls件数の
    // assertionがflakyになる)。
    await waitForFolderClaimResolved('root-folder-id', '事業所A');

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
    expect(afterB.driveFileId).to.equal('file-b');
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
    expect(createCallsA).to.have.lengthOf(2); // Run A: フォルダ作成(claim確定)+ファイル作成
    // Run B: claimプロトコルによりRun Aが確定済みのフォルダを再利用するため、
    // 新規フォルダ作成は発生しない(まさにIssue #871が防ぎたかった重複作成)。ファイルのみ新規作成。
    expect(createCallsB).to.have.lengthOf(1);
  });

  it('並行実行: 後から完了した古い実行(runId不一致)のエラー書戻しは、先に完了した新しい実行のexported状態を上書きしない', async () => {
    const docId = await seedDocument({ driveExportStatus: 'exporting' });
    const blockA = makeDeferred<void>();
    const sharedIdToParents = new Map<string, string[]>();
    const { drive: driveA } = makeFakeDrive({ createdIds: ['folder-a'], sharedIdToParents });
    // Run BはRun Aが先に確定させたclaim(folder-a)を再利用するため、フォルダは作成しない。
    const { drive: driveB, createCalls: createCallsB } = makeFakeDrive({ createdIds: ['file-b'], sharedIdToParents });

    // Run A: クレーム成功後ブロックし、解放後にエラーをthrowする
    const runAPromise = executeDriveExport(
      db,
      docId,
      { drive: driveA, downloadFile: async () => { await blockA.promise; throw new Error('simulated late failure'); } },
      'exporting'
    );
    await waitForRunIdClaim(docId);
    await waitForFolderClaimResolved('root-folder-id', '事業所A');

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
    // Run B: claimプロトコルによりRun Aが確定済みのフォルダを再利用するため、
    // 新規フォルダ作成は発生しない。ファイルのみ新規作成。
    expect(createCallsB).to.have.lengthOf(1);
  });

  it('顧客未確定の書類はCustomerUnconfirmedErrorでerror遷移し、driveExportErrorが「顧客が未確定のため」で始まる(同姓同名リスク対応、2026-07-25再設計: 同名マスター2件で曖昧性ありのケース)', async () => {
    const docId = await seedDocument({ customerConfirmed: false });
    await seedCollidingCustomers('鈴木花子', 2); // beforeEachのseedCustomer()に加え、同名衝突を作る
    const { drive } = makeFakeDrive({});

    const result = await executeDriveExport(
      db,
      docId,
      { drive, downloadFile: async () => Buffer.from('x') },
      undefined
    );

    expect(result).to.equal(true); // クレーム自体は成功、その後のexportDocument()内でthrow
    const after = await getDoc(docId);
    expect(after.driveExportStatus).to.equal('error');
    expect(after.driveExportError).to.be.a('string');
    expect(after.driveExportError as string).to.match(/^顧客が未確定のため/);
  });

  it('更新対象外フィールド(customerName/careManager/officeName等)の値が変化しない(CLAUDE.md MUST)', async () => {
    const docId = await seedDocument({
      driveExportStatus: 'error',
      fileName: 'keep-me.pdf',
      customerName: '不変花子',
      officeName: '不変事業所',
      careManager: '不変太郎',
      customerConfirmed: true,
    });
    await seedCustomer('不変花子'); // doc.customerNameと一致させる(name↔id乖離チェック対策)
    const { drive } = makeFakeDrive({ createdIds: ['folder-x', 'file-x'] });

    await executeDriveExport(db, docId, { drive, downloadFile: async () => Buffer.from('x') }, 'error');

    const data = await getDoc(docId);
    expect(data.fileName).to.equal('keep-me.pdf');
    expect(data.customerName).to.equal('不変花子');
    expect(data.officeName).to.equal('不変事業所');
    expect(data.careManager).to.equal('不変太郎');
  });
});
