/**
 * `scripts/lib/executeDivergenceResync.ts` 統合テスト(Firestore emulator + fake Drive、Issue #871 恒久対応)
 *
 * `buildDivergencePlan.integration.test.ts`と同型のfake Driveパターンに加え、実際の
 * `resolveDivergentClaim`/`releaseDivergentClaim`/`buildFolderLockId`(functions/src/drive/
 * driveFolderClaim.ts)をimportして使うことで、claim状態機械との結合を含めた
 * end-to-endの動作を検証する。
 *
 * 実行: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'
 */

import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import * as admin from 'firebase-admin';
import type { drive_v3 } from 'googleapis';
import { executeDivergenceResync, type ClaimFunctions } from './lib/executeDivergenceResync';
import type { DivergenceOperation, DivergencePlan, DivergenceApproval } from './lib/divergenceResolutionPlan';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'この統合テストはFirestore emulator経由でのみ実行してください: firebase emulators:exec --only firestore \'cd scripts && npm run test:integration\''
  );
}

const PROJECT_ID = 'execute-divergence-resync-integration-test';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const SUPPORTS_ALL_DRIVES = { supportsAllDrives: true };
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

interface FakeFile {
  id: string;
  name: string;
  trashed?: boolean;
  parents: string[];
  modifiedTime?: string;
  capabilities?: { canMoveItemWithinDrive?: boolean; canRename?: boolean; canAddChildren?: boolean };
}

function makeFakeDrive(files: FakeFile[], opts: { mutateOnNthGet?: { n: number; apply: () => void } } = {}) {
  const updateCalls: Record<string, unknown>[] = [];
  let getCallCount = 0;
  const drive = {
    files: {
      get: async (params: Record<string, unknown>) => {
        getCallCount++;
        const fileId = params.fileId as string;
        const file = files.find((f) => f.id === fileId);
        if (!file) {
          const err = new Error('File not found') as Error & { status: number };
          err.status = 404;
          throw err;
        }
        const response = {
          data: {
            id: file.id,
            name: file.name,
            trashed: file.trashed ?? false,
            parents: [...file.parents],
            modifiedTime: file.modifiedTime ?? '2026-01-01T00:00:00.000Z',
            capabilities: file.capabilities ?? { canMoveItemWithinDrive: true, canRename: true, canAddChildren: true },
          },
        };
        // 書込み直前TOCTOU再確認のテスト用: 指定回数目のfiles.get()呼出し完了「後」に
        // Drive側の状態を変化させ、その後続の呼出しが変化後の状態を観測するようにする
        // (第三者が並行して移動・改名した状況を模す)。
        if (opts.mutateOnNthGet && getCallCount === opts.mutateOnNthGet.n) {
          opts.mutateOnNthGet.apply();
        }
        return response;
      },
      list: async (params: Record<string, unknown>) => {
        const q = params.q as string;
        const parentMatch = q.match(/^'([^']+)' in parents/);
        const parentId = parentMatch ? parentMatch[1] : null;
        const nameMatch = q.match(/name='((?:[^'\\]|\\.)*)'/);
        const nameFilter = nameMatch ? nameMatch[1].replace(/\\(.)/g, '$1') : null;
        let matched = files.filter((f) => parentId !== null && f.parents.includes(parentId));
        if (nameFilter !== null) {
          matched = matched.filter((f) => f.name === nameFilter);
        }
        return { data: { files: matched.map((f) => ({ id: f.id, name: f.name, parents: f.parents, trashed: f.trashed ?? false })) } };
      },
      update: async (params: Record<string, unknown>) => {
        updateCalls.push(params);
        const fileId = params.fileId as string;
        const file = files.find((f) => f.id === fileId);
        if (!file) throw new Error(`fake drive: update対象が見つかりません: ${fileId}`);
        const addParents = params.addParents as string | undefined;
        const removeParents = params.removeParents as string | undefined;
        if (addParents) {
          const removeSet = new Set((removeParents ?? '').split(',').filter(Boolean));
          file.parents = file.parents.filter((p) => !removeSet.has(p));
          file.parents.push(addParents);
        }
        const requestBody = params.requestBody as { name?: string } | undefined;
        if (requestBody?.name) {
          file.name = requestBody.name;
        }
        return { data: { id: file.id, name: file.name, parents: file.parents, trashed: file.trashed ?? false } };
      },
    },
  } as unknown as drive_v3.Drive;
  return { drive, updateCalls };
}

async function clearCollections(): Promise<void> {
  const snap = await db.collection('driveFolderLocks').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}
beforeEach(clearCollections);

async function loadClaimFns(): Promise<ClaimFunctions> {
  return import('../functions/src/drive/driveFolderClaim');
}

/** claim doc への参照。ドキュメントIDは`buildFolderLockId(parentId, name)`の実装と一致させる
 * 必要がある(`executeDivergenceResync`が同じ関数でルックアップするため)。 */
function claimDocRef(claimFns: ClaimFunctions) {
  return db.collection('driveFolderLocks').doc(claimFns.buildFolderLockId('expected-parent', '対象太郎'));
}

async function seedDivergentClaim(claimFns: ClaimFunctions, overrides: Record<string, unknown> = {}) {
  const doc = claimDocRef(claimFns);
  await doc.set({
    state: 'divergent',
    folderId: 'f1',
    attempt: null,
    divergentReason: 'parents-mismatch',
    divergentAtMs: 1000,
    parentId: 'expected-parent',
    name: '対象太郎',
    ...overrides,
  });
  return doc.get();
}

function buildOp(overrides: Partial<DivergenceOperation> = {}): DivergenceOperation {
  return {
    operationId: 'op-0001',
    parentId: 'expected-parent',
    name: '対象太郎',
    divergentReason: 'parents-mismatch',
    divergentAtMs: 1000,
    claimFolderId: 'f1',
    claimUpdateTimeMs: 0,
    actual: { id: 'f1', name: '対象太郎', parents: ['wrong-parent'], trashed: false, modifiedTime: '2026-01-01T00:00:00.000Z' },
    expectedName: '対象太郎',
    expectedParentId: 'expected-parent',
    nameDiffers: false,
    parentsDiffer: true,
    recommendedMode: 'restore-expected',
    blockedReasons: [],
    directChildCount: 0,
    affectedDocIds: ['doc-affected-1'],
    claimGraphConflicts: [],
    ...overrides,
  };
}

function buildPlan(operations: DivergenceOperation[]): DivergencePlan {
  return {
    schemaVersion: 'divergence-resolution-plan-v1',
    planId: 'plan-1',
    createdAt: new Date().toISOString(),
    environment: PROJECT_ID,
    projectId: PROJECT_ID,
    driveApiVersion: { lockfileHash: 'h', googleapisLockfileVersion: '1.0.0' },
    summary: { totalDivergent: operations.length, autoResolvable: operations.length, blocked: 0 },
    operations,
  };
}

function buildApproval(planId: string, entries: DivergenceApproval['approvedOperations']): DivergenceApproval {
  return { planId, approvedOperations: entries };
}

test('restore-expected(--execute): Driveを移動しclaimをresolvedへ復帰、manifestに記録される', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  const { drive, updateCalls } = makeFakeDrive([
    { id: 'f1', name: '対象太郎', parents: ['wrong-parent'] },
    { id: 'expected-parent', name: '期待親', parents: [] },
  ]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'restore-expected' } });

  const { outcomes, manifest } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'executed');
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].addParents, 'expected-parent');

  const after = (await claimDocRef(claimFns).get()).data()!;
  assert.equal(after.state, 'resolved');
  assert.equal(after.folderId, 'f1');

  assert.equal(manifest.entries.length, 1);
  assert.deepEqual(manifest.entries[0].driveChange!.newParents, ['expected-parent']);
});

test('dry-run(--executeなし): Drive書込み・Firestore書込みともに発生しない', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  const { drive, updateCalls } = makeFakeDrive([
    { id: 'f1', name: '対象太郎', parents: ['wrong-parent'] },
    { id: 'expected-parent', name: '期待親', parents: [] },
  ]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'restore-expected' } });

  const { outcomes, manifest } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: false, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'dry-run');
  assert.equal(updateCalls.length, 0);
  assert.equal(manifest.entries.length, 0);
  const after = (await claimDocRef(claimFns).get()).data()!;
  assert.equal(after.state, 'divergent');
});

test('承認されていないoperationはnot-approvedでスキップされる', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  const { drive } = makeFakeDrive([{ id: 'f1', name: '対象太郎', parents: ['wrong-parent'] }]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, {});

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'not-approved');
});

test('claim drift: classify後にclaimのdivergentReasonが変化していたらclaim-driftでブロックし書込みしない', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  await claimDocRef(claimFns).update({ divergentReason: 'name-mismatch' });
  const { drive, updateCalls } = makeFakeDrive([{ id: 'f1', name: '対象太郎', parents: ['wrong-parent'] }]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() }); // 古いupdateTimeのまま
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'restore-expected' } });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'claim-drift');
  assert.equal(updateCalls.length, 0);
});

test('drive drift: classify後にDrive実体がさらに動いていたらdrive-driftでブロックし書込みしない', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  // classify時点ではwrong-parent配下だったが、その後さらに別の場所へ動いた想定
  const { drive, updateCalls } = makeFakeDrive([{ id: 'f1', name: '対象太郎', parents: ['yet-another-parent'] }]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'restore-expected' } });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'drive-drift');
  assert.equal(updateCalls.length, 0);
});

test('drive drift: name/parents/trashedは一致するがmodifiedTimeのみ不一致でもdrive-driftになる(codex review Medium指摘の回帰テスト)', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  // name/parents/trashedはplan記録時のop.actualと一致するが、modifiedTimeだけ後から変化した
  // (例: 内容更新や移動→復帰でmodifiedTimeが進んだ)ケースを模す。
  const { drive, updateCalls } = makeFakeDrive([
    { id: 'f1', name: '対象太郎', parents: ['wrong-parent'], modifiedTime: '2026-02-01T00:00:00.000Z' },
  ]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() }); // op.actual.modifiedTimeは既定の2026-01-01のまま
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'restore-expected' } });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'drive-drift');
  assert.equal(updateCalls.length, 0);
});

test('release-claim(--execute): Driveには一切書き込まずclaimをinvalidatedへ落とす', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  const { drive, updateCalls } = makeFakeDrive([{ id: 'f1', name: '対象太郎', parents: ['wrong-parent'] }]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis(), directChildCount: 0 });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'release-claim', acknowledgedStrandedFiles: 0 } });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'executed');
  assert.equal(updateCalls.length, 0);
  const after = (await claimDocRef(claimFns).get()).data()!;
  assert.equal(after.state, 'invalidated');
});

test('release-claim: 直接の子entryが未承認件数と不一致ならstranded-unacknowledgedでblocked', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  const { drive, updateCalls } = makeFakeDrive([
    { id: 'f1', name: '対象太郎', parents: ['wrong-parent'] },
    { id: 'child-1', name: '子1', parents: ['f1'] },
    { id: 'child-2', name: '子2', parents: ['f1'] },
  ]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'release-claim', acknowledgedStrandedFiles: 1 } });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'blocked');
  assert.deepEqual(outcomes[0].reasons, ['stranded-unacknowledged']);
  assert.equal(updateCalls.length, 0);
  const after = (await claimDocRef(claimFns).get()).data()!;
  assert.equal(after.state, 'divergent');
});

test('finalize-resolved(--execute): Drive実体は既に期待通りのためDrive書込みなしでclaimをresolvedへ', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  const { drive, updateCalls } = makeFakeDrive([{ id: 'f1', name: '対象太郎', parents: ['expected-parent'] }]);

  const op = buildOp({
    claimUpdateTimeMs: claimSnap.updateTime!.toMillis(),
    actual: { id: 'f1', name: '対象太郎', parents: ['expected-parent'], trashed: false, modifiedTime: '2026-01-01T00:00:00.000Z' },
    nameDiffers: false,
    parentsDiffer: false,
    recommendedMode: 'finalize-resolved',
  });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'finalize-resolved' } });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'executed');
  assert.equal(updateCalls.length, 0);
  const after = (await claimDocRef(claimFns).get()).data()!;
  assert.equal(after.state, 'resolved');
});

test('claimグラフ再確認: execute直前に新たに競合claimが作られていたらclaim-graph-conflictでblocked', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  await db.collection('driveFolderLocks').doc('conflicting-claim').set({
    state: 'resolved',
    folderId: 'f1',
    attempt: null,
    parentId: 'other-parent',
    name: '別名',
  });
  const { drive, updateCalls } = makeFakeDrive([
    { id: 'f1', name: '対象太郎', parents: ['wrong-parent'] },
    { id: 'expected-parent', name: '期待親', parents: [] },
  ]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'restore-expected' } });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'blocked');
  assert.deepEqual(outcomes[0].reasons, ['claim-graph-conflict']);
  assert.equal(updateCalls.length, 0);
});

test('finalize-resolved(--execute): 実体が期待値と不一致(推奨と異なるmodeを誤って承認)ならfinalize-resolved-mismatchでblockedになりresolvedにならない(codex review High指摘の回帰テスト)', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  // 実体は依然としてwrong-parent配下(未修復)。recommendedModeはrestore-expectedのはずだが、
  // operatorが誤ってfinalize-resolvedを承認したケースを模す。
  const { drive, updateCalls } = makeFakeDrive([{ id: 'f1', name: '対象太郎', parents: ['wrong-parent'] }]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'finalize-resolved' } });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'blocked');
  assert.deepEqual(outcomes[0].reasons, ['finalize-resolved-mismatch']);
  assert.equal(updateCalls.length, 0);
  const after = (await claimDocRef(claimFns).get()).data()!;
  assert.equal(after.state, 'divergent');
});

test('restore-expected(書込み直前): capability確認等の間に第三者が動かした場合もfiles.update直前の再確認で検知しdrive-driftになる(codex review High指摘の回帰テスト)', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  const files: FakeFile[] = [
    { id: 'f1', name: '対象太郎', parents: ['wrong-parent'] },
    { id: 'expected-parent', name: '期待親', parents: [] },
  ];
  const { drive, updateCalls } = makeFakeDrive(files, {
    // 1回目のfiles.get()(早期driftチェック用のfreshActual取得)完了直後に、第三者が
    // 別の場所へ動かしたことにする。以降のcapability確認等はこの変化後の状態を見る。
    mutateOnNthGet: { n: 1, apply: () => { files[0].parents = ['yet-another-parent']; } },
  });

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'restore-expected' } });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'drive-drift');
  assert.equal(updateCalls.length, 0);
  const after = (await claimDocRef(claimFns).get()).data()!;
  assert.equal(after.state, 'divergent');
});

test('finalize-resolved(書込み直前): claimグラフ再確認等の間に第三者が動かした場合もFirestore書込み直前の再確認で検知しresolvedにしない(codex review High指摘の回帰テスト)', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  const files: FakeFile[] = [{ id: 'f1', name: '対象太郎', parents: ['expected-parent'] }];
  const { drive } = makeFakeDrive(files, {
    // 早期driftチェック(freshActual取得)完了直後に第三者が動かしたことにする。
    mutateOnNthGet: { n: 1, apply: () => { files[0].parents = ['yet-another-parent']; } },
  });

  const op = buildOp({
    claimUpdateTimeMs: claimSnap.updateTime!.toMillis(),
    actual: { id: 'f1', name: '対象太郎', parents: ['expected-parent'], trashed: false, modifiedTime: '2026-01-01T00:00:00.000Z' },
    nameDiffers: false,
    parentsDiffer: false,
    recommendedMode: 'finalize-resolved',
  });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, { 'op-0001': { mode: 'finalize-resolved' } });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'drive-drift');
  const after = (await claimDocRef(claimFns).get()).data()!;
  assert.equal(after.state, 'divergent');
});

test('未知のresolutionMode文字列はrestore-expectedへfall-throughせずerrorで拒否される(codex review Medium指摘の回帰テスト)', async () => {
  const claimFns = await loadClaimFns();
  const claimSnap = await seedDivergentClaim(claimFns);
  const { drive, updateCalls } = makeFakeDrive([{ id: 'f1', name: '対象太郎', parents: ['wrong-parent'] }]);

  const op = buildOp({ claimUpdateTimeMs: claimSnap.updateTime!.toMillis() });
  const plan = buildPlan([op]);
  const approval = buildApproval(plan.planId, {
    'op-0001': { mode: 'typo-mode' as unknown as 'restore-expected' },
  });

  const { outcomes } = await executeDivergenceResync(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    db,
    claimFns,
    plan,
    approval,
    { execute: true, actor: 'test-actor' }
  );

  assert.equal(outcomes[0].status, 'error');
  // restore-expectedへfall-throughしてfiles.update()が呼ばれていないことを確認
  assert.equal(updateCalls.length, 0);
  const after = (await claimDocRef(claimFns).get()).data()!;
  assert.equal(after.state, 'divergent');
});
