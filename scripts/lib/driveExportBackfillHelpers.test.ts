import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BACKFILL_ERROR_MESSAGE,
  isBackfillCandidate,
  isRollbackCandidate,
  computeBackdatedUpdatedAtMs,
  applyLimit,
  assertExpectedCount,
  ExpectedCountMismatchError,
  buildManifest,
  estimateSweepEta,
} from './driveExportBackfillHelpers';

test('isBackfillCandidate: driveExportStatusフィールドが無いdocのみ対象', () => {
  assert.equal(isBackfillCandidate({}), true);
  assert.equal(isBackfillCandidate({ fileName: 'x.pdf' }), true);
  assert.equal(isBackfillCandidate({ driveExportStatus: 'error' }), false);
  assert.equal(isBackfillCandidate({ driveExportStatus: 'exported' }), false);
  assert.equal(isBackfillCandidate({ driveExportStatus: 'exporting' }), false);
});

test('isRollbackCandidate: sentinelメッセージ付きerrorのみ対象(実エラー・exported等は対象外)', () => {
  assert.equal(
    isRollbackCandidate({ driveExportStatus: 'error', driveExportError: BACKFILL_ERROR_MESSAGE }),
    true
  );
  assert.equal(
    isRollbackCandidate({ driveExportStatus: 'error', driveExportError: '実際のDrive APIエラー' }),
    false,
    '実エラー(sentinel以外のメッセージ)はrollback対象外'
  );
  assert.equal(
    isRollbackCandidate({ driveExportStatus: 'exported', driveExportError: BACKFILL_ERROR_MESSAGE }),
    false,
    'exportedはrollback対象外(sentinelメッセージが偶然残っていても無視)'
  );
  assert.equal(
    isRollbackCandidate({ driveExportStatus: 'exporting' }),
    false
  );
  assert.equal(isRollbackCandidate({}), false, 'フィールド不在(reprocess済み)はrollback対象外');
});

test('computeBackdatedUpdatedAtMs: now - threshold - buffer を返す', () => {
  assert.equal(computeBackdatedUpdatedAtMs(1_000_000, 60 * 60 * 1000, 5 * 60 * 1000), 1_000_000 - 3_600_000 - 300_000);
});

test('applyLimit: limit未指定なら全件、指定時は先頭からN件', () => {
  const items = ['a', 'b', 'c', 'd'];
  assert.deepEqual(applyLimit(items, undefined), ['a', 'b', 'c', 'd']);
  assert.deepEqual(applyLimit(items, 2), ['a', 'b']);
  assert.deepEqual(applyLimit(items, 0), []);
  assert.deepEqual(applyLimit(items, 100), ['a', 'b', 'c', 'd'], 'limitが対象数を超えても全件を返す');
});

test('assertExpectedCount: expectedCount未指定なら常に通過', () => {
  assert.doesNotThrow(() => assertExpectedCount(5, undefined));
  assert.doesNotThrow(() => assertExpectedCount(0, undefined));
});

test('assertExpectedCount: 一致時は通過、不一致時はExpectedCountMismatchErrorをthrow(書込み前のガード)', () => {
  assert.doesNotThrow(() => assertExpectedCount(5, 5));
  assert.throws(() => assertExpectedCount(5, 3), ExpectedCountMismatchError);
  try {
    assertExpectedCount(5, 3);
    assert.fail('throwされるべき');
  } catch (err) {
    assert.ok(err instanceof ExpectedCountMismatchError);
    assert.equal((err as ExpectedCountMismatchError).expected, 3);
    assert.equal((err as ExpectedCountMismatchError).actual, 5);
  }
});

test('buildManifest: runId/projectId/timestamp/docIdsをそのまま構造化する(配列はコピーされる)', () => {
  const docIds = ['doc-1', 'doc-2'];
  const manifest = buildManifest({
    runId: 'run-1',
    projectId: 'docsplit-kanameone',
    timestampIso: '2026-07-23T00:00:00.000Z',
    docIds,
  });
  assert.deepEqual(manifest, {
    runId: 'run-1',
    projectId: 'docsplit-kanameone',
    timestamp: '2026-07-23T00:00:00.000Z',
    docIds: ['doc-1', 'doc-2'],
  });
  // 元配列を変更してもmanifestは影響を受けない(コピーされている)
  docIds.push('doc-3');
  assert.deepEqual(manifest.docIds, ['doc-1', 'doc-2']);
});

test('estimateSweepEta: ceil(target/batchSize)回 × intervalMinutes分を返す', () => {
  assert.deepEqual(estimateSweepEta(876, 10, 15), { estimatedRuns: 88, estimatedMinutes: 1320 });
  assert.deepEqual(estimateSweepEta(10, 10, 15), { estimatedRuns: 1, estimatedMinutes: 15 });
  assert.deepEqual(estimateSweepEta(1, 10, 15), { estimatedRuns: 1, estimatedMinutes: 15 });
  assert.deepEqual(estimateSweepEta(0, 10, 15), { estimatedRuns: 0, estimatedMinutes: 0 });
});
