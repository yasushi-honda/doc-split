/**
 * cleanup-duplicates.js の複数顧客FAX複製機能対応ロジックのテスト
 * (kanameone現場要件「複数顧客FAX複製機能」、GOAL.md D4/AC-d)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// faxDuplicationCleanupHelpers.js はプレーンJS(cleanup-duplicates.jsからts-node無しで
// require可能にするため)。TypeScriptのrequire()はanyを返すため型宣言は不要。
const { hasDistributionId, planGroupCleanup } = require('./faxDuplicationCleanupHelpers');

test('hasDistributionId: 非空文字列のdistributionIdを持つ場合はtrue', () => {
  assert.equal(hasDistributionId({ distributionId: 'dist_1' }), true);
});

test('hasDistributionId: distributionId未設定はfalse', () => {
  assert.equal(hasDistributionId({}), false);
});

test('hasDistributionId: distributionIdが空文字はfalse', () => {
  assert.equal(hasDistributionId({ distributionId: '' }), false);
});

test('hasDistributionId: distributionIdがnullはfalse', () => {
  assert.equal(hasDistributionId({ distributionId: null }), false);
});

test('planGroupCleanup: 全docがdistributionId未設定(通常の重複) → escalate:false, plainDocsに全件', () => {
  const docs = [
    { id: 'a', data: { fileName: 'x.pdf' } },
    { id: 'b', data: { fileName: 'x.pdf' } },
  ];
  const plan = planGroupCleanup(docs);
  assert.equal(plan.escalate, false);
  assert.deepEqual(plan.distributionIds, []);
  assert.deepEqual(plan.distributedDocs, []);
  assert.equal(plan.plainDocs.length, 2);
});

test('planGroupCleanup: 単一distributionIdのみ(複製配信グループ) → escalate:false, distributedDocsに分類', () => {
  const docs = [
    { id: 'a', data: { distributionId: 'dist_1' } },
    { id: 'b', data: { distributionId: 'dist_1' } },
  ];
  const plan = planGroupCleanup(docs);
  assert.equal(plan.escalate, false);
  assert.deepEqual(plan.distributionIds, ['dist_1']);
  assert.equal(plan.distributedDocs.length, 2);
  assert.equal(plan.plainDocs.length, 0);
});

test('planGroupCleanup: 複数のdistributionIdが混在 → escalate:true(AC-d: WARNエスカレーション対象)', () => {
  const docs = [
    { id: 'a', data: { distributionId: 'dist_1' } },
    { id: 'b', data: { distributionId: 'dist_2' } },
  ];
  const plan = planGroupCleanup(docs);
  assert.equal(plan.escalate, true);
  assert.deepEqual(plan.distributionIds.sort(), ['dist_1', 'dist_2']);
});

test('planGroupCleanup: distributionId保持doc + 非保持doc混在 → escalateはfalse、それぞれ正しく分類される', () => {
  const docs = [
    { id: 'copy-1', data: { distributionId: 'dist_1' } },
    { id: 'copy-2', data: { distributionId: 'dist_1' } },
    { id: 'legacy-dup-1', data: {} },
    { id: 'legacy-dup-2', data: {} },
  ];
  const plan = planGroupCleanup(docs);
  assert.equal(plan.escalate, false);
  assert.deepEqual(plan.distributionIds, ['dist_1']);
  assert.deepEqual(
    plan.distributedDocs.map((d: { id: string }) => d.id),
    ['copy-1', 'copy-2']
  );
  assert.deepEqual(
    plan.plainDocs.map((d: { id: string }) => d.id),
    ['legacy-dup-1', 'legacy-dup-2']
  );
});

test('planGroupCleanup: 空配列を渡すとescalate:false・全て空配列', () => {
  const plan = planGroupCleanup([]);
  assert.equal(plan.escalate, false);
  assert.deepEqual(plan.distributionIds, []);
  assert.deepEqual(plan.distributedDocs, []);
  assert.deepEqual(plan.plainDocs, []);
});
