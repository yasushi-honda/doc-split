/**
 * `functions/src/drive/driveExportScheduled.ts` 統合テスト(ADR-0022 Phase 1 Task8, Firestore emulator)
 *
 * `onSchedule`のCloudEvent配管から独立させた`sweepStuckDriveExports`を直接テストする
 * (`rescueStuckProcessingDocs`と同型パターン)。
 *
 * 実行: firebase emulators:exec --only firestore --project drive-export-scheduled-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { drive_v3 } from 'googleapis';
import { cleanupCollections } from './helpers/cleanupEmulator';
import {
  sweepStuckDriveExports,
  DRIVE_EXPORT_SCHEDULED_BATCH_SIZE,
  DRIVE_EXPORT_ERROR_RETRY_THRESHOLD_MS,
  DRIVE_EXPORT_STUCK_EXPORTING_THRESHOLD_MS,
} from '../src/drive/driveExportScheduled';
import { MASTER_PATHS } from '../src/utils/masterPaths';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'settings', MASTER_PATHS.customers];
// 境界より確実に過去/未来になるよう +60s のバッファ
const BUFFER_MS = 60_000;

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

async function seedDriveSettings(): Promise<void> {
  await db.doc('settings/drive').set({
    rootFolderId: 'root-folder-id',
    template: [{ type: 'fixed', value: '事業所A' }],
    furiganaFallback: 'stop',
  });
}

async function getDoc(docId: string) {
  const snap = await db.doc(`documents/${docId}`).get();
  return snap.data()!;
}

describe('sweepStuckDriveExports (ADR-0022 Phase 1 Task8)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
    await seedCustomer();
    await seedDriveSettings();
  });

  it('error状態で閾値(1時間)以上経過したdocは再エンキューされ成功時はexportedへ遷移する', async () => {
    const docId = await seedDocument({
      driveExportStatus: 'error',
      driveExportError: '古いエラー',
      updatedAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - DRIVE_EXPORT_ERROR_RETRY_THRESHOLD_MS - BUFFER_MS
      ),
    });
    const { drive, createCalls } = makeFakeDrive({ createdIds: ['folder-office', 'exported-file-id'] });

    const result = await sweepStuckDriveExports(db, {
      drive,
      downloadFile: async () => Buffer.from('x'),
    });

    expect(result).to.deep.equal({ requeued: 1, skipped: 0 });
    expect(createCalls).to.have.lengthOf(2);
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.equal('exported');
  });

  it('error状態でまだ閾値未満のdocはスキップされる(直近の失敗を連続リトライしない)', async () => {
    await seedDocument({
      driveExportStatus: 'error',
      driveExportError: '直近のエラー',
      updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 5 * 60 * 1000), // 5分前
    });
    const { drive, createCalls } = makeFakeDrive();

    const result = await sweepStuckDriveExports(db, {
      drive,
      downloadFile: async () => Buffer.from('x'),
    });

    expect(result).to.deep.equal({ requeued: 0, skipped: 1 });
    expect(createCalls).to.have.lengthOf(0);
  });

  it('exporting状態で閾値(10分)以上経過したdoc(クラッシュ想定)は再エンキューされる', async () => {
    const docId = await seedDocument({
      driveExportStatus: 'exporting',
      updatedAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - DRIVE_EXPORT_STUCK_EXPORTING_THRESHOLD_MS - BUFFER_MS
      ),
    });
    const { drive, createCalls } = makeFakeDrive({ createdIds: ['folder-office', 'exported-file-id'] });

    const result = await sweepStuckDriveExports(db, {
      drive,
      downloadFile: async () => Buffer.from('x'),
    });

    expect(result).to.deep.equal({ requeued: 1, skipped: 0 });
    expect(createCalls).to.have.lengthOf(2);
    const data = await getDoc(docId);
    expect(data.driveExportStatus).to.equal('exported');
  });

  it('exporting状態でまだ閾値未満のdoc(実行中の可能性)はスキップされる', async () => {
    await seedDocument({
      driveExportStatus: 'exporting',
      updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 1000), // 30秒前
    });
    const { drive, createCalls } = makeFakeDrive();

    const result = await sweepStuckDriveExports(db, {
      drive,
      downloadFile: async () => Buffer.from('x'),
    });

    expect(result).to.deep.equal({ requeued: 0, skipped: 1 });
    expect(createCalls).to.have.lengthOf(0);
  });

  it('exported状態のdocは対象外(クエリで除外される)', async () => {
    await seedDocument({
      driveExportStatus: 'exported',
      driveFileId: 'already-done',
      updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000),
    });
    const { drive, createCalls } = makeFakeDrive();

    const result = await sweepStuckDriveExports(db, {
      drive,
      downloadFile: async () => Buffer.from('x'),
    });

    expect(result).to.deep.equal({ requeued: 0, skipped: 0 });
    expect(createCalls).to.have.lengthOf(0);
  });

  it(`1回のスイープで再エンキューする件数はDRIVE_EXPORT_SCHEDULED_BATCH_SIZE(${DRIVE_EXPORT_SCHEDULED_BATCH_SIZE})件を超えない`, async () => {
    const staleUpdatedAt = admin.firestore.Timestamp.fromMillis(
      Date.now() - DRIVE_EXPORT_ERROR_RETRY_THRESHOLD_MS - BUFFER_MS
    );
    const overBatchCount = DRIVE_EXPORT_SCHEDULED_BATCH_SIZE + 3;
    await Promise.all(
      Array.from({ length: overBatchCount }, () =>
        seedDocument({ driveExportStatus: 'error', updatedAt: staleUpdatedAt })
      )
    );
    const { drive } = makeFakeDrive({
      createdIds: Array.from({ length: overBatchCount * 2 }, (_, i) => `id-${i}`),
    });

    const result = await sweepStuckDriveExports(db, {
      drive,
      downloadFile: async () => Buffer.from('x'),
    });

    expect(result.requeued).to.equal(DRIVE_EXPORT_SCHEDULED_BATCH_SIZE);
  });

  it('更新対象外フィールド(customerName/fileName/officeName等)の値が変化しない(CLAUDE.md MUST)', async () => {
    const docId = await seedDocument({
      driveExportStatus: 'error',
      driveExportError: '古いエラー',
      updatedAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - DRIVE_EXPORT_ERROR_RETRY_THRESHOLD_MS - BUFFER_MS
      ),
      fileName: 'keep-me.pdf',
      customerName: '不変太郎',
      officeName: '不変事業所',
      mimeType: 'application/pdf',
      fileId: 'unchanged-file-id',
    });
    const { drive } = makeFakeDrive({ createdIds: ['folder-office', 'exported-file-id'] });

    await sweepStuckDriveExports(db, { drive, downloadFile: async () => Buffer.from('x') });

    const data = await getDoc(docId);
    expect(data.fileName).to.equal('keep-me.pdf');
    expect(data.customerName).to.equal('不変太郎');
    expect(data.officeName).to.equal('不変事業所');
    expect(data.mimeType).to.equal('application/pdf');
    expect(data.fileId).to.equal('unchanged-file-id');
  });

  it('対象docが0件の場合は何もせずrequeued/skipped共に0を返す', async () => {
    const { drive, createCalls } = makeFakeDrive();

    const result = await sweepStuckDriveExports(db, {
      drive,
      downloadFile: async () => Buffer.from('x'),
    });

    expect(result).to.deep.equal({ requeued: 0, skipped: 0 });
    expect(createCalls).to.have.lengthOf(0);
  });
});
