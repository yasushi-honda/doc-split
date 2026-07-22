/**
 * Drive フォルダ find-or-create(`functions/src/drive/findOrCreateFolder.ts`)のテスト(ADR-0022)
 *
 * 実Drive APIは呼ばず、`drive_v3.Drive`の`files.list`/`files.create`のみを
 * 実装したfakeクライアントで検証する(sinon等のモックライブラリ未導入のため手書き)。
 *
 * 異なるdocId間の作成競合防止(code-review xhigh指摘#2対応、2026-07-22)にFirestore
 * トランザクションベースのロック(`driveFolderLocks`コレクション)を追加したため、
 * 単体テストからFirestore emulator依存の統合テストへ移行した
 * (旧`findOrCreateFolder.test.ts`から改名)。
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

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['driveFolderLocks'];

interface FakeFile {
  id: string;
  name: string;
}

function makeFakeDrive(opts: { listFiles: FakeFile[]; createdId?: string | null }) {
  const listCalls: Record<string, unknown>[] = [];
  const createCalls: Record<string, unknown>[] = [];

  const drive = {
    files: {
      list: async (params: Record<string, unknown>) => {
        listCalls.push(params);
        return { data: { files: opts.listFiles } };
      },
      create: async (params: Record<string, unknown>) => {
        createCalls.push(params);
        return { data: { id: opts.createdId === undefined ? 'new-folder-id' : opts.createdId } };
      },
    },
  } as unknown as drive_v3.Drive;

  return { drive, listCalls, createCalls };
}

describe('findOrCreateFolder (ADR-0022)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('0件の場合は新規フォルダを作成し、そのidを返す', async () => {
    const { drive, createCalls } = makeFakeDrive({ listFiles: [] });

    const result = await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');

    expect(result).to.equal('new-folder-id');
    expect(createCalls).to.have.lengthOf(1);
    const body = createCalls[0].requestBody as { name: string; mimeType: string; parents: string[] };
    expect(body).to.deep.equal({
      name: '田中太郎',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['parent-1'],
    });
  });

  it('作成リクエストにsupportsAllDrivesがtrueで付与される', async () => {
    const { drive, createCalls } = makeFakeDrive({ listFiles: [] });
    await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');
    expect(createCalls[0].supportsAllDrives).to.equal(true);
  });

  it('1件見つかった場合はそのidを再利用し、作成は呼ばない', async () => {
    const { drive, createCalls } = makeFakeDrive({
      listFiles: [{ id: 'existing-id', name: '田中太郎' }],
    });

    const result = await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');

    expect(result).to.equal('existing-id');
    expect(createCalls).to.have.lengthOf(0);
  });

  it('2件以上見つかった場合はAmbiguousFolderErrorをthrowし、作成は呼ばない', async () => {
    const { drive, createCalls } = makeFakeDrive({
      listFiles: [
        { id: 'dup-1', name: '田中太郎' },
        { id: 'dup-2', name: '田中太郎' },
      ],
    });

    try {
      await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');
      expect.fail('AmbiguousFolderErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(AmbiguousFolderError);
      expect((error as Error).message).to.include('田中太郎');
      expect((error as Error).message).to.include('2件');
    }
    expect(createCalls).to.have.lengthOf(0);
  });

  it('検索クエリはparentId・name・folder mimeType・trashed=falseを含む', async () => {
    const { drive, listCalls } = makeFakeDrive({ listFiles: [] });
    await findOrCreateFolder(drive, db, 'parent-xyz', '鈴木花子');

    const q = listCalls[0].q as string;
    expect(q).to.include(`'parent-xyz' in parents`);
    expect(q).to.include(`name='鈴木花子'`);
    expect(q).to.include(`mimeType='application/vnd.google-apps.folder'`);
    expect(q).to.include('trashed=false');
  });

  it('name内のシングルクォートはクエリ内でエスケープされる', async () => {
    const { drive, listCalls } = makeFakeDrive({ listFiles: [] });
    await findOrCreateFolder(drive, db, 'parent-1', "O'Brien");

    const q = listCalls[0].q as string;
    expect(q).to.include(`name='O\\'Brien'`);
  });

  it('作成レスポンスにidが含まれない場合はErrorをthrowする', async () => {
    const { drive } = makeFakeDrive({ listFiles: [], createdId: null });

    try {
      await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');
      expect.fail('Errorがthrowされるべき');
    } catch (error) {
      expect((error as Error).message).to.include('作成に失敗');
    }
  });

  it('既存フォルダのidが空の場合はErrorをthrowする', async () => {
    const { drive } = makeFakeDrive({
      listFiles: [{ id: '', name: '田中太郎' }],
    });

    try {
      await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');
      expect.fail('Errorがthrowされるべき');
    } catch (error) {
      expect((error as Error).message).to.include('idが取得できません');
    }
  });

  it('検索リクエストにincludeItemsFromAllDrivesがtrueで付与される(Shared Drive対応)', async () => {
    const { drive, listCalls } = makeFakeDrive({ listFiles: [] });
    await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');
    expect(listCalls[0].includeItemsFromAllDrives).to.equal(true);
    expect(listCalls[0].supportsAllDrives).to.equal(true);
  });

  describe('異なるdocId間の作成競合防止(code-review xhigh指摘#2対応)', () => {
    // findOrCreateFolder.ts の buildFolderLockId() と同じキー生成をテスト側でも
    // 再現する(非公開ヘルパーのため、実装と同じロジックをテストで直接計算する)
    function lockDocRef(parentId: string, name: string) {
      const lockId = Buffer.from(`${parentId}/${name}`).toString('base64url');
      return db.collection('driveFolderLocks').doc(lockId);
    }

    it('同一parent+nameの新しいロックが既に保有されている場合はFolderCreationInProgressErrorをthrowし、Drive作成は呼ばない', async () => {
      await lockDocRef('parent-locked', '施錠太郎').set({ claimedAtMs: Date.now() });
      const { drive, createCalls } = makeFakeDrive({ listFiles: [] });

      try {
        await findOrCreateFolder(drive, db, 'parent-locked', '施錠太郎');
        expect.fail('FolderCreationInProgressErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(FolderCreationInProgressError);
      }
      expect(createCalls).to.have.lengthOf(0);
    });

    it('staleなロック(FOLDER_LOCK_STALE_MS超過)が残留していても上書き取得して新規作成できる', async () => {
      const staleMs = 3 * 60 * 1000; // FOLDER_LOCK_STALE_MS(2分)より確実に過去
      await lockDocRef('parent-stale', '陳腐化太郎').set({ claimedAtMs: Date.now() - staleMs });
      const { drive, createCalls } = makeFakeDrive({ listFiles: [], createdId: 'after-stale-lock' });

      const result = await findOrCreateFolder(drive, db, 'parent-stale', '陳腐化太郎');

      expect(result).to.equal('after-stale-lock');
      expect(createCalls).to.have.lengthOf(1);
    });

    it('正常完了後はロックドキュメントが解放され残留しない', async () => {
      const { drive } = makeFakeDrive({ listFiles: [], createdId: 'first-id' });
      await findOrCreateFolder(drive, db, 'parent-seq', '順次作成太郎');

      const lockSnap = await lockDocRef('parent-seq', '順次作成太郎').get();
      expect(lockSnap.exists).to.equal(false);
    });

    it('作成失敗時もロックドキュメントは解放される(finally節)', async () => {
      const { drive } = makeFakeDrive({ listFiles: [], createdId: null });

      try {
        await findOrCreateFolder(drive, db, 'parent-fail', '失敗太郎');
        expect.fail('Errorがthrowされるべき');
      } catch {
        // idが返却されないケース(既存の異常系テストと同じ)
      }

      const lockSnap = await lockDocRef('parent-fail', '失敗太郎').get();
      expect(lockSnap.exists).to.equal(false);
    });

    it('ロック獲得後の再検索で既に他の実行が作成済みだった場合はそのidを再利用し、二重作成しない', async () => {
      // 1回目のlist呼び出し(0件)はロック取得前、2回目の再検索(ロック取得後)では
      // 別プロセスが既に作成済みのシナリオを模倣して1件返す
      let listCallCount = 0;
      const createCalls: Record<string, unknown>[] = [];
      const drive = {
        files: {
          list: async () => {
            listCallCount++;
            if (listCallCount === 1) {
              return { data: { files: [] } };
            }
            return { data: { files: [{ id: 'concurrently-created-id', name: '再検索太郎' }] } };
          },
          create: async (params: Record<string, unknown>) => {
            createCalls.push(params);
            return { data: { id: 'should-not-be-used' } };
          },
        },
      } as unknown as drive_v3.Drive;

      const result = await findOrCreateFolder(drive, db, 'parent-recheck', '再検索太郎');

      expect(result).to.equal('concurrently-created-id');
      expect(createCalls).to.have.lengthOf(0);
    });

    // 注: 真の同時実行(Promise.allで2つのfindOrCreateFolderを未ゲート実行)による
    // レース再現は、Firestore emulatorの新規(未作成)ドキュメントに対するトランザクション
    // 競合検知が実行タイミングにより不安定(検証時に複数回試行し再現したりしなかったり
    // する挙動を確認済み)なため採用しない。ロックの契約(既に保有されている場合は
    // throwする/staleなら上書きできる/正常終了・異常終了いずれでも解放される)は上記の
    // 決定論的なテスト群で網羅しているため、フレークな再現テストに依存する必要はない。
  });
});
