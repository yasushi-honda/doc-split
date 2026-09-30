/**
 * `scripts/lib/folderTreeMerge.ts` の単体テスト(fake Drive + in-memory claim store、emulator不要)
 *
 * 実行: cd scripts && npm test (node --test lib/*.test.ts)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  executeFolderTreeMerge,
  planFolderTreeMerge,
  TreeMergeValidationError,
  type RootClaimSnapshot,
  type TreeMergeDeps,
} from './folderTreeMerge';
import {
  FOLDER_TREE_MERGE_EXIT_CODE,
  parseFolderTreeMergeApproval,
  parseFolderTreeMergePlan,
  type FolderTreeMergeApproval,
  type FolderTreeMergePlan,
} from './folderTreeMergePlanTypes';
import {
  makeFakeClaimStore,
  makeFakeTreeDrive,
  type FakeClaimStoreState,
  type FakeTreeDriveOptions,
  type FakeTreeFile,
} from './testing/fakeTreeDrive';

const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const PDF = 'application/pdf';
const FIXED_NOW = new Date('2026-10-01T00:00:00.000Z');

function folder(id: string, name: string, parents: string[], extra: Partial<FakeTreeFile> = {}): FakeTreeFile {
  return { id, name, mimeType: FOLDER, parents, ...extra };
}
function file(id: string, name: string, parents: string[], extra: Partial<FakeTreeFile> = {}): FakeTreeFile {
  return { id, name, mimeType: PDF, parents, ...extra };
}

/** ROOT配下に同名「森奈穂美」のS(統合元)・D(統合先)。S-A/D-Aは同名で重なり、S-BはSのみ、D-CはDのみ。 */
function baseFiles(): FakeTreeFile[] {
  return [
    folder('S', '森奈穂美', ['ROOT']),
    folder('D', '森奈穂美', ['ROOT']),
    folder('S-A', '山田太郎', ['S']),
    file('S-A-f1', 'a.pdf', ['S-A'], { appProperties: { docSplitDocId: 'doc1' } }),
    folder('S-B', '佐藤花子', ['S']),
    file('S-f0', 'x.pdf', ['S']),
    folder('D-A', '山田太郎', ['D']),
    file('D-A-f2', 'b.pdf', ['D-A'], { appProperties: { docSplitDocId: 'doc2' } }),
    folder('D-C', '鈴木一郎', ['D']),
  ];
}

function baseClaim(): FakeClaimStoreState {
  return {
    root: { state: 'divergent', folderId: 'D', divergentReason: 'ambiguous-full-scan', updateTimeMs: 1000 },
    claimReadEnabled: true,
    referencedIds: new Set<string>(),
    slots: new Set<string>(),
  };
}

function setup(files: FakeTreeFile[] = baseFiles(), claim: FakeClaimStoreState = baseClaim(), opts: FakeTreeDriveOptions = {}) {
  const fake = makeFakeTreeDrive(files, opts);
  const claimStore = makeFakeClaimStore(claim, fake.callLog);
  const deps: TreeMergeDeps = { drive: fake.drive, claimStore, folderMimeType: FOLDER, now: () => FIXED_NOW };
  return { fake, claimStore, deps, claim };
}

const PARAMS = {
  rootFolderId: 'ROOT',
  sourceFolderId: 'S',
  targetFolderId: 'D',
  projectId: 'proj',
  environment: 'test',
};

function approvalFor(plan: FolderTreeMergePlan): FolderTreeMergeApproval {
  return {
    planId: plan.planId,
    expectedFileMoves: plan.summary.fileMoves,
    expectedFolderMoves: plan.summary.folderMoves,
    expectedFolderTrashes: plan.summary.folderTrashes,
  };
}

async function planOf(deps: TreeMergeDeps): Promise<FolderTreeMergePlan> {
  return planFolderTreeMerge(deps, PARAMS);
}

async function assertValidation(deps: TreeMergeDeps, code: string): Promise<void> {
  await assert.rejects(
    () => planFolderTreeMerge(deps, PARAMS),
    (err: unknown) => err instanceof TreeMergeValidationError && err.code === code
  );
}

// ---------------------------------------------------------------- plan: 正常系

test('plan: 重なる子フォルダは再帰統合、Sのみの子フォルダは再親付け、trashは深い順', async () => {
  const { deps } = setup();
  const plan = await planOf(deps);
  assert.deepEqual(
    plan.ops.map((o) => `${o.kind}:${o.kind === 'move-file' ? o.fileId : o.folderId}`),
    ['move-file:S-A-f1', 'trash-folder:S-A', 'move-folder:S-B', 'move-file:S-f0', 'trash-folder:S']
  );
  assert.equal(plan.summary.fileMoves, 2);
  assert.equal(plan.summary.folderMoves, 1);
  assert.equal(plan.summary.folderTrashes, 2);
  assert.equal(plan.summary.visitedSourceFolderCount, 2);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.rootClaim.updateTimeMs, 1000);
});

test('plan: 空のツリー(Sに子が無い)はtrash 1件だけ', async () => {
  const { deps } = setup([folder('S', 'n', ['ROOT']), folder('D', 'n', ['ROOT'])]);
  const plan = await planOf(deps);
  assert.deepEqual(plan.ops.map((o) => o.kind), ['trash-folder']);
});

test('plan: ページネーション(1件ずつ)でも同じopsになる', async () => {
  const a = await planOf(setup().deps);
  const b = await planOf(setup(baseFiles(), baseClaim(), { listPageSize: 1 }).deps);
  assert.deepEqual(b.ops, a.ops);
});

test('plan: 同名ファイルの併存件数を数える(名前は出さない)', async () => {
  const files = baseFiles();
  files.push(file('S-A-same', 'same.pdf', ['S-A']), file('D-A-same', 'same.pdf', ['D-A']));
  const plan = await planOf(setup(files).deps);
  assert.equal(plan.summary.sameNameFileCount, 1);
});

test('plan: 出力(plan)にフォルダ名・ファイル名が含まれない(PII対策)', async () => {
  const plan = await planOf(setup().deps);
  const json = JSON.stringify(plan);
  for (const name of ['森奈穂美', '山田太郎', '佐藤花子', '鈴木一郎', 'a.pdf', 'x.pdf']) {
    assert.equal(json.includes(name), false, `${name}が含まれている`);
  }
});

// ---------------------------------------------------------------- plan: 対象同定・前提条件

test('plan検証: source===targetは拒否', async () => {
  const { deps } = setup();
  await assert.rejects(
    () => planFolderTreeMerge(deps, { ...PARAMS, targetFolderId: 'S' }),
    (e: unknown) => e instanceof TreeMergeValidationError && e.code === 'same-folder'
  );
});

test('plan検証: 存在しない/フォルダでない/ゴミ箱/親違い/名前違いを拒否', async () => {
  await assertValidation(setup(baseFiles().filter((f) => f.id !== 'D')).deps, 'folder-not-found');
  await assertValidation(setup(baseFiles().map((f) => (f.id === 'S' ? { ...f, mimeType: PDF } : f))).deps, 'not-a-folder');
  await assertValidation(setup(baseFiles().map((f) => (f.id === 'D' ? { ...f, trashed: true } : f))).deps, 'folder-trashed');
  await assertValidation(setup(baseFiles().map((f) => (f.id === 'D' ? { ...f, parents: ['OTHER'] } : f))).deps, 'bad-parent');
  await assertValidation(setup(baseFiles().map((f) => (f.id === 'S' ? { ...f, parents: ['ROOT', 'X'] } : f))).deps, 'bad-parent');
  await assertValidation(setup(baseFiles().map((f) => (f.id === 'D' ? { ...f, name: '別名' } : f))).deps, 'name-mismatch');
});

test('plan検証: 統合元のrename/move権限、統合先のaddChildren権限が無ければ拒否', async () => {
  const noRename = baseFiles().map((f) => (f.id === 'S' ? { ...f, capabilities: { canRename: false } } : f));
  await assertValidation(setup(noRename).deps, 'insufficient-capabilities');
  const noAdd = baseFiles().map((f) => (f.id === 'D' ? { ...f, capabilities: { canAddChildren: false } } : f));
  await assertValidation(setup(noAdd).deps, 'insufficient-capabilities');
});

test('plan検証: ルートclaimがdivergent/ambiguous-full-scan/folderId=Dでなければ拒否', async () => {
  const roots: (RootClaimSnapshot | null)[] = [
    null,
    { state: 'resolved', folderId: 'D', divergentReason: 'ambiguous-full-scan', updateTimeMs: 1 },
    { state: 'divergent', folderId: 'D', divergentReason: 'full-scan-mismatch', updateTimeMs: 1 },
    { state: 'divergent', folderId: 'S', divergentReason: 'ambiguous-full-scan', updateTimeMs: 1 },
  ];
  for (const root of roots) {
    await assertValidation(setup(baseFiles(), { ...baseClaim(), root }).deps, 'root-claim-mismatch');
  }
});

test('plan検証: driveFolderClaimReadがOFFなら拒否', async () => {
  await assertValidation(setup(baseFiles(), { ...baseClaim(), claimReadEnabled: false }).deps, 'claim-read-disabled');
});

// ---------------------------------------------------------------- plan: 阻害要因

async function blockerCodes(files: FakeTreeFile[], claim: FakeClaimStoreState = baseClaim()): Promise<string[]> {
  const plan = await planOf(setup(files, claim).deps);
  return plan.blockers.map((b) => b.code);
}

test('plan阻害: 統合先に同名フォルダが2件', async () => {
  const files = [...baseFiles(), folder('D-A2', '山田太郎', ['D'])];
  assert.ok((await blockerCodes(files)).includes('target-same-name-multiple'));
});

test('plan阻害: 統合元に同名フォルダが2件', async () => {
  const files = [...baseFiles(), folder('S-A2', '山田太郎', ['S'])];
  assert.ok((await blockerCodes(files)).includes('source-same-name-multiple'));
});

test('plan阻害: docSplitDocIdが統合先と重複', async () => {
  const files = baseFiles().map((f) => (f.id === 'S-A-f1' ? { ...f, appProperties: { docSplitDocId: 'doc2' } } : f));
  assert.ok((await blockerCodes(files)).includes('docid-duplicate'));
});

test('plan阻害: 統合元ツリーを参照するclaimがある(親/folderId)', async () => {
  const claim = { ...baseClaim(), referencedIds: new Set(['S-A']) };
  assert.ok((await blockerCodes(baseFiles(), claim)).includes('claims-reference-source-tree'));
});

test('plan阻害: 再親付け先に同名スロットのclaimが既にある', async () => {
  const claim = { ...baseClaim(), slots: new Set(['D/佐藤花子']) };
  assert.ok((await blockerCodes(baseFiles(), claim)).includes('claim-exists-at-target-slot'));
});

test('plan阻害: 参照先不明のショートカット・複数親・移動権限なし', async () => {
  const files = [
    ...baseFiles(),
    file('S-sc', 'sc', ['S'], { mimeType: SHORTCUT }), // 参照先(shortcutDetails)が取れない
    file('S-mp', 'mp', ['S', 'OTHER']),
    file('S-nm', 'nm', ['S'], { capabilities: { canMoveItemWithinDrive: false } }),
  ];
  const codes = await blockerCodes(files);
  assert.ok(codes.includes('shortcut-target-unknown'));
  assert.ok(codes.includes('multi-parent'));
  assert.ok(codes.includes('cannot-move'));
});

test('plan阻害: 統合先(子)にaddChildren権限がない', async () => {
  const files = baseFiles().map((f) => (f.id === 'D-A' ? { ...f, capabilities: { canAddChildren: false } } : f));
  assert.ok((await blockerCodes(files)).includes('cannot-add-children'));
});

// ---------------------------------------------------------------- execute

test('execute: 阻害要因があるplanは実行を拒否(書込み0件)', async () => {
  const { deps, fake } = setup([...baseFiles(), folder('D-A2', '山田太郎', ['D'])]);
  const plan = await planOf(deps);
  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(r.status, 'refused-blockers');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: 承認JSONの件数がplanと違えば拒否(書込み0件)', async () => {
  const { deps, fake } = setup();
  const plan = await planOf(deps);
  const bad = { ...approvalFor(plan), expectedFileMoves: plan.summary.fileMoves + 1 };
  const r = await executeFolderTreeMerge(deps, plan, bad, { execute: true });
  assert.equal(r.status, 'refused-approval-mismatch');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: dry-runは書込み0件で、pending件数を返す', async () => {
  const { deps, fake } = setup();
  const plan = await planOf(deps);
  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: false });
  assert.equal(r.status, 'dry-run');
  assert.equal(r.pendingOps, plan.ops.length);
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: 正常系 - 全て移動し、Sを改名+trashし、ルートclaimをresolvedへ(finalizeは最後)', async () => {
  const { deps, fake, claim } = setup();
  const plan = await planOf(deps);
  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(r.status, 'completed');
  const byId = new Map(fake.files.map((f) => [f.id, f]));
  assert.deepEqual(byId.get('S-A-f1')?.parents, ['D-A']);
  assert.deepEqual(byId.get('S-B')?.parents, ['D']);
  assert.deepEqual(byId.get('S-f0')?.parents, ['D']);
  for (const id of ['S-A', 'S']) {
    assert.equal(byId.get(id)?.trashed, true);
    assert.match(byId.get(id)?.name ?? '', /【統合済み_2026-10-01】$/);
  }
  assert.equal(claim.root?.state, 'resolved');
  assert.equal(r.manifest.finalize.outcome, 'resolved');
  const lastUpdate = fake.callLog.map((c, i) => (c.startsWith('files.update') ? i : -1)).filter((i) => i >= 0).pop() as number;
  const finalizeIdx = fake.callLog.findIndex((c) => c.startsWith('claim.finalize'));
  assert.ok(finalizeIdx > lastUpdate, 'finalizeは全てのDrive書込みより後');
});

test('execute: manifestにフォルダ名・ファイル名が含まれない(PII対策)', async () => {
  const { deps } = setup();
  const plan = await planOf(deps);
  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  const json = JSON.stringify(r.manifest);
  for (const name of ['森奈穂美', '山田太郎', '佐藤花子', 'a.pdf']) assert.equal(json.includes(name), false);
});

test('execute: ドリフト(ファイルが別の場所へ移された)は書込み前に停止', async () => {
  const { deps, fake } = setup();
  const plan = await planOf(deps);
  const f = fake.files.find((x) => x.id === 'S-f0') as FakeTreeFile;
  f.parents = ['ELSEWHERE'];
  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(r.status, 'aborted-drift');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: plan後にルートclaimが変化していたら書込み前に停止', async () => {
  const { deps, fake, claim } = setup();
  const plan = await planOf(deps);
  (claim.root as { updateTimeMs: number }).updateTimeMs = 2000;
  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(r.status, 'aborted-root-claim-changed');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: claim読取フラグがOFFになっていたら書込み前に停止', async () => {
  const { deps, fake, claim } = setup();
  const plan = await planOf(deps);
  claim.claimReadEnabled = false;
  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(r.status, 'aborted-root-claim-changed');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: 途中失敗ではtrash・finalizeせず、同一planの再実行で完走する(冪等な再開)', async () => {
  const updateFailures = new Map([['S-B', { mode: 'not-applied-error' as const }]]);
  const { deps, fake, claim } = setup(baseFiles(), baseClaim(), { updateFailures });
  const plan = await planOf(deps);
  const first = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(first.status, 'aborted-op-failure');
  assert.equal(claim.root?.state, 'divergent', '失敗時はclaimを戻さない(通常exportの停止を維持)');
  assert.equal(fake.files.find((f) => f.id === 'S')?.trashed ?? false, false, 'S本体はtrashされない');

  const second = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(second.status, 'completed');
  assert.ok(second.manifest.entries.some((e) => e.status === 'skipped-already-applied'), '適用済みopはスキップ');
  assert.equal(claim.root?.state, 'resolved');
});

test('execute: タイムアウトで応答が失われても適用済みなら再取得して継続する', async () => {
  const updateFailures = new Map([['S-f0', { mode: 'applied-error' as const }]]);
  const { deps } = setup(baseFiles(), baseClaim(), { updateFailures });
  const plan = await planOf(deps);
  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(r.status, 'completed');
  assert.ok(r.manifest.entries.some((e) => e.status === 'applied-after-error'));
});

test('execute: trash直前に統合元へ新規追加があれば、そのフォルダをtrashせず停止(finalizeもしない)', async () => {
  let addNew = (): void => {};
  const { deps, fake, claim } = setup(baseFiles(), baseClaim(), { afterNthUpdate: { n: 1, apply: () => addNew() } });
  addNew = () => fake.files.push(file('S-A-new', 'new.pdf', ['S-A']));
  const plan = await planOf(deps);
  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(r.status, 'aborted-not-empty');
  assert.equal(fake.files.find((f) => f.id === 'S-A')?.trashed ?? false, false);
  assert.equal(claim.root?.state, 'divergent');
});

test('execute: finalizeがno-opを返したら未完了(finalize-failed)として扱う', async () => {
  const claim = { ...baseClaim(), finalizeOverride: { outcome: 'no-op' as const, reason: 'fence-mismatch' } };
  const { deps } = setup(baseFiles(), claim);
  const plan = await planOf(deps);
  const r = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(r.status, 'finalize-failed');
  assert.equal(r.manifest.finalize.outcome, 'no-op');
  assert.equal(r.manifest.finalize.reason, 'fence-mismatch');
});

test('execute: 完了後の再実行はalready-completed(書込み0件)', async () => {
  const { deps, fake } = setup();
  const plan = await planOf(deps);
  await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  const before = fake.updateCalls.length;
  const again = await executeFolderTreeMerge(deps, plan, approvalFor(plan), { execute: true });
  assert.equal(again.status, 'already-completed');
  assert.equal(fake.updateCalls.length, before);
});

test('execute: onProgressで操作ごとにmanifestが保存される', async () => {
  const { deps } = setup();
  const plan = await planOf(deps);
  const sizes: number[] = [];
  await executeFolderTreeMerge(deps, plan, approvalFor(plan), {
    execute: true,
    onProgress: (m) => sizes.push(m.entries.length),
  });
  assert.ok(sizes.length >= plan.ops.length);
  assert.ok(sizes.includes(plan.ops.length));
});

// ---------------------------------------------------------------- レビュー指摘対応の追加テスト

const NAMES = ['森奈穂美', '山田太郎', '佐藤花子', '鈴木一郎', 'a.pdf', 'x.pdf', 'b.pdf'];

async function planAndApproval(deps: TreeMergeDeps): Promise<{ plan: FolderTreeMergePlan; approval: FolderTreeMergeApproval }> {
  const plan = await planOf(deps);
  return { plan, approval: approvalFor(plan) };
}

test('execute: 最後のupdate後にルートclaimが変化したらfinalizeせず停止する', async () => {
  const claim = baseClaim();
  const { deps, fake } = setup(baseFiles(), claim, { afterNthUpdate: { n: 5, apply: () => ((claim.root as { updateTimeMs: number }).updateTimeMs = 9999) } });
  const { plan, approval } = await planAndApproval(deps);
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-root-claim-changed');
  assert.equal(fake.callLog.some((c) => c.startsWith('claim.finalize')), false);
});

test('execute: 最後のupdate後にclaim読取フラグがOFFになったらfinalizeせず停止する', async () => {
  const claim = baseClaim();
  const { deps, fake } = setup(baseFiles(), claim, { afterNthUpdate: { n: 5, apply: () => (claim.claimReadEnabled = false) } });
  const { plan, approval } = await planAndApproval(deps);
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-root-claim-changed');
  assert.equal(fake.callLog.some((c) => c.startsWith('claim.finalize')), false);
});

test('execute: S本体のtrashが反映されていなければfinalizeせず停止する(aborted-source-not-trashed)', async () => {
  let untrash = (): void => {};
  const { deps, fake } = setup(baseFiles(), baseClaim(), { afterNthUpdate: { n: 5, apply: () => untrash() } });
  untrash = () => {
    (fake.files.find((f) => f.id === 'S') as FakeTreeFile).trashed = false;
  };
  const { plan, approval } = await planAndApproval(deps);
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-source-not-trashed');
  assert.equal(fake.callLog.some((c) => c.startsWith('claim.finalize')), false);
});

test('execute: Sはtrash済みでfinalizeだけ失敗した後、同一planの再実行でcompletedになる', async () => {
  const claim = baseClaim();
  const { deps, fake } = setup(baseFiles(), claim);
  const { plan, approval } = await planAndApproval(deps);
  claim.finalizeOverride = { outcome: 'no-op', reason: 'fence-mismatch' };
  const first = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(first.status, 'finalize-failed');
  claim.finalizeOverride = undefined;
  const updates = fake.updateCalls.length;
  const second = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(second.status, 'completed');
  assert.equal(fake.updateCalls.length, updates, '再開時はDriveへ書込まない');
  assert.equal(second.manifest.entries.every((e) => e.status === 'skipped-already-applied'), true);
  assert.equal(claim.root?.state, 'resolved');
});

test('execute: finalizeが例外を投げても未完了(finalize-failed)として扱い、reasonにerrorを残す', async () => {
  const { deps } = setup();
  const throwing: TreeMergeDeps = {
    ...deps,
    claimStore: { ...deps.claimStore, finalizeResolved: async () => { throw new Error('firestore unavailable'); } },
  };
  const { plan, approval } = await planAndApproval(throwing);
  const r = await executeFolderTreeMerge(throwing, plan, approval, { execute: true });
  assert.equal(r.status, 'finalize-failed');
  assert.ok(r.manifest.finalize.outcome === 'no-op' && /^error:/.test(r.manifest.finalize.reason));
});

test('execute: claimがresolvedでもSが生きていれば完了扱いにしない', async () => {
  const claim = baseClaim();
  const { deps, fake } = setup(baseFiles(), claim);
  const { plan, approval } = await planAndApproval(deps);
  claim.root = { state: 'resolved', folderId: 'D', updateTimeMs: 2000 };
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-root-claim-changed');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: 実行時点で統合先が改名されていたら書込み前に前提条件不一致で拒否', async () => {
  const { deps, fake } = setup();
  const { plan, approval } = await planAndApproval(deps);
  (fake.files.find((f) => f.id === 'D') as FakeTreeFile).name = '別名';
  await assert.rejects(
    () => executeFolderTreeMerge(deps, plan, approval, { execute: true }),
    (e: unknown) => e instanceof TreeMergeValidationError && e.code === 'name-mismatch'
  );
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: 統合元Sが404(権限喪失等)なら「trash済み」扱いにせず拒否する', async () => {
  const { deps, fake } = setup();
  const { plan, approval } = await planAndApproval(deps);
  fake.files.splice(fake.files.findIndex((f) => f.id === 'S'), 1);
  await assert.rejects(
    () => executeFolderTreeMerge(deps, plan, approval, { execute: true }),
    (e: unknown) => e instanceof TreeMergeValidationError && e.code === 'folder-not-found'
  );
  assert.equal(fake.callLog.some((c) => c.startsWith('claim.finalize')), false);
});

test('execute: 子フォルダ(trash対象)が404ならapplied扱いにせずドリフトで停止する', async () => {
  const { deps, fake } = setup();
  const { plan, approval } = await planAndApproval(deps);
  fake.files.splice(fake.files.findIndex((f) => f.id === 'S-A'), 1);
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-drift');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: ドリフト - 対象ファイルがゴミ箱に入っていたら書込み前に停止', async () => {
  const { deps, fake } = setup();
  const { plan, approval } = await planAndApproval(deps);
  (fake.files.find((f) => f.id === 'S-f0') as FakeTreeFile).trashed = true;
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-drift');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: ドリフト - 未適用のファイルが複数親になっていたら書込み前に停止', async () => {
  const { deps, fake } = setup();
  const { plan, approval } = await planAndApproval(deps);
  (fake.files.find((f) => f.id === 'S-f0') as FakeTreeFile).parents = ['S', 'OTHER'];
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-drift');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: ドリフト - 適用済みopと後続のドリフトが混在しても書込み0件で停止', async () => {
  const { deps, fake } = setup();
  const { plan, approval } = await planAndApproval(deps);
  // 先頭opは適用済み(S-A-f1がD-Aへ移動済み)、後続のS-B(move-folder)は別の場所へ移されている
  (fake.files.find((f) => f.id === 'S-A-f1') as FakeTreeFile).parents = ['D-A'];
  (fake.files.find((f) => f.id === 'S-B') as FakeTreeFile).parents = ['ELSEWHERE'];
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-drift');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: plan後に統合元ツリーを参照するclaimが作られていたら書込み前に停止', async () => {
  const { deps, fake, claim } = setup();
  const { plan, approval } = await planAndApproval(deps);
  claim.referencedIds.add('S-A');
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-drift');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: 有効期間(24h)を超えたplanは拒否(書込み0件)', async () => {
  const { deps, fake } = setup();
  const { plan, approval } = await planAndApproval(deps);
  const later: TreeMergeDeps = { ...deps, now: () => new Date(FIXED_NOW.getTime() + 25 * 60 * 60 * 1000) };
  const r = await executeFolderTreeMerge(later, plan, approval, { execute: true });
  assert.equal(r.status, 'refused-plan-expired');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: 承認JSONは4項目のどれか1つでも違えば拒否(planId/各件数)', async () => {
  const { deps, fake } = setup();
  const { plan, approval } = await planAndApproval(deps);
  const variants: FolderTreeMergeApproval[] = [
    { ...approval, planId: 'other-plan' },
    { ...approval, expectedFileMoves: approval.expectedFileMoves + 1 },
    { ...approval, expectedFolderMoves: approval.expectedFolderMoves + 1 },
    { ...approval, expectedFolderTrashes: approval.expectedFolderTrashes + 1 },
  ];
  for (const v of variants) {
    const r = await executeFolderTreeMerge(deps, plan, v, { execute: true });
    assert.equal(r.status, 'refused-approval-mismatch');
  }
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: 阻害要因があれば承認が完全一致でもrefused-blockers(blockersが先に判定される)', async () => {
  const { deps, fake } = setup([...baseFiles(), folder('D-A2', '山田太郎', ['D'])]);
  const { plan, approval } = await planAndApproval(deps);
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'refused-blockers');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: S本体のtrashが未適用で失敗したらfinalizeせずaborted-op-failure', async () => {
  const updateFailures = new Map([['S', { mode: 'not-applied-error' as const }]]);
  const { deps, fake, claim } = setup(baseFiles(), baseClaim(), { updateFailures });
  const { plan, approval } = await planAndApproval(deps);
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-op-failure');
  assert.equal(claim.root?.state, 'divergent');
  assert.equal(fake.callLog.some((c) => c.startsWith('claim.finalize')), false);
  assert.equal(r.manifest.entries.at(-1)?.status, 'failed');
});

test('execute: S本体のtrashが応答喪失だが適用済みならcompletedになる(applied-error)', async () => {
  const updateFailures = new Map([['S', { mode: 'applied-error' as const }]]);
  const { deps } = setup(baseFiles(), baseClaim(), { updateFailures });
  const { plan, approval } = await planAndApproval(deps);
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'completed');
  assert.ok(r.manifest.entries.some((e) => e.kind === 'trash-folder' && e.status === 'applied-after-error'));
});

test('execute: 失敗時のログ・manifestに生のエラー文言やフォルダ名・ファイル名を含めない(PII対策)', async () => {
  const logs: string[] = [];
  const updateFailures = new Map([['S-B', { mode: 'not-applied-error' as const }]]);
  const { deps } = setup(baseFiles(), baseClaim(), { updateFailures });
  const logging: TreeMergeDeps = { ...deps, log: (m) => logs.push(m) };
  const { plan, approval } = await planAndApproval(logging);
  const r = await executeFolderTreeMerge(logging, plan, approval, { execute: true, log: (m) => logs.push(m), logError: (m) => logs.push(m) });
  assert.equal(r.status, 'aborted-op-failure');
  const all = logs.join('\n') + JSON.stringify(r.manifest);
  for (const name of NAMES) assert.equal(all.includes(name), false, `${name}が含まれている`);
  assert.equal(all.includes('fakeTreeDrive'), false, '生のエラー文言がmanifest/ログに出ている');
});

test('execute: trash直前の空確認で失敗した場合のログにも名前を含めない', async () => {
  let addNew = (): void => {};
  const logs: string[] = [];
  const { deps, fake } = setup(baseFiles(), baseClaim(), { afterNthUpdate: { n: 1, apply: () => addNew() } });
  addNew = () => fake.files.push(file('S-A-new', 'new.pdf', ['S-A']));
  const { plan, approval } = await planAndApproval(deps);
  await executeFolderTreeMerge(deps, plan, approval, { execute: true, logError: (m) => logs.push(m) });
  const all = logs.join('\n');
  for (const name of [...NAMES, 'new.pdf']) assert.equal(all.includes(name), false);
});

// ---------------------------------------------------------------- 深い再帰・claim照会対象

function deepFiles(): FakeTreeFile[] {
  return [
    ...baseFiles(),
    folder('S-A-1', '孫', ['S-A']),
    file('S-A-1-f', 'deep.pdf', ['S-A-1']),
    folder('D-A-1', '孫', ['D-A']),
  ];
}

test('plan: 深さ3の再帰統合でもtrashは深い順(孫→子→S)で並ぶ', async () => {
  const plan = await planOf(setup(deepFiles()).deps);
  const trashOrder = plan.ops.filter((o) => o.kind === 'trash-folder').map((o) => (o as { folderId: string }).folderId);
  assert.deepEqual(trashOrder, ['S-A-1', 'S-A', 'S']);
  assert.ok(plan.ops.some((o) => o.kind === 'move-file' && o.fileId === 'S-A-1-f' && o.toParentId === 'D-A-1'));
  assert.equal(plan.summary.visitedSourceFolderCount, 3);
});

test('plan阻害: S自身を親とするclaim(S直下フォルダのclaim)も検知する', async () => {
  const claim = { ...baseClaim(), referencedIds: new Set(['S']) };
  assert.ok((await blockerCodes(baseFiles(), claim)).includes('claims-reference-source-tree'));
});

test('plan阻害: 深さ2の統合元フォルダを参照するclaimも検知する', async () => {
  const claim = { ...baseClaim(), referencedIds: new Set(['S-A-1']) };
  assert.ok((await blockerCodes(deepFiles(), claim)).includes('claims-reference-source-tree'));
});

test('plan阻害: 統合元内で同じdocSplitDocIdが2件あればdocid-duplicate', async () => {
  const files = [
    ...baseFiles(),
    file('S-dup1', 'p.pdf', ['S'], { appProperties: { docSplitDocId: 'same' } }),
    file('S-dup2', 'q.pdf', ['S'], { appProperties: { docSplitDocId: 'same' } }),
  ];
  assert.ok((await blockerCodes(files)).includes('docid-duplicate'));
});

// ---------------------------------------------------------------- codex review(1回目)指摘対応

test('execute: finalizeだけ失敗した状態は、planの有効期間を過ぎても再実行で完了できる(書込みなしの再開)', async () => {
  const claim = baseClaim();
  const { deps, fake } = setup(baseFiles(), claim);
  const { plan, approval } = await planAndApproval(deps);
  claim.finalizeOverride = { outcome: 'no-op', reason: 'fence-mismatch' };
  assert.equal((await executeFolderTreeMerge(deps, plan, approval, { execute: true })).status, 'finalize-failed');
  claim.finalizeOverride = undefined;
  const later: TreeMergeDeps = { ...deps, now: () => new Date(FIXED_NOW.getTime() + 48 * 60 * 60 * 1000) };
  const updates = fake.updateCalls.length;
  const r = await executeFolderTreeMerge(later, plan, approval, { execute: true });
  assert.equal(r.status, 'completed');
  assert.equal(fake.updateCalls.length, updates);
});

test('plan阻害: 再帰統合する子フォルダのrename/trash権限が無ければcannot-trash(部分統合を避ける)', async () => {
  for (const capabilities of [{ canRename: false }, { canTrash: false }]) {
    const files = baseFiles().map((f) => (f.id === 'S-A' ? { ...f, capabilities } : f));
    assert.ok((await blockerCodes(files)).includes('cannot-trash'));
  }
});

test('plan検証: 統合元Sのtrash権限が無ければ拒否', async () => {
  const files = baseFiles().map((f) => (f.id === 'S' ? { ...f, capabilities: { canTrash: false } } : f));
  await assertValidation(setup(files).deps, 'insufficient-capabilities');
});

test('plan阻害: Sのみの子フォルダの孫を参照するclaimも検知する(サブツリー全体を走査)', async () => {
  const files = [...baseFiles(), folder('S-B-1', '孫', ['S-B']), folder('S-B-2', 'ひ孫', ['S-B-1'])];
  for (const id of ['S-B-1', 'S-B-2']) {
    const claim = { ...baseClaim(), referencedIds: new Set([id]) };
    assert.ok((await blockerCodes(files, claim)).includes('claims-reference-source-tree'), id);
  }
});

test('plan阻害: Sのみの子フォルダ配下の参照先不明ショートカット・複数親も検知する', async () => {
  const files = [
    ...baseFiles(),
    file('S-B-sc', 'sc', ['S-B'], { mimeType: SHORTCUT }),
    file('S-B-mp', 'mp', ['S-B', 'OTHER']),
  ];
  const codes = await blockerCodes(files);
  assert.ok(codes.includes('shortcut-target-unknown'));
  assert.ok(codes.includes('multi-parent'));
});

// ---------------------------------------------------------------- codex review(2回目)指摘対応

test('plan阻害: 再帰統合で一致した子フォルダ(統合元・統合先とも)が複数親ならmulti-parent', async () => {
  const srcMulti = baseFiles().map((f) => (f.id === 'S-A' ? { ...f, parents: ['S', 'OTHER'] } : f));
  assert.ok((await blockerCodes(srcMulti)).includes('multi-parent'));
  const tgtMulti = baseFiles().map((f) => (f.id === 'D-A' ? { ...f, parents: ['D', 'OTHER'] } : f));
  assert.ok((await blockerCodes(tgtMulti)).includes('multi-parent'));
});

test('execute: plan後に再帰統合対象の子フォルダが別の場所へ移されていたら、書込み前にドリフトで停止', async () => {
  const { deps, fake } = setup();
  const { plan, approval } = await planAndApproval(deps);
  (fake.files.find((f) => f.id === 'S-A') as FakeTreeFile).parents = ['ELSEWHERE'];
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-drift');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: op実行の途中でclaim読取フラグがOFFになったら、次のop前に停止する(以降の書込みなし)', async () => {
  const claim = baseClaim();
  const { deps, fake } = setup(baseFiles(), claim, { afterNthUpdate: { n: 2, apply: () => (claim.claimReadEnabled = false) } });
  const { plan, approval } = await planAndApproval(deps);
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-root-claim-changed');
  assert.equal(fake.updateCalls.length, 2);
  assert.equal(fake.callLog.some((c) => c.startsWith('claim.finalize')), false);
});

test('execute: op実行の途中でルートclaimが書き換えられたら、次のop前に停止する', async () => {
  const claim = baseClaim();
  const { deps, fake } = setup(baseFiles(), claim, { afterNthUpdate: { n: 1, apply: () => ((claim.root as { updateTimeMs: number }).updateTimeMs = 7777) } });
  const { plan, approval } = await planAndApproval(deps);
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-root-claim-changed');
  assert.equal(fake.updateCalls.length, 1);
});

// ---------------------------------------------------------------- plan/承認JSONの入口検証(型設計レビュー指摘)

test('parseFolderTreeMergePlan: 実際に生成したplanはJSON往復しても受理される', async () => {
  const plan = await planOf(setup().deps);
  const roundTripped = JSON.parse(JSON.stringify(plan)); // undefinedのフィールドはJSONで落ちる
  assert.deepEqual(parseFolderTreeMergePlan(roundTripped), roundTripped);
});

test('parseFolderTreeMergePlan: 手編集・破損したplanは拒否する(内容をエラー文言に含めない)', async () => {
  const good = JSON.parse(JSON.stringify(await planOf(setup().deps)));
  const mutations: Record<string, (p: Record<string, any>) => void> = {
    schemaVersion: (p) => (p.schemaVersion = 'other'),
    planId: (p) => delete p.planId,
    rootFolderId: (p) => (p.rootFolderId = ''),
    rootClaim: (p) => (p.rootClaim = { folderId: 'D' }),
    blockers: (p) => delete p.blockers,
    claimCheckFolderIds: (p) => delete p.claimCheckFolderIds,
    summary: (p) => (p.summary.fileMoves = -1),
    ops: (p) => (p.ops = 'x'),
    'op.kind': (p) => (p.ops[0].kind = 'delete-folder'),
    'move-file': (p) => delete p.ops.find((o: any) => o.kind === 'move-file').toParentId,
    'trash-folder': (p) => delete p.ops.find((o: any) => o.kind === 'trash-folder').parentId,
    'summary-ops-mismatch': (p) => (p.summary.fileMoves += 1),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const p = JSON.parse(JSON.stringify(good));
    mutate(p);
    assert.throws(() => parseFolderTreeMergePlan(p), /invalid folder-tree-merge plan/, name);
  }
  assert.throws(() => parseFolderTreeMergePlan(null), /invalid folder-tree-merge plan/);
});

test('parseFolderTreeMergeApproval: 欠落・負数・非整数は拒否する', () => {
  const ok = { planId: 'p', expectedFileMoves: 1, expectedFolderMoves: 0, expectedFolderTrashes: 2 };
  assert.deepEqual(parseFolderTreeMergeApproval(ok), ok);
  for (const bad of [null, { ...ok, planId: '' }, { ...ok, expectedFileMoves: -1 }, { ...ok, expectedFolderMoves: 1.5 }, { ...ok, expectedFolderTrashes: '2' }]) {
    assert.throws(() => parseFolderTreeMergeApproval(bad), /invalid folder-tree-merge approval/);
  }
});

test('終了コード: completed/already-completed/dry-runだけが0で、それ以外は3', () => {
  const zero = Object.entries(FOLDER_TREE_MERGE_EXIT_CODE).filter(([, c]) => c === 0).map(([s]) => s).sort();
  assert.deepEqual(zero, ['already-completed', 'completed', 'dry-run']);
});

test('plan: claimCheckFolderIdsに統合元ツリーの全フォルダ(Sのみサブツリーの子孫を含む)が入る', async () => {
  const files = [...baseFiles(), folder('S-B-1', '孫', ['S-B']), folder('S-B-2', 'ひ孫', ['S-B-1'])];
  const plan = await planOf(setup(files).deps);
  assert.deepEqual([...plan.claimCheckFolderIds].sort(), ['S', 'S-A', 'S-B', 'S-B-1', 'S-B-2']);
});

test('execute: plan後にSのみサブツリーの孫を参照するclaimが作られていても、書込み前に停止する', async () => {
  const files = [...baseFiles(), folder('S-B-1', '孫', ['S-B'])];
  const { deps, fake, claim } = setup(files);
  const { plan, approval } = await planAndApproval(deps);
  claim.referencedIds.add('S-B-1');
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true });
  assert.equal(r.status, 'aborted-drift');
  assert.equal(fake.updateCalls.length, 0);
});

test('execute: 書込みopを1件も記録していない拒否・停止では、manifestを保存しない(既存の記録を上書きしない)', async () => {
  const { deps, fake } = setup();
  const { plan, approval } = await planAndApproval(deps);
  (fake.files.find((f) => f.id === 'S-f0') as FakeTreeFile).parents = ['ELSEWHERE'];
  let saved = 0;
  const r = await executeFolderTreeMerge(deps, plan, approval, { execute: true, onProgress: () => (saved += 1) });
  assert.equal(r.status, 'aborted-drift');
  assert.equal(saved, 0);
});

// ---------------------------------------------------------------- ショートカットの扱い(参照先がtrashされるかで判定)

function shortcut(id: string, parents: string[], targetId?: string): FakeTreeFile {
  return file(id, 'sc', parents, { mimeType: SHORTCUT, shortcutTargetId: targetId });
}

test('plan: 移動されるフォルダを指すショートカットは阻害要因にならず、通常のファイルとして移動される', async () => {
  const plan = await planOf(setup([...baseFiles(), shortcut('S-sc', ['S'], 'S-B')]).deps);
  assert.deepEqual(plan.blockers, []);
  assert.ok(plan.ops.some((o) => o.kind === 'move-file' && o.fileId === 'S-sc' && o.toParentId === 'D'));
});

test('plan: 統合の影響を受けないフォルダ(範囲外)を指すショートカットも阻害要因にならない', async () => {
  const plan = await planOf(setup([...baseFiles(), shortcut('S-sc', ['S'], 'OUTSIDE')]).deps);
  assert.deepEqual(plan.blockers, []);
});

test('plan: Sのみサブツリー内で、同じサブツリー内のフォルダ(祖先を含む)を指すショートカットは阻害要因にならない(実データの形)', async () => {
  const files = [
    ...baseFiles(),
    folder('S-B-1', '孫', ['S-B']),
    shortcut('S-B-1-sc', ['S-B-1'], 'S-B'), // 自分を含む祖先を指す自己参照
  ];
  const plan = await planOf(setup(files).deps);
  assert.deepEqual(plan.blockers, []);
  assert.ok(plan.ops.some((o) => o.kind === 'move-folder' && o.folderId === 'S-B'));
});

test('plan阻害: 空にしてtrashされる統合元フォルダを指すショートカットはリンク切れになるためshortcut-to-trashed-folder', async () => {
  for (const target of ['S-A', 'S']) {
    const codes = await blockerCodes([...baseFiles(), shortcut('S-sc', ['S'], target)]);
    assert.ok(codes.includes('shortcut-to-trashed-folder'), target);
  }
});

test('plan阻害: Sのみサブツリー内のショートカットがtrashされるフォルダを指す場合も検知する', async () => {
  const files = [...baseFiles(), folder('S-B-1', '孫', ['S-B']), shortcut('S-B-1-sc', ['S-B-1'], 'S-A')];
  assert.ok((await blockerCodes(files)).includes('shortcut-to-trashed-folder'));
});

test('plan阻害: 統合先側にあるショートカットがtrashされる統合元フォルダを指す場合も検知する', async () => {
  const files = [...baseFiles(), shortcut('D-sc', ['D'], 'S-A')];
  assert.ok((await blockerCodes(files)).includes('shortcut-to-trashed-folder'));
});

test('plan阻害: 複数親のショートカットはmulti-parent(参照先が安全でも移動しない)', async () => {
  const codes = await blockerCodes([...baseFiles(), shortcut('S-sc', ['S', 'OTHER'], 'S-B')]);
  assert.ok(codes.includes('multi-parent'));
});

test('plan阻害: 統合先のみのサブツリー(深い階層)にあるショートカットがtrashされる統合元フォルダを指す場合も検知する', async () => {
  const files = [...baseFiles(), folder('D-C-1', '孫', ['D-C']), shortcut('D-C-1-sc', ['D-C-1'], 'S-A')];
  assert.ok((await blockerCodes(files)).includes('shortcut-to-trashed-folder'));
});

test('plan: 統合先のみのサブツリー内のショートカットが影響を受けないフォルダを指すなら阻害要因にならない', async () => {
  const files = [...baseFiles(), folder('D-C-1', '孫', ['D-C']), shortcut('D-C-1-sc', ['D-C-1'], 'D-C')];
  assert.deepEqual((await planOf(setup(files).deps)).blockers, []);
});
