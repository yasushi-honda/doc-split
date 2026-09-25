/**
 * `scripts/lib/executeSiblingMerge.ts` 統合テスト(Issue #1039恒久対応)
 *
 * `scripts/executeDivergenceResync.integration.test.ts`と同型のfake Drive + 実Firestore
 * emulatorパターンに加え、実際の`readClaim`/`invalidateResolvedClaimByFolderId`
 * (functions/src/drive/driveFolderClaim.ts)をimportして使うことで、claim状態機械との
 * 結合を含めたend-to-endの動作を検証する。fake Driveは`scripts/lib/testing/
 * fakeSiblingDrive.ts`(sibling-merge/audit共用、既存executeDivergenceResync用fakeとは別実装)。
 *
 * 対象の7つの安全分岐: (1)ファイル移動部分失敗時のskip (2)claim状態によるtrash可否
 * (3)trash直前の再列挙 (4)claim無効化件数照合によるTOCTOU検知 (5)再実行時の冪等性
 * (6)fingerprint不一致によるfencing skip (7)manifestのgroup単位チェックポイント書出し。
 *
 * plan-crossreview(2026-09-25)でのdecision-maker確定事項: Issue #1039本文が例示した
 * 「API timeout後の状態照合」ロジックは実装しない(挙動不変の原則を優先)。ケース7a/7bは
 * 既存実装(次回再実行による回復力・fail-closedなfingerprintチェック)の検証に限定する。
 *
 * 実行: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'
 */

import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import * as admin from 'firebase-admin';
import {
  executeSiblingMerge,
  type SiblingMergeClaimFunctions,
} from './lib/executeSiblingMerge';
import type {
  SiblingDuplicateApproval,
  SiblingDuplicatePlan,
  SiblingGroup,
  FolderSnapshot,
} from './lib/siblingDuplicatePlanTypes';
import { SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION } from './lib/siblingDuplicatePlanTypes';
import type { SiblingMergeManifest } from './lib/siblingMergeManifest';
import {
  makeFakeSiblingDrive,
  wrapClaimFnsForCallLog,
  wrapClaimFnsWithBeforeInvalidateHook,
  type FakeSiblingFile,
} from './lib/testing/fakeSiblingDrive';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "この統合テストはFirestore emulator経由でのみ実行してください: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'"
  );
}

const PROJECT_ID = 'execute-sibling-merge-integration-test';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const CLAIM_KEY = 'docSplitFolderClaim';
const PARENT_ID = 'parent-1';
const GROUP_NAME = '医療';
const CANONICAL_ID = 'canonical-1';
const DUPLICATE_ID = 'duplicate-1';
const MODIFIED_TIME = '2026-01-01T00:00:00.000Z';

async function clearCollections(): Promise<void> {
  const snap = await db.collection('driveFolderLocks').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}
beforeEach(clearCollections);

async function loadClaimModule() {
  return import('../functions/src/drive/driveFolderClaim');
}

async function loadClaimFns(): Promise<SiblingMergeClaimFunctions> {
  const mod = await loadClaimModule();
  return { readClaim: mod.readClaim, invalidateResolvedClaimByFolderId: mod.invalidateResolvedClaimByFolderId };
}

async function seedClaim(
  parentId: string,
  name: string,
  data: { state: 'creating' | 'resolved' | 'invalidated' | 'divergent'; folderId?: string }
): Promise<void> {
  const mod = await loadClaimModule();
  const id = mod.buildFolderLockId(parentId, name);
  await db.collection('driveFolderLocks').doc(id).set({
    state: data.state,
    folderId: data.folderId ?? null,
    attempt: null,
    parentId,
    name,
  });
}

async function getClaimState(parentId: string, name: string): Promise<string | undefined> {
  const mod = await loadClaimModule();
  const id = mod.buildFolderLockId(parentId, name);
  const snap = await db.collection('driveFolderLocks').doc(id).get();
  return snap.exists ? (snap.data()!.state as string) : undefined;
}

function canonicalSnapshot(overrides: Partial<FolderSnapshot> = {}): FolderSnapshot {
  return {
    id: CANONICAL_ID,
    parentId: PARENT_ID,
    name: GROUP_NAME,
    trashed: false,
    modifiedTime: MODIFIED_TIME,
    hasClaimTag: false,
    childFolderCount: 0,
    childFileCount: 0,
    ...overrides,
  };
}

function duplicateSnapshot(overrides: Partial<FolderSnapshot> = {}): FolderSnapshot {
  return {
    id: DUPLICATE_ID,
    parentId: PARENT_ID,
    name: GROUP_NAME,
    trashed: false,
    modifiedTime: MODIFIED_TIME,
    hasClaimTag: true,
    childFolderCount: 0,
    childFileCount: 1,
    ...overrides,
  };
}

function buildGroup(overrides: Partial<SiblingGroup> = {}): SiblingGroup {
  return {
    groupId: `${PARENT_ID}:${GROUP_NAME}`,
    parentId: PARENT_ID,
    parentPath: 'ルート',
    name: GROUP_NAME,
    folders: [canonicalSnapshot(), duplicateSnapshot()],
    action: 'merge',
    reason: 'タグ無し(人作成)1件・タグ有り(app作成)1件・統合元に子フォルダなし',
    canonicalFolderId: CANONICAL_ID,
    duplicateFolderId: DUPLICATE_ID,
    ...overrides,
  };
}

function buildPlan(groups: SiblingGroup[]): SiblingDuplicatePlan {
  return {
    schemaVersion: SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION,
    planId: 'plan-1',
    createdAt: new Date().toISOString(),
    environment: PROJECT_ID,
    projectId: PROJECT_ID,
    rootFolderId: 'root',
    googleapisLockfileVersion: '1.0.0',
    lockfileHash: 'hash',
    summary: { scannedFolderCount: 0, groupCount: groups.length, byAction: { merge: groups.length, 'manual-review': 0 } },
    groups,
  };
}

function buildApproval(planId: string, approvedGroupIds: string[]): SiblingDuplicateApproval {
  return { planId, approvedGroupIds };
}

function canonicalFile(overrides: Partial<FakeSiblingFile> = {}): FakeSiblingFile {
  // fetchLiveSnapshot()はfakeファイルのparents[0]をFolderSnapshot.parentIdとして読むため、
  // fingerprint照合(plan.canonical.parentId===PARENT_ID)と一致させる必要がある。
  return { id: CANONICAL_ID, name: GROUP_NAME, mimeType: FOLDER_MIME_TYPE, parents: [PARENT_ID], modifiedTime: MODIFIED_TIME, ...overrides };
}

function duplicateFile(overrides: Partial<FakeSiblingFile> = {}): FakeSiblingFile {
  return {
    id: DUPLICATE_ID,
    name: GROUP_NAME,
    mimeType: FOLDER_MIME_TYPE,
    parents: [PARENT_ID],
    modifiedTime: MODIFIED_TIME,
    appProperties: { [CLAIM_KEY]: 'x' },
    ...overrides,
  };
}

test('ケース1: execute正常系・claim無し → 全ファイル移動+duplicateを改名してtrash', async () => {
  const claimFns = await loadClaimFns();
  const file1 = { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf', parents: [DUPLICATE_ID] };
  const { drive, updateCalls } = makeFakeSiblingDrive([canonicalFile(), duplicateFile(), file1]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { manifest, outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'merged');
  assert.equal(manifest.entries[0].movedFileIds.length, 1);
  assert.ok(manifest.entries[0].duplicateTrashedAt);
  const trashUpdate = updateCalls.find((c) => c.fileId === DUPLICATE_ID);
  assert.ok(trashUpdate);
  const requestBody = trashUpdate!.requestBody as { name: string; trashed: boolean };
  assert.match(requestBody.name, /医療【統合済み_\d{4}-\d{2}-\d{2}】/);
  assert.equal(requestBody.trashed, true);
});

test('ケース2: claim=resolved(duplicate向け) → invalidatedへ遷移しmerged', async () => {
  const claimFns = await loadClaimFns();
  await seedClaim(PARENT_ID, GROUP_NAME, { state: 'resolved', folderId: DUPLICATE_ID });
  const { drive } = makeFakeSiblingDrive([canonicalFile(), duplicateFile()]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { manifest, outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'merged');
  assert.equal(manifest.entries[0].claimInvalidatedCount, 1);
  assert.equal(await getClaimState(PARENT_ID, GROUP_NAME), 'invalidated');
});

test('ケース3: claim=invalidated → trash可、claimInvalidatedCount=0でmerged', async () => {
  const claimFns = await loadClaimFns();
  await seedClaim(PARENT_ID, GROUP_NAME, { state: 'invalidated' });
  const { drive } = makeFakeSiblingDrive([canonicalFile(), duplicateFile()]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { manifest, outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'merged');
  assert.equal(manifest.entries[0].claimInvalidatedCount, 0);
});

for (const state of ['divergent', 'creating'] as const) {
  test(`ケース4: claim=${state} → ファイル移動は完了・trashされずtrash-blocked-by-claim`, async () => {
    const claimFns = await loadClaimFns();
    await seedClaim(PARENT_ID, GROUP_NAME, { state });
    const file1 = { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf', parents: [DUPLICATE_ID] };
    const { drive } = makeFakeSiblingDrive([canonicalFile(), duplicateFile(), file1]);
    const plan = buildPlan([buildGroup()]);
    const approval = buildApproval(plan.planId, [buildGroup().groupId]);

    const { manifest, outcomes } = await executeSiblingMerge(
      { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
      db,
      claimFns,
      plan,
      approval,
      { execute: true }
    );

    assert.equal(outcomes[0].status, 'trash-blocked-by-claim');
    assert.equal(manifest.entries[0].movedFileIds.length, 1);
    assert.equal(manifest.entries[0].duplicateTrashedAt, null);
    assert.equal(await getClaimState(PARENT_ID, GROUP_NAME), state);
  });
}

test('ケース4b: claim=resolved(別folder向け) → trash-blocked-by-claim', async () => {
  const claimFns = await loadClaimFns();
  await seedClaim(PARENT_ID, GROUP_NAME, { state: 'resolved', folderId: 'some-other-folder' });
  const { drive } = makeFakeSiblingDrive([canonicalFile(), duplicateFile()]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'trash-blocked-by-claim');
  assert.equal(await getClaimState(PARENT_ID, GROUP_NAME), 'resolved');
});

test('ケース5: dry-run → Drive書込みゼロ・claim不変・onProgress未呼出し', async () => {
  const claimFns = await loadClaimFns();
  const file1 = { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf', parents: [DUPLICATE_ID] };
  const { drive, updateCalls } = makeFakeSiblingDrive([canonicalFile(), duplicateFile(), file1]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);
  let onProgressCalls = 0;

  const { outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: false, onProgress: () => { onProgressCalls += 1; } }
  );

  assert.equal(outcomes[0].status, 'dry-run');
  assert.equal(outcomes[0].plannedFileMoveCount, 1);
  assert.equal(updateCalls.length, 0);
  assert.equal(onProgressCalls, 0);
});

test('ケース6: 権限エラー(2ファイル中1件のupdateが非適用エラー) → 成功/失敗が正しく振り分けられ、partial-file-move-failure', async () => {
  const claimFns = await loadClaimFns();
  const file1 = { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf', parents: [DUPLICATE_ID] };
  const file2 = { id: 'file-2', name: 'b.pdf', mimeType: 'application/pdf', parents: [DUPLICATE_ID] };
  const { drive } = makeFakeSiblingDrive([canonicalFile(), duplicateFile(), file1, file2], {
    updateFailures: new Map([['file-2', { mode: 'not-applied-error', message: 'permission denied' }]]),
  });
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { manifest, outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  // pr-test-analyzer指摘対応: 1件のみだと「失敗idだけ記録」と「何も記録されない」を
  // 区別できないため、成功1件+失敗1件で正しく振り分けられることを確認する。
  assert.equal(outcomes[0].status, 'partial-file-move-failure');
  assert.deepEqual(manifest.entries[0].movedFileIds, ['file-1']);
  assert.equal(manifest.entries[0].failedFileMoves.length, 1);
  assert.equal(manifest.entries[0].failedFileMoves[0].fileId, 'file-2');
  assert.equal(manifest.entries[0].duplicateTrashedAt, null);
});

test('ケース7a: API timeout(applied-error)で1回目partial-file-move-failure→同一plan再実行(modifiedTime不変)でmergedまで到達', async () => {
  const claimFns = await loadClaimFns();
  const file1 = { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf', parents: [DUPLICATE_ID] };
  const files = [canonicalFile(), duplicateFile(), file1];
  const { drive } = makeFakeSiblingDrive(files, {
    updateFailures: new Map([['file-1', { mode: 'applied-error', message: 'ETIMEDOUT (simulated)' }]]),
  });
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const first = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );
  assert.equal(first.outcomes[0].status, 'partial-file-move-failure');
  // 実際にはfile-1は既に移動済み(applied-error)のため、duplicate配下は空になっている。
  assert.equal(file1.parents[0], CANONICAL_ID);

  const second = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );
  assert.equal(second.outcomes[0].status, 'merged');
  assert.equal(second.manifest.entries[0].movedFileIds.length, 0);
});

test('ケース7b: 7aと同一シナリオだが再実行前にduplicate側modifiedTimeがdrift → skipped-fingerprint-mismatchのまま', async () => {
  const claimFns = await loadClaimFns();
  const file1 = { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf', parents: [DUPLICATE_ID] };
  const dup = duplicateFile();
  const files = [canonicalFile(), dup, file1];
  const { drive } = makeFakeSiblingDrive(files, {
    updateFailures: new Map([['file-1', { mode: 'applied-error', message: 'ETIMEDOUT (simulated)' }]]),
  });
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const first = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );
  assert.equal(first.outcomes[0].status, 'partial-file-move-failure');

  // 並行exportがduplicateフォルダを更新し、modifiedTimeがaudit時点(plan)と乖離したと仮定する。
  dup.modifiedTime = '2026-01-02T00:00:00.000Z';

  const second = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );
  assert.equal(second.outcomes[0].status, 'skipped-fingerprint-mismatch');
});

test('ケース8: 成功後の再実行 → skipped-already-merged、update 0件', async () => {
  const claimFns = await loadClaimFns();
  const { drive, updateCalls } = makeFakeSiblingDrive([canonicalFile(), duplicateFile()]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );
  updateCalls.length = 0;

  const { outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'skipped-already-merged');
  assert.equal(updateCalls.length, 0);
});

test('ケース9a: duplicate 404 → skipped-already-merged', async () => {
  const claimFns = await loadClaimFns();
  const { drive } = makeFakeSiblingDrive([canonicalFile()]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'skipped-already-merged');
});

test('ケース9b: canonical 404 → skipped-canonical-missing', async () => {
  const claimFns = await loadClaimFns();
  const { drive } = makeFakeSiblingDrive([duplicateFile()]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'skipped-canonical-missing');
});

test('ケース10: fingerprint drift(canonical modifiedTime変化) → skipped-fingerprint-mismatch、update 0件', async () => {
  const claimFns = await loadClaimFns();
  const { drive, updateCalls } = makeFakeSiblingDrive([
    canonicalFile({ modifiedTime: '2099-01-01T00:00:00.000Z' }),
    duplicateFile(),
  ]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'skipped-fingerprint-mismatch');
  assert.equal(updateCalls.length, 0);
});

test('ケース11: 子フォルダ衝突(実行時にduplicate配下へサブフォルダ出現) → skipped-fingerprint-mismatch', async () => {
  const claimFns = await loadClaimFns();
  const childFolder = { id: 'child-folder', name: '子', mimeType: FOLDER_MIME_TYPE, parents: [DUPLICATE_ID] };
  const { drive } = makeFakeSiblingDrive([canonicalFile(), duplicateFile(), childFolder]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'skipped-fingerprint-mismatch');
});

test('ケース12: trash直前再列挙で残存(並行exportがファイル作成) → trashされずtrash-blocked-not-empty', async () => {
  const claimFns = await loadClaimFns();
  const file1 = { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf', parents: [DUPLICATE_ID] };
  const files = [canonicalFile(), duplicateFile(), file1];
  const { drive } = makeFakeSiblingDrive(files, {
    afterNthUpdate: {
      n: 1, // file-1の移動(1回目のupdate)完了直後に、並行exportが新規ファイルを作成したと模す
      apply: () => {
        files.push({ id: 'race-file', name: 'race.pdf', mimeType: 'application/pdf', parents: [DUPLICATE_ID] });
      },
    },
  });
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { manifest, outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'trash-blocked-not-empty');
  assert.equal(manifest.entries[0].duplicateTrashedAt, null);
});

test('ケース13: claim TOCTOU(readClaim後・invalidate直前にclaimがdivergentへ変化) → trash-blocked-claim-toctou', async () => {
  const claimFns = await loadClaimFns();
  await seedClaim(PARENT_ID, GROUP_NAME, { state: 'resolved', folderId: DUPLICATE_ID });
  const { drive } = makeFakeSiblingDrive([canonicalFile(), duplicateFile()]);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  // invalidateResolvedClaimByFolderId本体は実関数のまま、その呼出し直前にFirestore上の
  // claimを別プロセスがdivergentへ遷移させた状況を模す(plan-crossreview High#6対応:
  // 単純スタブではなく実関数のquery+transaction fencingを実際に通過させる)。
  const claimFnsWithToctou = wrapClaimFnsWithBeforeInvalidateHook(claimFns, async () => {
    await seedClaim(PARENT_ID, GROUP_NAME, { state: 'divergent', folderId: DUPLICATE_ID });
  });

  const { manifest, outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFnsWithToctou,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'trash-blocked-claim-toctou');
  assert.equal(manifest.entries[0].claimInvalidatedCount, 0);
  assert.equal(await getClaimState(PARENT_ID, GROUP_NAME), 'divergent');
});

test('ケース14: manifestチェックポイント(2group目のtrash updateで例外) → 例外は伝播、1group目のcheckpointは受領済み', async () => {
  const claimFns = await loadClaimFns();
  const group1 = buildGroup();
  const group2 = buildGroup({
    groupId: `${PARENT_ID}:介護`,
    name: '介護',
    folders: [
      canonicalSnapshot({ id: 'canonical-2', name: '介護' }),
      duplicateSnapshot({ id: 'duplicate-2', name: '介護' }),
    ],
    canonicalFolderId: 'canonical-2',
    duplicateFolderId: 'duplicate-2',
  });
  const { drive } = makeFakeSiblingDrive(
    [
      canonicalFile(),
      duplicateFile(),
      canonicalFile({ id: 'canonical-2', name: '介護' }),
      duplicateFile({ id: 'duplicate-2', name: '介護' }),
    ],
    {
      updateFailures: new Map([
        ['duplicate-2', { mode: 'not-applied-error', message: 'simulated trash failure', consumeOnce: false }],
      ]),
    }
  );
  const plan = buildPlan([group1, group2]);
  const approval = buildApproval(plan.planId, [group1.groupId, group2.groupId]);

  const checkpoints: SiblingMergeManifest[] = [];
  await assert.rejects(
    executeSiblingMerge(
      { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
      db,
      claimFns,
      plan,
      approval,
      {
        execute: true,
        onProgress: (m) => {
          // シリアライズ済みスナップショットとして保存する(可変オブジェクト参照の
          // 使い回しではないことを確認するため、呼出し時点でJSON化する)。
          checkpoints.push(JSON.parse(JSON.stringify(m)) as SiblingMergeManifest);
        },
      }
    )
  );

  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].entries.length, 1);
  assert.equal(checkpoints[0].entries[0].groupId, group1.groupId);
  assert.ok(checkpoints[0].entries[0].duplicateTrashedAt);
});

test('ケース15: 承認外group・action=manual-review承認済みgroup', async () => {
  const claimFns = await loadClaimFns();
  const mergeGroup = buildGroup({ groupId: 'unapproved-group' });
  const manualReviewGroup = buildGroup({
    groupId: 'manual-review-group',
    action: 'manual-review',
    canonicalFolderId: null,
    duplicateFolderId: null,
  });
  const { drive, updateCalls } = makeFakeSiblingDrive([canonicalFile(), duplicateFile()]);
  const plan = buildPlan([mergeGroup, manualReviewGroup]);
  // mergeGroupは承認しない(承認外)。manualReviewGroupのみ承認する。
  const approval = buildApproval(plan.planId, ['manual-review-group']);

  const { outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].groupId, 'manual-review-group');
  assert.equal(outcomes[0].status, 'skipped-non-merge-action');
  assert.equal(updateCalls.length, 0);
});

test('ケース16: ページング(fakeのサーバ側応答上限2件で5ファイルを移動)', async () => {
  const claimFns = await loadClaimFns();
  const files = Array.from({ length: 5 }, (_, i) => ({
    id: `file-${i}`,
    name: `${i}.pdf`,
    mimeType: 'application/pdf',
    parents: [DUPLICATE_ID],
  }));
  const { drive } = makeFakeSiblingDrive([canonicalFile(), duplicateFile(), ...files], { listPageSize: 2 });
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { manifest, outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'merged');
  assert.equal(manifest.entries[0].movedFileIds.length, 5);
});

test('ケース17: 成功系でのcallLog順序確認(移動→claim状態チェック→再列挙→無効化→trash)', async () => {
  const claimFns = await loadClaimFns();
  await seedClaim(PARENT_ID, GROUP_NAME, { state: 'resolved', folderId: DUPLICATE_ID });
  const file1 = { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf', parents: [DUPLICATE_ID] };
  const { drive, callLog } = makeFakeSiblingDrive([canonicalFile(), duplicateFile(), file1]);
  const loggedClaimFns = wrapClaimFnsForCallLog(claimFns, callLog);
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    loggedClaimFns,
    plan,
    approval,
    { execute: true }
  );

  const kinds = callLog.map((entry) => entry.split('(')[0]);
  const firstUpdateIdx = kinds.indexOf('files.update');
  const readClaimIdx = kinds.indexOf('readClaim');
  const lastListIdx = kinds.lastIndexOf('files.list');
  const invalidateIdx = kinds.indexOf('invalidateResolvedClaimByFolderId');
  const lastUpdateIdx = kinds.lastIndexOf('files.update');

  assert.ok(firstUpdateIdx < readClaimIdx, 'ファイル移動はclaim状態チェックより前');
  assert.ok(readClaimIdx < lastListIdx, 'claim状態チェックはtrash直前再列挙より前');
  assert.ok(lastListIdx < invalidateIdx, 'trash直前再列挙はclaim無効化より前');
  assert.ok(invalidateIdx < lastUpdateIdx, 'claim無効化はtrash(最後のupdate)より前');
});

// pr-review-toolkit:pr-test-analyzer指摘対応(Important、rating6): fakeSiblingDrive.tsに
// plan-crossreview High#2対応として実装した'applied-success-but-noop'が、どのテストからも
// 一度も注入されていなかった。trashステップ(最後のfiles.update)でこのモードを注入し、
// 現状の挙動(既知の限界)を明示的にテストで固定する。
test('ケース18: trashステップでのno-op(200成功だが無反映) → manifestはduplicateTrashedAtを立てるが実際はtrashedのまま変化しない(既知の限界、次回再実行で自己修復)', async () => {
  const claimFns = await loadClaimFns();
  const dup = duplicateFile();
  const { drive } = makeFakeSiblingDrive([canonicalFile(), dup], {
    updateFailures: new Map([[DUPLICATE_ID, { mode: 'applied-success-but-noop' }]]),
  });
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  const { manifest, outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  // 現状の実装(抽出元main()から不変)はtrash updateの応答内容を再検証しないため、
  // Drive側が無言no-opでも例外を投げなければ成功扱いになる。dupは実際にはtrashed
  // されないため、次回同一planを再実行すればfetchLiveSnapshotがtrashed=falseを
  // 観測し再度処理対象になる(=データ破壊ではなく、1回分のmanifestが実態と
  // 食い違うだけ、との評価)。この挙動を変更することは本Issueのスコープ外
  // (挙動不変の原則)。
  assert.equal(outcomes[0].status, 'merged');
  assert.ok(manifest.entries[0].duplicateTrashedAt);
  assert.equal(dup.trashed ?? false, false);
});

// pr-review-toolkit:pr-test-analyzer指摘対応(Important、rating6): ケース7a/7bはファイル
// 移動ステップでのapplied-errorのみ検証しており、trashステップ(最後のfiles.update)での
// applied-error(実際には適用されるが例外を投げる)は未検証だった。
test('ケース19: trashステップでapplied-error(実際はtrashedへ変化するが例外) → 例外が伝播しそのgroupは当該manifestに未記録、再実行はskipped-already-merged', async () => {
  const claimFns = await loadClaimFns();
  const dup = duplicateFile();
  const { drive } = makeFakeSiblingDrive([canonicalFile(), dup], {
    updateFailures: new Map([[DUPLICATE_ID, { mode: 'applied-error', message: 'ETIMEDOUT (simulated, trash step)' }]]),
  });
  const plan = buildPlan([buildGroup()]);
  const approval = buildApproval(plan.planId, [buildGroup().groupId]);

  // 抽出元main()と同様、trashのfiles.update()にtry/catchが無いため例外はそのまま伝播する
  // (この挙動は意図的: 途中で処理を止めることを意味し、本PRで変更していない)。
  await assert.rejects(
    executeSiblingMerge(
      { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
      db,
      claimFns,
      plan,
      approval,
      { execute: true }
    )
  );
  // 実際にはDrive側は既にtrashed=trueへ変化している(applied-error)。
  assert.equal(dup.trashed, true);

  // 同一planを再実行すると、duplicateは既にtrashed済みのため冪等性判定でskipされる。
  const second = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );
  assert.equal(second.outcomes[0].status, 'skipped-already-merged');
});

// pr-review-toolkit:pr-test-analyzer指摘対応(Minor、rating5): SiblingGroupStatusのうち
// 'skipped-missing-snapshot'だけがどのテストからも一度もヒットしていなかった。
test('ケース20: plan内にcanonical/duplicateのsnapshotが見つからない(改ざん/不整合なplan) → skipped-missing-snapshot', async () => {
  const claimFns = await loadClaimFns();
  const { drive } = makeFakeSiblingDrive([canonicalFile(), duplicateFile()]);
  // canonicalSnapshotを欠落させた不整合group(canonicalFolderIdが指すsnapshotがfoldersに無い)。
  const brokenGroup = buildGroup({ folders: [duplicateSnapshot()] });
  const plan = buildPlan([brokenGroup]);
  const approval = buildApproval(plan.planId, [brokenGroup.groupId]);

  const { outcomes } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: CLAIM_KEY },
    db,
    claimFns,
    plan,
    approval,
    { execute: true }
  );

  assert.equal(outcomes[0].status, 'skipped-missing-snapshot');
});
