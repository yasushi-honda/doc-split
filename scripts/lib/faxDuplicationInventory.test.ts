import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasDistributionId,
  groupByDistributionId,
  summarizeGroup,
  summarizeAllGroups,
  aggregateGroups,
  type InventoryDoc,
} from './faxDuplicationInventory';

test('hasDistributionId: 非空文字列のみtrue(空文字列/undefined/nullはfalse)', () => {
  assert.equal(hasDistributionId({ distributionId: 'orig-1' }), true);
  assert.equal(hasDistributionId({ distributionId: '' }), false);
  assert.equal(hasDistributionId({ distributionId: undefined }), false);
  assert.equal(hasDistributionId({ distributionId: null }), false);
  assert.equal(hasDistributionId({}), false);
});

test('groupByDistributionId: distributionIdでグルーピングし、非配信docは無視する', () => {
  const docs: InventoryDoc[] = [
    { id: 'orig-1', distributionId: 'orig-1' },
    { id: 'copy-1', distributionId: 'orig-1' },
    { id: 'orig-2', distributionId: 'orig-2' },
    { id: 'plain-1' }, // distributionId無し
  ];
  const groups = groupByDistributionId(docs);
  assert.equal(groups.size, 2);
  assert.deepEqual(
    groups.get('orig-1')?.map((d) => d.id),
    ['orig-1', 'copy-1']
  );
  assert.deepEqual(
    groups.get('orig-2')?.map((d) => d.id),
    ['orig-2']
  );
});

test('summarizeGroup: 元doc(id===distributionId)が存在する正常系グループ', () => {
  const members: InventoryDoc[] = [
    {
      id: 'orig-1',
      distributionId: 'orig-1',
      customerConfirmed: true,
      verified: true,
      driveExportStatus: 'exported',
      processedAtMs: 1000,
    },
    {
      id: 'copy-1',
      distributionId: 'orig-1',
      customerConfirmed: true,
      verified: false,
      driveExportStatus: null,
      processedAtMs: 1000,
    },
  ];
  const summary = summarizeGroup('orig-1', members);
  assert.equal(summary.size, 2);
  assert.equal(summary.hasOriginal, true);
  assert.deepEqual(summary.memberIds, ['orig-1', 'copy-1']);
  assert.equal(summary.confirmedCount, 2);
  assert.equal(summary.verifiedCount, 1);
  assert.equal(summary.driveExportedCount, 1);
  assert.equal(summary.multiCustomerDetectedCount, 0);
  assert.equal(summary.oldestProcessedAtMs, 1000);
  assert.equal(summary.newestProcessedAtMs, 1000);
});

test('summarizeGroup: 元doc欠落(異常系、コピーのみ残存)はhasOriginal:false', () => {
  const members: InventoryDoc[] = [{ id: 'copy-1', distributionId: 'orig-missing' }];
  const summary = summarizeGroup('orig-missing', members);
  assert.equal(summary.hasOriginal, false);
  assert.equal(summary.size, 1);
});

test('summarizeGroup: processedAtMs欠落メンバーは時系列集計から除外される(oldest/newestはnullのまま)', () => {
  const members: InventoryDoc[] = [
    { id: 'orig-1', distributionId: 'orig-1' },
    { id: 'copy-1', distributionId: 'orig-1' },
  ];
  const summary = summarizeGroup('orig-1', members);
  assert.equal(summary.oldestProcessedAtMs, null);
  assert.equal(summary.newestProcessedAtMs, null);
});

test('summarizeGroup: multiCustomerDetected:trueのメンバーをカウントする(新旧突合用)', () => {
  const members: InventoryDoc[] = [
    { id: 'orig-1', distributionId: 'orig-1', multiCustomerDetected: true },
    { id: 'copy-1', distributionId: 'orig-1', multiCustomerDetected: false },
  ];
  const summary = summarizeGroup('orig-1', members);
  assert.equal(summary.multiCustomerDetectedCount, 1);
});

test('summarizeAllGroups: 複数グループを一括集計し、非配信docは含まれない', () => {
  const docs: InventoryDoc[] = [
    { id: 'orig-1', distributionId: 'orig-1' },
    { id: 'copy-1', distributionId: 'orig-1' },
    { id: 'orig-2', distributionId: 'orig-2' },
    { id: 'copy-2', distributionId: 'orig-2' },
    { id: 'copy-3', distributionId: 'orig-2' },
    { id: 'plain-1' },
  ];
  const summaries = summarizeAllGroups(docs);
  assert.equal(summaries.length, 2);
  const sizes = summaries.map((s) => s.size).sort();
  assert.deepEqual(sizes, [2, 3]);
});

test('aggregateGroups: 空配列は全項目ゼロ/null', () => {
  const agg = aggregateGroups([]);
  assert.equal(agg.groupCount, 0);
  assert.equal(agg.totalDocCount, 0);
  assert.deepEqual(agg.sizeDistribution, {});
  assert.deepEqual(agg.missingOriginalGroupIds, []);
  assert.equal(agg.fullyConfirmedGroupCount, 0);
  assert.equal(agg.totalConfirmedMemberCount, 0);
  assert.equal(agg.totalVerifiedMemberCount, 0);
  assert.equal(agg.oldestGroupProcessedAtMs, null);
  assert.equal(agg.newestGroupProcessedAtMs, null);
});

test('aggregateGroups: サイズ分布・元doc欠落グループを正しく集計する', () => {
  const groups = [
    summarizeGroup('orig-1', [
      { id: 'orig-1', distributionId: 'orig-1' },
      { id: 'copy-1', distributionId: 'orig-1' },
    ]),
    summarizeGroup('orig-2', [
      { id: 'orig-2', distributionId: 'orig-2' },
      { id: 'copy-2', distributionId: 'orig-2' },
      { id: 'copy-3', distributionId: 'orig-2' },
    ]),
    // 元doc欠落(異常系)
    summarizeGroup('orig-missing', [{ id: 'copy-4', distributionId: 'orig-missing' }]),
  ];
  const agg = aggregateGroups(groups);
  assert.equal(agg.groupCount, 3);
  assert.equal(agg.totalDocCount, 6);
  assert.deepEqual(agg.sizeDistribution, { 2: 1, 3: 1, 1: 1 });
  assert.deepEqual(agg.missingOriginalGroupIds, ['orig-missing']);
});

test('aggregateGroups: 確定/確認状態は全員一致(fully)と一部一致(partially)を区別する', () => {
  const groups = [
    // 全員確定済み
    summarizeGroup('g1', [
      { id: 'g1', distributionId: 'g1', customerConfirmed: true, verified: true },
      { id: 'g1-c1', distributionId: 'g1', customerConfirmed: true, verified: true },
    ]),
    // 一部のみ確定済み(確認は誰もしていない)
    summarizeGroup('g2', [
      { id: 'g2', distributionId: 'g2', customerConfirmed: true, verified: false },
      { id: 'g2-c1', distributionId: 'g2', customerConfirmed: false, verified: false },
    ]),
    // 誰も確定していない
    summarizeGroup('g3', [
      { id: 'g3', distributionId: 'g3', customerConfirmed: false, verified: false },
      { id: 'g3-c1', distributionId: 'g3', customerConfirmed: false, verified: false },
    ]),
  ];
  const agg = aggregateGroups(groups);
  assert.equal(agg.fullyConfirmedGroupCount, 1);
  assert.equal(agg.partiallyConfirmedGroupCount, 1);
  assert.equal(agg.totalConfirmedMemberCount, 3); // g1:2 + g2:1 + g3:0
  assert.equal(agg.fullyVerifiedGroupCount, 1);
  assert.equal(agg.partiallyVerifiedGroupCount, 0);
  assert.equal(agg.totalVerifiedMemberCount, 2); // g1:2のみ
});

test('aggregateGroups: Drive出力済みメンバーを含むグループ数と総メンバー数を集計する', () => {
  const groups = [
    summarizeGroup('g1', [
      { id: 'g1', distributionId: 'g1', driveExportStatus: 'exported' },
      { id: 'g1-c1', distributionId: 'g1', driveExportStatus: 'exported' },
    ]),
    summarizeGroup('g2', [
      { id: 'g2', distributionId: 'g2', driveExportStatus: null },
      { id: 'g2-c1', distributionId: 'g2', driveExportStatus: 'exporting' },
    ]),
  ];
  const agg = aggregateGroups(groups);
  assert.equal(agg.groupsWithDriveExportedMemberCount, 1);
  assert.equal(agg.totalDriveExportedMemberCount, 2);
});

test('aggregateGroups: 新旧突合(multiCustomerDetectedを含むグループ数)を集計する', () => {
  const groups = [
    summarizeGroup('g1', [
      { id: 'g1', distributionId: 'g1', multiCustomerDetected: true },
      { id: 'g1-c1', distributionId: 'g1', multiCustomerDetected: false },
    ]),
    summarizeGroup('g2', [
      { id: 'g2', distributionId: 'g2', multiCustomerDetected: false },
    ]),
  ];
  const agg = aggregateGroups(groups);
  assert.equal(agg.groupsWithMultiCustomerDetectedMemberCount, 1);
});

test('aggregateGroups: 全グループを通した時系列の最古/最新を算出する', () => {
  const groups = [
    summarizeGroup('g1', [
      { id: 'g1', distributionId: 'g1', processedAtMs: 5000 },
      { id: 'g1-c1', distributionId: 'g1', processedAtMs: 5100 },
    ]),
    summarizeGroup('g2', [{ id: 'g2', distributionId: 'g2', processedAtMs: 3000 }]),
  ];
  const agg = aggregateGroups(groups);
  assert.equal(agg.oldestGroupProcessedAtMs, 3000);
  assert.equal(agg.newestGroupProcessedAtMs, 5100);
});
