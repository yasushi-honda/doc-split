/**
 * Google Drive フォルダ claim プロトコル(Issue #871恒久対策)のテスト
 *
 * `findOrCreateFolderIntegration.test.ts`と同型の手書きfakeドライブ+Firestore emulatorで
 * 検証する。本ファイルは`driveFolderClaim.ts`が導入する新しい状態機械(結果整合性遅延への
 * 耐性・中断復旧・fail-closedなfiles.getエラー分類)に焦点を当てる。
 * 既存の検索/trashed復元/曖昧検知の挙動は`findOrCreateFolderIntegration.test.ts`側で
 * 引き続き検証される(claimプロトコル導入で無改変)。
 *
 * 実行: firebase emulators:exec --only firestore --project find-or-create-folder-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { drive_v3 } from 'googleapis';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { findOrCreateFolder, AmbiguousFolderError, FolderCreationInProgressError } from '../src/drive/findOrCreateFolder';
import { DivergentFolderClaimError, buildFolderLockId } from '../src/drive/driveFolderClaim';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['driveFolderLocks', 'settings'];

interface FakeFile {
  id: string;
  name: string;
  trashed?: boolean;
  parents: string[];
  appProperties?: Record<string, string>;
}

interface FakeDriveOptions {
  files?: FakeFile[];
  createdIdFactory?: () => string;
  getImpl?: (fileId: string) => Promise<{ data: { id: string; trashed?: boolean; parents?: string[] } }>;
}

function parseParentId(q: string): string {
  const m = q.match(/^'([^']+)' in parents/);
  if (!m) throw new Error(`テストfakeが解釈できないクエリです: ${q}`);
  return m[1];
}

function makeFakeDrive(opts: FakeDriveOptions = {}) {
  const store: FakeFile[] = opts.files ?? [];
  const listCalls: Record<string, unknown>[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const updateCalls: Record<string, unknown>[] = [];
  const getCalls: Record<string, unknown>[] = [];
  let createSeq = 0;

  const drive = {
    files: {
      list: async (params: Record<string, unknown>) => {
        listCalls.push(params);
        const q = params.q as string;
        const parentId = parseParentId(q);
        if (q.includes('appProperties has')) {
          const valueMatch = q.match(/value='([^']*)'/);
          const value = valueMatch ? valueMatch[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\') : '';
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
        const id = opts.createdIdFactory ? opts.createdIdFactory() : `created-${++createSeq}`;
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
        updateCalls.push(params);
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
        if (opts.getImpl) {
          return opts.getImpl(fileId);
        }
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

  return { drive, store, listCalls, createCalls, updateCalls, getCalls };
}

async function enableClaimRead(): Promise<void> {
  await db.doc('settings/features').set({ driveFolderClaimRead: true });
}

function claimDocRef(parentId: string, name: string) {
  return db.collection('driveFolderLocks').doc(buildFolderLockId(parentId, name));
}

describe('driveFolderClaim プロトコル(Issue #871)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  describe('shadowモード(既定、driveFolderClaimRead未設定)', () => {
    it('claimの読み経路は無効なまま、書き込みのみ行われる(既存挙動への影響ゼロ)', async () => {
      const { drive, createCalls } = makeFakeDrive();
      const result = await findOrCreateFolder(drive, db, 'parent-shadow', '影太郎');
      expect(result).to.equal('created-1');
      expect(createCalls).to.have.lengthOf(1);

      const snap = await claimDocRef('parent-shadow', '影太郎').get();
      expect(snap.exists).to.equal(true);
      expect(snap.data()?.state).to.equal('resolved');
      expect(snap.data()?.folderId).to.equal('created-1');
    });

    it('shadowモードでは結果整合性の遅延を防げず、files.listが0件を返し続ける限り複数回作成されうる(read有効化前の既知の限界)', async () => {
      const { drive, createCalls } = makeFakeDrive();
      // files.list が常に0件を返す(索引未反映を模擬)よう、listだけ差し替える
      (drive.files as unknown as { list: unknown }).list = async () => ({ data: { files: [] } });

      await findOrCreateFolder(drive, db, 'parent-lag', '遅延太郎');
      await findOrCreateFolder(drive, db, 'parent-lag', '遅延太郎');

      expect(createCalls).to.have.lengthOf(2);
    });
  });

  describe('読み経路有効化(driveFolderClaimRead=true)後の結果整合性再現テスト', () => {
    it('files.listの結果整合性遅延下でも、同一parent+nameへ逐次5回呼んでもfiles.createはちょうど1回', async () => {
      await enableClaimRead();
      const { drive, createCalls } = makeFakeDrive();
      // files.list は常に0件を返す(索引未反映を模擬)。read有効時はCREATE_TRUST_MSの
      // 短絡でこの0件応答自体が参照されなくなることを検証する。
      (drive.files as unknown as { list: unknown }).list = async () => ({ data: { files: [] } });

      const results: string[] = [];
      for (let i = 0; i < 5; i++) {
        results.push(await findOrCreateFolder(drive, db, 'parent-repro', '結果整合性太郎'));
      }

      expect(createCalls).to.have.lengthOf(1);
      expect(new Set(results).size).to.equal(1);
      expect(results[0]).to.equal('created-1');
    });
  });

  describe('3段ラダー(CREATE_TRUST_MS/SOFT_TTL_MS境界)', () => {
    it('CREATE_TRUST_MS(60秒)未満は Drive API を一切呼ばずclaimのfolderIdを返す', async () => {
      await enableClaimRead();
      await claimDocRef('parent-ladder', '境界太郎').set({
        state: 'resolved',
        folderId: 'trusted-id',
        attempt: null,
        resolvedAtMs: Date.now() - 30 * 1000,
        verifiedAtMs: Date.now() - 30 * 1000,
        parentId: 'parent-ladder',
        name: '境界太郎',
      });
      const { drive, listCalls, getCalls } = makeFakeDrive();

      const result = await findOrCreateFolder(drive, db, 'parent-ladder', '境界太郎');

      expect(result).to.equal('trusted-id');
      expect(listCalls).to.have.lengthOf(0);
      expect(getCalls).to.have.lengthOf(0);
    });

    it('CREATE_TRUST_MS〜SOFT_TTL_MSの間はfiles.getのみ呼び、files.listは呼ばない', async () => {
      await enableClaimRead();
      await claimDocRef('parent-ladder2', '検証太郎').set({
        state: 'resolved',
        folderId: 'verify-id',
        attempt: null,
        resolvedAtMs: Date.now() - 2 * 60 * 1000,
        verifiedAtMs: Date.now() - 2 * 60 * 1000, // CREATE_TRUST_MS超過・SOFT_TTL_MS(5分)未満
        parentId: 'parent-ladder2',
        name: '検証太郎',
      });
      const { drive, listCalls, getCalls } = makeFakeDrive({
        files: [{ id: 'verify-id', name: '検証太郎', parents: ['parent-ladder2'], trashed: false }],
      });

      const result = await findOrCreateFolder(drive, db, 'parent-ladder2', '検証太郎');

      expect(result).to.equal('verify-id');
      expect(getCalls).to.have.lengthOf(1);
      expect(listCalls).to.have.lengthOf(0);
    });

    it('SOFT_TTL_MS(5分)超過後は完全検索(files.list)が復活し、AmbiguousFolderErrorの検知力も戻る', async () => {
      await enableClaimRead();
      await claimDocRef('parent-ladder3', '完全検索太郎').set({
        state: 'resolved',
        folderId: 'stale-scan-id',
        attempt: null,
        resolvedAtMs: Date.now() - 10 * 60 * 1000,
        verifiedAtMs: Date.now() - 10 * 60 * 1000, // SOFT_TTL_MS超過
        parentId: 'parent-ladder3',
        name: '完全検索太郎',
      });
      const { drive, listCalls, getCalls } = makeFakeDrive({
        files: [
          { id: 'dup-1', name: '完全検索太郎', parents: ['parent-ladder3'], trashed: false },
          { id: 'dup-2', name: '完全検索太郎', parents: ['parent-ladder3'], trashed: false },
        ],
      });

      try {
        await findOrCreateFolder(drive, db, 'parent-ladder3', '完全検索太郎');
        expect.fail('AmbiguousFolderErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(AmbiguousFolderError);
      }
      expect(listCalls.length).to.be.greaterThan(0);
      expect(getCalls).to.have.lengthOf(0);
    });
  });

  describe('SOFT_TTL超過後の完全再検索が0件のケース(§4の要)', () => {
    it('resolved claimがあるのに完全再検索が0件でも、claimを信用しfiles.createを呼ばない', async () => {
      await enableClaimRead();
      await claimDocRef('parent-trust0', '信頼太郎').set({
        state: 'resolved',
        folderId: 'ghost-id',
        attempt: null,
        resolvedAtMs: Date.now() - 10 * 60 * 1000,
        verifiedAtMs: Date.now() - 10 * 60 * 1000,
        parentId: 'parent-trust0',
        name: '信頼太郎',
      });
      // files.list は0件(索引未反映)だが、files.get(ghost-id)は健全に200を返す
      const { drive, createCalls } = makeFakeDrive({
        files: [{ id: 'ghost-id', name: '信頼太郎', parents: ['parent-trust0'], trashed: false }],
      });
      (drive.files as unknown as { list: unknown }).list = async () => ({ data: { files: [] } });

      const result = await findOrCreateFolder(drive, db, 'parent-trust0', '信頼太郎');

      expect(result).to.equal('ghost-id');
      expect(createCalls).to.have.lengthOf(0);
    });
  });

  describe('中断復旧(reconcileAttempt)', () => {
    it('予約後・create前に死亡し、猶予(RECONCILE_GRACE_MS)未満の場合はFolderCreationInProgressErrorで待機し、createは呼ばない', async () => {
      await enableClaimRead();
      await claimDocRef('parent-crash1', '予約太郎').set({
        state: 'creating',
        // 開始から2分経過(RECONCILE_GRACE_MS=10分未満)。attemptIdタグ検索も0件(=まだ
        // 作成されていないか、索引未反映)なので待機すべきケース。
        attempt: { attemptId: 'attempt-1', startedAtMs: Date.now() - 2 * 60 * 1000, runId: 'old-run' },
        parentId: 'parent-crash1',
        name: '予約太郎',
      });
      const { drive, createCalls } = makeFakeDrive();

      try {
        await findOrCreateFolder(drive, db, 'parent-crash1', '予約太郎');
        expect.fail('FolderCreationInProgressErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(FolderCreationInProgressError);
      }
      expect(createCalls).to.have.lengthOf(0);
    });

    it('予約後・create前に死亡し、猶予超過の場合はclaimがinvalidatedになり通常の新規作成へフォールバックする', async () => {
      await enableClaimRead();
      await claimDocRef('parent-crash2', '猶予超過太郎').set({
        state: 'creating',
        attempt: { attemptId: 'attempt-2', startedAtMs: Date.now() - 21 * 60 * 1000, runId: 'old-run' }, // 猶予(10分)超過
        parentId: 'parent-crash2',
        name: '猶予超過太郎',
      });
      const { drive, createCalls } = makeFakeDrive();

      const result = await findOrCreateFolder(drive, db, 'parent-crash2', '猶予超過太郎');

      expect(result).to.equal('created-1');
      expect(createCalls).to.have.lengthOf(1);
      const snap = await claimDocRef('parent-crash2', '猶予超過太郎').get();
      expect(snap.data()?.state).to.equal('resolved');
      expect(snap.data()?.folderId).to.equal('created-1');
    });

    it('create後・確定書込み前に死亡した場合、appPropertiesタグ検索で作成事実を回収し、新規createは呼ばない', async () => {
      await enableClaimRead();
      await claimDocRef('parent-crash3', '回収太郎').set({
        state: 'creating',
        attempt: { attemptId: 'attempt-3', startedAtMs: Date.now() - 11 * 60 * 1000, runId: 'old-run' },
        parentId: 'parent-crash3',
        name: '回収太郎',
      });
      // files.listの名前検索は索引未反映で0件を返すが、Drive側には実際にattempt-3タグ付きの
      // フォルダが既に存在する(前任者のcreateはDrive側では成功していた)
      const { drive, createCalls } = makeFakeDrive({
        files: [
          {
            id: 'recovered-id',
            name: '回収太郎',
            parents: ['parent-crash3'],
            trashed: false,
            appProperties: { docSplitFolderClaim: 'attempt-3' },
          },
        ],
      });

      const result = await findOrCreateFolder(drive, db, 'parent-crash3', '回収太郎');

      expect(result).to.equal('recovered-id');
      expect(createCalls).to.have.lengthOf(0);
      const snap = await claimDocRef('parent-crash3', '回収太郎').get();
      expect(snap.data()?.state).to.equal('resolved');
      expect(snap.data()?.folderId).to.equal('recovered-id');
    });

    it('タグ付きフォルダが2件以上見つかった場合はAmbiguousFolderErrorをthrowする', async () => {
      await enableClaimRead();
      await claimDocRef('parent-crash4', '重複回収太郎').set({
        state: 'creating',
        attempt: { attemptId: 'attempt-4', startedAtMs: Date.now() - 11 * 60 * 1000, runId: 'old-run' },
        parentId: 'parent-crash4',
        name: '重複回収太郎',
      });
      const { drive } = makeFakeDrive({
        files: [
          {
            id: 'dup-a',
            name: '重複回収太郎',
            parents: ['parent-crash4'],
            trashed: false,
            appProperties: { docSplitFolderClaim: 'attempt-4' },
          },
          {
            id: 'dup-b',
            name: '重複回収太郎',
            parents: ['parent-crash4'],
            trashed: false,
            appProperties: { docSplitFolderClaim: 'attempt-4' },
          },
        ],
      });

      try {
        await findOrCreateFolder(drive, db, 'parent-crash4', '重複回収太郎');
        expect.fail('AmbiguousFolderErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(AmbiguousFolderError);
      }
    });
  });

  describe('fail-closedなfiles.getエラー分類(§3)', () => {
    it('404: missCountが閾値未満のうちはFolderVerificationPendingErrorをthrowし、claimは無効化されない', async () => {
      await enableClaimRead();
      await claimDocRef('parent-404', '保留太郎').set({
        state: 'resolved',
        folderId: 'maybe-gone-id',
        attempt: null,
        resolvedAtMs: Date.now() - 2 * 60 * 1000,
        verifiedAtMs: Date.now() - 2 * 60 * 1000,
        parentId: 'parent-404',
        name: '保留太郎',
      });
      const { drive } = makeFakeDrive({ files: [] }); // files.get対象が存在しない=404

      try {
        await findOrCreateFolder(drive, db, 'parent-404', '保留太郎');
        expect.fail('エラーがthrowされるべき');
      } catch (error) {
        expect((error as Error).name).to.equal('FolderVerificationPendingError');
      }
      const snap = await claimDocRef('parent-404', '保留太郎').get();
      expect(snap.data()?.state).to.equal('resolved');
      expect(snap.data()?.missCount).to.equal(1);
    });

    it('403(権限不足): DrivePermissionErrorをthrowし、claimは無効化されない', async () => {
      await enableClaimRead();
      await claimDocRef('parent-403', '権限太郎').set({
        state: 'resolved',
        folderId: 'perm-id',
        attempt: null,
        resolvedAtMs: Date.now() - 2 * 60 * 1000,
        verifiedAtMs: Date.now() - 2 * 60 * 1000,
        parentId: 'parent-403',
        name: '権限太郎',
      });
      const { drive } = makeFakeDrive({
        getImpl: async () => {
          const err = new Error('permission denied') as Error & { status: number };
          err.status = 403;
          throw err;
        },
      });

      try {
        await findOrCreateFolder(drive, db, 'parent-403', '権限太郎');
        expect.fail('エラーがthrowされるべき');
      } catch (error) {
        expect((error as Error).name).to.equal('DrivePermissionError');
      }
      const snap = await claimDocRef('parent-403', '権限太郎').get();
      expect(snap.data()?.state).to.equal('resolved');
    });

    it('name不一致(Drive UI上でのリネーム): divergentへ遷移しDivergentFolderClaimErrorをthrowする(codex review指摘対応)', async () => {
      await enableClaimRead();
      await claimDocRef('parent-rename', '旧名太郎').set({
        state: 'resolved',
        folderId: 'renamed-id',
        attempt: null,
        resolvedAtMs: Date.now() - 2 * 60 * 1000,
        verifiedAtMs: Date.now() - 2 * 60 * 1000,
        parentId: 'parent-rename',
        name: '旧名太郎',
      });
      // Drive UI上で「新名太郎」へリネームされたが、親フォルダは変わっていないケース
      const { drive, createCalls } = makeFakeDrive({
        files: [{ id: 'renamed-id', name: '新名太郎', parents: ['parent-rename'], trashed: false }],
      });

      try {
        await findOrCreateFolder(drive, db, 'parent-rename', '旧名太郎');
        expect.fail('DivergentFolderClaimErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(DivergentFolderClaimError);
      }
      expect(createCalls).to.have.lengthOf(0);
      const snap = await claimDocRef('parent-rename', '旧名太郎').get();
      expect(snap.data()?.state).to.equal('divergent');
    });

    it('parents不一致(人力移動): divergentへ遷移しDivergentFolderClaimErrorをthrowする(削除も再作成もしない)', async () => {
      await enableClaimRead();
      await claimDocRef('parent-orig', '移動太郎').set({
        state: 'resolved',
        folderId: 'moved-id',
        attempt: null,
        resolvedAtMs: Date.now() - 2 * 60 * 1000,
        verifiedAtMs: Date.now() - 2 * 60 * 1000,
        parentId: 'parent-orig',
        name: '移動太郎',
      });
      const { drive, createCalls } = makeFakeDrive({
        files: [{ id: 'moved-id', name: '移動太郎', parents: ['some-other-parent'], trashed: false }],
      });

      try {
        await findOrCreateFolder(drive, db, 'parent-orig', '移動太郎');
        expect.fail('DivergentFolderClaimErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(DivergentFolderClaimError);
      }
      expect(createCalls).to.have.lengthOf(0);
      const snap = await claimDocRef('parent-orig', '移動太郎').get();
      expect(snap.data()?.state).to.equal('divergent');
    });

    it('404累積: missCountが閾値(3回)・経過時間(10分)・異なるrunId(2件)を全て満たして初めてinvalidatedになる', async () => {
      await enableClaimRead();
      const ref = claimDocRef('parent-miss', '累積太郎');
      await ref.set({
        state: 'resolved',
        folderId: 'flaky-id',
        attempt: null,
        resolvedAtMs: Date.now() - 2 * 60 * 1000,
        verifiedAtMs: Date.now() - 2 * 60 * 1000,
        parentId: 'parent-miss',
        name: '累積太郎',
      });
      const { drive } = makeFakeDrive({ files: [] });

      // 1回目: missCount=1
      await findOrCreateFolder(drive, db, 'parent-miss', '累積太郎').catch(() => {});
      expect((await ref.get()).data()?.state).to.equal('resolved');

      // verifiedAtMsを再びCREATE_TRUST_MS超過・SOFT_TTL_MS未満の位置へ戻す(1回目呼び出しで
      // 更新されないためそのままでよいが、firstMissAtMsを10分以上過去に強制して経過条件も満たす)
      await ref.update({ firstMissAtMs: Date.now() - 11 * 60 * 1000, verifiedAtMs: Date.now() - 2 * 60 * 1000 });

      // 2回目: 異なるrunId(呼び出しごとにfindOrCreateFolderが新しいrunIdを生成)でmissCount=2
      await findOrCreateFolder(drive, db, 'parent-miss', '累積太郎').catch(() => {});
      expect((await ref.get()).data()?.state).to.equal('resolved');
      expect((await ref.get()).data()?.missCount).to.equal(2);

      // 3回目: 閾値(3)・経過(10分超)・異なるrunId(2件以上)を全て満たしinvalidatedへ
      await findOrCreateFolder(drive, db, 'parent-miss', '累積太郎').catch(() => {});
      expect((await ref.get()).data()?.state).to.equal('invalidated');
    });
  });

  describe('旧形式ロック残骸(attempt無し)との互換性', () => {
    it('旧形式(state欠損、claimedAtMs/lockTokenのみ)のドキュメントが有効なリース内ならFolderCreationInProgressError', async () => {
      await claimDocRef('parent-legacy1', '旧形式太郎').set({
        claimedAtMs: Date.now(),
        lockToken: 'legacy-token',
      });
      const { drive, createCalls } = makeFakeDrive();

      try {
        await findOrCreateFolder(drive, db, 'parent-legacy1', '旧形式太郎');
        expect.fail('FolderCreationInProgressErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(FolderCreationInProgressError);
      }
      expect(createCalls).to.have.lengthOf(0);
    });

    it('旧形式のドキュメントがFOLDER_LOCK_STALE_MS超過なら上書き取得して新規作成できる', async () => {
      await claimDocRef('parent-legacy2', '旧形式陳腐化太郎').set({
        claimedAtMs: Date.now() - 11 * 60 * 1000,
        lockToken: 'legacy-token',
      });
      const { drive, createCalls } = makeFakeDrive();

      const result = await findOrCreateFolder(drive, db, 'parent-legacy2', '旧形式陳腐化太郎');

      expect(result).to.equal('created-1');
      expect(createCalls).to.have.lengthOf(1);
    });
  });
});
