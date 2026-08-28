import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractCandidateIds,
  summarizeExclusions,
  assertExpectedTotal,
  ExpectedTotalMismatchError,
  isPlanStale,
  isNowHealthy,
  shouldSkipForPossibleManualEdit,
  shouldTripCircuitBreaker,
  tagRepairError,
} from './driveExportRepairTargets';

function target(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    docId: 'doc-1',
    careManager: 'x',
    customerName: 'y',
    category: 'trashed',
    oldDriveFileId: 'f1',
    oldParents: undefined,
    oldFileTrashed: true,
    expectedLeafFolderId: 'leaf-1',
    expectedPathStatus: 'resolved',
    storageObjectExists: true,
    ...overrides,
  } as never;
}

function blocked(overrides: Partial<Record<string, unknown>> = {}) {
  return { docId: 'doc-b', careManager: 'x', reason: 'target-path-not-created', ...overrides } as never;
}

test('extractCandidateIds: healthy以外のtargets(trashed/misplaced)を候補に含める', () => {
  const ids = extractCandidateIds({
    targets: [target({ docId: 'd1', category: 'trashed' }), target({ docId: 'd2', category: 'misplaced' })],
    blocked: [],
  });
  assert.deepEqual(ids.sort(), ['d1', 'd2']);
});

test('extractCandidateIds: healthyは候補から除外する', () => {
  const ids = extractCandidateIds({ targets: [target({ docId: 'd1', category: 'healthy' })], blocked: [] });
  assert.deepEqual(ids, []);
});

test('extractCandidateIds: expectedPathStatusがunresolved-ambiguousの対象は除外する(H1)', () => {
  const ids = extractCandidateIds({
    targets: [target({ docId: 'd1', expectedPathStatus: 'unresolved-ambiguous' })],
    blocked: [],
  });
  assert.deepEqual(ids, []);
});

test('extractCandidateIds: expectedPathStatusがunresolved-api-errorの対象は除外する(H1)', () => {
  const ids = extractCandidateIds({
    targets: [target({ docId: 'd1', expectedPathStatus: 'unresolved-api-error' })],
    blocked: [],
  });
  assert.deepEqual(ids, []);
});

test('extractCandidateIds: expectedPathStatusがnot-createdの対象は候補に含める', () => {
  const ids = extractCandidateIds({ targets: [target({ docId: 'd1', expectedPathStatus: 'not-created' })], blocked: [] });
  assert.deepEqual(ids, ['d1']);
});

test('extractCandidateIds: storageObjectExists===falseの対象は除外する(H2)', () => {
  const ids = extractCandidateIds({ targets: [target({ docId: 'd1', storageObjectExists: false })], blocked: [] });
  assert.deepEqual(ids, []);
});

test('extractCandidateIds: storageObjectExists===null(不明)の対象も除外する(fail-closed、codex High#5)', () => {
  const ids = extractCandidateIds({ targets: [target({ docId: 'd1', storageObjectExists: null })], blocked: [] });
  assert.deepEqual(ids, []);
});

test('extractCandidateIds: blocked[reason=target-path-not-created]は候補に含める', () => {
  const ids = extractCandidateIds({ targets: [], blocked: [blocked({ docId: 'db1' })] });
  assert.deepEqual(ids, ['db1']);
});

test('extractCandidateIds: blockedのそれ以外の理由(ambiguous-path等)は除外する', () => {
  const ids = extractCandidateIds({ targets: [], blocked: [blocked({ docId: 'db1', reason: 'ambiguous-path' })] });
  assert.deepEqual(ids, []);
});

test('extractCandidateIds: targetsとblockedに同一docIdが出現すると例外(H4)', () => {
  assert.throws(
    () =>
      extractCandidateIds({
        targets: [target({ docId: 'dup' })],
        blocked: [blocked({ docId: 'dup' })],
      }),
    /dup/
  );
});

test('extractCandidateIds: 空配列は空配列を返す', () => {
  assert.deepEqual(extractCandidateIds({ targets: [], blocked: [] }), []);
});

test('summarizeExclusions: healthy/unresolvedPath/storageNotConfirmed/otherBlockedReasonsを正しく集計する', () => {
  const summary = summarizeExclusions({
    targets: [
      target({ docId: 'd1', category: 'healthy' }),
      target({ docId: 'd2', expectedPathStatus: 'unresolved-ambiguous' }),
      target({ docId: 'd3', storageObjectExists: false }),
      target({ docId: 'd4', storageObjectExists: null }),
      target({ docId: 'd5', category: 'trashed', storageObjectExists: true, expectedPathStatus: 'resolved' }),
    ],
    blocked: [blocked({ docId: 'b1', reason: 'target-path-not-created' }), blocked({ docId: 'b2', reason: 'ambiguous-path' })],
  });
  assert.equal(summary.healthy, 1);
  assert.equal(summary.unresolvedPath, 1);
  assert.equal(summary.storageNotConfirmed, 2);
  assert.equal(summary.otherBlockedReasons, 1);
});

test('summarizeExclusions: 空配列は全項目0', () => {
  const summary = summarizeExclusions({ targets: [], blocked: [] });
  assert.deepEqual(summary, { healthy: 0, unresolvedPath: 0, storageNotConfirmed: 0, otherBlockedReasons: 0 });
});

test('assertExpectedTotal: 未指定なら常に通過', () => {
  assert.doesNotThrow(() => assertExpectedTotal(100, undefined));
});

test('assertExpectedTotal: 一致時は通過、不一致時はExpectedTotalMismatchErrorをthrow', () => {
  assert.doesNotThrow(() => assertExpectedTotal(488, 488));
  assert.throws(() => assertExpectedTotal(488, 500), ExpectedTotalMismatchError);
});

test('isPlanStale: maxAgeHours以内ならfalse', () => {
  const now = new Date('2026-08-28T12:00:00Z').getTime();
  const generatedAt = new Date('2026-08-28T00:00:00Z').toISOString();
  assert.equal(isPlanStale(generatedAt, now, 24), false);
});

test('isPlanStale: maxAgeHoursを超えたらtrue', () => {
  const now = new Date('2026-08-29T01:00:00Z').getTime();
  const generatedAt = new Date('2026-08-28T00:00:00Z').toISOString();
  assert.equal(isPlanStale(generatedAt, now, 24), true);
});

test('isPlanStale: ちょうどmaxAgeHours丁度は境界値でfalse(超過のみtrue)', () => {
  const generatedAt = new Date('2026-08-28T00:00:00Z').toISOString();
  const now = new Date('2026-08-28T00:00:00Z').getTime() + 24 * 60 * 60 * 1000;
  assert.equal(isPlanStale(generatedAt, now, 24), false);
});

test('isPlanStale: 不正な日時文字列はfail-closedでtrue', () => {
  assert.equal(isPlanStale('not-a-date', Date.now(), 24), true);
});

test('shouldSkipForPossibleManualEdit: modifiedTimeがdriveExportedAtより閾値超新しければtrue', () => {
  const exported = 1000;
  const modified = 1000 + 6 * 60 * 1000; // 6分後
  assert.equal(shouldSkipForPossibleManualEdit(exported, modified, 5 * 60 * 1000), true);
});

test('shouldSkipForPossibleManualEdit: 閾値以内ならfalse', () => {
  const exported = 1000;
  const modified = 1000 + 4 * 60 * 1000; // 4分後
  assert.equal(shouldSkipForPossibleManualEdit(exported, modified, 5 * 60 * 1000), false);
});

test('shouldSkipForPossibleManualEdit: modifiedTimeがdriveExportedAt以前ならfalse', () => {
  assert.equal(shouldSkipForPossibleManualEdit(2000, 1000, 5 * 60 * 1000), false);
});

test('shouldSkipForPossibleManualEdit: どちらかがundefinedなら判定不能でfalse', () => {
  assert.equal(shouldSkipForPossibleManualEdit(undefined, 1000, 1000), false);
  assert.equal(shouldSkipForPossibleManualEdit(1000, undefined, 1000), false);
});

test('shouldTripCircuitBreaker: 連続失敗が閾値到達でtrue', () => {
  assert.equal(shouldTripCircuitBreaker(5, 0, 5, 20), true);
});

test('shouldTripCircuitBreaker: 累計失敗が閾値到達でtrue', () => {
  assert.equal(shouldTripCircuitBreaker(1, 20, 5, 20), true);
});

test('shouldTripCircuitBreaker: どちらも未到達ならfalse', () => {
  assert.equal(shouldTripCircuitBreaker(2, 10, 5, 20), false);
});

test('tagRepairError: runIdを含むprefixを付与する', () => {
  assert.equal(tagRepairError('run-abc', 'Drive API error'), '[repair-run:run-abc] Drive API error');
});

test('isNowHealthy: trashed=false かつ parentsが期待leafフォルダ1件と一致すればtrue(既にhealthy)', () => {
  assert.equal(isNowHealthy(false, ['leaf-1'], 'leaf-1'), true);
});

test('isNowHealthy: trashed=trueならfalse(まだ修復が必要)', () => {
  assert.equal(isNowHealthy(true, ['leaf-1'], 'leaf-1'), false);
});

test('isNowHealthy: parentsが期待leafフォルダと不一致(misplacedのまま)ならfalse', () => {
  assert.equal(isNowHealthy(false, ['other-folder'], 'leaf-1'), false);
});

test('isNowHealthy: parentsが2件以上(単一parent正規化前)ならfalse', () => {
  assert.equal(isNowHealthy(false, ['leaf-1', 'other-folder'], 'leaf-1'), false);
});

test('isNowHealthy: expectedLeafFolderIdが未定義(blocked[target-path-not-created]由来)なら常にfalse', () => {
  assert.equal(isNowHealthy(false, ['leaf-1'], undefined), false);
});

test('isNowHealthy: oldFileTrashedが未定義(files.get失敗等)ならfalse(判定不能はfail-closed)', () => {
  assert.equal(isNowHealthy(undefined, ['leaf-1'], 'leaf-1'), false);
});

test('isNowHealthy: oldParentsが未定義ならfalse', () => {
  assert.equal(isNowHealthy(false, undefined, 'leaf-1'), false);
});
