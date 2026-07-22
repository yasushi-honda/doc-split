/**
 * `functions/src/drive/driveExportTrigger.ts` 統合テスト(ADR-0022, Firestore emulator)
 *
 * CloudEvent構築の複雑さを避けるため、`onDocumentWritten`のプラミング部分から
 * 独立させた`processDriveExportTrigger()`を直接呼び出す
 * (`updateDocumentGroupsIdempotencyIntegration.test.ts`と同型パターン)。
 * Drive API/StorageはexportDocumentへのdeps注入経由でfakeを使う。
 *
 * 実行: firebase emulators:exec --only firestore --project drive-export-trigger-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { drive_v3 } from 'googleapis';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { processDriveExportTrigger } from '../src/drive/driveExportTrigger';
import { MASTER_PATHS } from '../src/utils/masterPaths';
import type { DriveFolderTemplate } from '../../shared/types';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'settings', MASTER_PATHS.customers];

const TEMPLATE: DriveFolderTemplate = [{ type: 'fixed', value: '事業所A' }];

interface FakeFile {
  id: string;
  name: string;
}

function makeFakeDrive(opts: { listFiles?: FakeFile[]; createdIds?: string[] } = {}) {
  let createIndex = 0;
  const createCalls: Record<string, unknown>[] = [];
  const drive = {
    files: {
      list: async () => ({ data: { files: opts.listFiles ?? [] } }),
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

async function seedDriveSettings(overrides: Record<string, unknown> = {}): Promise<void> {
  await db.doc('settings/drive').set({
    rootFolderId: 'root-folder-id',
    template: TEMPLATE,
    furiganaFallback: 'stop',
    ...overrides,
  });
}

async function enableDriveExportFlag(): Promise<void> {
  await db.doc('settings/features').set({ driveExport: true }, { merge: true });
}

async function getDoc(docId: string) {
  const snap = await db.doc(`documents/${docId}`).get();
  return snap.data()!;
}

describe('processDriveExportTrigger (ADR-0022 Phase 1)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('ハッピーパス: verified false→true + flag ON + 設定済みでexporting→exportedと遷移しdriveFileIdが書かれる', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    await seedDriveSettings();
    await enableDriveExportFlag();
    const { drive, createCalls } = makeFakeDrive({ createdIds: ['folder-office', 'exported-file-id'] });

    await processDriveExportTrigger(
      db,
      docId,
      { verified: false },
      { verified: true },
      { drive, downloadFile: async () => Buffer.from('fake-pdf-bytes') }
    );

    expect(createCalls).to.have.lengthOf(2);
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.equal('exported');
    expect(data.driveFileId).to.equal('exported-file-id');
  });

  it('verifiedが既にtrue→true(変化なし)の場合は何も書き込まない(justVerified=false)', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    await seedDriveSettings();
    await enableDriveExportFlag();
    const { drive, createCalls } = makeFakeDrive();

    await processDriveExportTrigger(
      db,
      docId,
      { verified: true },
      { verified: true },
      { drive, downloadFile: async () => Buffer.from('x') }
    );

    expect(createCalls).to.have.lengthOf(0);
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.be.undefined;
  });

  it('verifiedがfalse→false(変化なし)の場合は何も書き込まない', async () => {
    const docId = await seedDocument({ verified: false });
    await seedCustomer();
    await seedDriveSettings();
    await enableDriveExportFlag();
    const { drive, createCalls } = makeFakeDrive();

    await processDriveExportTrigger(
      db,
      docId,
      { verified: false },
      { verified: false },
      { drive, downloadFile: async () => Buffer.from('x') }
    );

    expect(createCalls).to.have.lengthOf(0);
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.be.undefined;
  });

  it('afterに既にdriveExportStatusがある場合は二重エンキューせず早期returnする', async () => {
    const docId = await seedDocument({ driveExportStatus: 'exported', driveFileId: 'already-done' });
    await seedCustomer();
    await seedDriveSettings();
    await enableDriveExportFlag();
    const { drive, createCalls } = makeFakeDrive();

    await processDriveExportTrigger(
      db,
      docId,
      { verified: false },
      { verified: true, driveExportStatus: 'exported' },
      { drive, downloadFile: async () => Buffer.from('x') }
    );

    expect(createCalls).to.have.lengthOf(0);
    const data = await getDoc(docId);
    expect(data.driveFileId).to.equal('already-done'); // 上書きされていない
  });

  it('Feature Flag OFFの場合はDrive API呼び出し・フィールド書込みが一切発生しない', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    await seedDriveSettings();
    // enableDriveExportFlag() を呼ばない = flag OFF(デフォルト、fail-closed)
    const { drive, createCalls } = makeFakeDrive();

    await processDriveExportTrigger(
      db,
      docId,
      { verified: false },
      { verified: true },
      { drive, downloadFile: async () => Buffer.from('x') }
    );

    expect(createCalls).to.have.lengthOf(0);
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.be.undefined;
  });

  it('ドキュメント削除(after不在)の場合は何もせずreturnする', async () => {
    const { drive, createCalls } = makeFakeDrive();

    await processDriveExportTrigger(
      db,
      'deleted-doc-id',
      { verified: true },
      undefined,
      { drive, downloadFile: async () => Buffer.from('x') }
    );

    expect(createCalls).to.have.lengthOf(0);
  });

  it('verified false→trueがほぼ同時に2回発生しても、FirestoreトランザクションによりexportDocumentは1回しか実行されない(/code-review low指摘対応の回帰テスト)', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    await seedDriveSettings();
    await enableDriveExportFlag();
    const { drive, createCalls } = makeFakeDrive({ createdIds: ['folder-office', 'exported-file-id'] });

    // 同一docIdに対し、確認ボタンの二重タップ等を模してprocessDriveExportTriggerを
    // 並行実行する。executeDriveExport()内のトランザクションでの二重エンキュー防止が
    // 機能していれば、片方のみがdriveExportStatus:'exporting'を確保しexportDocument()を
    // 実行する。
    await Promise.all([
      processDriveExportTrigger(
        db,
        docId,
        { verified: false },
        { verified: true },
        { drive, downloadFile: async () => Buffer.from('fake-pdf-bytes') }
      ),
      processDriveExportTrigger(
        db,
        docId,
        { verified: false },
        { verified: true },
        { drive, downloadFile: async () => Buffer.from('fake-pdf-bytes') }
      ),
    ]);

    // 1回のexportDocument実行はフォルダ作成1回+ファイル作成1回=create呼び出し2回。
    // 2回実行されていれば4回になるはずだが、常に2回に収まることを検証する。
    expect(createCalls).to.have.lengthOf(2);
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.equal('exported');
    expect(data.driveFileId).to.equal('exported-file-id');
  });

  it('exportDocument()がエラーをthrowした場合、driveExportStatus:error + driveExportErrorを書き込む', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    await seedDriveSettings();
    await enableDriveExportFlag();
    // 同名フォルダ2件 → findOrCreateFolder が AmbiguousFolderError をthrow
    const { drive, createCalls } = makeFakeDrive({
      listFiles: [
        { id: 'dup-1', name: '事業所A' },
        { id: 'dup-2', name: '事業所A' },
      ],
    });

    await processDriveExportTrigger(
      db,
      docId,
      { verified: false },
      { verified: true },
      { drive, downloadFile: async () => Buffer.from('x') }
    );

    expect(createCalls).to.have.lengthOf(0);
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.equal('error');
    expect(data.driveExportError).to.be.a('string').and.not.empty;
    expect(data.driveFileId).to.be.undefined;
  });
});
