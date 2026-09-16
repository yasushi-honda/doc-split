import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  determineResolution,
  evaluatePreflight,
  OUT_OF_SCOPE_DIVERGENT_REASONS,
  type PreflightInput,
} from './divergenceResolutionPlan';

test('determineResolution: ambiguous-full-scanはout-of-scope-reasonでblocked', () => {
  const result = determineResolution({
    divergentReason: 'ambiguous-full-scan',
    claimFolderId: 'f1',
    actualUnreachable: false,
    nameDiffers: false,
    parentsDiffer: false,
  });
  assert.deepEqual(result, { mode: null, blockedReasons: ['out-of-scope-reason'] });
});

test('determineResolution: full-scan-mismatchはout-of-scope-reasonでblocked', () => {
  const result = determineResolution({
    divergentReason: 'full-scan-mismatch',
    claimFolderId: 'f1',
    actualUnreachable: false,
    nameDiffers: false,
    parentsDiffer: false,
  });
  assert.deepEqual(result, { mode: null, blockedReasons: ['out-of-scope-reason'] });
});

test('determineResolution: reconcile-name-mismatch(claimFolderId無し)はout-of-scope-reasonでblocked', () => {
  const result = determineResolution({
    divergentReason: 'reconcile-name-mismatch',
    claimFolderId: null,
    actualUnreachable: false,
    nameDiffers: false,
    parentsDiffer: false,
  });
  assert.deepEqual(result, { mode: null, blockedReasons: ['out-of-scope-reason'] });
});

test('determineResolution: out-of-scope理由以外でclaimFolderIdが無い場合も防御的にmissing-folder-idでblocked', () => {
  // 現行コードでは発生しない組合せ(out-of-scope理由以外でfolderId欠損は起きない想定)だが、
  // 将来の新しいdivergentReason追加に対する防御として、claimFolderId nullチェックを
  // out-of-scope判定の次に独立して持つことを確認する。
  const result = determineResolution({
    divergentReason: 'parents-mismatch',
    claimFolderId: null,
    actualUnreachable: false,
    nameDiffers: false,
    parentsDiffer: false,
  });
  assert.deepEqual(result, { mode: null, blockedReasons: ['missing-folder-id'] });
});

test('determineResolution: 実体が404で到達不能ならactual-folder-unreachableでblocked', () => {
  const result = determineResolution({
    divergentReason: 'parents-mismatch',
    claimFolderId: 'f1',
    actualUnreachable: true,
    nameDiffers: false,
    parentsDiffer: false,
  });
  assert.deepEqual(result, { mode: null, blockedReasons: ['actual-folder-unreachable'] });
});

test('determineResolution: name/parentsどちらも差分なしならfinalize-resolved(Drive成功・Firestore失敗からの収束)', () => {
  const result = determineResolution({
    divergentReason: 'parents-mismatch',
    claimFolderId: 'f1',
    actualUnreachable: false,
    nameDiffers: false,
    parentsDiffer: false,
  });
  assert.deepEqual(result, { mode: 'finalize-resolved', blockedReasons: [] });
});

test('determineResolution: nameのみ差分でもrestore-expected(divergentReasonだけでは判定しない)', () => {
  const result = determineResolution({
    divergentReason: 'parents-mismatch', // reasonとactualの差分が食い違うケースを意図的に検証
    claimFolderId: 'f1',
    actualUnreachable: false,
    nameDiffers: true,
    parentsDiffer: false,
  });
  assert.deepEqual(result, { mode: 'restore-expected', blockedReasons: [] });
});

test('determineResolution: parentsのみ差分でもrestore-expected', () => {
  const result = determineResolution({
    divergentReason: 'name-mismatch',
    claimFolderId: 'f1',
    actualUnreachable: false,
    nameDiffers: false,
    parentsDiffer: true,
  });
  assert.deepEqual(result, { mode: 'restore-expected', blockedReasons: [] });
});

test('determineResolution: name/parents両方差分でもrestore-expected(単一operationで両方直す)', () => {
  const result = determineResolution({
    divergentReason: 'name-mismatch',
    claimFolderId: 'f1',
    actualUnreachable: false,
    nameDiffers: true,
    parentsDiffer: true,
  });
  assert.deepEqual(result, { mode: 'restore-expected', blockedReasons: [] });
});

test('OUT_OF_SCOPE_DIVERGENT_REASONSは3種を含む', () => {
  assert.equal(OUT_OF_SCOPE_DIVERGENT_REASONS.has('ambiguous-full-scan'), true);
  assert.equal(OUT_OF_SCOPE_DIVERGENT_REASONS.has('full-scan-mismatch'), true);
  assert.equal(OUT_OF_SCOPE_DIVERGENT_REASONS.has('reconcile-name-mismatch'), true);
  assert.equal(OUT_OF_SCOPE_DIVERGENT_REASONS.has('parents-mismatch'), false);
  assert.equal(OUT_OF_SCOPE_DIVERGENT_REASONS.has('name-mismatch'), false);
});

const BASE_PREFLIGHT: PreflightInput = {
  approvedMode: 'restore-expected',
  actual: { id: 'f1', name: '対象太郎', parents: ['wrong-parent'], trashed: false, modifiedTime: '2026-01-01T00:00:00.000Z' },
  expectedParent: { found: true, canAddChildren: true },
  canMoveItemWithinDrive: true,
  canRename: null,
  duplicateNameAtTarget: false,
  claimGraphConflicts: [],
  directChildCount: null,
  acknowledgedStrandedCount: null,
  actualMatchesExpected: true,
};

test('evaluatePreflight: approvedModeがnullならout-of-scope-reasonでblocked', () => {
  const result = evaluatePreflight({ ...BASE_PREFLIGHT, approvedMode: null });
  assert.deepEqual(result, { blocked: true, reasons: ['out-of-scope-reason'] });
});

test('evaluatePreflight: actualがnull(実体404)ならactual-folder-unreachableでblocked', () => {
  const result = evaluatePreflight({ ...BASE_PREFLIGHT, actual: null });
  assert.deepEqual(result, { blocked: true, reasons: ['actual-folder-unreachable'] });
});

test('evaluatePreflight(release-claim): actualがnull(実体404、または claimFolderId自体が無い)でもblockedにならない(pr-review-toolkit:code-reviewer Critical指摘の回帰テスト)', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    approvedMode: 'release-claim',
    actual: null,
    directChildCount: null,
    acknowledgedStrandedCount: null,
  });
  assert.deepEqual(result, { blocked: false, reasons: [] });
});

test('evaluatePreflight(release-claim): actualがnullでもclaimGraphConflictsが有ればclaim-graph-conflictでblocked(actual===null早期returnをbypassしても他ゲートは効く)', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    approvedMode: 'release-claim',
    actual: null,
    directChildCount: null,
    acknowledgedStrandedCount: null,
    claimGraphConflicts: [{ otherParentId: 'p2', otherName: '実績', otherState: 'resolved' }],
  });
  assert.deepEqual(result, { blocked: true, reasons: ['claim-graph-conflict'] });
});

test('evaluatePreflight: 全条件を満たせばblocked=false', () => {
  const result = evaluatePreflight(BASE_PREFLIGHT);
  assert.deepEqual(result, { blocked: false, reasons: [] });
});

test('evaluatePreflight: 対象フォルダがtrashedならtrashedでblocked', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    actual: { ...BASE_PREFLIGHT.actual!, trashed: true },
  });
  assert.deepEqual(result, { blocked: true, reasons: ['trashed'] });
});

test('evaluatePreflight: claimグラフ掃引がヒットしたらclaim-graph-conflictでblocked', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    claimGraphConflicts: [{ otherParentId: 'p2', otherName: '実績', otherState: 'resolved' }],
  });
  assert.deepEqual(result, { blocked: true, reasons: ['claim-graph-conflict'] });
});

test('evaluatePreflight(restore-expected): 移動先に同名フォルダが既に存在するならduplicate-name-at-targetでblocked', () => {
  const result = evaluatePreflight({ ...BASE_PREFLIGHT, duplicateNameAtTarget: true });
  assert.deepEqual(result, { blocked: true, reasons: ['duplicate-name-at-target'] });
});

test('evaluatePreflight(restore-expected): 期待親が404(見つからない)ならexpected-parent-unreachableでblocked', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    expectedParent: { found: false, canAddChildren: false },
  });
  assert.deepEqual(result, { blocked: true, reasons: ['expected-parent-unreachable'] });
});

test('evaluatePreflight(restore-expected): 期待親にcanAddChildren権限が無いならmissing-capabilityでblocked', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    expectedParent: { found: true, canAddChildren: false },
  });
  assert.deepEqual(result, { blocked: true, reasons: ['missing-capability'] });
});

test('evaluatePreflight(restore-expected): canMoveItemWithinDriveがfalseならmissing-capabilityでblocked', () => {
  const result = evaluatePreflight({ ...BASE_PREFLIGHT, canMoveItemWithinDrive: false });
  assert.deepEqual(result, { blocked: true, reasons: ['missing-capability'] });
});

test('evaluatePreflight(restore-expected): canRenameがfalseならmissing-capabilityでblocked(canMoveItemWithinDriveをrenameに流用しない)', () => {
  const result = evaluatePreflight({ ...BASE_PREFLIGHT, canRename: false });
  assert.deepEqual(result, { blocked: true, reasons: ['missing-capability'] });
});

test('evaluatePreflight(release-claim): directChildCountが0ならstranded承認不要でblocked=false', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    approvedMode: 'release-claim',
    directChildCount: 0,
    acknowledgedStrandedCount: null,
  });
  assert.deepEqual(result, { blocked: false, reasons: [] });
});

test('evaluatePreflight(release-claim): directChildCount>0で未承認ならstranded-unacknowledgedでblocked', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    approvedMode: 'release-claim',
    directChildCount: 3,
    acknowledgedStrandedCount: null,
  });
  assert.deepEqual(result, { blocked: true, reasons: ['stranded-unacknowledged'] });
});

test('evaluatePreflight(release-claim): directChildCount>0で承認件数が不一致ならstranded-unacknowledgedでblocked', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    approvedMode: 'release-claim',
    directChildCount: 3,
    acknowledgedStrandedCount: 2,
  });
  assert.deepEqual(result, { blocked: true, reasons: ['stranded-unacknowledged'] });
});

test('evaluatePreflight(release-claim): directChildCount>0で承認件数が一致すればblocked=false', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    approvedMode: 'release-claim',
    directChildCount: 3,
    acknowledgedStrandedCount: 3,
  });
  assert.deepEqual(result, { blocked: false, reasons: [] });
});

test('evaluatePreflight(finalize-resolved): actualMatchesExpected=trueならblocked=false', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    approvedMode: 'finalize-resolved',
    actualMatchesExpected: true,
  });
  assert.deepEqual(result, { blocked: false, reasons: [] });
});

test('evaluatePreflight(finalize-resolved): actualMatchesExpected=falseならfinalize-resolved-mismatchでblocked(codex review High指摘の回帰テスト、推奨と異なるmodeを承認した場合の防止)', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    approvedMode: 'finalize-resolved',
    actualMatchesExpected: false,
  });
  assert.deepEqual(result, { blocked: true, reasons: ['finalize-resolved-mismatch'] });
});

test('evaluatePreflight: 複数条件を満たさない場合はreasonsに全て列挙する', () => {
  const result = evaluatePreflight({
    ...BASE_PREFLIGHT,
    actual: { ...BASE_PREFLIGHT.actual!, trashed: true },
    duplicateNameAtTarget: true,
    claimGraphConflicts: [{ otherParentId: 'p2', otherName: '実績', otherState: 'divergent' }],
  });
  assert.equal(result.blocked, true);
  assert.deepEqual(
    result.reasons.sort(),
    ['claim-graph-conflict', 'duplicate-name-at-target', 'trashed'].sort()
  );
});
