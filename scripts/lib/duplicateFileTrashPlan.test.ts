/**
 * `scripts/lib/duplicateFileTrashPlan.ts` の単体テスト(node:test、emulator不要)
 *
 * 実行: cd scripts && npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recommendKeep, validateTrashRequest, type DuplicateFileInfo } from './duplicateFileTrashPlan';

const f = (id: string, over: Partial<DuplicateFileInfo> = {}): DuplicateFileInfo => ({
  id,
  createdTime: '2026-08-10T00:00:00.000Z',
  size: '1000',
  md5Checksum: 'aaa',
  ...over,
});

test('recommendKeep: 書類のdriveFileIdと一致する1件を残す推奨にする', () => {
  const r = recommendKeep([f('A'), f('B')], 'B');
  assert.deepEqual(r, { keepId: 'B', trashId: 'A', basis: 'doc-driveFileId' });
});

test('recommendKeep: driveFileIdが重複のどちらにも一致しない場合は推奨しない(人が判断)', () => {
  assert.equal(recommendKeep([f('A'), f('B')], 'ZZZ'), null);
});

test('recommendKeep: driveFileIdが空(null/undefined)の場合は推奨しない', () => {
  assert.equal(recommendKeep([f('A'), f('B')], null), null);
  assert.equal(recommendKeep([f('A'), f('B')], undefined), null);
});

test('recommendKeep: 重複が2件でない(1件/3件以上)場合は推奨しない', () => {
  assert.equal(recommendKeep([f('A')], 'A'), null);
  assert.equal(recommendKeep([f('A'), f('B'), f('C')], 'A'), null);
  assert.equal(recommendKeep([], 'A'), null);
});

test('validateTrashRequest: 2件のうち異なる2IDを指定すれば許可', () => {
  assert.deepEqual(validateTrashRequest([f('A'), f('B')], 'A', 'B'), { ok: true });
});

test('validateTrashRequest: keepとtrashが同一IDは拒否', () => {
  const r = validateTrashRequest([f('A'), f('B')], 'A', 'A');
  assert.equal(r.ok, false);
});

test('validateTrashRequest: 重複一覧に無いIDは拒否(keep/trashのどちらでも)', () => {
  assert.equal(validateTrashRequest([f('A'), f('B')], 'A', 'X').ok, false);
  assert.equal(validateTrashRequest([f('A'), f('B')], 'X', 'B').ok, false);
});

test('validateTrashRequest: 重複が2件でない場合は拒否(誤って正規のファイルを消さない)', () => {
  assert.equal(validateTrashRequest([f('A')], 'A', 'B').ok, false);
  assert.equal(validateTrashRequest([f('A'), f('B'), f('C')], 'A', 'B').ok, false);
  assert.equal(validateTrashRequest([], 'A', 'B').ok, false);
});
