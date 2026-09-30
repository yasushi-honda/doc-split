/**
 * 同名の兄弟Driveフォルダ2つ(統合元S・統合先D)を、子孫を含めて再帰統合するコア
 * (plan-crossreview 2026-09-30 反映)。Drive・claimはDIし、emulator/実Driveなしで単体テストできる。
 *
 * 全体の流れ(呼び出し順序は固定):
 *   plan(read-only): 対象同定 → ルートclaim検証 → 再帰列挙 → 阻害要因検出 → ops生成
 *   execute: ゲート → 事前照合(書込み0件) → ops実行 → S本体のtrash確認 → ルートclaimのfinalize(最後)
 *
 * 排他の位置づけ: ルートclaimがdivergentかつ`driveFolderClaimRead`=ONの間、通常のexport経路は
 * Drive書込み前に停止する。ただし人のDrive操作・並走する運用スクリプトは止められないため、
 * runbookの運用フリーズ承認と、execute開始時/finalize直前のclaim・flag再確認で補う。
 *
 * 冪等な再開: 各opは「初期状態(pending)」または「期待終状態(applied)」のみ許容し、それ以外は
 * ドリフトとして書込み前に停止する。途中失敗後に同一planで再実行すれば、適用済みopをスキップして完走する。
 *
 * PII: plan・manifest・ログにフォルダ名・ファイル名を入れない(ID・件数のみ)。
 */

import type { drive_v3 } from 'googleapis';
import {
  FOLDER_TREE_MERGE_PLAN_SCHEMA_VERSION,
  approvalMatchesPlan,
  type FolderTreeMergeApproval,
  type FolderTreeMergeManifest,
  type FolderTreeMergePlan,
  type FolderTreeMergeStatus,
  type RootClaimFence,
  type TreeMergeBlocker,
  type TreeMergeManifestEntry,
  type TreeMergeOp,
} from './folderTreeMergePlanTypes';

export interface RootClaimSnapshot {
  state: string;
  folderId?: string;
  divergentReason?: string;
  updateTimeMs: number;
}

export interface TreeMergeClaimStore {
  readRootClaim(parentId: string, name: string): Promise<RootClaimSnapshot | null>;
  isClaimReadEnabled(): Promise<boolean>;
  /** 指定IDのいずれかを`parentId`または`folderId`として参照するclaimの件数(チャンク化は実装側)。 */
  countClaimsReferencing(folderIds: string[]): Promise<{ byParentId: number; byFolderId: number }>;
  hasClaim(parentId: string, name: string): Promise<boolean>;
  finalizeResolved(
    parentId: string,
    name: string,
    fence: { expectedFolderId: string; expectedDivergentReason: string; expectedUpdateTimeMs: number; actor: string }
  ): Promise<{ outcome: 'resolved' } | { outcome: 'no-op'; reason: string }>;
}

export interface TreeMergeDeps {
  drive: drive_v3.Drive;
  claimStore: TreeMergeClaimStore;
  folderMimeType: string;
  shortcutMimeType?: string;
  /** ファイルに付くFirestore documentId(`appProperties`のキー)。 */
  docIdKey?: string;
  log?: (message: string) => void;
  now?: () => Date;
}

export type TreeMergeValidationCode =
  | 'same-folder'
  | 'folder-not-found'
  | 'not-a-folder'
  | 'folder-trashed'
  | 'bad-parent'
  | 'name-mismatch'
  | 'insufficient-capabilities'
  | 'root-claim-mismatch'
  | 'claim-read-disabled';

/** 対象同定・前提条件の検証失敗(CLIはexit 2にする)。 */
export class TreeMergeValidationError extends Error {
  readonly code: TreeMergeValidationCode;
  constructor(code: TreeMergeValidationCode, detail?: string) {
    super(`folder-tree-merge: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'TreeMergeValidationError';
    this.code = code;
  }
}

const DEFAULT_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const DEFAULT_DOC_ID_KEY = 'docSplitDocId';
const ROOT_CLAIM_REASON = 'ambiguous-full-scan';

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  appProperties: Record<string, string>;
  canMove: boolean;
  canRename: boolean;
  canAddChildren: boolean;
}

const ITEM_FIELDS =
  'id,name,mimeType,parents,trashed,appProperties,capabilities(canMoveItemWithinDrive,canRename,canAddChildren)';

function toItem(f: drive_v3.Schema$File): DriveItem {
  return {
    id: f.id ?? '',
    name: f.name ?? '',
    mimeType: f.mimeType ?? '',
    parents: f.parents ?? [],
    trashed: !!f.trashed,
    appProperties: (f.appProperties as Record<string, string> | undefined) ?? {},
    canMove: f.capabilities?.canMoveItemWithinDrive !== false,
    canRename: f.capabilities?.canRename !== false,
    canAddChildren: f.capabilities?.canAddChildren !== false,
  };
}

function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; status?: number; response?: { status?: number } };
  return e?.code === 404 || e?.status === 404 || e?.response?.status === 404;
}

async function getItem(drive: drive_v3.Drive, fileId: string): Promise<DriveItem | null> {
  try {
    const res = await drive.files.get({ fileId, fields: ITEM_FIELDS, supportsAllDrives: true });
    return toItem(res.data);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** 直下の有効(未ゴミ箱)な全項目を、ページネーションを尽くして列挙する。 */
async function listChildren(drive: drive_v3.Drive, parentId: string): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed=false`,
      fields: `nextPageToken, files(${ITEM_FIELDS})`,
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) out.push(toItem(f));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function validateRoots(
  deps: TreeMergeDeps,
  rootFolderId: string,
  sourceId: string,
  targetId: string,
  opts: { allowSourceTrashed?: boolean } = {}
): Promise<{ source: DriveItem | null; target: DriveItem }> {
  if (sourceId === targetId) throw new TreeMergeValidationError('same-folder');
  const source = await getItem(deps.drive, sourceId);
  const target = await getItem(deps.drive, targetId);
  if (!target) throw new TreeMergeValidationError('folder-not-found', 'target');
  if (!source) {
    if (opts.allowSourceTrashed) return { source: null, target };
    throw new TreeMergeValidationError('folder-not-found', 'source');
  }
  const sourceIsGone = source.trashed && !!opts.allowSourceTrashed;
  for (const [label, f] of [['source', source], ['target', target]] as const) {
    if (f.mimeType !== deps.folderMimeType) throw new TreeMergeValidationError('not-a-folder', label);
    if (f.trashed && !(label === 'source' && sourceIsGone)) throw new TreeMergeValidationError('folder-trashed', label);
    if (f.parents.length !== 1 || f.parents[0] !== rootFolderId) throw new TreeMergeValidationError('bad-parent', label);
  }
  // trash済みのSは「【統合済み_…】」に改名されているため名前照合の対象外
  if (!sourceIsGone && source.name !== target.name) throw new TreeMergeValidationError('name-mismatch');
  if (!sourceIsGone && !(source.canRename && source.canMove)) {
    throw new TreeMergeValidationError('insufficient-capabilities', 'source');
  }
  if (!target.canAddChildren) throw new TreeMergeValidationError('insufficient-capabilities', 'target');
  return { source, target };
}

function assertRootClaimIsDivergentOnTarget(claim: RootClaimSnapshot | null, targetId: string): RootClaimSnapshot {
  if (!claim || claim.state !== 'divergent' || claim.divergentReason !== ROOT_CLAIM_REASON || claim.folderId !== targetId) {
    throw new TreeMergeValidationError('root-claim-mismatch');
  }
  return claim;
}

export interface PlanParams {
  rootFolderId: string;
  sourceFolderId: string;
  targetFolderId: string;
  projectId: string;
  environment: string;
  lockfile?: { version?: string; hash?: string };
}

export async function planFolderTreeMerge(deps: TreeMergeDeps, params: PlanParams): Promise<FolderTreeMergePlan> {
  const shortcutMime = deps.shortcutMimeType ?? DEFAULT_SHORTCUT_MIME;
  const docIdKey = deps.docIdKey ?? DEFAULT_DOC_ID_KEY;
  const now = deps.now ?? (() => new Date());

  const validated = await validateRoots(deps, params.rootFolderId, params.sourceFolderId, params.targetFolderId);
  const source = validated.source as DriveItem; // allowSourceTrashed未指定のためnullにならない
  const target = validated.target;
  if (!(await deps.claimStore.isClaimReadEnabled())) throw new TreeMergeValidationError('claim-read-disabled');
  const claim = assertRootClaimIsDivergentOnTarget(await deps.claimStore.readRootClaim(params.rootFolderId, target.name), target.id);
  const rootClaim: RootClaimFence = {
    folderId: claim.folderId as string,
    divergentReason: claim.divergentReason as string,
    updateTimeMs: claim.updateTimeMs,
  };

  const ops: TreeMergeOp[] = [];
  const blockers: TreeMergeBlocker[] = [];
  const mergedSourceIds: string[] = [source.id];
  const movedFolderIds: string[] = [];
  let seq = 0;
  const nextId = (): string => `op-${String(++seq).padStart(4, '0')}`;
  let sameNameFileCount = 0;
  let visited = 1;

  async function mergePair(s: DriveItem, sParentId: string, d: DriveItem): Promise<void> {
    const [sChildren, dChildren] = await Promise.all([listChildren(deps.drive, s.id), listChildren(deps.drive, d.id)]);
    if (!d.canAddChildren) blockers.push({ code: 'cannot-add-children', id: d.id });

    const sFolders = sChildren.filter((c) => c.mimeType === deps.folderMimeType);
    const sFiles = sChildren.filter((c) => c.mimeType !== deps.folderMimeType);
    const dFolders = dChildren.filter((c) => c.mimeType === deps.folderMimeType);
    const dFiles = dChildren.filter((c) => c.mimeType !== deps.folderMimeType);

    const sNameCount = new Map<string, number>();
    for (const x of sFolders) sNameCount.set(x.name, (sNameCount.get(x.name) ?? 0) + 1);
    for (const x of sFolders) {
      if ((sNameCount.get(x.name) ?? 0) > 1) blockers.push({ code: 'source-same-name-multiple', id: x.id });
    }

    for (const x of sFolders) {
      const matches = dFolders.filter((y) => y.name === x.name);
      if (matches.length >= 2) {
        blockers.push({ code: 'target-same-name-multiple', id: x.id });
      } else if (matches.length === 1) {
        mergedSourceIds.push(x.id);
        visited += 1;
        await mergePair(x, s.id, matches[0]);
      } else {
        if (await deps.claimStore.hasClaim(d.id, x.name)) blockers.push({ code: 'claim-exists-at-target-slot', id: x.id });
        if (x.parents.length !== 1) blockers.push({ code: 'multi-parent', id: x.id });
        else if (!x.canMove) blockers.push({ code: 'cannot-move', id: x.id });
        movedFolderIds.push(x.id);
        ops.push({ opId: nextId(), kind: 'move-folder', folderId: x.id, fromParentId: s.id, toParentId: d.id });
      }
    }

    const dDocIds = new Set<string>();
    for (const f of dFiles) {
      const docId = f.appProperties[docIdKey];
      if (docId) dDocIds.add(docId);
    }
    const dFileNames = new Set(dFiles.map((f) => f.name));
    const movedDocIds = new Set<string>();
    for (const f of sFiles) {
      if (f.mimeType === shortcutMime) {
        blockers.push({ code: 'shortcut', id: f.id });
        continue;
      }
      if (f.parents.length !== 1) {
        blockers.push({ code: 'multi-parent', id: f.id });
        continue;
      }
      if (!f.canMove) {
        blockers.push({ code: 'cannot-move', id: f.id });
        continue;
      }
      const docId = f.appProperties[docIdKey];
      if (docId) {
        if (dDocIds.has(docId) || movedDocIds.has(docId)) blockers.push({ code: 'docid-duplicate', id: f.id });
        movedDocIds.add(docId);
      }
      if (dFileNames.has(f.name)) sameNameFileCount += 1;
      ops.push({ opId: nextId(), kind: 'move-file', fileId: f.id, fromParentId: s.id, toParentId: d.id });
    }

    ops.push({ opId: nextId(), kind: 'trash-folder', folderId: s.id, parentId: sParentId });
  }

  await mergePair(source, params.rootFolderId, target);

  const refs = await deps.claimStore.countClaimsReferencing([...mergedSourceIds, ...movedFolderIds]);
  const refCount = refs.byParentId + refs.byFolderId;
  if (refCount > 0) blockers.push({ code: 'claims-reference-source-tree', count: refCount });

  const fileMoves = ops.filter((o) => o.kind === 'move-file').length;
  const folderMoves = ops.filter((o) => o.kind === 'move-folder').length;
  const folderTrashes = ops.filter((o) => o.kind === 'trash-folder').length;
  deps.log?.(
    `plan: fileMoves=${fileMoves} folderMoves=${folderMoves} folderTrashes=${folderTrashes} blockers=${blockers.length} sameNameFiles=${sameNameFileCount}`
  );

  return {
    schemaVersion: FOLDER_TREE_MERGE_PLAN_SCHEMA_VERSION,
    planId: `folder-tree-merge-${now().getTime()}`,
    createdAt: now().toISOString(),
    environment: params.environment,
    projectId: params.projectId,
    rootFolderId: params.rootFolderId,
    sourceFolderId: source.id,
    targetFolderId: target.id,
    rootClaim,
    ops,
    blockers,
    summary: { fileMoves, folderMoves, folderTrashes, sameNameFileCount, visitedSourceFolderCount: visited },
    googleapisLockfileVersion: params.lockfile?.version,
    lockfileHash: params.lockfile?.hash,
  };
}

export interface ExecuteOptions {
  execute: boolean;
  /** finalizeのresyncHistoryに残す監査情報(GHA run URL等)。 */
  actor?: string;
  log?: (message: string) => void;
  logError?: (message: string) => void;
  /** 各op処理直後に呼ぶ(manifestのチェックポイント保存用)。 */
  onProgress?: (manifest: FolderTreeMergeManifest) => void;
}

export interface ExecuteResult {
  status: FolderTreeMergeStatus;
  manifest: FolderTreeMergeManifest;
  pendingOps: number;
  appliedOps: number;
}

type LiveOpState = 'applied' | 'pending' | 'drift';

async function liveOpState(deps: TreeMergeDeps, op: TreeMergeOp): Promise<LiveOpState> {
  const targetId = op.kind === 'move-file' ? op.fileId : op.folderId;
  const item = await getItem(deps.drive, targetId);
  if (op.kind === 'trash-folder') {
    if (!item || item.trashed) return 'applied';
    return 'pending';
  }
  if (!item || item.trashed) return 'drift';
  const hasTo = item.parents.includes(op.toParentId);
  const hasFrom = item.parents.includes(op.fromParentId);
  if (hasTo && !hasFrom) return 'applied';
  if (hasFrom && !hasTo && item.parents.length === 1) return 'pending';
  return 'drift';
}

function dateStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function executeFolderTreeMerge(
  deps: TreeMergeDeps,
  plan: FolderTreeMergePlan,
  approval: FolderTreeMergeApproval,
  options: ExecuteOptions
): Promise<ExecuteResult> {
  const now = deps.now ?? (() => new Date());
  const actor = options.actor ?? 'folder-tree-merge';
  const manifest: FolderTreeMergeManifest = {
    planId: plan.planId,
    environment: plan.environment,
    startedAt: now().toISOString(),
    status: 'in-progress',
    entries: [],
    finalize: { outcome: 'not-attempted' },
  };
  const finish = (status: FolderTreeMergeStatus, pendingOps = 0, appliedOps = 0): ExecuteResult => {
    manifest.status = status;
    if (options.execute) options.onProgress?.(manifest);
    return { status, manifest, pendingOps, appliedOps };
  };

  if (plan.blockers.length > 0) return finish('refused-blockers');
  if (!approvalMatchesPlan(plan, approval)) return finish('refused-approval-mismatch');

  // S本体が既に消えている(=前回実行でtrash済み)場合は、finalize済みかどうかだけを確認する。
  const { target } = await validateRoots(deps, plan.rootFolderId, plan.sourceFolderId, plan.targetFolderId, {
    allowSourceTrashed: true,
  });
  const rootClaimNow = await deps.claimStore.readRootClaim(plan.rootFolderId, target.name);
  if (rootClaimNow?.state === 'resolved' && rootClaimNow.folderId === plan.targetFolderId) {
    const src = await getItem(deps.drive, plan.sourceFolderId);
    if (!src || src.trashed) return finish('already-completed');
  }

  const claimUnchanged = (c: RootClaimSnapshot | null): boolean =>
    !!c &&
    c.state === 'divergent' &&
    c.divergentReason === plan.rootClaim.divergentReason &&
    c.folderId === plan.rootClaim.folderId &&
    c.updateTimeMs === plan.rootClaim.updateTimeMs;

  if (!(await deps.claimStore.isClaimReadEnabled()) || !claimUnchanged(rootClaimNow)) {
    return finish('aborted-root-claim-changed');
  }

  // 事前照合(書込み0件): 各opは初期状態(pending)か期待終状態(applied)のみ許容
  const states: LiveOpState[] = [];
  for (const op of plan.ops) states.push(await liveOpState(deps, op));
  if (states.includes('drift')) return finish('aborted-drift');
  const pendingOps = states.filter((s) => s === 'pending').length;
  const appliedOps = states.length - pendingOps;
  if (!options.execute) return finish('dry-run', pendingOps, appliedOps);

  const record = (entry: Omit<TreeMergeManifestEntry, 'timestamp'>): void => {
    manifest.entries.push({ ...entry, timestamp: now().toISOString() });
    options.onProgress?.(manifest);
  };

  for (let i = 0; i < plan.ops.length; i += 1) {
    const op = plan.ops[i];
    if (states[i] === 'applied') {
      record({ opId: op.opId, kind: op.kind, status: 'skipped-already-applied' });
      continue;
    }
    try {
      if (op.kind === 'trash-folder') {
        const remaining = await listChildren(deps.drive, op.folderId);
        if (remaining.length > 0) {
          options.logError?.(`trash-blocked-not-empty: ${op.folderId} remaining=${remaining.length}`);
          record({ opId: op.opId, kind: op.kind, status: 'failed', error: 'not-empty' });
          return finish('aborted-not-empty', pendingOps, appliedOps);
        }
        const live = await getItem(deps.drive, op.folderId);
        await deps.drive.files.update({
          fileId: op.folderId,
          requestBody: { name: `${live?.name ?? ''}【統合済み_${dateStamp(now())}】`, trashed: true },
          supportsAllDrives: true,
          fields: 'id',
        });
      } else {
        await deps.drive.files.update({
          fileId: op.kind === 'move-file' ? op.fileId : op.folderId,
          addParents: op.toParentId,
          removeParents: op.fromParentId,
          supportsAllDrives: true,
          fields: 'id',
        });
      }
      record({ opId: op.opId, kind: op.kind, status: 'applied' });
    } catch (err) {
      // タイムアウト等で応答が失われても適用済みの場合があるため、実状態を再取得して判定する
      let recovered = false;
      try {
        recovered = (await liveOpState(deps, op)) === 'applied';
      } catch {
        recovered = false;
      }
      if (recovered) {
        record({ opId: op.opId, kind: op.kind, status: 'applied-after-error' });
        continue;
      }
      options.logError?.(`op-failed: ${op.opId} ${op.kind}`);
      record({ opId: op.opId, kind: op.kind, status: 'failed', error: (err as Error).message });
      return finish('aborted-op-failure', pendingOps, appliedOps);
    }
  }

  // S本体がtrashされたこと、ルートclaim・flagが実行前から変わっていないことを確認してからfinalizeする
  const sourceAfter = await getItem(deps.drive, plan.sourceFolderId);
  if (sourceAfter && !sourceAfter.trashed) return finish('aborted-source-not-trashed', pendingOps, appliedOps);
  if (!(await deps.claimStore.isClaimReadEnabled()) || !claimUnchanged(await deps.claimStore.readRootClaim(plan.rootFolderId, target.name))) {
    return finish('aborted-root-claim-changed', pendingOps, appliedOps);
  }

  const outcome = await deps.claimStore.finalizeResolved(plan.rootFolderId, target.name, {
    expectedFolderId: plan.rootClaim.folderId,
    expectedDivergentReason: plan.rootClaim.divergentReason,
    expectedUpdateTimeMs: plan.rootClaim.updateTimeMs,
    actor,
  });
  if (outcome.outcome !== 'resolved') {
    manifest.finalize = { outcome: 'no-op', reason: outcome.reason };
    options.logError?.(`finalize-failed: ${outcome.reason}`);
    return finish('finalize-failed', pendingOps, appliedOps);
  }
  manifest.finalize = { outcome: 'resolved' };
  return finish('completed', pendingOps, appliedOps);
}
