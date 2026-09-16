/**
 * `scripts/lib/buildDivergencePlan.ts` 統合テスト(Firestore emulator + fake Drive、Issue #871 恒久対応)
 *
 * `functions/test/driveFolderClaimIntegration.test.ts`の`makeFakeDrive()`と同型の
 * 手書きfakeドライブでDrive APIをfakeし、Firestore emulatorで実際のclaim/document
 * ドキュメントを読ませることで、`classify-drive-claim-divergence.ts`のコアロジック
 * (差分判定・claimグラフ掃引・影響書類解決・プリフライト)を実クレデンシャル無しで検証する。
 *
 * 実行: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'
 */

import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import * as admin from 'firebase-admin';
import type { drive_v3 } from 'googleapis';
import { buildDivergencePlan } from './lib/buildDivergencePlan';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'この統合テストはFirestore emulator経由でのみ実行してください: firebase emulators:exec --only firestore \'cd scripts && npm run test:integration\''
  );
}

const PROJECT_ID = 'build-divergence-plan-integration-test';
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
  capabilities?: { canMoveItemWithinDrive?: boolean; canRename?: boolean; canAddChildren?: boolean };
}

function makeFakeDrive(files: FakeFile[]) {
  const drive = {
    files: {
      get: async (params: Record<string, unknown>) => {
        const fileId = params.fileId as string;
        const file = files.find((f) => f.id === fileId);
        if (!file) {
          const err = new Error('File not found') as Error & { status: number };
          err.status = 404;
          throw err;
        }
        return {
          data: {
            id: file.id,
            name: file.name,
            trashed: file.trashed ?? false,
            parents: file.parents,
            modifiedTime: '2026-01-01T00:00:00.000Z',
            capabilities: file.capabilities ?? { canMoveItemWithinDrive: true, canRename: true, canAddChildren: true },
          },
        };
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
    },
  } as unknown as drive_v3.Drive;
  return drive;
}

const DEPS_FACTORY = (files: FakeFile[]) => ({
  drive: makeFakeDrive(files),
  supportsAllDrives: SUPPORTS_ALL_DRIVES,
  folderMimeType: FOLDER_MIME_TYPE,
  escapeQueryValue,
});

const BASE_OPTIONS = {
  firestore: db,
  driveApiVersion: { lockfileHash: 'test-hash', googleapisLockfileVersion: '1.0.0' },
  environment: PROJECT_ID,
  projectId: PROJECT_ID,
};

async function clearCollections(): Promise<void> {
  for (const name of ['driveFolderLocks', 'documents']) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

beforeEach(clearCollections);

test('parents-mismatchでnameは一致: restore-expectedを推奨し、blockedにならない', async () => {
  await db.collection('driveFolderLocks').doc('claim-1').set({
    state: 'divergent',
    folderId: 'f1',
    attempt: null,
    divergentReason: 'parents-mismatch',
    divergentAtMs: 1000,
    parentId: 'expected-parent',
    name: '対象太郎',
  });

  const plan = await buildDivergencePlan(
    DEPS_FACTORY([
      { id: 'f1', name: '対象太郎', parents: ['wrong-parent'] },
      { id: 'expected-parent', name: '期待親', parents: [] },
    ]),
    BASE_OPTIONS
  );

  assert.equal(plan.operations.length, 1);
  const op = plan.operations[0];
  assert.equal(op.recommendedMode, 'restore-expected');
  assert.equal(op.nameDiffers, false);
  assert.equal(op.parentsDiffer, true);
  assert.deepEqual(op.blockedReasons, []);
  assert.equal(op.directChildCount, 0);
});

test('実体が既に期待通り(差分なし): finalize-resolvedを推奨する(Drive成功・Firestore失敗からの収束)', async () => {
  await db.collection('driveFolderLocks').doc('claim-2').set({
    state: 'divergent',
    folderId: 'f2',
    attempt: null,
    divergentReason: 'parents-mismatch',
    parentId: 'expected-parent',
    name: '整合花子',
  });

  const plan = await buildDivergencePlan(
    DEPS_FACTORY([{ id: 'f2', name: '整合花子', parents: ['expected-parent'] }]),
    BASE_OPTIONS
  );

  assert.equal(plan.operations[0].recommendedMode, 'finalize-resolved');
});

test('ambiguous-full-scanはout-of-scope、Drive API呼び出し(files.get)を発生させない', async () => {
  await db.collection('driveFolderLocks').doc('claim-3').set({
    state: 'divergent',
    folderId: 'f3',
    attempt: null,
    divergentReason: 'ambiguous-full-scan',
    parentId: 'expected-parent',
    name: '対象次郎',
  });
  let getCalls = 0;
  const deps = DEPS_FACTORY([{ id: 'f3', name: '対象次郎', parents: ['expected-parent'] }]);
  const originalGet = deps.drive.files.get;
  deps.drive.files.get = (async (params: Record<string, unknown>) => {
    getCalls++;
    return originalGet(params);
  }) as typeof deps.drive.files.get;

  const plan = await buildDivergencePlan(deps, BASE_OPTIONS);

  assert.equal(plan.operations[0].recommendedMode, null);
  assert.deepEqual(plan.operations[0].blockedReasons, ['out-of-scope-reason']);
  assert.equal(getCalls, 0, 'out-of-scopeの場合はDrive files.getを呼ばない');
});

test('claimにfolderIdが無い(reconcile-name-mismatch)場合はmissing-folder-id相当でblocked', async () => {
  await db.collection('driveFolderLocks').doc('claim-4').set({
    state: 'divergent',
    attempt: null,
    divergentReason: 'reconcile-name-mismatch',
    parentId: 'expected-parent',
    name: '対象三郎',
  });

  const plan = await buildDivergencePlan(DEPS_FACTORY([]), BASE_OPTIONS);

  assert.equal(plan.operations[0].recommendedMode, null);
  assert.equal(plan.operations[0].claimFolderId, null);
});

test('claimグラフ掃引: 別parentIdをキーに持つ別claimが同じfolderIdを指す場合はblocked', async () => {
  await db.collection('driveFolderLocks').doc('claim-5a').set({
    state: 'divergent',
    folderId: 'shared-folder',
    attempt: null,
    divergentReason: 'parents-mismatch',
    parentId: 'expected-parent',
    name: '実績',
  });
  await db.collection('driveFolderLocks').doc('claim-5b').set({
    state: 'resolved',
    folderId: 'shared-folder',
    attempt: null,
    parentId: 'other-parent',
    name: '未判定',
  });

  const plan = await buildDivergencePlan(
    DEPS_FACTORY([
      { id: 'shared-folder', name: '実績', parents: ['other-parent'] },
      { id: 'expected-parent', name: '期待親', parents: [] },
    ]),
    BASE_OPTIONS
  );

  const op = plan.operations.find((o) => o.parentId === 'expected-parent')!;
  assert.equal(op.claimGraphConflicts.length, 1);
  assert.equal(op.claimGraphConflicts[0].otherParentId, 'other-parent');
  assert.equal(op.recommendedMode, null, 'claim-graph-conflictでblockedのためrecommendedModeはnull');
  assert.deepEqual(op.blockedReasons, ['claim-graph-conflict']);
});

test('移動先に同名フォルダが既に存在する場合はduplicate-name-at-targetでblocked', async () => {
  await db.collection('driveFolderLocks').doc('claim-6').set({
    state: 'divergent',
    folderId: 'f6',
    attempt: null,
    divergentReason: 'parents-mismatch',
    parentId: 'expected-parent',
    name: '対象四郎',
  });

  const plan = await buildDivergencePlan(
    DEPS_FACTORY([
      { id: 'f6', name: '対象四郎', parents: ['wrong-parent'] },
      { id: 'expected-parent', name: '期待親', parents: [] },
      { id: 'existing-duplicate', name: '対象四郎', parents: ['expected-parent'] },
    ]),
    BASE_OPTIONS
  );

  assert.deepEqual(plan.operations[0].blockedReasons, ['duplicate-name-at-target']);
});

test('capabilities.canRenameがfalseの場合、name-mismatchのみのケースがmissing-capabilityでblocked(canMoveItemWithinDriveを流用しない)', async () => {
  await db.collection('driveFolderLocks').doc('claim-7').set({
    state: 'divergent',
    folderId: 'f7',
    attempt: null,
    divergentReason: 'name-mismatch',
    parentId: 'expected-parent',
    name: '正しい名前',
  });

  const plan = await buildDivergencePlan(
    DEPS_FACTORY([
      {
        id: 'f7',
        name: '間違った名前',
        parents: ['expected-parent'],
        capabilities: { canMoveItemWithinDrive: true, canRename: false, canAddChildren: true },
      },
    ]),
    BASE_OPTIONS
  );

  const op = plan.operations[0];
  assert.equal(op.nameDiffers, true);
  assert.equal(op.parentsDiffer, false);
  assert.deepEqual(op.blockedReasons, ['missing-capability']);
});

test('影響書類: driveExportErrorにclaimFolderIdを含むdocumentをaffectedDocIdsとして解決する', async () => {
  await db.collection('driveFolderLocks').doc('claim-8').set({
    state: 'divergent',
    folderId: 'f8',
    attempt: null,
    divergentReason: 'parents-mismatch',
    parentId: 'expected-parent',
    name: '対象五郎',
  });
  await db.collection('documents').doc('doc-affected').set({
    driveExportStatus: 'error',
    driveExportError: 'Drive上でこのフォルダが移動・改名された可能性があります(参考情報: folderId f8)',
  });
  await db.collection('documents').doc('doc-unrelated').set({
    driveExportStatus: 'error',
    driveExportError: '無関係なエラー(folderId other-id)',
  });

  const plan = await buildDivergencePlan(
    DEPS_FACTORY([{ id: 'f8', name: '対象五郎', parents: ['wrong-parent'] }, { id: 'expected-parent', name: '期待親', parents: [] }]),
    BASE_OPTIONS
  );

  assert.deepEqual(plan.operations[0].affectedDocIds, ['doc-affected']);
});

test('directChildCountはfiles.listのページネーションを全走査した合計になる', async () => {
  await db.collection('driveFolderLocks').doc('claim-9').set({
    state: 'divergent',
    folderId: 'f9',
    attempt: null,
    divergentReason: 'parents-mismatch',
    parentId: 'expected-parent',
    name: '対象六郎',
  });
  const children = Array.from({ length: 150 }, (_, i) => ({ id: `child-${i}`, name: `子${i}`, parents: ['f9'] }));

  const plan = await buildDivergencePlan(
    DEPS_FACTORY([
      { id: 'f9', name: '対象六郎', parents: ['wrong-parent'] },
      { id: 'expected-parent', name: '期待親', parents: [] },
      ...children,
    ]),
    BASE_OPTIONS
  );

  assert.equal(plan.operations[0].directChildCount, 150);
});

test('サマリー(summary)がoperations件数と整合する', async () => {
  await db.collection('driveFolderLocks').doc('claim-10a').set({
    state: 'divergent',
    folderId: 'f10a',
    attempt: null,
    divergentReason: 'parents-mismatch',
    parentId: 'expected-parent',
    name: 'A太郎',
  });
  await db.collection('driveFolderLocks').doc('claim-10b').set({
    state: 'divergent',
    folderId: 'f10b',
    attempt: null,
    divergentReason: 'ambiguous-full-scan',
    parentId: 'expected-parent-b',
    name: 'B太郎',
  });

  const plan = await buildDivergencePlan(
    DEPS_FACTORY([
      { id: 'f10a', name: 'A太郎', parents: ['wrong-parent'] },
      { id: 'expected-parent', name: '期待親', parents: [] },
      { id: 'f10b', name: 'B太郎', parents: ['expected-parent-b'] },
    ]),
    BASE_OPTIONS
  );

  assert.equal(plan.summary.totalDivergent, 2);
  assert.equal(plan.summary.autoResolvable, 1);
  assert.equal(plan.summary.blocked, 1);
  assert.equal(plan.schemaVersion, 'divergence-resolution-plan-v1');
  assert.equal(plan.projectId, PROJECT_ID);
});
