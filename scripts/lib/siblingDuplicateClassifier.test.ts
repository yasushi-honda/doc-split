import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySiblingGroup } from './siblingDuplicateClassifier';
import type { FolderSnapshot } from './siblingDuplicatePlanTypes';

function folder(overrides: Partial<FolderSnapshot> = {}): FolderSnapshot {
  return {
    id: 'folder-1',
    parentId: 'parent-1',
    name: '医療',
    trashed: false,
    modifiedTime: '2026-09-23T00:00:00.000Z',
    hasClaimTag: false,
    childFolderCount: 0,
    childFileCount: 0,
    ...overrides,
  };
}

test('classifySiblingGroup: タグ無し1件・タグ有り1件・子フォルダ無し → merge(人作成側をcanonical)', () => {
  const human = folder({ id: 'human-1', hasClaimTag: false });
  const app = folder({ id: 'app-1', hasClaimTag: true });
  const result = classifySiblingGroup([human, app]);

  assert.equal(result.action, 'merge');
  assert.equal(result.canonicalFolderId, 'human-1');
  assert.equal(result.duplicateFolderId, 'app-1');
});

test('classifySiblingGroup: 3件以上はmanual-review', () => {
  const result = classifySiblingGroup([
    folder({ id: 'f1', hasClaimTag: false }),
    folder({ id: 'f2', hasClaimTag: true }),
    folder({ id: 'f3', hasClaimTag: true }),
  ]);

  assert.equal(result.action, 'manual-review');
  assert.match(result.reason, /3件/);
  assert.equal(result.canonicalFolderId, null);
  assert.equal(result.duplicateFolderId, null);
});

test('classifySiblingGroup: タグ無しが0件(両方app作成)はmanual-review', () => {
  const result = classifySiblingGroup([
    folder({ id: 'f1', hasClaimTag: true }),
    folder({ id: 'f2', hasClaimTag: true }),
  ]);

  assert.equal(result.action, 'manual-review');
  assert.match(result.reason, /タグ無し0件/);
});

test('classifySiblingGroup: タグ無しが2件(両方人作成)はmanual-review', () => {
  const result = classifySiblingGroup([
    folder({ id: 'f1', hasClaimTag: false }),
    folder({ id: 'f2', hasClaimTag: false }),
  ]);

  assert.equal(result.action, 'manual-review');
  assert.match(result.reason, /タグ有り0件/);
});

test('classifySiblingGroup: duplicate(app作成)側に子フォルダがあればmanual-review(同名衝突リスク)', () => {
  const human = folder({ id: 'human-1', hasClaimTag: false });
  const app = folder({ id: 'app-1', hasClaimTag: true, childFolderCount: 2 });
  const result = classifySiblingGroup([human, app]);

  assert.equal(result.action, 'manual-review');
  assert.match(result.reason, /子フォルダが2件/);
});

test('classifySiblingGroup: canonical(人作成)側に子フォルダがあってもmergeを妨げない(統合先はそのまま維持されるため)', () => {
  const human = folder({ id: 'human-1', hasClaimTag: false, childFolderCount: 3 });
  const app = folder({ id: 'app-1', hasClaimTag: true, childFolderCount: 0 });
  const result = classifySiblingGroup([human, app]);

  assert.equal(result.action, 'merge');
  assert.equal(result.canonicalFolderId, 'human-1');
});

test('classifySiblingGroup: 1件以下の入力は呼び出し側のバグとしてmanual-review', () => {
  const result = classifySiblingGroup([folder()]);
  assert.equal(result.action, 'manual-review');
  assert.match(result.reason, /1件/);
});
