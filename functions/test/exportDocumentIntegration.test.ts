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
import { FuriganaMissingError, FileDateMissingError } from '../src/drive/folderPath';
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
 * docId冪等性チェック。driveFileId優先パスの重複再確認も同じqの形を使う)を
 * 区別してfakeの応答を切り替える。
 *
 * `getFile`は`files.get()`(driveFileId優先解決の第一段)の応答を制御する:
 * - `{ parents: [...], trashed?: boolean }`: そのidのファイルが指定の親フォルダ配下に
 *   存在する。`trashed: true`はゴミ箱移動済みを表す
 * - `'not-found'`: 404、`error.code`のみに設定(手動削除等を想定) → フォールバックへ
 * - `'not-found-status-shape'`: 404、実際のgaxiosエラー形状を模して`error.status`
 *   のみに設定(`error.code`は無し) → フォールバックへ
 * - 省略: `doc.driveFileId`が無いテストケースでは呼ばれない想定
 */
function makeFakeDrive(opts: {
  listFiles?: FakeFile[];
  existingFiles?: FakeFile[];
  createdIds?: string[];
  getFile?: { parents: string[]; trashed?: boolean } | 'not-found' | 'not-found-status-shape';
}) {
  let createIndex = 0;
  const listCalls: Record<string, unknown>[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const getCalls: Record<string, unknown>[] = [];
  const updateCalls: Record<string, unknown>[] = [];

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
      get: async (params: Record<string, unknown>) => {
        getCalls.push(params);
        if (opts.getFile === 'not-found') {
          const notFound = new Error('File not found') as Error & { code: number };
          notFound.code = 404;
          throw notFound;
        }
        if (opts.getFile === 'not-found-status-shape') {
          // 実際のgaxios GaxiosErrorの形状: HTTPステータスはstatusにのみ設定され、
          // codeはnetwork層エラー専用でHTTP 404では設定されない
          const notFound = new Error('File not found') as Error & { status: number };
          notFound.status = 404;
          throw notFound;
        }
        return { data: { parents: opts.getFile?.parents ?? [], trashed: opts.getFile?.trashed ?? false } };
      },
      update: async (params: Record<string, unknown>) => {
        updateCalls.push(params);
        return { data: { id: params.fileId } };
      },
    },
  } as unknown as drive_v3.Drive;

  return { drive, listCalls, createCalls, getCalls, updateCalls };
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

  // ADR-0022 code-review xhigh指摘対応(2026-07-21): reprocess時にdriveFileIdをクリア
  // しない設計への変更に伴う回帰テスト群。driveFileIdが既にある場合はappProperties検索
  // ではなくdriveFileIdを直接参照したmove/rename/内容更新に切り替わることを検証する。
  describe('driveFileId優先のmove/rename/内容更新(code-review xhigh指摘対応)', () => {
    it('driveFileIdあり+フォルダパス不変: files.updateで内容更新のみ行い、files.createは呼ばれず同一idを返す', async () => {
      const docId = await seedDocument({ driveFileId: 'prior-file-id' });
      await seedCustomer();
      await seedDriveSettings();
      const { drive, createCalls, getCalls, updateCalls } = makeFakeDrive({
        createdIds: ['folder-office', 'folder-customer'], // フォルダのみ(ファイルcreateは発生しない想定)
        getFile: { parents: ['folder-customer'] }, // 既に解決後の親フォルダ配下にある
      });

      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('updated-bytes') });

      expect(getCalls).to.have.lengthOf(1);
      expect(getCalls[0].fileId).to.equal('prior-file-id');
      expect(createCalls).to.have.lengthOf(2); // フォルダのみ、ファイルのcreateなし
      expect(updateCalls).to.have.lengthOf(1);
      expect(updateCalls[0].fileId).to.equal('prior-file-id');
      expect(updateCalls[0].addParents).to.equal('folder-customer');
      expect(updateCalls[0]).to.not.have.property('removeParents'); // 移動不要
      expect((updateCalls[0].requestBody as { name: string }).name).to.equal('書類_事業所A_20260101_鈴木花子.pdf');
      expect((updateCalls[0].media as { mimeType: string }).mimeType).to.equal('application/pdf');

      const data = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(data.driveFileId).to.equal('prior-file-id');
      expect(data.driveExportStatus).to.equal('exported');
    });

    it('driveFileIdあり+フォルダパス変化: files.updateがaddParents/removeParents付きで呼ばれ、旧フォルダに孤児が残らない', async () => {
      const docId = await seedDocument({ driveFileId: 'prior-file-id' });
      await seedCustomer();
      await seedDriveSettings();
      const { drive, createCalls, updateCalls } = makeFakeDrive({
        createdIds: ['folder-office', 'folder-customer'],
        getFile: { parents: ['old-folder-id'] }, // 訂正前は別フォルダに存在していた
      });

      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });

      expect(createCalls).to.have.lengthOf(2); // ファイルのcreateは発生しない(移動のみ)
      expect(updateCalls).to.have.lengthOf(1);
      expect(updateCalls[0].fileId).to.equal('prior-file-id');
      expect(updateCalls[0].addParents).to.equal('folder-customer');
      expect(updateCalls[0].removeParents).to.equal('old-folder-id');

      const data = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(data.driveFileId).to.equal('prior-file-id'); // 新規ファイルではなく同一idのまま(孤児化しない)
    });

    it('driveFileIdあり+files.getが404: findOrUploadFile(appPropertiesフォールバック)経路で新規アップロードする', async () => {
      const docId = await seedDocument({ driveFileId: 'stale-file-id' }); // ユーザーがDrive上で手動削除した想定
      await seedCustomer();
      await seedDriveSettings();
      const { drive, createCalls, updateCalls } = makeFakeDrive({
        createdIds: ['folder-office', 'folder-customer', 'recreated-file-id'],
        getFile: 'not-found',
      });

      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });

      expect(updateCalls).to.have.lengthOf(0);
      expect(createCalls).to.have.lengthOf(3); // フォルダ2件 + ファイル新規作成1件
      const data = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(data.driveFileId).to.equal('recreated-file-id');
    });

    // /code-review high指摘対応(2026-07-21): 実際のgaxios GaxiosErrorはHTTPステータスを
    // error.statusに設定し、error.codeはnetwork層エラー専用でHTTP 404には使われない。
    // 単純な`error.code===404`比較では本番で常にfalseになり、404フォールバックが
    // 死んだコードパスになっていた(実装のnode_modules/gaxios確認で判明)。
    it('driveFileIdあり+files.getが実際のgaxios形状(error.statusのみに404、codeは未設定)で失敗: findOrUploadFileにフォールバックする', async () => {
      const docId = await seedDocument({ driveFileId: 'stale-file-id-status-shape' });
      await seedCustomer();
      await seedDriveSettings();
      const { drive, createCalls, updateCalls } = makeFakeDrive({
        createdIds: ['folder-office', 'folder-customer', 'recreated-file-id-status-shape'],
        getFile: 'not-found-status-shape',
      });

      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });

      expect(updateCalls).to.have.lengthOf(0);
      expect(createCalls).to.have.lengthOf(3);
      const data = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(data.driveFileId).to.equal('recreated-file-id-status-shape');
    });

    // /code-review high指摘対応(2026-07-21): drive.fileスコープでは完全削除ができず
    // ゴミ箱移動(trashed:true)のみ許可される(ADR-0022 Decision2)。files.get()はtrashed
    // ファイルでも200で成功するため、trashedを見ないとゴミ箱内のファイルへ不可視のまま
    // 上書きし続けるsilent failureになっていた。
    it('driveFileIdあり+Drive上でゴミ箱移動(trashed)されている: files.updateを呼ばずfindOrUploadFileにフォールバックする', async () => {
      const docId = await seedDocument({ driveFileId: 'trashed-file-id' });
      await seedCustomer();
      await seedDriveSettings();
      const { drive, createCalls, updateCalls } = makeFakeDrive({
        createdIds: ['folder-office', 'folder-customer', 'recreated-after-trash-file-id'],
        getFile: { parents: ['folder-customer'], trashed: true },
      });

      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });

      expect(updateCalls).to.have.lengthOf(0); // ゴミ箱内ファイルへは書き込まない
      expect(createCalls).to.have.lengthOf(3);
      const data = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(data.driveFileId).to.equal('recreated-after-trash-file-id');
    });

    // /code-review high指摘対応(2026-07-21): driveFileId確定後は、findOrUploadFile()が
    // 持つappPropertiesベースの重複検知(AmbiguousFileError)を永久に経由しなくなっていた。
    // ADRの「以後AmbiguousFileErrorで恒久停止」という記述を毎回のエクスポートで再現する。
    it('driveFileIdあり+同じappPropertiesを持つ別ファイルが対象フォルダに存在する: AmbiguousFileErrorをthrowしfiles.updateは呼ばれない', async () => {
      const docId = await seedDocument({ driveFileId: 'known-file-id' });
      await seedCustomer();
      await seedDriveSettings();
      const { drive, createCalls, updateCalls } = makeFakeDrive({
        createdIds: ['folder-office', 'folder-customer'],
        getFile: { parents: ['folder-customer'] },
        existingFiles: [
          { id: 'known-file-id', name: '書類_事業所A_20260101_鈴木花子.pdf' },
          { id: 'orphan-duplicate-id', name: '書類_事業所A_20260101_鈴木花子.pdf' },
        ],
      });

      try {
        await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });
        expect.fail('AmbiguousFileErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(AmbiguousFileError);
      }

      expect(updateCalls).to.have.lengthOf(0); // 重複検知で停止、内容更新は発生しない
      expect(createCalls).to.have.lengthOf(2); // フォルダのみ
      const data = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(data.driveFileId).to.equal('known-file-id'); // 元の値のまま変化なし
      expect(data.driveExportStatus).to.equal('exporting'); // seedDocumentの初期値のまま
    });

    it('driveFileIdなし(初回エクスポート): files.get/files.updateは一切呼ばれず既存のfindOrUploadFile経路のまま動作する', async () => {
      const docId = await seedDocument(); // driveFileId未設定(初回エクスポート)
      await seedCustomer();
      await seedDriveSettings();
      const { drive, createCalls, getCalls, updateCalls } = makeFakeDrive({
        createdIds: ['folder-office', 'folder-customer', 'first-export-file-id'],
      });

      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });

      expect(getCalls).to.have.lengthOf(0);
      expect(updateCalls).to.have.lengthOf(0);
      expect(createCalls).to.have.lengthOf(3);
      const data = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(data.driveFileId).to.equal('first-export-file-id');
    });
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

  it('fileDateがnullでdateセグメント対象カテゴリの場合はFileDateMissingErrorをthrowし、Drive/Firestore書込みは一切発生しない(#45)', async () => {
    const docId = await seedDocument({ fileDate: null });
    await seedCustomer();
    const templateWithDate: DriveFolderTemplate = [
      ...TEMPLATE,
      { type: 'date', format: 'YYYY年MM月', onlyForCategories: ['ケアプラン'] },
    ];
    await seedDriveSettings({ template: templateWithDate });
    const { drive, listCalls, createCalls } = makeFakeDrive({});

    try {
      await exportDocument(docId, TEST_RUN_ID, { drive, downloadFile: async () => Buffer.from('x') });
      expect.fail('FileDateMissingErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(FileDateMissingError);
    }

    expect(listCalls).to.have.lengthOf(0);
    expect(createCalls).to.have.lengthOf(0);
    const docSnap = await db.doc(`documents/${docId}`).get();
    expect(docSnap.data()!.driveFileId).to.be.undefined;
    expect(docSnap.data()!.driveExportStatus).to.equal('exporting'); // seedDocumentの初期値のまま
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
