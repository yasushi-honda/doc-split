/**
 * Drive フォルダ find-or-create(`functions/src/drive/findOrCreateFolder.ts`)のテスト(ADR-0022)
 *
 * 実Drive APIは呼ばず、`drive_v3.Drive`の`files.list`/`files.create`のみを
 * 実装したfakeクライアントで検証する(sinon等のモックライブラリ未導入のため手書き)。
 */

import { expect } from 'chai';
import { drive_v3 } from 'googleapis';
import { findOrCreateFolder, AmbiguousFolderError } from '../src/drive/findOrCreateFolder';

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

describe('findOrCreateFolder', () => {
  it('0件の場合は新規フォルダを作成し、そのidを返す', async () => {
    const { drive, createCalls } = makeFakeDrive({ listFiles: [] });

    const result = await findOrCreateFolder(drive, 'parent-1', '田中太郎');

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
    await findOrCreateFolder(drive, 'parent-1', '田中太郎');
    expect(createCalls[0].supportsAllDrives).to.equal(true);
  });

  it('1件見つかった場合はそのidを再利用し、作成は呼ばない', async () => {
    const { drive, createCalls } = makeFakeDrive({
      listFiles: [{ id: 'existing-id', name: '田中太郎' }],
    });

    const result = await findOrCreateFolder(drive, 'parent-1', '田中太郎');

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
      await findOrCreateFolder(drive, 'parent-1', '田中太郎');
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
    await findOrCreateFolder(drive, 'parent-xyz', '鈴木花子');

    const q = listCalls[0].q as string;
    expect(q).to.include(`'parent-xyz' in parents`);
    expect(q).to.include(`name='鈴木花子'`);
    expect(q).to.include(`mimeType='application/vnd.google-apps.folder'`);
    expect(q).to.include('trashed=false');
  });

  it('name内のシングルクォートはクエリ内でエスケープされる', async () => {
    const { drive, listCalls } = makeFakeDrive({ listFiles: [] });
    await findOrCreateFolder(drive, 'parent-1', "O'Brien");

    const q = listCalls[0].q as string;
    expect(q).to.include(`name='O\\'Brien'`);
  });

  it('作成レスポンスにidが含まれない場合はErrorをthrowする', async () => {
    const { drive } = makeFakeDrive({ listFiles: [], createdId: null });

    try {
      await findOrCreateFolder(drive, 'parent-1', '田中太郎');
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
      await findOrCreateFolder(drive, 'parent-1', '田中太郎');
      expect.fail('Errorがthrowされるべき');
    } catch (error) {
      expect((error as Error).message).to.include('idが取得できません');
    }
  });

  it('検索リクエストにincludeItemsFromAllDrivesがtrueで付与される(Shared Drive対応)', async () => {
    const { drive, listCalls } = makeFakeDrive({ listFiles: [] });
    await findOrCreateFolder(drive, 'parent-1', '田中太郎');
    expect(listCalls[0].includeItemsFromAllDrives).to.equal(true);
    expect(listCalls[0].supportsAllDrives).to.equal(true);
  });
});
