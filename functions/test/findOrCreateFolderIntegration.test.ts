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
        // 実Drive APIと同様、クエリのtrashed条件でフィルタする(2段階検索の
        // active/trashed両フェーズを区別するため。実装がどちらの段階の呼び出しかは
        // クエリ文字列でしか判別できない)
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

  describe('trashedフォルダの自動復元(Issue #811根本原因修正、2026-08-27)', () => {
    it('1件見つかりtrashedでない場合はfiles.updateを呼ばずそのidを返す', async () => {
      const { drive, updateCalls } = makeFakeDrive({
        listFiles: [{ id: 'existing-id', name: '田中太郎', trashed: false }],
      });

      const result = await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');

      expect(result).to.equal('existing-id');
      expect(updateCalls).to.have.lengthOf(0);
    });

    it('1件見つかりtrashedの場合はfiles.update({trashed:false})で復元してからそのidを返す', async () => {
      const { drive, updateCalls, createCalls } = makeFakeDrive({
        listFiles: [{ id: 'trashed-id', name: '田中太郎', trashed: true }],
      });

      const result = await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');

      expect(result).to.equal('trashed-id');
      expect(updateCalls).to.have.lengthOf(1);
      expect(updateCalls[0].fileId).to.equal('trashed-id');
      expect(updateCalls[0].requestBody).to.deep.equal({ trashed: false });
      expect(createCalls).to.have.lengthOf(0);
    });

    it('復元API(files.update)が失敗した場合は新規作成へフォールバックせず例外を再送出する', async () => {
      const { drive, createCalls } = makeFakeDrive({
        listFiles: [{ id: 'trashed-id', name: '田中太郎', trashed: true }],
        updateImpl: async () => {
          throw new Error('simulated Drive API failure');
        },
      });

      try {
        await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');
        expect.fail('復元失敗時の例外がthrowされるべき');
      } catch (error) {
        expect((error as Error).message).to.include('simulated Drive API failure');
      }
      expect(createCalls).to.have.lengthOf(0);
    });

    it('ロック獲得後の再検索で1件かつtrashedだった場合も復元してから再利用する', async () => {
      // 呼び出し順: 1=pre-lock active(0件) 2=pre-lock trashed(0件) →ロック取得→
      // 3=post-lock active(0件) 4=post-lock trashed(1件、ここで復元)
      let listCallCount = 0;
      const updateCalls: Record<string, unknown>[] = [];
      const createCalls: Record<string, unknown>[] = [];
      const drive = {
        files: {
          list: async () => {
            listCallCount++;
            if (listCallCount <= 3) {
              return { data: { files: [] } };
            }
            return { data: { files: [{ id: 'concurrently-trashed-id', name: '再検索太郎', trashed: true }] } };
          },
          create: async (params: Record<string, unknown>) => {
            createCalls.push(params);
            return { data: { id: 'should-not-be-used' } };
          },
          update: async (params: Record<string, unknown>) => {
            updateCalls.push(params);
            return { data: { id: params.fileId as string } };
          },
        },
      } as unknown as drive_v3.Drive;

      const result = await findOrCreateFolder(drive, db, 'parent-recheck-trashed', '再検索太郎');

      expect(result).to.equal('concurrently-trashed-id');
      expect(updateCalls).to.have.lengthOf(1);
      expect(createCalls).to.have.lengthOf(0);
    });

    it('activeが1件見つかれば、無関係なtrashedの同名フォルダが他に残っていても一切考慮せずそのidを返す(kanameone本番回帰の再発防止、2026-08-27)', async () => {
      // 顧客「大橋のぶ子」配下の「報告書」フォルダで実際に発生した回帰: active 1件+
      // trashedの残骸1件が同名で存在するケースで、初版はtrashedも検索対象に含めて
      // AmbiguousFolderErrorにしてしまっていた。2段階検索ではactiveが1件見つかった
      // 時点でtrashed側を一切検索しないため、この回帰が再発しないことを固定する。
      const { drive, listCalls, updateCalls, createCalls } = makeFakeDrive({
        listFiles: [
          { id: 'active-report-id', name: '報告書', trashed: false },
          { id: 'stale-trashed-report-id', name: '報告書', trashed: true },
        ],
      });

      const result = await findOrCreateFolder(drive, db, 'parent-customer', '報告書');

      expect(result).to.equal('active-report-id');
      expect(updateCalls).to.have.lengthOf(0);
      expect(createCalls).to.have.lengthOf(0);
      // trashed側の検索クエリが一度も発行されていないこと(activeの1件で即確定するため)
      expect(listCalls.every((c) => !(c.q as string).includes('trashed=true'))).to.equal(true);
    });
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

  it('active 0件・trashedが2件以上見つかった場合もAmbiguousFolderErrorをthrowする(2段階目の分岐)', async () => {
    const { drive, createCalls } = makeFakeDrive({
      listFiles: [
        { id: 'trashed-dup-1', name: '田中太郎', trashed: true },
        { id: 'trashed-dup-2', name: '田中太郎', trashed: true },
      ],
    });

    try {
      await findOrCreateFolder(drive, db, 'parent-1', '田中太郎');
      expect.fail('AmbiguousFolderErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(AmbiguousFolderError);
      expect((error as Error).message).to.include('2件');
    }
    expect(createCalls).to.have.lengthOf(0);
  });

  it('検索は2段階(まずactiveのみ、0件ならtrashed込みで再検索)で行う(Issue #811根本原因修正、2026-08-27訂正)', async () => {
    const { drive, listCalls } = makeFakeDrive({ listFiles: [] });
    await findOrCreateFolder(drive, db, 'parent-xyz', '鈴木花子');

    // 1段階目(pre-lock active検索)
    const q1 = listCalls[0].q as string;
    expect(q1).to.include(`'parent-xyz' in parents`);
    expect(q1).to.include(`name='鈴木花子'`);
    expect(q1).to.include(`mimeType='application/vnd.google-apps.folder'`);
    expect(q1).to.include('trashed=false');

    // 2段階目(1段階目が0件だったためtrashed込みで再検索)
    const q2 = listCalls[1].q as string;
    expect(q2).to.include(`'parent-xyz' in parents`);
    expect(q2).to.include('trashed=true');
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
      const staleMs = 11 * 60 * 1000; // FOLDER_LOCK_STALE_MS(10分)より確実に過去
      await lockDocRef('parent-stale', '陳腐化太郎').set({ claimedAtMs: Date.now() - staleMs });
      const { drive, createCalls } = makeFakeDrive({ listFiles: [], createdId: 'after-stale-lock' });

      const result = await findOrCreateFolder(drive, db, 'parent-stale', '陳腐化太郎');

      expect(result).to.equal('after-stale-lock');
      expect(createCalls).to.have.lengthOf(1);
    });

    it('Issue #871是正: 実行時間timeoutSeconds(120秒)級の遅延が経過してもロックは失効せず、他の実行に奪われない', async () => {
      // 是正前はFOLDER_LOCK_STALE_MSがdriveExportTrigger.ts/retryDriveExport.tsの
      // timeoutSeconds:120と完全に一致しており、関数がタイムアウト死する瞬間とロック失効が
      // 同時に来ていた。120秒経過時点ではまだ有効(=奪われない)ことを確認する回帰テスト。
      const elapsedMs = 120 * 1000;
      await lockDocRef('parent-still-locked', '継続保持太郎').set({
        claimedAtMs: Date.now() - elapsedMs,
      });
      const { drive, createCalls } = makeFakeDrive({ listFiles: [] });

      try {
        await findOrCreateFolder(drive, db, 'parent-still-locked', '継続保持太郎');
        expect.fail('120秒経過時点ではロックはまだ有効で、FolderCreationInProgressErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(FolderCreationInProgressError);
      }
      expect(createCalls).to.have.lengthOf(0);
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
      // 呼び出し順: 1=pre-lock active(0件) 2=pre-lock trashed(0件) →ロック取得→
      // 3=post-lock active(1件、別プロセスが既に作成済み、ここで確定しtrashed側は検索しない)
      let listCallCount = 0;
      const createCalls: Record<string, unknown>[] = [];
      const drive = {
        files: {
          list: async () => {
            listCallCount++;
            if (listCallCount <= 2) {
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

    it('ロック獲得後の再検索で2件以上見つかった場合もAmbiguousFolderErrorをthrowする(code-review high指摘#2対応)', async () => {
      // 呼び出し順: 1=pre-lock active(0件) 2=pre-lock trashed(0件) →ロック取得→
      // 3=post-lock active(2件、ここでAmbiguousFolderError)
      let listCallCount = 0;
      const createCalls: Record<string, unknown>[] = [];
      const drive = {
        files: {
          list: async () => {
            listCallCount++;
            if (listCallCount <= 2) {
              return { data: { files: [] } };
            }
            return {
              data: {
                files: [
                  { id: 'dup-1', name: '再検索重複太郎' },
                  { id: 'dup-2', name: '再検索重複太郎' },
                ],
              },
            };
          },
          create: async (params: Record<string, unknown>) => {
            createCalls.push(params);
            return { data: { id: 'should-not-be-used' } };
          },
        },
      } as unknown as drive_v3.Drive;

      try {
        await findOrCreateFolder(drive, db, 'parent-recheck-dup', '再検索重複太郎');
        expect.fail('AmbiguousFolderErrorがthrowされるべき');
      } catch (error) {
        expect(error).to.be.instanceOf(AmbiguousFolderError);
      }
      expect(createCalls).to.have.lengthOf(0);

      // 曖昧な状態で停止した場合もロックは解放される(finally節)
      const lockSnap = await lockDocRef('parent-recheck-dup', '再検索重複太郎').get();
      expect(lockSnap.exists).to.equal(false);
    });

    it('release時に他の実行へロックが既に引き継がれていた場合は削除しない(fencing token、code-review high指摘#1対応)', async () => {
      let releaseCreateGate: (() => void) | undefined;
      const createGate = new Promise<void>((resolve) => {
        releaseCreateGate = resolve;
      });

      const drive = {
        files: {
          list: async () => ({ data: { files: [] } }),
          create: async () => {
            // ロック保有中に別プロセスがロックを奪ったことをシミュレートできるよう、
            // create()完了をゲートで足止めする
            await createGate;
            return { data: { id: 'original-holder-id' } };
          },
        },
      } as unknown as drive_v3.Drive;

      const findPromise = findOrCreateFolder(drive, db, 'parent-fencing', '横取太郎');

      // findOrCreateFolderがロックを獲得しcreate()内で足止めされるのを待ってから、
      // 別プロセスが(staleと誤判定して)ロックを奪ったのと同じ状態を直接書き込む
      await new Promise((resolve) => setTimeout(resolve, 50));
      const lockRef = lockDocRef('parent-fencing', '横取太郎');
      await lockRef.set({ claimedAtMs: Date.now(), lockToken: 'someone-elses-token' });

      releaseCreateGate?.();
      const result = await findPromise;
      expect(result).to.equal('original-holder-id');

      // 元の実行のfinally節はlockTokenが一致しないため削除をスキップし、
      // 別プロセス(を模した書込み)のロックがそのまま残っているはず
      const lockSnap = await lockRef.get();
      expect(lockSnap.exists).to.equal(true);
      expect(lockSnap.data()?.lockToken).to.equal('someone-elses-token');
    });

    // 注: 真の同時実行(Promise.allで2つのfindOrCreateFolderを未ゲート実行)による
    // レース再現は、Firestore emulatorの新規(未作成)ドキュメントに対するトランザクション
    // 競合検知が実行タイミングにより不安定(検証時に複数回試行し再現したりしなかったり
    // する挙動を確認済み)なため採用しない。ロックの契約(既に保有されている場合は
    // throwする/staleなら上書きできる/正常終了・異常終了いずれでも解放される)は上記の
    // 決定論的なテスト群で網羅しているため、フレークな再現テストに依存する必要はない。
  });
});
