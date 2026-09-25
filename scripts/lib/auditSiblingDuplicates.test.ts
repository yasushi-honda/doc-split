/**
 * `scripts/lib/auditSiblingDuplicates.ts` の単体テスト(Issue #1039恒久対応)
 *
 * Firestore emulatorを必要としない(`scanSiblingDuplicates`はfirebase-adminに一切
 * 依存しないため)。fake Driveは`scripts/lib/testing/fakeSiblingDrive.ts`を流用する。
 *
 * 実行: cd scripts && npm test (node --test lib/*.test.ts)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanSiblingDuplicates } from './auditSiblingDuplicates';
import { makeFakeSiblingDrive, type FakeSiblingFile } from './testing/fakeSiblingDrive';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const CLAIM_KEY = 'docSplitFolderClaim';
const ROOT_ID = 'root';
const ROOT_NAME = 'ルート';

function folder(overrides: Partial<FakeSiblingFile> & { id: string }): FakeSiblingFile {
  return {
    name: '医療',
    mimeType: FOLDER_MIME_TYPE,
    parents: [ROOT_ID],
    modifiedTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function scan(files: FakeSiblingFile[]) {
  const { drive } = makeFakeSiblingDrive(files);
  return scanSiblingDuplicates({
    drive,
    rootFolderId: ROOT_ID,
    rootName: ROOT_NAME,
    folderMimeType: FOLDER_MIME_TYPE,
    claimKey: CLAIM_KEY,
  });
}

test('scanSiblingDuplicates: 重複なし → groups 0件', async () => {
  const result = await scan([folder({ id: 'f1', name: '医療', appProperties: undefined })]);
  assert.equal(result.groups.length, 0);
  // ルート(1)+f1自身がBFSでdequeueされ子要素列挙されるため2(f1に子は無い)。
  assert.equal(result.scannedFolderCount, 2);
});

test('scanSiblingDuplicates: タグ無し1件+タグ有り1件 → merge(人作成をcanonical)', async () => {
  const human = folder({ id: 'human-1', name: '医療' });
  const app = folder({ id: 'app-1', name: '医療', appProperties: { [CLAIM_KEY]: 'x' } });
  const result = await scan([human, app]);

  assert.equal(result.groups.length, 1);
  const g = result.groups[0];
  assert.equal(g.action, 'merge');
  assert.equal(g.canonicalFolderId, 'human-1');
  assert.equal(g.duplicateFolderId, 'app-1');
  assert.equal(g.folders.length, 2);
});

test('scanSiblingDuplicates: 同一parent+nameが3件 → manual-review', async () => {
  const f1 = folder({ id: 'f1', name: '医療' });
  const f2 = folder({ id: 'f2', name: '医療', appProperties: { [CLAIM_KEY]: 'x' } });
  const f3 = folder({ id: 'f3', name: '医療', appProperties: { [CLAIM_KEY]: 'y' } });
  const result = await scan([f1, f2, f3]);

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].action, 'manual-review');
});

test('scanSiblingDuplicates: duplicate候補側に子フォルダあり → manual-review', async () => {
  const human = folder({ id: 'human-1', name: '医療' });
  const app = folder({ id: 'app-1', name: '医療', appProperties: { [CLAIM_KEY]: 'x' } });
  const childOfApp = folder({ id: 'child-1', name: '子', parents: ['app-1'] });
  const result = await scan([human, app, childOfApp]);

  const g = result.groups.find((x) => x.name === '医療');
  assert.ok(g);
  assert.equal(g!.action, 'manual-review');
});

test('scanSiblingDuplicates: 深い階層のparentPathが祖先名を連結して構築される', async () => {
  const level1 = folder({ id: 'l1', name: '事業所A', parents: [ROOT_ID] });
  const humanUnder1 = folder({ id: 'human-2', name: '利用者太郎', parents: ['l1'] });
  const appUnder1 = folder({ id: 'app-2', name: '利用者太郎', parents: ['l1'], appProperties: { [CLAIM_KEY]: 'x' } });
  const result = await scan([level1, humanUnder1, appUnder1]);

  const g = result.groups.find((x) => x.name === '利用者太郎');
  assert.ok(g);
  assert.equal(g!.parentPath, `${ROOT_NAME}/事業所A`);
});

test('scanSiblingDuplicates: trashedフォルダはグルーピング対象から除外される', async () => {
  const human = folder({ id: 'human-1', name: '医療' });
  const app = folder({ id: 'app-1', name: '医療', appProperties: { [CLAIM_KEY]: 'x' } });
  const trashedDup = folder({ id: 'trashed-1', name: '医療', trashed: true });
  const result = await scan([human, app, trashedDup]);

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].folders.length, 2);
});

test('scanSiblingDuplicates: files.listのページングを跨いでも全件走査される', async () => {
  const human = folder({ id: 'human-1', name: '医療' });
  const app = folder({ id: 'app-1', name: '医療', appProperties: { [CLAIM_KEY]: 'x' } });
  const extra1 = folder({ id: 'extra-1', name: '介護' });
  const extra2 = folder({ id: 'extra-2', name: '生活' });
  const { drive } = makeFakeSiblingDrive([human, app, extra1, extra2], { listPageSize: 2 });

  const result = await scanSiblingDuplicates({
    drive,
    rootFolderId: ROOT_ID,
    rootName: ROOT_NAME,
    folderMimeType: FOLDER_MIME_TYPE,
    claimKey: CLAIM_KEY,
  });

  // ルート直下4フォルダ全てが発見され、うち「医療」ペアのみ重複グループ化される。
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].folders.length, 2);
});

test('scanSiblingDuplicates: scannedFolderCountはBFSでdequeueしたフォルダ数と一致する(ルート含む)', async () => {
  const level1 = folder({ id: 'l1', name: '事業所A', parents: [ROOT_ID] });
  const level2 = folder({ id: 'l2', name: '利用者太郎', parents: ['l1'] });
  const result = await scan([level1, level2]);

  // ルート(1) + l1(1) + l2(1、子フォルダ無しでもBFSでdequeueされ走査対象になる) = 3
  assert.equal(result.scannedFolderCount, 3);
});
