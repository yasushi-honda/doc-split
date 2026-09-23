import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  verifySiblingGroupFingerprint,
  isGroupAlreadyMerged,
  buildGroupId,
  type FolderSnapshot,
} from './siblingDuplicatePlanTypes';

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

test('buildGroupId: parentId:nameで一意化する', () => {
  assert.equal(buildGroupId('parent-1', '医療'), 'parent-1:医療');
});

test('verifySiblingGroupFingerprint: audit時点とlive状態が完全一致すればok', () => {
  const canonical = folder({ id: 'human-1' });
  const duplicate = folder({ id: 'app-1', hasClaimTag: true });

  const result = verifySiblingGroupFingerprint(
    { canonical, duplicate },
    { canonical, duplicate }
  );

  assert.deepEqual(result, { ok: true });
});

test('verifySiblingGroupFingerprint: audit〜execute間にduplicateのmodifiedTimeが変化していればfail(drift検知)', () => {
  const canonical = folder({ id: 'human-1' });
  const duplicatePlan = folder({ id: 'app-1', hasClaimTag: true, modifiedTime: '2026-09-23T00:00:00.000Z' });
  const duplicateLive = folder({ id: 'app-1', hasClaimTag: true, modifiedTime: '2026-09-23T01:00:00.000Z' });

  const result = verifySiblingGroupFingerprint(
    { canonical, duplicate: duplicatePlan },
    { canonical, duplicate: duplicateLive }
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /duplicate folderのmodifiedTime/);
});

test('verifySiblingGroupFingerprint: audit〜execute間にduplicate配下へ子フォルダが追加されていればfail', () => {
  const canonical = folder({ id: 'human-1' });
  const duplicatePlan = folder({ id: 'app-1', hasClaimTag: true, childFolderCount: 0 });
  const duplicateLive = folder({ id: 'app-1', hasClaimTag: true, childFolderCount: 1 });

  const result = verifySiblingGroupFingerprint(
    { canonical, duplicate: duplicatePlan },
    { canonical, duplicate: duplicateLive }
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /子フォルダが新たに存在する/);
});

test('verifySiblingGroupFingerprint: canonical側が手動で移動・改名されていればfail', () => {
  const canonicalPlan = folder({ id: 'human-1', name: '医療' });
  const canonicalLive = folder({ id: 'human-1', name: '医療(改名後)' });
  const duplicate = folder({ id: 'app-1', hasClaimTag: true });

  const result = verifySiblingGroupFingerprint(
    { canonical: canonicalPlan, duplicate },
    { canonical: canonicalLive, duplicate }
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /canonical folderのparent\/name/);
});

test('verifySiblingGroupFingerprint: canonicalがtrashed済みならfail', () => {
  const canonicalPlan = folder({ id: 'human-1' });
  const canonicalLive = folder({ id: 'human-1', trashed: true });
  const duplicate = folder({ id: 'app-1', hasClaimTag: true });

  const result = verifySiblingGroupFingerprint(
    { canonical: canonicalPlan, duplicate },
    { canonical: canonicalLive, duplicate }
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /trashed/);
});

test('isGroupAlreadyMerged: duplicateがnull(404で取得不能)ならtrue', () => {
  assert.equal(isGroupAlreadyMerged(null), true);
});

test('isGroupAlreadyMerged: duplicateが既にtrashed済みならtrue', () => {
  assert.equal(isGroupAlreadyMerged({ trashed: true }), true);
});

test('isGroupAlreadyMerged: duplicateがactiveのまま残っていればfalse(未処理・再実行対象)', () => {
  assert.equal(isGroupAlreadyMerged({ trashed: false }), false);
});
