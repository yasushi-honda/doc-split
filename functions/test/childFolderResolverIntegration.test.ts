/**
 * Issue #811 Phase B Part A専用フォルダresolver(`functions/src/drive/childFolderResolver.ts`)のテスト。
 *
 * `findOrCreateFolderIntegration.test.ts`と同型の手書きfakeドライブ+Firestore emulatorで検証する。
 *
 * 2026-08-27追加の経緯: 本番の`findOrCreateFolder.ts`にPR #840で加えた「trashed込み単一検索」が
 * kanameone本番で回帰(active 1件+無関係なtrashed残骸を誤ってAmbiguousFolderError扱い)を起こし、
 * PR #842で2段階検索(activeのみ→0件時のみtrashed込み再検索)に訂正した。同じ設計を踏襲する
 * `childFolderResolver.ts`はコードレビューで「同じ回帰を引き起こしうる設計であるにもかかわらず
 * テストが一切存在しない」と指摘され、本ファイルで穴を埋める。
 *
 * 実行: firebase emulators:exec --only firestore --project find-or-create-folder-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { drive_v3 } from 'googleapis';
import { cleanupCollections } from './helpers/cleanupEmulator';
import {
  resolveChildFolder,
  resolveChildFolderPath,
  resolveChildFolderPathReadOnly,
  AmbiguousChildFolderError,
} from '../src/drive/childFolderResolver';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['driveFolderLocks'];

interface FakeFile {
  id: string;
  name: string;
  trashed?: boolean;
}

function makeFakeDrive(opts: {
  listFiles: FakeFile[];
  createdId?: string | null;
  updateImpl?: (params: Record<string, unknown>) => Promise<{ data: { id: string | null } }>;
}) {
  const listCalls: Record<string, unknown>[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const updateCalls: Record<string, unknown>[] = [];

  const drive = {
    files: {
      list: async (params: Record<string, unknown>) => {
        listCalls.push(params);
        const q = params.q as string;
        const wantTrashed = q.includes('trashed=true');
        const filtered = opts.listFiles.filter((f) => !!f.trashed === wantTrashed);
        return { data: { files: filtered } };
      },
      create: async (params: Record<string, unknown>) => {
        createCalls.push(params);
        return { data: { id: opts.createdId === undefined ? 'new-folder-id' : opts.createdId } };
      },
      update: async (params: Record<string, unknown>) => {
        updateCalls.push(params);
        if (opts.updateImpl) {
          return opts.updateImpl(params);
        }
        return { data: { id: params.fileId as string } };
      },
    },
  } as unknown as drive_v3.Drive;

  return { drive, listCalls, createCalls, updateCalls };
}

describe('resolveChildFolder (Issue #811 Phase B Part A)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('activeが1件見つかれば、無関係なtrashedの同名フォルダが他に残っていても一切考慮せずそのidを返す(kanameone本番回帰の再発防止)', async () => {
    const { drive, updateCalls, createCalls, listCalls } = makeFakeDrive({
      listFiles: [
        { id: 'active-report-id', name: '報告書', trashed: false },
        { id: 'stale-trashed-report-id', name: '報告書', trashed: true },
      ],
    });

    const result = await resolveChildFolder(drive, db, 'parent-customer', '報告書');

    expect(result).to.deep.equal({ id: 'active-report-id', restored: false, created: false });
    expect(updateCalls).to.have.lengthOf(0);
    expect(createCalls).to.have.lengthOf(0);
    expect(listCalls.every((c) => !(c.q as string).includes('trashed=true'))).to.equal(true);
  });

  it('active 0件・trashed 1件の場合は復元してrestored:trueで返す', async () => {
    const { drive, updateCalls, createCalls } = makeFakeDrive({
      listFiles: [{ id: 'trashed-id', name: '報告書', trashed: true }],
    });

    const result = await resolveChildFolder(drive, db, 'parent-customer', '報告書');

    expect(result).to.deep.equal({ id: 'trashed-id', restored: true, created: false });
    expect(updateCalls).to.have.lengthOf(1);
    expect(updateCalls[0].fileId).to.equal('trashed-id');
    expect(updateCalls[0].requestBody).to.deep.equal({ trashed: false });
    expect(createCalls).to.have.lengthOf(0);
  });

  it('active 0件・trashed 0件の場合は新規作成しcreated:trueで返す', async () => {
    const { drive, createCalls } = makeFakeDrive({ listFiles: [], createdId: 'new-id' });

    const result = await resolveChildFolder(drive, db, 'parent-customer', '報告書');

    expect(result).to.deep.equal({ id: 'new-id', restored: false, created: true });
    expect(createCalls).to.have.lengthOf(1);
  });

  it('activeが2件以上見つかった場合はAmbiguousChildFolderErrorをthrowし、trashed側は検索しない', async () => {
    const { drive, listCalls, createCalls } = makeFakeDrive({
      listFiles: [
        { id: 'dup-1', name: '報告書', trashed: false },
        { id: 'dup-2', name: '報告書', trashed: false },
      ],
    });

    try {
      await resolveChildFolder(drive, db, 'parent-customer', '報告書');
      expect.fail('AmbiguousChildFolderErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(AmbiguousChildFolderError);
      expect((error as Error).message).to.include('2件');
    }
    expect(createCalls).to.have.lengthOf(0);
    expect(listCalls.every((c) => !(c.q as string).includes('trashed=true'))).to.equal(true);
  });

  it('active 0件・trashedが2件以上見つかった場合もAmbiguousChildFolderErrorをthrowする', async () => {
    const { drive, createCalls } = makeFakeDrive({
      listFiles: [
        { id: 'trashed-dup-1', name: '報告書', trashed: true },
        { id: 'trashed-dup-2', name: '報告書', trashed: true },
      ],
    });

    try {
      await resolveChildFolder(drive, db, 'parent-customer', '報告書');
      expect.fail('AmbiguousChildFolderErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(AmbiguousChildFolderError);
      expect((error as Error).message).to.include('2件');
    }
    expect(createCalls).to.have.lengthOf(0);
  });

  it('復元API(files.update)が失敗した場合は新規作成へフォールバックせず例外を再送出する', async () => {
    const { drive, createCalls } = makeFakeDrive({
      listFiles: [{ id: 'trashed-id', name: '報告書', trashed: true }],
      updateImpl: async () => {
        throw new Error('simulated Drive API failure');
      },
    });

    try {
      await resolveChildFolder(drive, db, 'parent-customer', '報告書');
      expect.fail('復元失敗時の例外がthrowされるべき');
    } catch (error) {
      expect((error as Error).message).to.include('simulated Drive API failure');
    }
    expect(createCalls).to.have.lengthOf(0);
  });
});

describe('resolveChildFolderPath (Issue #811 Phase B Part A)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('複数segmentを順に解決し、restoredFolderIds/createdFolderIdsを蓄積する', async () => {
    // 1segment目: active 1件で即確定(restored/createdどちらもfalse)
    // 2segment目: active 0件+trashed 1件で復元
    const drive = {
      files: {
        list: async (params: Record<string, unknown>) => {
          const q = params.q as string;
          const wantTrashed = q.includes('trashed=true');
          if (q.includes(`name='顧客A'`)) {
            return { data: { files: wantTrashed ? [] : [{ id: 'customer-a-id', name: '顧客A', trashed: false }] } };
          }
          if (q.includes(`name='報告書'`)) {
            return {
              data: {
                files: wantTrashed ? [{ id: 'report-trashed-id', name: '報告書', trashed: true }] : [],
              },
            };
          }
          return { data: { files: [] } };
        },
        update: async () => ({ data: { id: 'report-trashed-id' } }),
      },
    } as unknown as drive_v3.Drive;

    const result = await resolveChildFolderPath(drive, db, 'root-id', ['顧客A', '報告書']);

    expect(result.id).to.equal('report-trashed-id');
    expect(result.restoredFolderIds).to.deep.equal(['report-trashed-id']);
    expect(result.createdFolderIds).to.deep.equal([]);
  });
});

describe('resolveChildFolderPathReadOnly (Issue #811 Phase B Part A)', () => {
  it('read-only版はfiles.create/files.updateを一切呼ばない(preflight用)', async () => {
    const createCalls: Record<string, unknown>[] = [];
    const updateCalls: Record<string, unknown>[] = [];
    const drive = {
      files: {
        list: async () => ({ data: { files: [{ id: 'active-id', name: '顧客A', trashed: false }] } }),
        create: async (params: Record<string, unknown>) => {
          createCalls.push(params);
          return { data: { id: 'should-not-be-used' } };
        },
        update: async (params: Record<string, unknown>) => {
          updateCalls.push(params);
          return { data: { id: 'should-not-be-used' } };
        },
      },
    } as unknown as drive_v3.Drive;

    const result = await resolveChildFolderPathReadOnly(drive, 'root-id', ['顧客A']);

    expect(result).to.equal('active-id');
    expect(createCalls).to.have.lengthOf(0);
    expect(updateCalls).to.have.lengthOf(0);
  });

  it('0件マッチの階層に到達した時点でnullを返す', async () => {
    const drive = {
      files: {
        list: async () => ({ data: { files: [] } }),
      },
    } as unknown as drive_v3.Drive;

    const result = await resolveChildFolderPathReadOnly(drive, 'root-id', ['未作成顧客']);

    expect(result).to.equal(null);
  });

  it('2件以上マッチした階層はAmbiguousChildFolderErrorをthrowする', async () => {
    const drive = {
      files: {
        list: async (params: Record<string, unknown>) => {
          const q = params.q as string;
          if (q.includes('trashed=true')) {
            return { data: { files: [] } };
          }
          return {
            data: {
              files: [
                { id: 'dup-1', name: '曖昧顧客', trashed: false },
                { id: 'dup-2', name: '曖昧顧客', trashed: false },
              ],
            },
          };
        },
      },
    } as unknown as drive_v3.Drive;

    try {
      await resolveChildFolderPathReadOnly(drive, 'root-id', ['曖昧顧客']);
      expect.fail('AmbiguousChildFolderErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(AmbiguousChildFolderError);
    }
  });
});
