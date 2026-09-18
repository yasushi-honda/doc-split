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
import {
  findOrCreateFolder,
  AmbiguousFolderError,
  FolderCreationInProgressError,
} from '../src/drive/findOrCreateFolder';
import {
  DivergentFolderClaimError,
  FolderClaimRestoreCommitError,
  FolderVerificationPendingError,
  buildFolderLockId,
  commitResolvedWithRetry,
  resolveDivergentClaim,
  releaseDivergentClaim,
  beginCreation,
  recordFullScanResolution,
  invalidateResolvedClaimByFolderId,
  invalidateCreatingClaimByAttemptId,
  reconcileAttempt,
  verifyFolderClaim,
  readClaim,
  FOLDER_CLAIM_TX_RETRY_ATTEMPTS,
  RECONCILE_GRACE_MS,
  FOLDER_LOCK_STALE_MS,
  type ResolvedFolderClaim,
  type FolderClaimAttempt,
  type FolderClaimDoc,
} from '../src/drive/driveFolderClaim';
import { classifyDriveExportErrorKind } from '../src/drive/executeDriveExport';
import { resolveChildFolder } from '../src/drive/childFolderResolver';

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

/**
 * `runTransaction`だけを差し替えたfirestoreラッパ。`collection`/`doc`は実dbへ委譲するため、
 * 返される参照は実dbのFirestore emulatorに対して有効。commitResolvedWithRetryの
 * リトライ(withBackoffRetry)を意図的に失敗させ、「files.create()成功後にFirestoreへの
 * 確定書込みだけが失敗する」状況(codex review P1指摘)を再現するために使う。
 *
 * Issue #954で`driveFolderClaim.ts`内の10関数に追加された`withBackoffRetry`は
 * `isRetryableFirestoreError`(gRPC transientコードのみリトライ)を`shouldRetry`として
 * 渡すため、`errorCode`(既定14=UNAVAILABLE、transient)を持つ合成エラーを投げる。
 * 非transientコード(例: 7=PERMISSION_DENIED)を指定すれば「リトライされない」ことの
 * 検証に使える。`getTxCallCount()`で実際の`runTransaction`呼び出し回数を検証できる。
 */
function makeFailingCommitFirestore(
  realDb: admin.firestore.Firestore,
  failTxCallIndices: readonly number[],
  errorCode = 14
): { firestore: admin.firestore.Firestore; getTxCallCount: () => number } {
  let txCalls = 0;
  const firestore = {
    collection: (path: string) => realDb.collection(path),
    doc: (path: string) => realDb.doc(path),
    runTransaction: async (updateFn: (tx: admin.firestore.Transaction) => Promise<unknown>) => {
      txCalls++;
      if (failTxCallIndices.includes(txCalls)) {
        const err = new Error(`simulated Firestore transaction failure (call #${txCalls})`) as Error & {
          code: number;
        };
        err.code = errorCode;
        throw err;
      }
      return realDb.runTransaction(updateFn);
    },
  } as unknown as admin.firestore.Firestore;
  return { firestore, getTxCallCount: () => txCalls };
}

function claimDocRef(parentId: string, name: string) {
  return db.collection('driveFolderLocks').doc(buildFolderLockId(parentId, name));
}

/**
 * `runTransaction`だけを差し替えたfirestoreラッパ。`failOnCallIndex`回目のtxは実dbへ
 * 実際に委譲し(書込みは成功する)、その直後にクライアント側にのみgRPC transientコード
 * (既定14=UNAVAILABLE)を持つ合成エラーを投げる。「サーバー側は成功したがクライアントには
 * 失敗として返る」ambiguous commitを再現する(Issue #954、beginCreationの自己ブロック
 * 解消の検証用)。
 */
function makeAmbiguousCommitFirestore(
  realDb: admin.firestore.Firestore,
  failOnCallIndex: number,
  errorCode = 14
): admin.firestore.Firestore {
  let txCalls = 0;
  return {
    collection: (path: string) => realDb.collection(path),
    doc: (path: string) => realDb.doc(path),
    runTransaction: async (updateFn: (tx: admin.firestore.Transaction) => Promise<unknown>) => {
      txCalls++;
      const result = await realDb.runTransaction(updateFn);
      if (txCalls === failOnCallIndex) {
        const err = new Error('simulated ambiguous commit (server succeeded, client sees failure)') as Error & {
          code: number;
        };
        err.code = errorCode;
        throw err;
      }
      return result;
    },
  } as unknown as admin.firestore.Firestore;
}

/**
 * `runTransaction`だけを差し替えたfirestoreラッパ。最初の呼び出しの直前に`beforeFirstTx`
 * を実行してから実dbへ委譲する。「クエリのsnapshot取得後、実際のトランザクション直前に
 * 別プロセスがドキュメントを変更した」というレースを模擬するために使う
 * (codex review P2指摘対応、9巡目: fencingでスキップされた場合のカウント精度検証用)。
 */
function makeRaceSimulatingFirestore(
  realDb: admin.firestore.Firestore,
  beforeFirstTx: () => Promise<void>
): admin.firestore.Firestore {
  let called = false;
  return {
    collection: (path: string) => realDb.collection(path),
    doc: (path: string) => realDb.doc(path),
    runTransaction: async (updateFn: (tx: admin.firestore.Transaction) => Promise<unknown>) => {
      if (!called) {
        called = true;
        await beforeFirstTx();
      }
      return realDb.runTransaction(updateFn);
    },
  } as unknown as admin.firestore.Firestore;
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

    it('shadowモードでも、beginCreation自身がresolved claimをatomicに保護するため結果整合性の遅延下で二重作成されない(codex review P1指摘対応、4巡目)', async () => {
      // 従来はshadowモード(claimの読み経路が無効)ではbeginCreation()がresolved claimを
      // 無条件上書きしていたため、files.listが索引未反映で0件を返し続ける限り呼び出す
      // たびに新規作成されていた(旧仕様、テスト名変更前の期待値)。codex reviewで
      // 「読み経路の有無に関わらずresolved claimは保護すべき」との指摘を受け、
      // beginCreation自身のトランザクション内でatomicに保護するよう修正した結果、
      // shadowモードでもこの二重作成は起きなくなった。
      const { drive, createCalls } = makeFakeDrive();
      // files.list が常に0件を返す(索引未反映を模擬)よう、listだけ差し替える
      (drive.files as unknown as { list: unknown }).list = async () => ({ data: { files: [] } });

      const first = await findOrCreateFolder(drive, db, 'parent-lag', '遅延太郎');
      const second = await findOrCreateFolder(drive, db, 'parent-lag', '遅延太郎');

      expect(createCalls).to.have.lengthOf(1);
      expect(second).to.equal(first);
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

    it('SOFT_TTL窓内でtrashedからの復元(untrash)自体は成功したが、直後のrecordVerification確定書込みに失敗するとFolderClaimRestoreCommitErrorをthrowする(second-opinionレビュー指摘対応、テストカバレッジ欠如の解消)', async () => {
      await enableClaimRead();
      await claimDocRef('parent-restorecommitfail', '復元失敗太郎').set({
        state: 'resolved',
        folderId: 'trashed-restore-fail-id',
        attempt: null,
        resolvedAtMs: Date.now() - 2 * 60 * 1000,
        verifiedAtMs: Date.now() - 2 * 60 * 1000, // CREATE_TRUST_MS超過・SOFT_TTL_MS未満 → files.getのみ
        parentId: 'parent-restorecommitfail',
        name: '復元失敗太郎',
      });
      const { drive, updateCalls } = makeFakeDrive({
        files: [
          { id: 'trashed-restore-fail-id', name: '復元失敗太郎', parents: ['parent-restorecommitfail'], trashed: true },
        ],
      });
      // Issue #954: recordVerificationはwithBackoffRetry(FOLDER_CLAIM_TX_RETRY_ATTEMPTS回)で
      // 保護されるようになったため、全attemptを失敗させて初めてFolderClaimRestoreCommitErrorになる。
      const { firestore: failingDb } = makeFailingCommitFirestore(
        db,
        Array.from({ length: FOLDER_CLAIM_TX_RETRY_ATTEMPTS }, (_, i) => i + 1)
      );

      try {
        await findOrCreateFolder(drive, failingDb, 'parent-restorecommitfail', '復元失敗太郎');
        expect.fail('FolderClaimRestoreCommitErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(FolderClaimRestoreCommitError);
        expect((error as FolderClaimRestoreCommitError).folderId).to.equal('trashed-restore-fail-id');
      }
      // Drive側のuntrash自体は成功していること(claim確定書込みの失敗とは独立)
      expect(updateCalls).to.have.lengthOf(1);
      expect(updateCalls[0].fileId).to.equal('trashed-restore-fail-id');
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

    it('完全再検索がclaimと異なるtrashedフォルダを見つけた場合、untrashせずdivergentへ遷移する(codex review P2指摘対応、2巡目)', async () => {
      await enableClaimRead();
      await claimDocRef('parent-scanmismatch', '再検索不一致太郎').set({
        state: 'resolved',
        folderId: 'claimed-id',
        attempt: null,
        resolvedAtMs: Date.now() - 10 * 60 * 1000,
        verifiedAtMs: Date.now() - 10 * 60 * 1000, // SOFT_TTL_MS超過 → 完全再検索へ
        parentId: 'parent-scanmismatch',
        name: '再検索不一致太郎',
      });
      const { drive, updateCalls, createCalls } = makeFakeDrive({
        files: [
          { id: 'different-trashed-id', name: '再検索不一致太郎', parents: ['parent-scanmismatch'], trashed: true },
        ],
      });

      try {
        await findOrCreateFolder(drive, db, 'parent-scanmismatch', '再検索不一致太郎');
        expect.fail('DivergentFolderClaimErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(DivergentFolderClaimError);
      }
      // untrash(files.update)も新規作成も行われないこと(claimと無関係なフォルダをDrive側で書き換えない)
      expect(updateCalls).to.have.lengthOf(0);
      expect(createCalls).to.have.lengthOf(0);
      const snap = await claimDocRef('parent-scanmismatch', '再検索不一致太郎').get();
      expect(snap.data()?.state).to.equal('divergent');
    });
  });

  describe('childFolderResolver.tsとのclaim共有 — shadowモードのクロスリゾルバ保護(codex review P1指摘対応、2巡目)', () => {
    it('shadowモード(driveFolderClaimRead未設定)でも、findOrCreateFolderが確定済みのresolved claimを直後のresolveChildFolderが再作成しない(旧acquireFolderLockの多層防御を復元)', async () => {
      const { drive, createCalls } = makeFakeDrive();
      // files.list は常に0件を返す(索引未反映を模擬)。この防御が無いと、shadowモードの
      // beginCreation()がresolved claimを無条件上書きし2重作成してしまう。
      (drive.files as unknown as { list: unknown }).list = async () => ({ data: { files: [] } });

      const folderId = await findOrCreateFolder(drive, db, 'parent-shadow-cross', '影連携太郎');
      expect(createCalls).to.have.lengthOf(1);

      const result = await resolveChildFolder(drive, db, 'parent-shadow-cross', '影連携太郎');

      expect(result).to.deep.equal({ id: folderId, restored: false, created: false });
      expect(createCalls).to.have.lengthOf(1);
    });

    it('shadowモード(driveFolderClaimRead未設定)でも、期限切れの"creating"claim(クラッシュ後の孤児)を永久にblockせずreconcileAttemptで回収する(codex review P2指摘対応、3巡目)', async () => {
      await claimDocRef('parent-shadow-stale-creating', '孤児太郎').set({
        state: 'creating',
        attempt: { attemptId: 'orphan-attempt', startedAtMs: Date.now() - 20 * 60 * 1000, runId: 'crashed-run' },
        parentId: 'parent-shadow-stale-creating',
        name: '孤児太郎',
      });
      const { drive: baseDrive, createCalls } = makeFakeDrive({
        files: [
          {
            id: 'orphan-created-id',
            name: '孤児太郎',
            parents: ['parent-shadow-stale-creating'],
            trashed: false,
            appProperties: { docSplitFolderClaim: 'orphan-attempt' },
          },
        ],
      });
      // 名前ベースの検索(files.list)は常に0件(索引未反映を模擬)だが、appProperties
      // タグ検索はstoreを正しく参照する(reconcileAttemptの回収経路のみ機能する状況、
      // 既存の同型テストと同じ手法)。
      const drive = {
        files: {
          ...baseDrive.files,
          list: async (params: Record<string, unknown>) => {
            const q = params.q as string;
            if (q.includes('appProperties has')) {
              return baseDrive.files.list(params);
            }
            return { data: { files: [] } };
          },
        },
      } as unknown as drive_v3.Drive;

      const result = await resolveChildFolder(drive, db, 'parent-shadow-stale-creating', '孤児太郎');

      expect(result).to.deep.equal({ id: 'orphan-created-id', restored: false, created: false });
      // タグ検索で既存フォルダを回収したので新規作成は発生しない
      expect(createCalls).to.have.lengthOf(0);
      const snap = await claimDocRef('parent-shadow-stale-creating', '孤児太郎').get();
      expect(snap.data()?.state).to.equal('resolved');
      expect(snap.data()?.folderId).to.equal('orphan-created-id');
    });

    it('完全再検索が進行中の他プロセスの"creating"claimをfencingトークン汚染なしに温存する(codex review P1指摘対応、6巡目)', async () => {
      // シナリオ: 本番exportが同じparent+nameに対しbeginCreationでcreating claimを
      // 確保した直後(files.create()呼び出し前)。この間隙で、childFolderResolver.tsの
      // 完全再検索が(無関係に)別の既存フォルダを見つけ、recordFullScanResolutionを
      // 呼ぶ。修正前は既存attempt(exporterのattemptId)を騙って'resolved'へ上書きして
      // いたため、後でexporter自身がcommitResolvedWithRetryを呼ぶとfencingが
      // (誤って)一致と判定し、2つの物理フォルダが確定してしまっていた。
      await claimDocRef('parent-race', '競合太郎').set({
        state: 'creating',
        attempt: { attemptId: 'exporter-attempt-id', startedAtMs: Date.now(), runId: 'exporter-run' },
        parentId: 'parent-race',
        name: '競合太郎',
      });
      const { drive } = makeFakeDrive({
        files: [{ id: 'unrelated-existing-id', name: '競合太郎', parents: ['parent-race'], trashed: false }],
      });

      const result = await resolveChildFolder(drive, db, 'parent-race', '競合太郎');
      expect(result).to.deep.equal({ id: 'unrelated-existing-id', restored: false, created: false });

      // claimはexporterのcreating attemptのまま温存され、上書きされていないこと
      const midSnap = await claimDocRef('parent-race', '競合太郎').get();
      expect(midSnap.data()?.state).to.equal('creating');
      expect(midSnap.data()?.attempt?.attemptId).to.equal('exporter-attempt-id');

      // exporter自身が後でfiles.create()を完了しcommitResolvedWithRetryを呼んでも、
      // fencingトークンが汚染されていないため正しく自分のfolderIdで確定できる
      // (poisoningされていた場合は "unrelated-existing-id" 側のattemptと誤って
      // 一致判定され、以下のcommitが正常系として通ってしまっていた)。
      await commitResolvedWithRetry(db, 'parent-race', '競合太郎', 'exporter-attempt-id', 'exporter-created-id');
      const finalSnap = await claimDocRef('parent-race', '競合太郎').get();
      expect(finalSnap.data()?.state).to.equal('resolved');
      expect(finalSnap.data()?.folderId).to.equal('exporter-created-id');
    });
  });

  describe('findOrCreateFolder: shadowモードでの期限切れ"creating"claim回収(codex review P2指摘対応、6巡目)', () => {
    it('shadowモード(driveFolderClaimRead未設定)でも、期限切れの"creating"claim(クラッシュ後の孤児)をreconcileAttemptで回収し二重作成しない', async () => {
      await claimDocRef('parent-fofc-stale-creating', '孤児二郎').set({
        state: 'creating',
        attempt: { attemptId: 'orphan-attempt-fofc', startedAtMs: Date.now() - 20 * 60 * 1000, runId: 'crashed-run' },
        parentId: 'parent-fofc-stale-creating',
        name: '孤児二郎',
      });
      const { drive: baseDrive, createCalls } = makeFakeDrive({
        files: [
          {
            id: 'orphan-created-id-fofc',
            name: '孤児二郎',
            parents: ['parent-fofc-stale-creating'],
            trashed: false,
            appProperties: { docSplitFolderClaim: 'orphan-attempt-fofc' },
          },
        ],
      });
      const drive = {
        files: {
          ...baseDrive.files,
          list: async (params: Record<string, unknown>) => {
            const q = params.q as string;
            if (q.includes('appProperties has')) {
              return baseDrive.files.list(params);
            }
            return { data: { files: [] } };
          },
        },
      } as unknown as drive_v3.Drive;

      const result = await findOrCreateFolder(drive, db, 'parent-fofc-stale-creating', '孤児二郎');

      expect(result).to.equal('orphan-created-id-fofc');
      expect(createCalls).to.have.lengthOf(0);
      const snap = await claimDocRef('parent-fofc-stale-creating', '孤児二郎').get();
      expect(snap.data()?.state).to.equal('resolved');
      expect(snap.data()?.folderId).to.equal('orphan-created-id-fofc');
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

    it('タグ付きフォルダが見つかっても名前が要求と異なる場合、untrashせずdivergentへ遷移する(codex review P2指摘対応、9巡目)', async () => {
      // プロセスクラッシュ後、files.create()には成功しclaim確定書込み前だったフォルダを
      // ユーザーが手動でリネーム(かつゴミ箱へ移動)していたケース。attemptIdタグ検索
      // だけで採用すると、verifyFolderClaimが持つname不一致のfail-closed判定を
      // バイパスしてしまい、要求された名前とは異なるフォルダへ後続exportが配置され続ける。
      await enableClaimRead();
      await claimDocRef('parent-crash5', '要求名太郎').set({
        state: 'creating',
        attempt: { attemptId: 'attempt-5', startedAtMs: Date.now() - 2 * 60 * 1000, runId: 'old-run' },
        parentId: 'parent-crash5',
        name: '要求名太郎',
      });
      const { drive, updateCalls, createCalls } = makeFakeDrive({
        files: [
          {
            id: 'renamed-id',
            name: '手動リネーム後太郎',
            parents: ['parent-crash5'],
            trashed: true,
            appProperties: { docSplitFolderClaim: 'attempt-5' },
          },
        ],
      });

      try {
        await findOrCreateFolder(drive, db, 'parent-crash5', '要求名太郎');
        expect.fail('DivergentFolderClaimErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(DivergentFolderClaimError);
      }
      // untrash(files.update)も新規作成も行われないこと
      expect(updateCalls).to.have.lengthOf(0);
      expect(createCalls).to.have.lengthOf(0);
      const snap = await claimDocRef('parent-crash5', '要求名太郎').get();
      expect(snap.data()?.state).to.equal('divergent');
    });

    it('findOrCreateFolder: reconcileAttemptがadoptを返した直後にcommitResolvedWithRetryが失敗すると、専用errorに包まず素のFolderClaimCommitErrorをそのままthrowする(Issue #880 characterization test、リファクタ前の非対称性を固定する)', async () => {
      await enableClaimRead();
      await claimDocRef('parent-adoptcommitfail', '回収確定失敗太郎').set({
        state: 'creating',
        attempt: { attemptId: 'attempt-adoptcommitfail', startedAtMs: Date.now() - 11 * 60 * 1000, runId: 'old-run' },
        parentId: 'parent-adoptcommitfail',
        name: '回収確定失敗太郎',
      });
      const { drive } = makeFakeDrive({
        files: [
          {
            id: 'tagged-adoptcommitfail',
            name: '回収確定失敗太郎',
            parents: ['parent-adoptcommitfail'],
            trashed: false,
            appProperties: { docSplitFolderClaim: 'attempt-adoptcommitfail' },
          },
        ],
      });
      // readClaim/reconcileAttemptはトランザクションを使わないため、commitResolvedWithRetryの
      // 3回のリトライ(1〜3回目のtx)を全て失敗させる。
      const { firestore: failingDb } = makeFailingCommitFirestore(db, [1, 2, 3]);

      try {
        await findOrCreateFolder(drive, failingDb, 'parent-adoptcommitfail', '回収確定失敗太郎');
        expect.fail('FolderClaimCommitErrorがthrowされるべき');
      } catch (error) {
        // childFolderResolver.ts側はChildFolderRestoredButUncommittedError等でfolderIdを
        // 運ぶ専用errorへ包み直すが、findOrCreateFolder.ts側はそのような包装を行わない
        // (現行実装の非対称性、Issue #880で共通コア化する際もこの挙動を維持する)。
        expect((error as Error).name).to.equal('FolderClaimCommitError');
        expect((error as { folderId?: string }).folderId).to.equal('tagged-adoptcommitfail');
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

    it('parents不一致かつtrashed=trueの組み合わせでも、untrashせずdivergentへ遷移する(codex review P1指摘対応)', async () => {
      // 別の親フォルダへ手動移動された「後」にゴミ箱へ入れられたケース。trashed判定を
      // parents確認より先に行う実装だと、parents不一致に気付かないままuntrashして
      // 誤った場所のフォルダを採用してしまう(移行処理が誤配置になる)。
      await enableClaimRead();
      await claimDocRef('parent-orig2', '移動後ゴミ箱太郎').set({
        state: 'resolved',
        folderId: 'moved-then-trashed-id',
        attempt: null,
        resolvedAtMs: Date.now() - 2 * 60 * 1000,
        verifiedAtMs: Date.now() - 2 * 60 * 1000,
        parentId: 'parent-orig2',
        name: '移動後ゴミ箱太郎',
      });
      const { drive, createCalls, updateCalls } = makeFakeDrive({
        files: [
          { id: 'moved-then-trashed-id', name: '移動後ゴミ箱太郎', parents: ['some-other-parent'], trashed: true },
        ],
      });

      try {
        await findOrCreateFolder(drive, db, 'parent-orig2', '移動後ゴミ箱太郎');
        expect.fail('DivergentFolderClaimErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(DivergentFolderClaimError);
      }
      // untrash(files.update)も新規作成も行われないこと
      expect(updateCalls).to.have.lengthOf(0);
      expect(createCalls).to.have.lengthOf(0);
      const snap = await claimDocRef('parent-orig2', '移動後ゴミ箱太郎').get();
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

  describe('childFolderResolver.tsとのclaim共有(Issue #871 PR-4、旧acquireFolderLock/releaseFolderLockを置き換え)', () => {
    it('findOrCreateFolderが確定したresolved claimを、直後のresolveChildFolderが(読み経路有効時)再作成せず引き継ぐ', async () => {
      await enableClaimRead();
      const { drive, createCalls } = makeFakeDrive();
      const folderId = await findOrCreateFolder(drive, db, 'parent-cross', '相互作用太郎');
      expect(createCalls).to.have.lengthOf(1);

      const result = await resolveChildFolder(drive, db, 'parent-cross', '相互作用太郎');

      expect(result).to.deep.equal({ id: folderId, restored: false, created: false });
      // CREATE_TRUST_MS内のためfiles.createは呼ばれない(1回のまま)
      expect(createCalls).to.have.lengthOf(1);
    });

    it('resolveChildFolderが確定したresolved claimを、直後のfindOrCreateFolderが(読み経路有効時)再作成せず引き継ぐ(逆方向)', async () => {
      await enableClaimRead();
      const { drive, createCalls } = makeFakeDrive();
      const created = await resolveChildFolder(drive, db, 'parent-cross-rev', '逆方向太郎');
      expect(created.created).to.equal(true);
      expect(createCalls).to.have.lengthOf(1);

      const folderId = await findOrCreateFolder(drive, db, 'parent-cross-rev', '逆方向太郎');

      expect(folderId).to.equal(created.id);
      expect(createCalls).to.have.lengthOf(1);
    });
  });

  describe('invalidateResolvedClaimByFolderId(Issue #871 PR-4、rollback-drive-folder-merge.ts用)', () => {
    it('folderId一致するresolved claimをinvalidatedへ遷移させる', async () => {
      const { drive } = makeFakeDrive();
      const folderId = await findOrCreateFolder(drive, db, 'parent-invalidate', '無効化太郎');
      const beforeSnap = await claimDocRef('parent-invalidate', '無効化太郎').get();
      expect(beforeSnap.data()?.state).to.equal('resolved');

      const count = await invalidateResolvedClaimByFolderId(db, folderId);

      expect(count).to.equal(1);
      const afterSnap = await claimDocRef('parent-invalidate', '無効化太郎').get();
      expect(afterSnap.data()?.state).to.equal('invalidated');
      expect(afterSnap.data()?.attempt).to.equal(null);
    });

    it('folderIdが一致するclaimが無い場合は何もせず0を返す(TTL消滅済み・claim未生成の両方が正常系)', async () => {
      const count = await invalidateResolvedClaimByFolderId(db, 'no-such-folder-id');
      expect(count).to.equal(0);
    });

    it('divergent状態のclaimはfolderIdが一致してもresolved限定のクエリに一致せず、無変更のまま残る', async () => {
      await claimDocRef('parent-invalidate2', '発散太郎').set({
        state: 'divergent',
        folderId: 'divergent-folder-id',
        attempt: null,
        parentId: 'parent-invalidate2',
        name: '発散太郎',
      });

      const count = await invalidateResolvedClaimByFolderId(db, 'divergent-folder-id');

      expect(count).to.equal(0);
      const snap = await claimDocRef('parent-invalidate2', '発散太郎').get();
      expect(snap.data()?.state).to.equal('divergent');
    });

    it('クエリのsnapshot取得後、トランザクション直前に別プロセスがclaimを別folderIdへ変更していた場合、fencingでスキップされ0を返す(codex review P2指摘対応、9巡目)', async () => {
      const { drive } = makeFakeDrive();
      const folderId = await findOrCreateFolder(drive, db, 'parent-race-invalidate', '競合無効化太郎');
      const raceDb = makeRaceSimulatingFirestore(db, async () => {
        // クエリはこの前に実行済み(folderId一致でヒット)。トランザクション直前に
        // 別プロセス(reconcile中の別解決者)が別のfolderIdへ確定させた状況を模擬する。
        await claimDocRef('parent-race-invalidate', '競合無効化太郎').update({ folderId: 'different-winner-id' });
      });

      const count = await invalidateResolvedClaimByFolderId(raceDb, folderId);

      // 実際には書き込んでいない(fencingでスキップされた)ため0を返すべき
      // (修正前は無条件で1を返し、rollbackスクリプトが誤ってcleanup成功と判定していた)
      expect(count).to.equal(0);
      const snap = await claimDocRef('parent-race-invalidate', '競合無効化太郎').get();
      expect(snap.data()?.state).to.equal('resolved'); // invalidatedへ遷移していない
      expect(snap.data()?.folderId).to.equal('different-winner-id'); // 別プロセスの値のまま
    });
  });

  describe('invalidateCreatingClaimByAttemptId(Issue #871 PR-4、rollback-drive-folder-merge.ts用、codex review P2指摘対応、5巡目)', () => {
    it('attemptId一致する"creating"状態(claim確定書込み失敗でfolderId未確定)のclaimをinvalidatedへ遷移させる', async () => {
      await claimDocRef('parent-orphan-attempt', '未確定太郎').set({
        state: 'creating',
        attempt: { attemptId: 'orphan-attempt-id', startedAtMs: Date.now(), runId: 'run-x' },
        parentId: 'parent-orphan-attempt',
        name: '未確定太郎',
      });

      const count = await invalidateCreatingClaimByAttemptId(db, 'orphan-attempt-id');

      expect(count).to.equal(1);
      const snap = await claimDocRef('parent-orphan-attempt', '未確定太郎').get();
      expect(snap.data()?.state).to.equal('invalidated');
      expect(snap.data()?.attempt).to.equal(null);
    });

    it('attemptIdが一致するclaimが無い場合は何もせず0を返す', async () => {
      const count = await invalidateCreatingClaimByAttemptId(db, 'no-such-attempt-id');
      expect(count).to.equal(0);
    });

    it('既にresolved確定済み(別attemptがcommitResolvedWithRetryで確定させた)claimはfencingにより無変更のまま残る', async () => {
      await claimDocRef('parent-resolved-race', '確定済太郎').set({
        state: 'resolved',
        folderId: 'winner-folder-id',
        attempt: { attemptId: 'loser-attempt-id', startedAtMs: Date.now(), runId: 'run-y' },
        resolvedAtMs: Date.now(),
        parentId: 'parent-resolved-race',
        name: '確定済太郎',
      });

      const count = await invalidateCreatingClaimByAttemptId(db, 'loser-attempt-id');

      expect(count).to.equal(0);
      const snap = await claimDocRef('parent-resolved-race', '確定済太郎').get();
      expect(snap.data()?.state).to.equal('resolved');
      expect(snap.data()?.folderId).to.equal('winner-folder-id');
    });

    it('クエリのsnapshot取得後、トランザクション直前に別プロセスがresolvedへ確定させていた場合、fencingでスキップされ0を返す(codex review P2指摘対応、9巡目)', async () => {
      // 上の「既にresolved確定済み」テストとの違い: あちらはクエリ自体が0件(シード時点で
      // 既にresolved)なのに対し、本テストはクエリ時点ではcreatingでヒットし、
      // トランザクション直前(クエリ後)に別プロセスが確定させる、というより厳密な
      // レース窓を再現する。
      await claimDocRef('parent-race-creating', '競合作成太郎').set({
        state: 'creating',
        attempt: { attemptId: 'attempt-race', startedAtMs: Date.now(), runId: 'run-race' },
        parentId: 'parent-race-creating',
        name: '競合作成太郎',
      });
      const raceDb = makeRaceSimulatingFirestore(db, async () => {
        await claimDocRef('parent-race-creating', '競合作成太郎').set({
          state: 'resolved',
          folderId: 'concurrently-resolved-id',
          attempt: { attemptId: 'attempt-race', startedAtMs: Date.now(), runId: 'run-race' },
          resolvedAtMs: Date.now(),
          parentId: 'parent-race-creating',
          name: '競合作成太郎',
        });
      });

      const count = await invalidateCreatingClaimByAttemptId(raceDb, 'attempt-race');

      expect(count).to.equal(0);
      const snap = await claimDocRef('parent-race-creating', '競合作成太郎').get();
      expect(snap.data()?.state).to.equal('resolved'); // invalidatedへ遷移していない
      expect(snap.data()?.folderId).to.equal('concurrently-resolved-id');
    });
  });

  describe('divergent状態の保護(second-opinionレビューImportant指摘対応)', () => {
    it('shadowモードでも、既存のdivergent claimを新規作成attemptで上書きしない(DivergentFolderClaimError)', async () => {
      await claimDocRef('parent-div1', '発散太郎').set({
        state: 'divergent',
        folderId: 'old-divergent-id',
        attempt: null,
        parentId: 'parent-div1',
        name: '発散太郎',
      });
      const { drive, createCalls } = makeFakeDrive({ files: [] }); // 完全検索は0件(=通常なら新規作成に進むケース)

      try {
        await findOrCreateFolder(drive, db, 'parent-div1', '発散太郎');
        expect.fail('DivergentFolderClaimErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(DivergentFolderClaimError);
      }
      expect(createCalls).to.have.lengthOf(0);
      const snap = await claimDocRef('parent-div1', '発散太郎').get();
      expect(snap.data()?.state).to.equal('divergent');
    });

    it('shadowモードでも、既存のdivergent claimを完全再検索の成功結果で"resolved"へ上書きしない', async () => {
      await claimDocRef('parent-div2', '発散花子').set({
        state: 'divergent',
        folderId: 'old-divergent-id',
        attempt: null,
        parentId: 'parent-div2',
        name: '発散花子',
      });
      // 完全検索では別のfolderIdが1件見つかる(=通常なら成功として記録されるケース)
      const { drive } = makeFakeDrive({
        files: [{ id: 'found-by-scan', name: '発散花子', parents: ['parent-div2'], trashed: false }],
      });

      const result = await findOrCreateFolder(drive, db, 'parent-div2', '発散花子');

      expect(result).to.equal('found-by-scan');
      const snap = await claimDocRef('parent-div2', '発散花子').get();
      expect(snap.data()?.state).to.equal('divergent');
      expect(snap.data()?.folderId).to.equal('old-divergent-id');
    });
  });

  describe('codex review 2巡目指摘対応(commit失敗時の回収・trashed回収)', () => {
    it('files.create()成功後にcommitResolvedWithRetryが失敗しても、claimは"creating"のまま残り、次回呼び出しのreconcileAttemptが実フォルダを回収し重複作成しない(P1指摘対応)', async () => {
      await enableClaimRead();
      const { drive: baseDrive, store, createCalls } = makeFakeDrive();
      // 名前ベースの検索(files.list)は常に0件(索引未反映を模擬)だが、appProperties
      // タグ検索はstoreを正しく参照する(reconcileAttemptの回収経路のみ機能する状況)。
      const drive = {
        files: {
          ...baseDrive.files,
          list: async (params: Record<string, unknown>) => {
            const q = params.q as string;
            if (q.includes('appProperties has')) {
              return baseDrive.files.list(params);
            }
            return { data: { files: [] } };
          },
        },
      } as unknown as drive_v3.Drive;

      // beginCreation(1回目のtx)は成功させ、commitResolvedWithRetryの3回のリトライ
      // (2〜4回目のtx)を全て失敗させる。
      const { firestore: failingDb } = makeFailingCommitFirestore(db, [2, 3, 4]);

      let firstError: unknown;
      try {
        await findOrCreateFolder(drive, failingDb, 'parent-p1fix', 'コミット失敗太郎');
        expect.fail('エラーがthrowされるべき');
      } catch (error) {
        firstError = error;
      }
      expect((firstError as Error).name).to.equal('FolderClaimCommitError');
      expect(createCalls).to.have.lengthOf(1); // Drive側の作成自体は1回成功している

      const claimBeforeRetry = await claimDocRef('parent-p1fix', 'コミット失敗太郎').get();
      expect(claimBeforeRetry.data()?.state).to.equal('creating'); // invalidatedにされていない(P1指摘の核心)

      // 次回呼び出し(正常なfirestore)は、名前検索が依然0件でも重複作成せず、
      // reconcileAttemptがattemptIdタグで実フォルダを回収する。
      const result = await findOrCreateFolder(drive, db, 'parent-p1fix', 'コミット失敗太郎');
      expect(result).to.equal(store[0].id);
      expect(createCalls).to.have.lengthOf(1); // 2回目もfiles.createは呼ばれていない(重複作成なし)

      const claimAfter = await claimDocRef('parent-p1fix', 'コミット失敗太郎').get();
      expect(claimAfter.data()?.state).to.equal('resolved');
      expect(claimAfter.data()?.folderId).to.equal(store[0].id);
    });

    it('reconcileAttemptが回収したフォルダがtrashedの場合、untrashしてから採用する(P2指摘対応)', async () => {
      await enableClaimRead();
      await claimDocRef('parent-trash-reconcile', 'ゴミ箱回収太郎').set({
        state: 'creating',
        attempt: { attemptId: 'attempt-trashed', startedAtMs: Date.now() - 11 * 60 * 1000, runId: 'old-run' },
        parentId: 'parent-trash-reconcile',
        name: 'ゴミ箱回収太郎',
      });
      // attemptIdタグ付きの実フォルダは存在するが、commit前にゴミ箱へ移動されていた
      const { drive, store, updateCalls, createCalls } = makeFakeDrive({
        files: [
          {
            id: 'trashed-recovered-id',
            name: 'ゴミ箱回収太郎',
            parents: ['parent-trash-reconcile'],
            trashed: true,
            appProperties: { docSplitFolderClaim: 'attempt-trashed' },
          },
        ],
      });

      const result = await findOrCreateFolder(drive, db, 'parent-trash-reconcile', 'ゴミ箱回収太郎');

      expect(result).to.equal('trashed-recovered-id');
      expect(createCalls).to.have.lengthOf(0);
      expect(updateCalls).to.have.lengthOf(1);
      expect(updateCalls[0].fileId).to.equal('trashed-recovered-id');
      expect(updateCalls[0].requestBody).to.deep.equal({ trashed: false });
      const recovered = store.find((f) => f.id === 'trashed-recovered-id');
      expect(recovered?.trashed).to.equal(false);
    });
  });

  describe('markDivergent: TTL対象外化 + 監査フィールド(Issue #871 恒久対応)', () => {
    it('expireAtを書かず、divergentAtMs/divergentRunIdを書く', async () => {
      await claimDocRef('parent-ttl1', '滞留太郎').set({
        state: 'resolved',
        folderId: 'existing-id',
        attempt: null,
        parentId: 'parent-ttl1',
        name: '滞留太郎',
        expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 1000),
      });
      const beforeMs = Date.now();
      const { drive } = makeFakeDrive({
        files: [{ id: 'other-id', name: '滞留太郎', parents: ['parent-ttl1'], trashed: false }],
      });
      await enableClaimRead();

      try {
        await findOrCreateFolder(drive, db, 'parent-ttl1', '滞留太郎');
        expect.fail('DivergentFolderClaimErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(DivergentFolderClaimError);
      }

      const snap = await claimDocRef('parent-ttl1', '滞留太郎').get();
      const data = snap.data()!;
      expect(data.state).to.equal('divergent');
      expect(data.expireAt).to.equal(undefined);
      expect(data.divergentAtMs).to.be.a('number').and.be.at.least(beforeMs);
      expect(data.divergentReason).to.equal('full-scan-mismatch');
    });

    it('完全再検索でAmbiguousFolderError(2件以上)を検知した場合もmarkDivergent(ambiguous-full-scan)を記録してからそのままthrowする(Issue #880 characterization test)', async () => {
      await claimDocRef('parent-ambfs', '曖昧太郎').set({
        state: 'resolved',
        folderId: 'existing-id',
        attempt: null,
        parentId: 'parent-ambfs',
        name: '曖昧太郎',
      });
      const { drive } = makeFakeDrive({
        files: [
          { id: 'dup-a', name: '曖昧太郎', parents: ['parent-ambfs'], trashed: false },
          { id: 'dup-b', name: '曖昧太郎', parents: ['parent-ambfs'], trashed: false },
        ],
      });
      await enableClaimRead();

      try {
        await findOrCreateFolder(drive, db, 'parent-ambfs', '曖昧太郎');
        expect.fail('AmbiguousFolderErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(AmbiguousFolderError);
      }

      const snap = await claimDocRef('parent-ambfs', '曖昧太郎').get();
      const data = snap.data()!;
      expect(data.state).to.equal('divergent');
      expect(data.divergentReason).to.equal('ambiguous-full-scan');
    });

    it('同一claimが再度divergent化してもresyncHistoryを引き継ぐ(codex review Low指摘の回帰テスト)', async () => {
      await claimDocRef('parent-ttl2', '再発太郎').set({
        state: 'resolved',
        folderId: 'existing-id',
        attempt: null,
        parentId: 'parent-ttl2',
        name: '再発太郎',
        resyncHistory: [{ mode: 'restore-expected', actor: 'past-actor', atMs: 1000 }],
      });
      const { drive } = makeFakeDrive({
        files: [{ id: 'other-id', name: '再発太郎', parents: ['parent-ttl2'], trashed: false }],
      });
      await enableClaimRead();

      try {
        await findOrCreateFolder(drive, db, 'parent-ttl2', '再発太郎');
        expect.fail('DivergentFolderClaimErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(DivergentFolderClaimError);
      }

      const snap = await claimDocRef('parent-ttl2', '再発太郎').get();
      const data = snap.data()!;
      expect(data.state).to.equal('divergent');
      expect(data.resyncHistory).to.have.lengthOf(1);
      expect(data.resyncHistory[0]).to.deep.include({ mode: 'restore-expected', actor: 'past-actor', atMs: 1000 });
    });

    it('resync直後の通常のverify成功(recordVerification、実運用で最も頻繁に通るホットパス)でもresyncHistoryが消えない(codex review 2巡目P2指摘の回帰テスト)', async () => {
      await claimDocRef('parent-ttl3', '健全太郎').set({
        state: 'resolved',
        folderId: 'healthy-id',
        attempt: null,
        parentId: 'parent-ttl3',
        name: '健全太郎',
        resyncHistory: [{ mode: 'restore-expected', actor: 'past-actor', atMs: 1000 }],
      });
      const { drive } = makeFakeDrive({
        files: [{ id: 'healthy-id', name: '健全太郎', parents: ['parent-ttl3'], trashed: false }],
      });
      const claim = (await readClaim(db, 'parent-ttl3', '健全太郎')) as ResolvedFolderClaim;

      await verifyFolderClaim(drive, db, 'parent-ttl3', '健全太郎', claim, 'run-verify1');

      const after = (await claimDocRef('parent-ttl3', '健全太郎').get()).data()!;
      expect(after.state).to.equal('resolved');
      expect(after.resyncHistory).to.have.lengthOf(1);
      expect(after.resyncHistory[0]).to.deep.include({ mode: 'restore-expected', actor: 'past-actor', atMs: 1000 });
    });
  });

  describe('resolveDivergentClaim/releaseDivergentClaim(Issue #871 恒久対応、承認付き再同期の唯一の出口)', () => {
    const parentId = 'parent-resync';
    const name = '再同期太郎';

    async function seedDivergentClaim(overrides: Record<string, unknown> = {}) {
      await claimDocRef(parentId, name).set({
        state: 'divergent',
        folderId: 'divergent-folder-id',
        attempt: null,
        divergentReason: 'parents-mismatch',
        divergentAtMs: Date.now() - 60_000,
        parentId,
        name,
        ...overrides,
      });
      return claimDocRef(parentId, name).get();
    }

    it('divergent → resolved: fenceが一致すれば成功し、verifiedAtMs/resolvedAtMsを未設定のままにする(次回完全再検索を強制)', async () => {
      const snap = await seedDivergentClaim();
      const outcome = await resolveDivergentClaim(
        db,
        parentId,
        name,
        {
          expectedFolderId: 'divergent-folder-id',
          expectedDivergentReason: 'parents-mismatch',
          expectedUpdateTimeMs: snap.updateTime!.toMillis(),
          actor: 'test-actor',
        },
        'restore-expected'
      );

      expect(outcome).to.deep.equal({ outcome: 'resolved' });
      const after = (await claimDocRef(parentId, name).get()).data()!;
      expect(after.state).to.equal('resolved');
      expect(after.folderId).to.equal('divergent-folder-id');
      expect(after.verifiedAtMs).to.equal(undefined);
      expect(after.resolvedAtMs).to.equal(undefined);
      expect(after.missCount).to.equal(0);
      expect(after.resyncHistory).to.have.lengthOf(1);
      expect(after.resyncHistory[0]).to.deep.include({ mode: 'restore-expected', actor: 'test-actor' });
    });

    it('finalize-resolved経由の場合、resyncHistoryにfinalize-resolvedと記録される(type-design-analyzerレビュー指摘の回帰テスト、Drive成功後Firestore失敗からの収束パスとrestore-expectedを監査上区別する)', async () => {
      const snap = await seedDivergentClaim();
      const outcome = await resolveDivergentClaim(
        db,
        parentId,
        name,
        {
          expectedFolderId: 'divergent-folder-id',
          expectedDivergentReason: 'parents-mismatch',
          expectedUpdateTimeMs: snap.updateTime!.toMillis(),
          actor: 'test-actor',
        },
        'finalize-resolved'
      );

      expect(outcome).to.deep.equal({ outcome: 'resolved' });
      const after = (await claimDocRef(parentId, name).get()).data()!;
      expect(after.resyncHistory).to.have.lengthOf(1);
      expect(after.resyncHistory[0]).to.deep.include({ mode: 'finalize-resolved', actor: 'test-actor' });
    });

    it('divergent → resolved 復帰後、次回findOrCreateFolderがthrowせず実体を再確認できる(出口が機能する回帰テスト)', async () => {
      const snap = await seedDivergentClaim();
      await resolveDivergentClaim(
        db,
        parentId,
        name,
        {
          expectedFolderId: 'divergent-folder-id',
          expectedDivergentReason: 'parents-mismatch',
          expectedUpdateTimeMs: snap.updateTime!.toMillis(),
          actor: 'test-actor',
        },
        'restore-expected'
      );
      await enableClaimRead();
      const { drive, listCalls } = makeFakeDrive({
        files: [{ id: 'divergent-folder-id', name, parents: [parentId], trashed: false }],
      });

      const result = await findOrCreateFolder(drive, db, parentId, name);

      expect(result).to.equal('divergent-folder-id');
      // verifiedAtMs/resolvedAtMs未設定によりanchorMs=0となり、SOFT_TTL_MS超過と同じ
      // 扱いで即座に完全再検索(files.list)が行われることを確認する。
      expect(listCalls.length).to.be.greaterThan(0);
    });

    it('divergent → invalidated(release): fenceが一致すれば成功し、Driveには一切書き込まない', async () => {
      const snap = await seedDivergentClaim();
      const { drive, updateCalls } = makeFakeDrive({ files: [] });

      const outcome = await releaseDivergentClaim(db, parentId, name, {
        expectedFolderId: 'divergent-folder-id',
        expectedDivergentReason: 'parents-mismatch',
        expectedUpdateTimeMs: snap.updateTime!.toMillis(),
        actor: 'test-actor',
      });

      expect(outcome).to.deep.equal({ outcome: 'resolved' });
      expect(updateCalls).to.have.lengthOf(0);
      const after = (await claimDocRef(parentId, name).get()).data()!;
      expect(after.state).to.equal('invalidated');
      expect(after.folderId).to.equal(undefined);
      expect(after.resyncHistory).to.have.lengthOf(1);
      expect(after.resyncHistory[0]).to.deep.include({ mode: 'release-claim', actor: 'test-actor' });
      void drive;
    });

    it('release後、次回findOrCreateFolderは通常のfind-or-create経路(完全検索)に入る', async () => {
      const snap = await seedDivergentClaim();
      await releaseDivergentClaim(db, parentId, name, {
        expectedFolderId: 'divergent-folder-id',
        expectedDivergentReason: 'parents-mismatch',
        expectedUpdateTimeMs: snap.updateTime!.toMillis(),
        actor: 'test-actor',
      });
      await enableClaimRead();
      const { drive, createCalls } = makeFakeDrive({ files: [] });

      const result = await findOrCreateFolder(drive, db, parentId, name);

      expect(result).to.equal('created-1');
      expect(createCalls).to.have.lengthOf(1);
    });

    it('stateが divergent でなければ no-op(not-divergent)', async () => {
      await claimDocRef(parentId, name).set({
        state: 'resolved',
        folderId: 'resolved-id',
        attempt: null,
        parentId,
        name,
      });
      const snap = await claimDocRef(parentId, name).get();

      const outcome = await resolveDivergentClaim(
        db,
        parentId,
        name,
        {
          expectedFolderId: 'resolved-id',
          expectedDivergentReason: 'parents-mismatch',
          expectedUpdateTimeMs: snap.updateTime!.toMillis(),
          actor: 'test-actor',
        },
        'restore-expected'
      );

      expect(outcome).to.deep.equal({ outcome: 'no-op', reason: 'not-divergent' });
      const after = (await claimDocRef(parentId, name).get()).data()!;
      expect(after.state).to.equal('resolved');
    });

    it('claimドキュメントが存在しなければ no-op(not-divergent)', async () => {
      const outcome = await resolveDivergentClaim(
        db,
        parentId,
        name,
        {
          expectedFolderId: 'x',
          expectedDivergentReason: 'parents-mismatch',
          expectedUpdateTimeMs: Date.now(),
          actor: 'test-actor',
        },
        'restore-expected'
      );
      expect(outcome).to.deep.equal({ outcome: 'no-op', reason: 'not-divergent' });
    });

    it('updateTimeが不一致なら no-op(fence-mismatch、classify後にclaimが変化した場合の防御)', async () => {
      const snap = await seedDivergentClaim();
      const outcome = await resolveDivergentClaim(
        db,
        parentId,
        name,
        {
          expectedFolderId: 'divergent-folder-id',
          expectedDivergentReason: 'parents-mismatch',
          expectedUpdateTimeMs: snap.updateTime!.toMillis() - 1,
          actor: 'test-actor',
        },
        'restore-expected'
      );
      expect(outcome).to.deep.equal({ outcome: 'no-op', reason: 'fence-mismatch' });
      const after = (await claimDocRef(parentId, name).get()).data()!;
      expect(after.state).to.equal('divergent');
    });

    it('divergentReasonが不一致なら no-op(fence-mismatch)', async () => {
      const snap = await seedDivergentClaim();
      const outcome = await resolveDivergentClaim(
        db,
        parentId,
        name,
        {
          expectedFolderId: 'divergent-folder-id',
          expectedDivergentReason: 'name-mismatch',
          expectedUpdateTimeMs: snap.updateTime!.toMillis(),
          actor: 'test-actor',
        },
        'restore-expected'
      );
      expect(outcome).to.deep.equal({ outcome: 'no-op', reason: 'fence-mismatch' });
    });

    it('folderIdが不一致なら no-op(fence-mismatch)', async () => {
      const snap = await seedDivergentClaim();
      const outcome = await resolveDivergentClaim(
        db,
        parentId,
        name,
        {
          expectedFolderId: 'different-id',
          expectedDivergentReason: 'parents-mismatch',
          expectedUpdateTimeMs: snap.updateTime!.toMillis(),
          actor: 'test-actor',
        },
        'restore-expected'
      );
      expect(outcome).to.deep.equal({ outcome: 'no-op', reason: 'fence-mismatch' });
    });

    it('folderIdが無いclaim(reconcile-name-mismatch等)は resolveDivergentClaim では no-op(missing-folder-id)、releaseDivergentClaimでは扱える', async () => {
      await claimDocRef(parentId, name).set({
        state: 'divergent',
        attempt: null,
        divergentReason: 'reconcile-name-mismatch',
        parentId,
        name,
      });
      const snap = await claimDocRef(parentId, name).get();

      const resolveOutcome = await resolveDivergentClaim(
        db,
        parentId,
        name,
        {
          expectedDivergentReason: 'reconcile-name-mismatch',
          expectedUpdateTimeMs: snap.updateTime!.toMillis(),
          actor: 'test-actor',
        },
        'restore-expected'
      );
      expect(resolveOutcome).to.deep.equal({ outcome: 'no-op', reason: 'missing-folder-id' });

      const releaseOutcome = await releaseDivergentClaim(db, parentId, name, {
        expectedDivergentReason: 'reconcile-name-mismatch',
        expectedUpdateTimeMs: snap.updateTime!.toMillis(),
        actor: 'test-actor',
      });
      expect(releaseOutcome).to.deep.equal({ outcome: 'resolved' });
      const after = (await claimDocRef(parentId, name).get()).data()!;
      expect(after.state).to.equal('invalidated');
    });

    it('resyncHistoryはRESYNC_HISTORY_MAX(20件)を超えると古いものから切り捨てる', async () => {
      const oldEntries = Array.from({ length: 20 }, (_, i) => ({
        mode: 'restore-expected' as const,
        actor: `actor-${i}`,
        atMs: i,
      }));
      await seedDivergentClaim({ resyncHistory: oldEntries });
      const snap = await claimDocRef(parentId, name).get();

      await resolveDivergentClaim(
        db,
        parentId,
        name,
        {
          expectedFolderId: 'divergent-folder-id',
          expectedDivergentReason: 'parents-mismatch',
          expectedUpdateTimeMs: snap.updateTime!.toMillis(),
          actor: 'actor-new',
        },
        'restore-expected'
      );

      const after = (await claimDocRef(parentId, name).get()).data()!;
      expect(after.resyncHistory).to.have.lengthOf(20);
      // 最古(actor-0)が切り捨てられ、先頭はactor-1になっている
      expect(after.resyncHistory[0].actor).to.equal('actor-1');
      expect(after.resyncHistory[19].actor).to.equal('actor-new');
    });
  });

  describe('契約テスト: divergent状態はresolveDivergentClaim/releaseDivergentClaim以外から変更されない(Issue #871 恒久対応)', () => {
    it('beginCreationはdivergentを変更しない(既存ガードの再確認)', async () => {
      await claimDocRef('parent-contract1', '契約太郎').set({
        state: 'divergent',
        folderId: 'divergent-id',
        attempt: null,
        divergentReason: 'parents-mismatch',
        parentId: 'parent-contract1',
        name: '契約太郎',
      });
      const before = (await claimDocRef('parent-contract1', '契約太郎').get()).data()!;

      const result = await beginCreation(db, 'parent-contract1', '契約太郎', 'run-contract1');

      expect(result.status).to.equal('divergent');
      const after = (await claimDocRef('parent-contract1', '契約太郎').get()).data()!;
      expect(after).to.deep.equal(before);
    });

    it('recordFullScanResolutionはdivergentを変更しない(既存ガードの再確認)', async () => {
      await claimDocRef('parent-contract2', '契約花子').set({
        state: 'divergent',
        folderId: 'divergent-id',
        attempt: null,
        divergentReason: 'parents-mismatch',
        parentId: 'parent-contract2',
        name: '契約花子',
      });
      const before = (await claimDocRef('parent-contract2', '契約花子').get()).data()!;

      await recordFullScanResolution(db, 'parent-contract2', '契約花子', 'scanned-id', 'run-contract2');

      const after = (await claimDocRef('parent-contract2', '契約花子').get()).data()!;
      expect(after).to.deep.equal(before);
    });

    it('invalidateResolvedClaimByFolderIdはdivergentを変更しない(resolved限定クエリのため、既存ガードの再確認)', async () => {
      await claimDocRef('parent-contract3', '契約次郎').set({
        state: 'divergent',
        folderId: 'divergent-id',
        attempt: null,
        divergentReason: 'parents-mismatch',
        parentId: 'parent-contract3',
        name: '契約次郎',
      });
      const before = (await claimDocRef('parent-contract3', '契約次郎').get()).data()!;

      const count = await invalidateResolvedClaimByFolderId(db, 'divergent-id');

      expect(count).to.equal(0);
      const after = (await claimDocRef('parent-contract3', '契約次郎').get()).data()!;
      expect(after).to.deep.equal(before);
    });
  });

  // fable-reviewセカンドオピニオン指摘: 本describe配下のmakeFailingCommitFirestoreは
  // `firestore.runTransaction`自体を差し替えるため、`@google-cloud/firestore`のSDK内部
  // リトライ(同じgRPC transientコード集合を最大5回まで内部リトライする)を経由せず、
  // withBackoffRetry(外側の層)のみを直接検証している。本番では「SDK内部リトライ最大5回が
  // 枯渇してもなお失敗する」場合に初めてこの外側リトライが効く(1回のtransaction呼び出しで
  // 即座に失敗する状況を想定したものではない)。
  describe('Issue #954: runTransaction自体の一時的失敗をwithBackoffRetryで防御', () => {
    describe('A. リトライで復旧する(1回だけ失敗させ2回目で成功、getTxCallCount()でリトライが実際に効いたことを確認)', () => {
      it('recordVerification: 1回失敗しても2回目でリトライ成功しclaimが更新される', async () => {
        await claimDocRef('parent-954-a1', 'リトライ太郎').set({
          state: 'resolved',
          folderId: 'a1-folder-id',
          attempt: null,
          parentId: 'parent-954-a1',
          name: 'リトライ太郎',
        });
        const { drive } = makeFakeDrive({
          files: [{ id: 'a1-folder-id', name: 'リトライ太郎', parents: ['parent-954-a1'], trashed: false }],
        });
        const claim = (await readClaim(db, 'parent-954-a1', 'リトライ太郎')) as ResolvedFolderClaim;
        const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(db, [1]);

        const result = await verifyFolderClaim(drive, failingDb, 'parent-954-a1', 'リトライ太郎', claim, 'run-a1');

        expect(result).to.deep.equal({ folderId: 'a1-folder-id', restored: false });
        expect(getTxCallCount()).to.equal(2);
        const after = (await claimDocRef('parent-954-a1', 'リトライ太郎').get()).data()!;
        expect(after.verifiedAtMs).to.be.a('number');
      });

      it('markDivergent: 1回失敗しても2回目でリトライ成功しdivergent状態が記録される(従来は1回失敗で検知が永久に失われていた)', async () => {
        await claimDocRef('parent-954-a2', '不一致太郎').set({
          state: 'resolved',
          folderId: 'a2-folder-id',
          attempt: null,
          parentId: 'parent-954-a2',
          name: '不一致太郎',
        });
        const { drive } = makeFakeDrive({
          files: [{ id: 'a2-folder-id', name: '実際は別名', parents: ['parent-954-a2'], trashed: false }],
        });
        const claim = (await readClaim(db, 'parent-954-a2', '不一致太郎')) as ResolvedFolderClaim;
        const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(db, [1]);

        try {
          await verifyFolderClaim(drive, failingDb, 'parent-954-a2', '不一致太郎', claim, 'run-a2');
          expect.fail('DivergentFolderClaimErrorがthrowされるべき');
        } catch (error) {
          expect(error).to.be.instanceOf(DivergentFolderClaimError);
        }

        expect(getTxCallCount()).to.equal(2);
        const after = (await claimDocRef('parent-954-a2', '不一致太郎').get()).data()!;
        expect(after.state).to.equal('divergent');
      });

      it('invalidateResolvedClaimByFolderId: 1回失敗しても2回目でリトライ成功する', async () => {
        await claimDocRef('parent-954-a3', '無効化太郎').set({
          state: 'resolved',
          folderId: 'a3-folder-id',
          attempt: null,
          parentId: 'parent-954-a3',
          name: '無効化太郎',
        });
        const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(db, [1]);

        const count = await invalidateResolvedClaimByFolderId(failingDb, 'a3-folder-id');

        expect(count).to.equal(1);
        expect(getTxCallCount()).to.equal(2);
        const after = (await claimDocRef('parent-954-a3', '無効化太郎').get()).data()!;
        expect(after.state).to.equal('invalidated');
      });
    });

    describe('B. リトライ全滅後も呼び出し元の契約が守られる(全attempts失敗)', () => {
      it('recordMiss: 全滅してもFolderVerificationPendingError(transient)を必ずthrowする(生のFirestoreエラーではない)', async () => {
        await claimDocRef('parent-954-b1', '既存太郎').set({
          state: 'resolved',
          folderId: 'gone-id',
          attempt: null,
          parentId: 'parent-954-b1',
          name: '既存太郎',
        });
        const { drive } = makeFakeDrive({ files: [] }); // files.get()は404
        const claim = (await readClaim(db, 'parent-954-b1', '既存太郎')) as ResolvedFolderClaim;
        const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(
          db,
          Array.from({ length: FOLDER_CLAIM_TX_RETRY_ATTEMPTS }, (_, i) => i + 1)
        );

        try {
          await verifyFolderClaim(drive, failingDb, 'parent-954-b1', '既存太郎', claim, 'run-b1');
          expect.fail('FolderVerificationPendingErrorがthrowされるべき');
        } catch (error) {
          expect(error).to.be.instanceOf(FolderVerificationPendingError);
          expect(classifyDriveExportErrorKind(error)).to.equal('transient');
        }
        // pr955-test-analyzer指摘対応: 無条件throwの背後でrecordMiss自体が実際に
        // FOLDER_CLAIM_TX_RETRY_ATTEMPTS回リトライしたことを直接確認する(リトライ回数の
        // 後退はこのアサーションなしでは検知できない)。
        expect(getTxCallCount()).to.equal(FOLDER_CLAIM_TX_RETRY_ATTEMPTS);
      });

      it('recordVerification(非trashed経路): 全滅しても例外を投げずrestored:falseで返す(claimのverifiedAtMsは更新されない)', async () => {
        await claimDocRef('parent-954-b2', '継続太郎').set({
          state: 'resolved',
          folderId: 'b2-folder-id',
          attempt: null,
          verifiedAtMs: 12345,
          parentId: 'parent-954-b2',
          name: '継続太郎',
        });
        const { drive } = makeFakeDrive({
          files: [{ id: 'b2-folder-id', name: '継続太郎', parents: ['parent-954-b2'], trashed: false }],
        });
        const claim = (await readClaim(db, 'parent-954-b2', '継続太郎')) as ResolvedFolderClaim;
        const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(
          db,
          Array.from({ length: FOLDER_CLAIM_TX_RETRY_ATTEMPTS }, (_, i) => i + 1)
        );

        const result = await verifyFolderClaim(drive, failingDb, 'parent-954-b2', '継続太郎', claim, 'run-b2');

        expect(result).to.deep.equal({ folderId: 'b2-folder-id', restored: false });
        const after = (await claimDocRef('parent-954-b2', '継続太郎').get()).data()!;
        expect(after.verifiedAtMs).to.equal(12345);
        // pr955-test-analyzer指摘対応: recordVerification自体が実際にリトライ全滅した
        // ことを直接確認する。
        expect(getTxCallCount()).to.equal(FOLDER_CLAIM_TX_RETRY_ATTEMPTS);
      });

      it('reconcileAttempt: invalidateAttemptが全滅しても握り潰され、clear経路が正常に返る', async () => {
        const parentId = 'parent-954-b3';
        const name = 'クリア太郎';
        const attemptId = 'attempt-954-b3';
        const claim: FolderClaimDoc & { attempt: FolderClaimAttempt } = {
          state: 'creating',
          attempt: { attemptId, startedAtMs: Date.now() - (RECONCILE_GRACE_MS + 60_000), runId: 'old-run' },
          parentId,
          name,
        };
        await claimDocRef(parentId, name).set(claim);
        const { drive } = makeFakeDrive({}); // attemptIdタグ検索は0件
        const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(
          db,
          Array.from({ length: FOLDER_CLAIM_TX_RETRY_ATTEMPTS }, (_, i) => i + 1)
        );

        const result = await reconcileAttempt(drive, failingDb, parentId, name, claim, 'new-run');

        expect(result).to.deep.equal({ status: 'clear' });
        // pr955-test-analyzer指摘対応: invalidateAttempt自体が実際にリトライ全滅した
        // ことを直接確認する。
        expect(getTxCallCount()).to.equal(FOLDER_CLAIM_TX_RETRY_ATTEMPTS);
      });
    });

    describe('C. 非transientエラーは即座に諦める(shouldRetry述語が機能する証拠)', () => {
      it('recordVerification: PERMISSION_DENIED(非transient)は1回で諦めリトライされない', async () => {
        await claimDocRef('parent-954-c1', '非再試行太郎').set({
          state: 'resolved',
          folderId: 'c1-folder-id',
          attempt: null,
          parentId: 'parent-954-c1',
          name: '非再試行太郎',
        });
        const { drive } = makeFakeDrive({
          files: [{ id: 'c1-folder-id', name: '非再試行太郎', parents: ['parent-954-c1'], trashed: false }],
        });
        const claim = (await readClaim(db, 'parent-954-c1', '非再試行太郎')) as ResolvedFolderClaim;
        // gRPC code 7 = PERMISSION_DENIED、FIRESTORE_TRANSIENT_GRPC_CODESに含まれない
        const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(db, [1], 7);

        const result = await verifyFolderClaim(drive, failingDb, 'parent-954-c1', '非再試行太郎', claim, 'run-c1');

        expect(result).to.deep.equal({ folderId: 'c1-folder-id', restored: false });
        expect(getTxCallCount()).to.equal(1);
      });

      it('recordVerification: RESOURCE_EXHAUSTED(code 8、SDK内部ではtransient扱いだが外側リトライ対象からは意図的に除外)も1回で諦めリトライされない(fable-reviewセカンドオピニオン指摘、Issue #954)', async () => {
        // gRPC code 8はSDK内部で最大60秒程度までbackoffが引き上げられる特別扱いのため、
        // 外側でさらに3回重ねるとホットパスでCloud Functions timeoutに接近するリスクが
        // あり、意図的にFIRESTORE_TRANSIENT_GRPC_CODESから除外している。この判断が
        // 将来「executeDriveExport.tsのGRPC_TRANSIENT_CODES(8を含む)と揃えよう」という
        // 善意のリファクタで無言に巻き戻らないよう固定する。
        await claimDocRef('parent-954-c2', '過負荷太郎').set({
          state: 'resolved',
          folderId: 'c2-folder-id',
          attempt: null,
          parentId: 'parent-954-c2',
          name: '過負荷太郎',
        });
        const { drive } = makeFakeDrive({
          files: [{ id: 'c2-folder-id', name: '過負荷太郎', parents: ['parent-954-c2'], trashed: false }],
        });
        const claim = (await readClaim(db, 'parent-954-c2', '過負荷太郎')) as ResolvedFolderClaim;
        const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(db, [1], 8);

        const result = await verifyFolderClaim(drive, failingDb, 'parent-954-c2', '過負荷太郎', claim, 'run-c2');

        expect(result).to.deep.equal({ folderId: 'c2-folder-id', restored: false });
        expect(getTxCallCount()).to.equal(1);
      });
    });

    describe('E. 定数間の暗黙結合のドリフト検知(silent-failure-hunter指摘、Issue #954)', () => {
      it('RECONCILE_GRACE_MSとFOLDER_LOCK_STALE_MSは同値でなければならない(reconcileAttemptがinvalidateAttempt失敗を「リースは既に失効済み」として握り潰す前提)', () => {
        expect(RECONCILE_GRACE_MS).to.equal(FOLDER_LOCK_STALE_MS);
      });
    });

    describe('D. beginCreationの自己ブロック解消(ambiguous commit後の再試行で自分自身のcreating claimをblockedと誤認しない)', () => {
      it('ambiguous commit(サーバー側の書込みは成功したがクライアントには失敗として返る)後の再試行で、自分自身が書いたcreating claimをblockedと誤認せずbegunを返す', async () => {
        const parentId = 'parent-954-d1';
        const name = '自己ブロック太郎';
        // 1回目のtxは実dbへ実際に委譲し(書込みは成功する)、その後クライアント側にのみ
        // 一時的失敗として返す(ambiguous commitの再現)。attemptIdはbeginCreation内で
        // tx外(呼び出し1回につき1つ)生成されるため、2回目のtxでも同じattemptIdが使われる。
        // 本テストは外側のwithBackoffRetry層でのみ再現するが、自己ブロック解消ガード
        // (`existing.attempt?.attemptId === attemptId`)はtxコールバック内にあるため、
        // 実運用でSDK内部リトライ(最大5回)経由でtxコールバックが再実行される場合も
        // 同様に効く(fable-reviewセカンドオピニオン指摘)。
        const ambiguousDb = makeAmbiguousCommitFirestore(db, 1);

        const result = await beginCreation(ambiguousDb, parentId, name, 'run-d1');

        expect(result.status).to.equal('begun');
        const snap = await claimDocRef(parentId, name).get();
        expect(snap.data()?.state).to.equal('creating');
        if (result.status === 'begun') {
          expect(snap.data()?.attempt?.attemptId).to.equal(result.attemptId);
        }
      });
    });
  });
});
