/**
 * `functions/src/drive/retryDriveExport.ts` 統合テスト(ADR-0022 Phase 1 Task8, Firestore emulator)
 *
 * onCall配管(admin権限チェック等)は`exchangeDriveAuthCode.ts`等の既存実装から複製した
 * 定型ロジックのため、`retryDriveExportCore`(業務ロジック本体)を直接テストする
 * (`processDriveExportTrigger`と同型パターン)。
 *
 * 実行: firebase emulators:exec --only firestore --project retry-drive-export-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { drive_v3 } from 'googleapis';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { retryDriveExportCore, DriveExportNotRetryableError } from '../src/drive/retryDriveExport';
import { MASTER_PATHS } from '../src/utils/masterPaths';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'settings', MASTER_PATHS.customers];

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

async function getDoc(docId: string) {
  const snap = await db.doc(`documents/${docId}`).get();
  return snap.data()!;
}

describe('retryDriveExportCore (ADR-0022 Phase 1 Task8)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('Drive設定未完了のままリトライするとexportDocument()内でDriveSettingsIncompleteErrorとなりerror状態を維持する', async () => {
    const docId = await seedDocument({
      driveExportStatus: 'error',
      driveExportError: '前回のエラーメッセージ',
    });
    await seedCustomer();
    // settings/drive を意図的に設定しない(rootFolderId/template未設定)
    const { drive, createCalls } = makeFakeDrive({ createdIds: ['folder-office', 'exported-file-id'] });

    const result = await retryDriveExportCore(db, docId, {
      drive,
      downloadFile: async () => Buffer.from('fake-pdf-bytes'),
    });

    expect(createCalls).to.have.lengthOf(0); // rootFolderId/template未設定→DriveSettingsIncompleteErrorでcreate到達前にerror
    expect(result.success).to.be.false;
    expect(result.status).to.equal('error');
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.equal('error');
  });

  it('ハッピーパス: error状態のdocが再エクスポートに成功しexportedへ遷移する', async () => {
    const docId = await seedDocument({
      driveExportStatus: 'error',
      driveExportError: '前回のエラーメッセージ',
    });
    await seedCustomer();
    await db.doc('settings/drive').set({
      rootFolderId: 'root-folder-id',
      template: [{ type: 'fixed', value: '事業所A' }],
      furiganaFallback: 'stop',
    });
    const { drive, createCalls } = makeFakeDrive({ createdIds: ['folder-office', 'exported-file-id'] });

    const result = await retryDriveExportCore(db, docId, {
      drive,
      downloadFile: async () => Buffer.from('fake-pdf-bytes'),
    });

    expect(createCalls).to.have.lengthOf(2);
    expect(result.success).to.be.true;
    expect(result.status).to.equal('exported');
    expect(result.error).to.be.null;
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.equal('exported');
    expect(data.driveFileId).to.equal('exported-file-id');
    expect(data.driveExportError).to.be.undefined; // 前回エラーがクリアされている
  });

  it('status !== error のdocはDriveExportNotRetryableErrorをthrowする(何も書き込まない)', async () => {
    const docId = await seedDocument({ driveExportStatus: 'exported', driveFileId: 'already-done' });
    const { drive, createCalls } = makeFakeDrive();

    let thrown: unknown;
    try {
      await retryDriveExportCore(db, docId, { drive, downloadFile: async () => Buffer.from('x') });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).to.be.instanceOf(DriveExportNotRetryableError);
    expect(createCalls).to.have.lengthOf(0);
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.equal('exported'); // 変化なし
    expect(data.driveFileId).to.equal('already-done');
  });

  it('存在しないdocIdはDriveExportNotRetryableErrorをthrowする', async () => {
    const { drive } = makeFakeDrive();

    let thrown: unknown;
    try {
      await retryDriveExportCore(db, 'non-existent-doc-id', {
        drive,
        downloadFile: async () => Buffer.from('x'),
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).to.be.instanceOf(DriveExportNotRetryableError);
  });

  it('更新対象外フィールド(customerName/fileName/officeName等)の値が変化しない(CLAUDE.md MUST)', async () => {
    const docId = await seedDocument({
      driveExportStatus: 'error',
      driveExportError: '前回のエラー',
      fileName: 'keep-me.pdf',
      customerName: '不変太郎',
      officeName: '不変事業所',
      mimeType: 'application/pdf',
      fileId: 'unchanged-file-id',
    });
    await seedCustomer();
    await db.doc('settings/drive').set({
      rootFolderId: 'root-folder-id',
      template: [{ type: 'fixed', value: '事業所A' }],
      furiganaFallback: 'stop',
    });
    const { drive } = makeFakeDrive({ createdIds: ['folder-office', 'exported-file-id'] });

    await retryDriveExportCore(db, docId, { drive, downloadFile: async () => Buffer.from('x') });

    const data = await getDoc(docId);
    expect(data.fileName).to.equal('keep-me.pdf');
    expect(data.customerName).to.equal('不変太郎');
    expect(data.officeName).to.equal('不変事業所');
    expect(data.mimeType).to.equal('application/pdf');
    expect(data.fileId).to.equal('unchanged-file-id');
  });

  it('同一docIdへの並行リトライ呼び出しでもexportDocumentは1回のみ実行される', async () => {
    const docId = await seedDocument({ driveExportStatus: 'error' });
    await seedCustomer();
    await db.doc('settings/drive').set({
      rootFolderId: 'root-folder-id',
      template: [{ type: 'fixed', value: '事業所A' }],
      furiganaFallback: 'stop',
    });
    const { drive, createCalls } = makeFakeDrive({ createdIds: ['folder-office', 'exported-file-id'] });

    const results = await Promise.allSettled([
      retryDriveExportCore(db, docId, { drive, downloadFile: async () => Buffer.from('x') }),
      retryDriveExportCore(db, docId, { drive, downloadFile: async () => Buffer.from('x') }),
    ]);

    // 1回のexportDocument実行=フォルダ作成1回+ファイル作成1回=create呼び出し2回。
    // 2回実行されていれば4回になるはずだが、常に2回に収まることを検証する。
    expect(createCalls).to.have.lengthOf(2);
    const fulfilledCount = results.filter((r) => r.status === 'fulfilled').length;
    const rejectedCount = results.filter((r) => r.status === 'rejected').length;
    expect(fulfilledCount).to.equal(1);
    expect(rejectedCount).to.equal(1); // 後発はクレーム失敗でDriveExportNotRetryableError
  });
});
