/**
 * `scripts/lib/folderTreeMerge.ts` + `firestoreTreeClaimStore.ts` 統合テスト(Firestore emulator)
 *
 * fake Drive + 実Firestore emulator + 実`resolveDivergentClaim`(functions/src/drive/driveFolderClaim.ts)
 * で、ルートclaimのfence・finalize・チャンク化した全ツリーclaim照会を端から端まで検証する。
 *
 * 実行: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'
 */

import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import * as admin from 'firebase-admin';
import { executeFolderTreeMerge, planFolderTreeMerge, type TreeMergeDeps } from './lib/folderTreeMerge';
import { buildFirestoreClaimStore, FIRESTORE_IN_LIMIT } from './lib/firestoreTreeClaimStore';
import type { FolderTreeMergeApproval, FolderTreeMergePlan } from './lib/folderTreeMergePlanTypes';
import { makeFakeTreeDrive, type FakeTreeFile } from './lib/testing/fakeTreeDrive';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "この統合テストはFirestore emulator経由でのみ実行してください: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'"
  );
}

const PROJECT_ID = 'execute-folder-tree-merge-integration-test';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const FOLDER = 'application/vnd.google-apps.folder';
const ROOT = 'ROOT';
const NAME = '担当者A';

async function clearAll(): Promise<void> {
  const [locks, features] = await Promise.all([db.collection('driveFolderLocks').get(), db.collection('settings').get()]);
  await Promise.all([...locks.docs, ...features.docs].map((d) => d.ref.delete()));
}
beforeEach(clearAll);

async function claimModule() {
  return import('../functions/src/drive/driveFolderClaim');
}
async function flagModule() {
  return import('../functions/src/utils/featureFlags');
}

async function buildStore() {
  const [claims, flags] = await Promise.all([claimModule(), flagModule()]);
  return {
    claims,
    store: buildFirestoreClaimStore(db, {
      FOLDER_LOCKS_COLLECTION: claims.FOLDER_LOCKS_COLLECTION,
      buildFolderLockId: claims.buildFolderLockId,
      resolveDivergentClaim: claims.resolveDivergentClaim,
      isDriveFolderClaimReadEnabled: flags.isDriveFolderClaimReadEnabled,
    }),
  };
}

async function seedClaim(
  parentId: string,
  name: string,
  data: { state: string; folderId?: string; divergentReason?: string }
): Promise<void> {
  const { buildFolderLockId, FOLDER_LOCKS_COLLECTION } = await claimModule();
  await db
    .collection(FOLDER_LOCKS_COLLECTION)
    .doc(buildFolderLockId(parentId, name))
    .set({ parentId, name, attempt: null, ...data });
}

async function setClaimReadFlag(enabled: boolean): Promise<void> {
  await db.doc('settings/features').set({ driveFolderClaimRead: enabled });
}

function baseFiles(): FakeTreeFile[] {
  return [
    { id: 'S', name: NAME, mimeType: FOLDER, parents: [ROOT] },
    { id: 'D', name: NAME, mimeType: FOLDER, parents: [ROOT] },
    { id: 'S-A', name: '子1', mimeType: FOLDER, parents: ['S'] },
    { id: 'S-A-f', name: 'a.pdf', mimeType: 'application/pdf', parents: ['S-A'] },
    { id: 'D-A', name: '子1', mimeType: FOLDER, parents: ['D'] },
    { id: 'S-B', name: '子2', mimeType: FOLDER, parents: ['S'] },
  ];
}

async function setupDivergentRoot(): Promise<void> {
  await seedClaim(ROOT, NAME, { state: 'divergent', folderId: 'D', divergentReason: 'ambiguous-full-scan' });
  await setClaimReadFlag(true);
}

function approvalFor(plan: FolderTreeMergePlan): FolderTreeMergeApproval {
  return {
    planId: plan.planId,
    expectedFileMoves: plan.summary.fileMoves,
    expectedFolderMoves: plan.summary.folderMoves,
    expectedFolderTrashes: plan.summary.folderTrashes,
  };
}

async function makeDeps(files: FakeTreeFile[]) {
  const fake = makeFakeTreeDrive(files);
  const { store, claims } = await buildStore();
  const deps: TreeMergeDeps = {
    drive: fake.drive,
    claimStore: store,
    folderMimeType: FOLDER,
    now: () => new Date('2026-10-01T00:00:00.000Z'),
  };
  return { fake, deps, claims };
}

async function rootClaimData(): Promise<Record<string, unknown> | undefined> {
  const { buildFolderLockId, FOLDER_LOCKS_COLLECTION } = await claimModule();
  return (await db.collection(FOLDER_LOCKS_COLLECTION).doc(buildFolderLockId(ROOT, NAME)).get()).data();
}

const PLAN_PARAMS = { rootFolderId: ROOT, sourceFolderId: 'S', targetFolderId: 'D', projectId: PROJECT_ID, environment: 'test' };

test('実claim: plan→execute完走でルートclaimがresolved(D)になり、S側はtrashされる', async () => {
  await setupDivergentRoot();
  const { fake, deps } = await makeDeps(baseFiles());
  const plan = await planFolderTreeMerge(deps, PLAN_PARAMS);
  assert.deepEqual(plan.blockers, []);

  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true, actor: 'integration-test' });
  assert.equal(r.status, 'completed');
  assert.equal(r.manifest.finalize.outcome, 'resolved');

  const root = await rootClaimData();
  assert.equal(root?.state, 'resolved');
  assert.equal(root?.folderId, 'D');
  assert.equal(fake.files.find((f) => f.id === 'S')?.trashed, true);
  assert.deepEqual(fake.files.find((f) => f.id === 'S-A-f')?.parents, ['D-A']);
});

test('実claim: 再実行はalready-completed(finalize済みでも書込みなし)', async () => {
  await setupDivergentRoot();
  const { fake, deps } = await makeDeps(baseFiles());
  const plan = await planFolderTreeMerge(deps, PLAN_PARAMS);
  await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  const updates = fake.updateCalls.length;
  const again = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(again.status, 'already-completed');
  assert.equal(fake.updateCalls.length, updates);
});

test('実claim: plan後にルートclaimが更新されていたら(fence不一致)書込み前に停止しDrive不変', async () => {
  await setupDivergentRoot();
  const { fake, deps } = await makeDeps(baseFiles());
  const plan = await planFolderTreeMerge(deps, PLAN_PARAMS);
  // 別actorによる書き換えの模擬。Firestoreは内容が同一の書込みではupdateTimeを進めないため、値を変える。
  await seedClaim(ROOT, NAME, {
    state: 'divergent',
    folderId: 'D',
    divergentReason: 'ambiguous-full-scan',
    divergentRunId: 'other-actor',
  } as { state: string; folderId?: string; divergentReason?: string });

  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(r.status, 'aborted-root-claim-changed');
  assert.equal(fake.updateCalls.length, 0);
  assert.equal((await rootClaimData())?.state, 'divergent');
});

test('実claim: 統合元ツリーを参照するclaim(parentId)があればplanのblockerになり、executeは拒否される', async () => {
  await setupDivergentRoot();
  await seedClaim('S-A', '孫', { state: 'resolved', folderId: 'S-A-x' });
  const { fake, deps } = await makeDeps(baseFiles());
  const plan = await planFolderTreeMerge(deps, PLAN_PARAMS);
  assert.ok(plan.blockers.some((b) => b.code === 'claims-reference-source-tree'));

  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(r.status, 'refused-blockers');
  assert.equal(fake.updateCalls.length, 0);
});

test('実claim: 統合元ツリーを参照するclaim(folderId)も検知する', async () => {
  await setupDivergentRoot();
  await seedClaim('OTHER', '子1', { state: 'resolved', folderId: 'S-A' });
  const { deps } = await makeDeps(baseFiles());
  const plan = await planFolderTreeMerge(deps, PLAN_PARAMS);
  assert.ok(plan.blockers.some((b) => b.code === 'claims-reference-source-tree'));
});

test(`実claim: フォルダ数が${FIRESTORE_IN_LIMIT}を超えても(チャンク化)末尾のフォルダのclaimを検知する`, async () => {
  await setupDivergentRoot();
  const files = baseFiles();
  const total = FIRESTORE_IN_LIMIT * 2 + 5;
  for (let i = 0; i < total; i += 1) files.push({ id: `S-X${i}`, name: `x${i}`, mimeType: FOLDER, parents: ['S'] });
  await seedClaim(`S-X${total - 1}`, '孫', { state: 'resolved', folderId: 'g' });
  const { deps } = await makeDeps(files);
  const plan = await planFolderTreeMerge(deps, PLAN_PARAMS);
  assert.ok(plan.blockers.some((b) => b.code === 'claims-reference-source-tree'));
});

test('実claim: 再親付け先スロットに既存claimがあればblocker', async () => {
  await setupDivergentRoot();
  await seedClaim('D', '子2', { state: 'resolved', folderId: 'unrelated' });
  const { deps } = await makeDeps(baseFiles());
  const plan = await planFolderTreeMerge(deps, PLAN_PARAMS);
  assert.ok(plan.blockers.some((b) => b.code === 'claim-exists-at-target-slot'));
});

test('実claim: driveFolderClaimReadがOFFならplanは前提条件不一致で拒否される', async () => {
  await seedClaim(ROOT, NAME, { state: 'divergent', folderId: 'D', divergentReason: 'ambiguous-full-scan' });
  await setClaimReadFlag(false);
  const { deps } = await makeDeps(baseFiles());
  await assert.rejects(() => planFolderTreeMerge(deps, PLAN_PARAMS), /claim-read-disabled/);
});

test('実claim: 途中失敗ではルートclaimはdivergentのまま、同一planの再実行で完走しresolvedになる', async () => {
  await setupDivergentRoot();
  const files = baseFiles();
  const fake = makeFakeTreeDrive(files, { updateFailures: new Map([['S-B', { mode: 'not-applied-error' as const }]]) });
  const { store } = await buildStore();
  const deps: TreeMergeDeps = { drive: fake.drive, claimStore: store, folderMimeType: FOLDER, now: () => new Date('2026-10-01T00:00:00.000Z') };
  const plan = await planFolderTreeMerge(deps, PLAN_PARAMS);

  const first = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(first.status, 'aborted-op-failure');
  assert.equal((await rootClaimData())?.state, 'divergent');

  const second = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(second.status, 'completed');
  assert.equal((await rootClaimData())?.state, 'resolved');
});
