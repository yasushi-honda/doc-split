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
  PLAN_MAX_AGE_MS,
  approvalMatchesPlan,
  type FolderTreeMergeApproval,
  type FolderTreeMergeManifest,
  type FolderTreeMergePlan,
  type FolderTreeMergeStatus,
  type RootClaimFence,
  type TreeMergeBlocker,
  type TreeMergeManifestEntry,
  type RootClaimState,
  type TreeMergeOpStatus,
  type TreeMergeOp,
} from './folderTreeMergePlanTypes';
import { describeErrorSafely } from './confirmedReplayStats';

export interface RootClaimSnapshot {
  state: RootClaimState;
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
  canTrash: boolean;
  canAddChildren: boolean;
  /** ショートカットの参照先ID(ショートカット以外・不明ならundefined)。 */
  shortcutTargetId?: string;
}

const ITEM_FIELDS =
  'id,name,mimeType,parents,trashed,appProperties,capabilities(canMoveItemWithinDrive,canRename,canTrash,canAddChildren),shortcutDetails(targetId)';

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
    canTrash: f.capabilities?.canTrash !== false,
    canAddChildren: f.capabilities?.canAddChildren !== false,
    shortcutTargetId: f.shortcutDetails?.targetId ?? undefined,
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
): Promise<{ source: DriveItem; target: DriveItem }> {
  if (sourceId === targetId) throw new TreeMergeValidationError('same-folder');
  const source = await getItem(deps.drive, sourceId);
  const target = await getItem(deps.drive, targetId);
  if (!target) throw new TreeMergeValidationError('folder-not-found', 'target');
  // 404は「trash済み」ではない(権限喪失・共有解除でも404になる)ため、実行側でも許容せずfail-closedにする
  if (!source) throw new TreeMergeValidationError('folder-not-found', 'source');
  const sourceIsGone = source.trashed && !!opts.allowSourceTrashed;
  for (const [label, f] of [['source', source], ['target', target]] as const) {
    if (f.mimeType !== deps.folderMimeType) throw new TreeMergeValidationError('not-a-folder', label);
    if (f.trashed && !(label === 'source' && sourceIsGone)) throw new TreeMergeValidationError('folder-trashed', label);
    if (f.parents.length !== 1 || f.parents[0] !== rootFolderId) throw new TreeMergeValidationError('bad-parent', label);
  }
  // trash済みのSは「【統合済み_…】」に改名されているため名前照合の対象外
  if (!sourceIsGone && source.name !== target.name) throw new TreeMergeValidationError('name-mismatch');
  if (!sourceIsGone && !(source.canRename && source.canMove && source.canTrash)) {
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
  const source = validated.source;
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
  /** 走査中に見つけたショートカット。参照先がtrashされるフォルダかどうかは、全ペアの走査が終わってから判定する。 */
  const shortcuts: { id: string; targetId?: string }[] = [];

  /** 再親付けするサブツリーの全子孫を走査する(claim参照検査の対象ID収集と、ショートカット・複数親の検知)。 */
  async function inventoryMovedSubtree(folderId: string): Promise<void> {
    for (const c of await listChildren(deps.drive, folderId)) {
      if (c.mimeType === shortcutMime) shortcuts.push({ id: c.id, targetId: c.shortcutTargetId });
      if (c.parents.length !== 1) blockers.push({ code: 'multi-parent', id: c.id });
      if (c.mimeType === deps.folderMimeType) {
        movedFolderIds.push(c.id);
        await inventoryMovedSubtree(c.id);
      }
    }
  }

  /** 統合先側でSに対応する子が無いサブツリーの全子孫を走査し、ショートカットだけを収集する(リンク切れ判定用)。 */
  async function collectTargetOnlyShortcuts(folderId: string): Promise<void> {
    for (const c of await listChildren(deps.drive, folderId)) {
      if (c.mimeType === shortcutMime) shortcuts.push({ id: c.id, targetId: c.shortcutTargetId });
      if (c.mimeType === deps.folderMimeType) await collectTargetOnlyShortcuts(c.id);
    }
  }

  async function mergePair(s: DriveItem, sParentId: string, d: DriveItem): Promise<void> {
    const [sChildren, dChildren] = await Promise.all([listChildren(deps.drive, s.id), listChildren(deps.drive, d.id)]);
    if (!d.canAddChildren) blockers.push({ code: 'cannot-add-children', id: d.id });
    for (const c of dChildren) if (c.mimeType === shortcutMime) shortcuts.push({ id: c.id, targetId: c.shortcutTargetId });

    const sFolders = sChildren.filter((c) => c.mimeType === deps.folderMimeType);
    const sFiles = sChildren.filter((c) => c.mimeType !== deps.folderMimeType);
    const dFolders = dChildren.filter((c) => c.mimeType === deps.folderMimeType);
    const dFiles = dChildren.filter((c) => c.mimeType !== deps.folderMimeType);

    const sNameCount = new Map<string, number>();
    for (const x of sFolders) sNameCount.set(x.name, (sNameCount.get(x.name) ?? 0) + 1);
    for (const x of sFolders) {
      if ((sNameCount.get(x.name) ?? 0) > 1) blockers.push({ code: 'source-same-name-multiple', id: x.id });
    }

    // Sに同名の子が無い統合先の子フォルダはmergePairで再帰されないため、配下のショートカットをここで収集する
    for (const y of dFolders) {
      if (!sFolders.some((x) => x.name === y.name)) await collectTargetOnlyShortcuts(y.id);
    }

    for (const x of sFolders) {
      const matches = dFolders.filter((y) => y.name === x.name);
      if (matches.length >= 2) {
        blockers.push({ code: 'target-same-name-multiple', id: x.id });
      } else if (matches.length === 1) {
        // 複数親のフォルダは、空にしてtrashすると他の親配下からも消える(統合先側は共有ブランチへ書き込むことになる)
        if (x.parents.length !== 1) blockers.push({ code: 'multi-parent', id: x.id });
        if (matches[0].parents.length !== 1) blockers.push({ code: 'multi-parent', id: matches[0].id });
        // 再帰統合した子フォルダは後で改名+trashされる。実行途中で失敗して部分統合になるのを避けるため、権限を事前に確認する
        if (!(x.canRename && x.canTrash)) blockers.push({ code: 'cannot-trash', id: x.id });
        mergedSourceIds.push(x.id);
        visited += 1;
        await mergePair(x, s.id, matches[0]);
      } else {
        if (await deps.claimStore.hasClaim(d.id, x.name)) blockers.push({ code: 'claim-exists-at-target-slot', id: x.id });
        if (x.parents.length !== 1) blockers.push({ code: 'multi-parent', id: x.id });
        else if (!x.canMove) blockers.push({ code: 'cannot-move', id: x.id });
        movedFolderIds.push(x.id);
        await inventoryMovedSubtree(x.id);
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
      // ショートカットは(参照先を変えずに)通常のファイルと同様に移動できる。リンク切れになる場合だけ後で阻害要因にする
      if (f.mimeType === shortcutMime) shortcuts.push({ id: f.id, targetId: f.shortcutTargetId });
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

  // ショートカットが「空にしてtrashされる統合元フォルダ」を指すと、統合後にリンク切れになる。参照先が不明な場合も安全側で拒否する
  const trashedFolderIds = new Set(mergedSourceIds);
  for (const sc of shortcuts) {
    if (!sc.targetId) blockers.push({ code: 'shortcut-target-unknown', id: sc.id });
    else if (trashedFolderIds.has(sc.targetId)) blockers.push({ code: 'shortcut-to-trashed-folder', id: sc.id });
  }

  const claimCheckFolderIds = [...mergedSourceIds, ...movedFolderIds];
  const refs = await deps.claimStore.countClaimsReferencing(claimCheckFolderIds);
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
    claimCheckFolderIds,
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
    // 404は適用済みと見なさない(権限喪失でも404になる)。trashedを実観測した場合のみapplied
    if (!item) return 'drift';
    if (item.trashed) return 'applied';
    // plan後に別の場所へ移されたフォルダを空にしてtrashしないよう、計画上の親配下にある場合だけpendingとする
    return item.parents.length === 1 && item.parents[0] === op.parentId ? 'pending' : 'drift';
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
    // 書込みopを1件も記録していない終了(拒否・ドリフト停止等)では、空のmanifestで既存の記録を上書きさせない
    if (options.execute && manifest.entries.length > 0) options.onProgress?.(manifest);
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
    if (src?.trashed) return finish('already-completed');
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

  // plan後に統合元ツリーを参照するclaimが新規作成されていないか再確認(書込み前)
  const refsNow = await deps.claimStore.countClaimsReferencing(plan.claimCheckFolderIds);
  if (refsNow.byParentId + refsNow.byFolderId > 0) {
    options.logError?.(`claims-reference-source-tree-at-execute: count=${refsNow.byParentId + refsNow.byFolderId}`);
    return finish('aborted-drift');
  }

  // 事前照合(書込み0件): 各opは初期状態(pending)か期待終状態(applied)のみ許容
  const states: LiveOpState[] = [];
  for (const op of plan.ops) states.push(await liveOpState(deps, op));
  if (states.includes('drift')) return finish('aborted-drift');
  const pendingOps = states.filter((s) => s === 'pending').length;
  const appliedOps = states.length - pendingOps;
  // 期限切れのplanでDriveへ書込むのは拒否する。ただし全opが適用済みでfinalizeだけが残る再開(書込みなし)は許容する
  const planAgeMs = now().getTime() - new Date(plan.createdAt).getTime();
  if (pendingOps > 0 && (!Number.isFinite(planAgeMs) || planAgeMs > PLAN_MAX_AGE_MS)) {
    return finish('refused-plan-expired', pendingOps, appliedOps);
  }
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
    // 実行中にflagがOFFにされる・ルートclaimが書き換わると通常exportが再開しうるため、書込みop毎に再確認する
    if (!(await deps.claimStore.isClaimReadEnabled()) || !claimUnchanged(await deps.claimStore.readRootClaim(plan.rootFolderId, target.name))) {
      options.logError?.(`root-claim-or-flag-changed-during-execute: before ${op.opId}`);
      return finish('aborted-root-claim-changed', pendingOps, appliedOps);
    }
    let status: TreeMergeOpStatus = 'applied';
    try {
      if (op.kind === 'trash-folder') {
        const remaining = await listChildren(deps.drive, op.folderId);
        if (remaining.length > 0) {
          options.logError?.(`trash-blocked-not-empty: ${op.folderId} remaining=${remaining.length}`);
          record({ opId: op.opId, kind: op.kind, status: 'failed', error: 'not-empty' });
          return finish('aborted-not-empty', pendingOps, appliedOps);
        }
        const live = await getItem(deps.drive, op.folderId);
        if (!live) throw new Error('folder-not-found-before-trash');
        await deps.drive.files.update({
          fileId: op.folderId,
          requestBody: { name: `${live.name}【統合済み_${dateStamp(now())}】`, trashed: true },
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
    } catch (err) {
      // タイムアウト等で応答が失われても適用済みの場合があるため、実状態を再取得して判定する
      let recovered = false;
      try {
        recovered = (await liveOpState(deps, op)) === 'applied';
      } catch {
        recovered = false;
      }
      if (!recovered) {
        // Driveのエラー文言はリソース名(利用者名)を含みうるため、無害化した種別のみ記録する
        const safe = describeErrorSafely(err);
        options.logError?.(`op-failed: ${op.opId} ${op.kind} ${safe}`);
        record({ opId: op.opId, kind: op.kind, status: 'failed', error: safe });
        return finish('aborted-op-failure', pendingOps, appliedOps);
      }
      status = 'applied-after-error';
    }
    // 進捗の永続化失敗はop失敗と混同しないよう、try/catchの外で記録する
    record({ opId: op.opId, kind: op.kind, status });
  }

  // S本体がtrashされたこと、ルートclaim・flagが実行前から変わっていないことを確認してからfinalizeする
  const sourceAfter = await getItem(deps.drive, plan.sourceFolderId);
  if (!sourceAfter || !sourceAfter.trashed) return finish('aborted-source-not-trashed', pendingOps, appliedOps);
  if (!(await deps.claimStore.isClaimReadEnabled()) || !claimUnchanged(await deps.claimStore.readRootClaim(plan.rootFolderId, target.name))) {
    return finish('aborted-root-claim-changed', pendingOps, appliedOps);
  }

  let outcome: Awaited<ReturnType<TreeMergeClaimStore['finalizeResolved']>>;
  try {
    outcome = await deps.claimStore.finalizeResolved(plan.rootFolderId, target.name, {
      expectedFolderId: plan.rootClaim.folderId,
      expectedDivergentReason: plan.rootClaim.divergentReason,
      expectedUpdateTimeMs: plan.rootClaim.updateTimeMs,
      actor,
    });
  } catch (err) {
    // Drive側は完了済み・claim未確定。同一planの再実行(already-completed/finalize再試行)で救済する
    outcome = { outcome: 'no-op', reason: `error:${describeErrorSafely(err)}` };
  }
  if (outcome.outcome !== 'resolved') {
    manifest.finalize = { outcome: 'no-op', reason: outcome.reason };
    options.logError?.(`finalize-failed: ${outcome.reason} (Drive側の統合は完了済み。ルートclaimの状態を確認し、同一planで再実行してください)`);
    return finish('finalize-failed', pendingOps, appliedOps);
  }
  manifest.finalize = { outcome: 'resolved' };
  return finish('completed', pendingOps, appliedOps);
}
