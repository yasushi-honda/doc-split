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
 * 2026-08-30追加(Issue #871 PR-4): `resolveChildFolder()`をclaimプロトコルへ完全移行した。
 * claim固有の状態機械(3段ラダー・中断復旧・fail-closedエラー分類)自体は
 * `driveFolderClaimIntegration.test.ts`で網羅済みのため、本ファイルでは「resolveChildFolder()
 * がその状態機械を正しく呼び出しているか」「read-only関数が引き続きclaimコレクションに
 * 無関係のままか」に焦点を当てて追加する。
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
  resolveExistingChildFile,
  AmbiguousChildFolderError,
} from '../src/drive/childFolderResolver';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['driveFolderLocks', 'settings'];

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

/**
 * `driveFolderClaimIntegration.test.ts`と同型の、状態を保持するfake Drive
 * (`files.get`・appPropertiesタグ検索対応)。claimプロトコルの結果整合性再現・
 * 中断復旧テストにはfiles.create()の結果がfiles.list()へ反映される状態遷移が必要なため、
 * 上のシンプルなfakeとは別に用意する。
 */
interface ClaimAwareFakeFile {
  id: string;
  name: string;
  trashed?: boolean;
  parents: string[];
  appProperties?: Record<string, string>;
}

function parseParentId(q: string): string {
  const m = q.match(/^'([^']+)' in parents/);
  if (!m) throw new Error(`テストfakeが解釈できないクエリです: ${q}`);
  return m[1];
}

function makeClaimAwareFakeDrive(opts: { files?: ClaimAwareFakeFile[]; listReturnsEmpty?: boolean } = {}) {
  const store: ClaimAwareFakeFile[] = opts.files ?? [];
  const listCalls: Record<string, unknown>[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const getCalls: Record<string, unknown>[] = [];
  let createSeq = 0;

  const drive = {
    files: {
      list: async (params: Record<string, unknown>) => {
        listCalls.push(params);
        // 結果整合性遅延の再現(索引未反映): このモードでは常に0件を返す。
        if (opts.listReturnsEmpty) {
          return { data: { files: [] } };
        }
        const q = params.q as string;
        const parentId = parseParentId(q);
        if (q.includes('appProperties has')) {
          const valueMatch = q.match(/value='([^']*)'/);
          const value = valueMatch ? valueMatch[1] : '';
          const matches = store.filter(
            (f) => f.parents.includes(parentId) && f.appProperties?.docSplitFolderClaim === value
          );
          return { data: { files: matches.map((f) => ({ id: f.id, name: f.name, trashed: f.trashed })) } };
        }
        const nameMatch = q.match(/name='((?:[^'\\]|\\.)*)'/);
        const name = nameMatch ? nameMatch[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\') : '';
        const wantTrashed = q.includes('trashed=true');
        const matches = store.filter(
          (f) => f.parents.includes(parentId) && f.name === name && !!f.trashed === wantTrashed
        );
        return { data: { files: matches.map((f) => ({ id: f.id, name: f.name, trashed: f.trashed })) } };
      },
      create: async (params: Record<string, unknown>) => {
        createCalls.push(params);
        const requestBody = params.requestBody as {
          name: string;
          parents: string[];
          appProperties?: Record<string, string>;
        };
        const id = `created-${++createSeq}`;
        store.push({
          id,
          name: requestBody.name,
          parents: requestBody.parents,
          trashed: false,
          appProperties: requestBody.appProperties,
        });
        return { data: { id } };
      },
      update: async (params: Record<string, unknown>) => {
        const fileId = params.fileId as string;
        const requestBody = params.requestBody as { trashed?: boolean };
        const file = store.find((f) => f.id === fileId);
        if (file && requestBody.trashed !== undefined) {
          file.trashed = requestBody.trashed;
        }
        return { data: { id: fileId } };
      },
      get: async (params: Record<string, unknown>) => {
        getCalls.push(params);
        const fileId = params.fileId as string;
        const file = store.find((f) => f.id === fileId);
        if (!file) {
          const err = new Error('File not found') as Error & { status: number };
          err.status = 404;
          throw err;
        }
        return { data: { id: file.id, name: file.name, trashed: file.trashed, parents: file.parents } };
      },
    },
  } as unknown as drive_v3.Drive;

  return { drive, store, listCalls, createCalls, getCalls };
}

async function enableClaimRead(): Promise<void> {
  await db.doc('settings/features').set({ driveFolderClaimRead: true });
}

describe('resolveChildFolder: claimプロトコルへの参加(Issue #871 PR-4)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('files.listが索引未反映で常に0件を返す状況でも、逐次呼び出しでfiles.createはちょうど1回だけ実行される', async () => {
    await enableClaimRead();
    const { drive, createCalls } = makeClaimAwareFakeDrive({ listReturnsEmpty: true });

    const first = await resolveChildFolder(drive, db, 'parent-burst', '結果整合性太郎');
    expect(first.created).to.equal(true);
    expect(createCalls).to.have.lengthOf(1);

    for (let i = 0; i < 4; i++) {
      const result = await resolveChildFolder(drive, db, 'parent-burst', '結果整合性太郎');
      expect(result.id).to.equal(first.id);
    }

    expect(createCalls).to.have.lengthOf(1);
  });

  it('SOFT_TTL超過後にfiles.listが0件でも、resolved claimを信用してfiles.createを呼ばない(§4の要)', async () => {
    await enableClaimRead();
    // files.list()は索引未反映で0件を返し続けるが、files.get(id)は健全に解決できる状況
    // (実Drive APIの典型的な結果整合性遅延: list検索は遅延するがget直接参照は強整合)。
    const { drive, createCalls } = makeClaimAwareFakeDrive({
      listReturnsEmpty: true,
      files: [{ id: 'already-resolved-id', name: '陳腐化太郎', parents: ['parent-stale'], trashed: false }],
    });
    await db
      .collection('driveFolderLocks')
      .doc(Buffer.from('parent-stale/陳腐化太郎').toString('base64url'))
      .set({
        state: 'resolved',
        folderId: 'already-resolved-id',
        attempt: null,
        resolvedAtMs: Date.now() - 10 * 60 * 1000,
        verifiedAtMs: Date.now() - 10 * 60 * 1000, // SOFT_TTL_MS(5分)超過 → 完全再検索へ
        parentId: 'parent-stale',
        name: '陳腐化太郎',
      });

    const result = await resolveChildFolder(drive, db, 'parent-stale', '陳腐化太郎');

    expect(result).to.deep.equal({ id: 'already-resolved-id', restored: false, created: false });
    expect(createCalls).to.have.lengthOf(0);
  });

  it('SOFT_TTL窓内でclaimのfolderIdがtrashed済みと判明した場合、復元しrestored:trueで返す(rollback manifest用フラグの伝播)', async () => {
    await enableClaimRead();
    const { drive } = makeClaimAwareFakeDrive({
      files: [{ id: 'trashed-claim-id', name: '復元太郎', parents: ['parent-verify'], trashed: true }],
    });
    await db
      .collection('driveFolderLocks')
      .doc(Buffer.from('parent-verify/復元太郎').toString('base64url'))
      .set({
        state: 'resolved',
        folderId: 'trashed-claim-id',
        attempt: null,
        resolvedAtMs: Date.now() - 2 * 60 * 1000,
        verifiedAtMs: Date.now() - 2 * 60 * 1000, // CREATE_TRUST_MS超過・SOFT_TTL_MS未満 → files.getのみ
        parentId: 'parent-verify',
        name: '復元太郎',
      });

    const result = await resolveChildFolder(drive, db, 'parent-verify', '復元太郎');

    expect(result).to.deep.equal({ id: 'trashed-claim-id', restored: true, created: false });
  });

  it('shadowモード(driveFolderClaimRead未設定)でもclaimは書き込まれる(既存挙動には影響しない)', async () => {
    const { drive, createCalls } = makeClaimAwareFakeDrive();

    const result = await resolveChildFolder(drive, db, 'parent-shadow', '影太郎');

    expect(result.created).to.equal(true);
    expect(createCalls).to.have.lengthOf(1);
    const snap = await db
      .collection('driveFolderLocks')
      .doc(Buffer.from('parent-shadow/影太郎').toString('base64url'))
      .get();
    expect(snap.exists).to.equal(true);
    expect(snap.data()?.state).to.equal('resolved');
    expect(snap.data()?.folderId).to.equal(result.id);
  });
});

describe('read-only関数はclaimコレクションに一切アクセスしない(診断の独立性の回帰防止)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('resolveExistingChildFileを繰り返し呼んでもdriveFolderLocksに書き込みが発生しない', async () => {
    const { drive } = makeClaimAwareFakeDrive({
      files: [{ id: 'active-id', name: '読取太郎', parents: ['parent-readonly'], trashed: false }],
    });

    for (let i = 0; i < 3; i++) {
      await resolveExistingChildFile(drive, 'parent-readonly', '読取太郎');
    }

    const snap = await db.collection('driveFolderLocks').get();
    expect(snap.empty).to.equal(true);
  });

  it('resolveChildFolderPathReadOnlyを呼んでもdriveFolderLocksに書き込みが発生しない', async () => {
    const { drive } = makeClaimAwareFakeDrive({
      files: [{ id: 'active-id', name: '読取太郎', parents: ['root-id'], trashed: false }],
    });

    await resolveChildFolderPathReadOnly(drive, 'root-id', ['読取太郎']);

    const snap = await db.collection('driveFolderLocks').get();
    expect(snap.empty).to.equal(true);
  });
});
