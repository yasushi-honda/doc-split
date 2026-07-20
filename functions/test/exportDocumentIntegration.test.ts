/**
 * `functions/src/drive/exportDocument.ts` 統合テスト(ADR-0022, Firestore emulator)
 *
 * Drive API / Storage は実呼出しせず、`ExportDocumentDeps`経由でfakeを注入する。
 * Firestoreの読込(document/customer master/settings)と書戻し(driveFileId等)は
 * emulatorで実際に検証する。
 *
 * `runId`所有権チェック(ADR-0022 code-review CONFIRMED指摘対応): 本番では
 * `executeDriveExport.ts`がクレーム時に`driveExportRunId`を書込んでから`exportDocument()`
 * を呼ぶため、`seedDocument()`は既定で`TEST_RUN_ID`を`driveExportRunId`として持つ
 * (実際の前提条件を再現)。
 *
 * 実行: firebase emulators:exec --only firestore --project export-document-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { drive_v3 } from 'googleapis';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { exportDocument, DriveSettingsIncompleteError, AmbiguousFileError } from '../src/drive/exportDocument';
import { FuriganaMissingError } from '../src/drive/folderPath';
import { AmbiguousFolderError } from '../src/drive/findOrCreateFolder';
import { MASTER_PATHS } from '../src/utils/masterPaths';
import type { DriveFolderTemplate } from '../../shared/types';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'settings', MASTER_PATHS.customers];

const TEMPLATE: DriveFolderTemplate = [
  { type: 'fixed', value: '事業所A' },
  { type: 'customer', format: 'furiganaInitialSpaceName' },
];

const TEST_RUN_ID = 'test-run-id';

interface FakeFile {
  id: string;
  name: string;
}

/**
 * `q`の内容でフォルダ検索(mimeType=folder)とファイル検索(appProperties経由の
 * docId冪等性チェック)を区別してfakeの応答を切り替える。
 */
function makeFakeDrive(opts: { listFiles?: FakeFile[]; existingFiles?: FakeFile[]; createdIds?: string[] }) {
  let createIndex = 0;
  const listCalls: Record<string, unknown>[] = [];
  const createCalls: Record<string, unknown>[] = [];

  const drive = {
    files: {
      list: async (params: Record<string, unknown>) => {
        listCalls.push(params);
        const q = (params.q as string | undefined) ?? '';
        if (q.includes('appProperties')) {
          return { data: { files: opts.existingFiles ?? [] } };
        }
        return { data: { files: opts.listFiles ?? [] } };
      },
      create: async (params: Record<string, unknown>) => {
        createCalls.push(params);
        const id = opts.createdIds?.[createIndex] ?? `created-${createIndex}`;
        createIndex++;
        return { data: { id } };
      },
    },
  } as unknown as drive_v3.Drive;

  return { drive, listCalls, createCalls };
}

async function seedDocument(overrides: Record<string, unknown> = {}): Promise<string> {
  const docRef = db.collection('documents').doc();
  await docRef.set({
    fileId: 'gmail-file-1',
    fileName: 'original.pdf',
    displayFileName: '書類_事業所A_20260101_鈴木花子.pdf',
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
    driveExportStatus: 'exporting',
    driveExportRunId: TEST_RUN_ID,
    ...overrides,
  });
  return docRef.id;
}

async function seedCustomer(furigana: string | undefined = 'スズキハナコ'): Promise<void> {
  await db.doc(`${MASTER_PATHS.customers}/customer-1`).set({
    name: '鈴木花子',
    ...(furigana !== undefined ? { furigana } : {}),
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

describe('exportDocument (ADR-0022 Phase 1)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('ハッピーパス: 2階層フォルダを作成しPDFを配置、driveFileId/driveExportedAt/driveExportStatusを書戻す', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    await seedDriveSettings();
    const { drive, createCalls } = makeFakeDrive({
      createdIds: ['folder-office', 'folder-customer', 'exported-file-id'],
    });

    await exportDocument(docId, TEST_RUN_ID, {
      drive,
      downloadFile: async () => Buffer.from('fake-pdf-bytes'),
    });

    expect(createCalls).to.have.lengthOf(3);

    const officeCall = createCalls[0].requestBody as { name: string; parents: string[] };
    expect(officeCall).to.deep.equal({
      name: '事業所A',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root-folder-id'],
    });

    const customerCall = createCalls[1].requestBody as { name: string; parents: string[] };
    expect(customerCall).to.deep.equal({
      name: 'ス　鈴木花子',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['folder-office'],
    });

    const fileCall = createCalls[2];
    const fileBody = fileCall.requestBody as { name: string; parents: string[]; appProperties: Record<string, string> };
    expect(fileBody.name).to.equal('書類_事業所A_20260101_鈴木花子.pdf');
    expect(fileBody.parents).to.deep.equal(['folder-customer']);
    expect(fileBody.appProperties).to.deep.equal({ docSplitDocId: docId });
    expect((fileCall.media as { mimeType: string }).mimeType).to.equal('application/pdf');

    const docSnap = await db.doc(`documents/${docId}`).get();
    const data = docSnap.data()!;
    expect(data.driveFileId).to.equal('exported-file-id');
    expect(data.driveExportStatus).to.equal('exported');
    expect(data.driveExportedAt).to.not.be.undefined;
  });

  it('更新対象外フィールド(customerName/careManager/officeName等)の値が変化しない(CLAUDE.md MUST)', async () => {
    const docId = await seedDocument({
      fileName: 'keep-me.pdf',
      customerName: '不変花子',
      officeName: '不変事業所',
      careManager: '不変太郎',
    });
    await seedCustomer();
    await seedDriveSettings();
    const { drive } = makeFakeDrive({
      createdIds: ['folder-office', 'folder-customer', 'exported-file-id'],
    });

    await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });

    const data = (await db.doc(`documents/${docId}`).get()).data()!;
    expect(data.fileName).to.equal('keep-me.pdf');
    expect(data.customerName).to.equal('不変花子');
    expect(data.officeName).to.equal('不変事業所');
    expect(data.careManager).to.equal('不変太郎');
  });

  it('appPropertiesに一致する既存ファイルが1件見つかった場合はアップロードをスキップしそのidを再利用する(重複作成防止)', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    await seedDriveSettings();
    const { drive, createCalls } = makeFakeDrive({
      createdIds: ['folder-office', 'folder-customer'], // フォルダ用の2件のみ(ファイルは既存流用のため未使用)
      existingFiles: [{ id: 'orphaned-file-from-prior-run', name: '書類_事業所A_20260101_鈴木花子.pdf' }],
    });

    await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });

    // フォルダ作成2回のみ(ファイルのcreateは呼ばれない)
    expect(createCalls).to.have.lengthOf(2);
    const data = (await db.doc(`documents/${docId}`).get()).data()!;
    expect(data.driveFileId).to.equal('orphaned-file-from-prior-run');
    expect(data.driveExportStatus).to.equal('exported');
  });

  it('appPropertiesに一致する既存ファイルが2件以上見つかった場合はAmbiguousFileErrorをthrowし、Firestore書込みは発生しない', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    await seedDriveSettings();
    const { drive, createCalls } = makeFakeDrive({
      createdIds: ['folder-office', 'folder-customer'],
      existingFiles: [
        { id: 'dup-file-1', name: '書類_事業所A_20260101_鈴木花子.pdf' },
        { id: 'dup-file-2', name: '書類_事業所A_20260101_鈴木花子.pdf' },
      ],
    });

    try {
      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });
      expect.fail('AmbiguousFileErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(AmbiguousFileError);
    }

    // フォルダは正常に解決されるが、ファイルのcreateには到達しない
    expect(createCalls).to.have.lengthOf(2);
    const docSnap = await db.doc(`documents/${docId}`).get();
    expect(docSnap.data()!.driveFileId).to.be.undefined;
    expect(docSnap.data()!.driveExportStatus).to.equal('exporting'); // seedDocumentの初期値のまま
  });

  it('runIdが現在のdriveExportRunIdと一致しない場合、Drive操作は実行されるがFirestore書戻しはスキップされる(superseded、並行実行対策)', async () => {
    // 別の実行(runId不一致)に所有権が引き継がれた状態を模す
    const docId = await seedDocument({ driveExportRunId: 'another-run-id' });
    await seedCustomer();
    await seedDriveSettings();
    const { drive, createCalls } = makeFakeDrive({
      createdIds: ['folder-office', 'folder-customer', 'exported-file-id'],
    });

    // 自分はTEST_RUN_IDを持つが、ライブのdocはalready 'another-run-id'に所有権が移っている
    await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });

    // Drive側の操作(フォルダ作成・ファイルアップロード)自体は実行される
    expect(createCalls).to.have.lengthOf(3);
    // だがFirestoreへの書戻しはスキップされ、driveExportRunIdの持ち主(another-run-id側)の状態を破壊しない
    const data = (await db.doc(`documents/${docId}`).get()).data()!;
    expect(data.driveFileId).to.be.undefined;
    expect(data.driveExportStatus).to.equal('exporting');
    expect(data.driveExportRunId).to.equal('another-run-id');
  });

  it('フリガナ欠損 + furiganaFallback:stop(デフォルト)はFuriganaMissingErrorをthrowし、Drive/Firestore書込みは一切発生しない', async () => {
    const docId = await seedDocument({ customerId: null });
    await seedDriveSettings();
    const { drive, listCalls, createCalls } = makeFakeDrive({});

    try {
      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });
      expect.fail('FuriganaMissingErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(FuriganaMissingError);
    }

    expect(listCalls).to.have.lengthOf(0);
    expect(createCalls).to.have.lengthOf(0);

    const docSnap = await db.doc(`documents/${docId}`).get();
    expect(docSnap.data()!.driveFileId).to.be.undefined;
    expect(docSnap.data()!.driveExportStatus).to.equal('exporting'); // seedDocumentの初期値のまま
  });

  it('フリガナ欠損 + furiganaFallback:useNameInitialは氏名頭文字で代替してエクスポートに成功する', async () => {
    const docId = await seedDocument({ customerId: null });
    await seedDriveSettings({ furiganaFallback: 'useNameInitial' });
    const { drive, createCalls } = makeFakeDrive({
      createdIds: ['folder-office', 'folder-customer', 'exported-file-id'],
    });

    await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });

    const customerCall = createCalls[1].requestBody as { name: string };
    expect(customerCall.name).to.equal('鈴　鈴木花子');
  });

  it('同名フォルダが2件以上の場合はAmbiguousFolderErrorをthrowし、Drive/Firestore書込みは一切発生しない', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    await seedDriveSettings();
    const { drive, createCalls } = makeFakeDrive({
      listFiles: [
        { id: 'dup-1', name: '事業所A' },
        { id: 'dup-2', name: '事業所A' },
      ],
    });

    try {
      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });
      expect.fail('AmbiguousFolderErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(AmbiguousFolderError);
    }

    expect(createCalls).to.have.lengthOf(0);
    const docSnap = await db.doc(`documents/${docId}`).get();
    expect(docSnap.data()!.driveFileId).to.be.undefined;
  });

  it('settings/driveにrootFolderIdが未設定の場合はDriveSettingsIncompleteErrorをthrowする', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    // rootFolderIdキー自体を書き込まない(Firestoreはundefined値を拒否するため、
    // seedDriveSettingsのデフォルト値を上書きするのではなくキーを省略する)
    await db.doc('settings/drive').set({ template: TEMPLATE, furiganaFallback: 'stop' });
    const { drive } = makeFakeDrive({});

    try {
      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });
      expect.fail('DriveSettingsIncompleteErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(DriveSettingsIncompleteError);
      expect((error as Error).message).to.include('rootFolderId');
    }
  });

  it('settings/driveにtemplateが未設定の場合はDriveSettingsIncompleteErrorをthrowする', async () => {
    const docId = await seedDocument();
    await seedCustomer();
    await seedDriveSettings({ template: [] });
    const { drive } = makeFakeDrive({});

    try {
      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });
      expect.fail('DriveSettingsIncompleteErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(DriveSettingsIncompleteError);
      expect((error as Error).message).to.include('template');
    }
  });

  it('存在しないdocIdの場合はErrorをthrowする', async () => {
    await seedDriveSettings();
    const { drive } = makeFakeDrive({});

    try {
      await exportDocument('non-existent-doc-id', TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });
      expect.fail('Errorがthrowされるべき');
    } catch (error) {
      expect((error as Error).message).to.include('non-existent-doc-id');
    }
  });
});
