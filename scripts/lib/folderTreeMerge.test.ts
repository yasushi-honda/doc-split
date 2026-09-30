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
  type TreeMergeDeps,
} from './folderTreeMerge';
import type { FolderTreeMergeApproval, FolderTreeMergePlan } from './folderTreeMergePlanTypes';
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
  for (const root of [
    null,
    { state: 'resolved', folderId: 'D', divergentReason: 'ambiguous-full-scan', updateTimeMs: 1 },
    { state: 'divergent', folderId: 'D', divergentReason: 'full-scan-mismatch', updateTimeMs: 1 },
    { state: 'divergent', folderId: 'S', divergentReason: 'ambiguous-full-scan', updateTimeMs: 1 },
  ]) {
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

test('plan阻害: ショートカット・複数親・移動権限なし', async () => {
  const files = [
    ...baseFiles(),
    file('S-sc', 'sc', ['S'], { mimeType: SHORTCUT }),
    file('S-mp', 'mp', ['S', 'OTHER']),
    file('S-nm', 'nm', ['S'], { capabilities: { canMoveItemWithinDrive: false } }),
  ];
  const codes = await blockerCodes(files);
  assert.ok(codes.includes('shortcut'));
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
