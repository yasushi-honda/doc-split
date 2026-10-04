import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLEAR_FIELDS,
  MAX_CLEAR_COUNT,
  checkClearCount,
  isUnmarkedPending,
  selectUnmarkedPendingIds,
} from './clearUnmarkedPendingSummary';

test('isUnmarkedPending: pendingかつ印なしだけが対象', () => {
  assert.equal(isUnmarkedPending({ id: 'a', summaryState: 'pending' }), true);
  assert.equal(isUnmarkedPending({ id: 'a', summaryState: 'pending', summaryManualRequestedAt: null }), true);
  assert.equal(isUnmarkedPending({ id: 'a', summaryState: 'pending', summaryManualRequestedAt: { seconds: 1 } }), false);
});

test('isUnmarkedPending: pending以外(processing/done/error/skipped/不在)は対象外', () => {
  for (const state of ['processing', 'done', 'error', 'skipped', undefined]) {
    assert.equal(isUnmarkedPending({ id: 'a', summaryState: state }), false);
  }
});

test('selectUnmarkedPendingIds: 印ありを除外し入力順を保つ。空配列は空配列', () => {
  assert.deepEqual(selectUnmarkedPendingIds([]), []);
  assert.deepEqual(
    selectUnmarkedPendingIds([
      { id: 'x', summaryState: 'pending' },
      { id: 'y', summaryState: 'pending', summaryManualRequestedAt: { seconds: 1 } },
      { id: 'z', summaryState: 'pending' },
    ]),
    ['x', 'z']
  );
});

test('checkClearCount: 境界(上限ちょうどはOK、+1はNG、0はOK)', () => {
  assert.deepEqual(checkClearCount(0), { ok: true });
  assert.deepEqual(checkClearCount(MAX_CLEAR_COUNT), { ok: true });
  const over = checkClearCount(MAX_CLEAR_COUNT + 1);
  assert.equal(over.ok, false);
});

test('CLEAR_FIELDS: 既存の要約本文(summary)・生成元(summaryProvider)は消去対象に含まれない(更新対象外フィールドの不変)', () => {
  assert.equal((CLEAR_FIELDS as readonly string[]).includes('summary'), false);
  assert.equal((CLEAR_FIELDS as readonly string[]).includes('summaryProvider'), false);
  assert.equal((CLEAR_FIELDS as readonly string[]).includes('summaryManualRequestedAt'), false);
});
