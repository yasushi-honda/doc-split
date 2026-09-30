/**
 * `scripts/lib/folderTreeMerge.ts`の単体テスト用in-memory fake Drive / fake claim store。
 *
 * 既存の`fakeSiblingDrive.ts`は他テストが依存する安定資産のため手を加えず、本ツール固有の
 * 要件(capabilities・ショートカット・複数親・空確認用の全種別list)に合わせた別実装とする。
 *
 * queryは「`'PARENT_ID' in parents and trashed=false`」の1パターンのみ許可し、未知のqueryは
 * throwする(パーサーの取りこぼしで安全分岐のテストが無関係に緑化する事故を避ける)。
 */

import type { drive_v3 } from 'googleapis';
import type { TreeMergeClaimStore, RootClaimSnapshot } from '../folderTreeMerge';

export interface FakeTreeCapabilities {
  canMoveItemWithinDrive?: boolean;
  canRename?: boolean;
  canTrash?: boolean;
  canAddChildren?: boolean;
}

export interface FakeTreeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed?: boolean;
  appProperties?: Record<string, string>;
  capabilities?: FakeTreeCapabilities;
}

export type FakeTreeInjectionMode = 'not-applied-error' | 'applied-error';

export interface FakeTreeDriveOptions {
  /** fileId → 障害注入(1回消費して以降は通常成功。consumeOnce:falseで継続)。 */
  updateFailures?: Map<string, { mode: FakeTreeInjectionMode; consumeOnce?: boolean }>;
  /** 指定回数目のfiles.update完了「後」にDrive状態を変化させる(並行操作の割込み模擬)。 */
  afterNthUpdate?: { n: number; apply: () => void };
  /** files.listのサーバ側応答上限(ページネーションの強制)。 */
  listPageSize?: number;
}

const QUERY_PATTERN = /^'([^']+)' in parents and trashed=false$/;

export function makeFakeTreeDrive(
  files: FakeTreeFile[],
  opts: FakeTreeDriveOptions = {}
): { drive: drive_v3.Drive; files: FakeTreeFile[]; updateCalls: Record<string, unknown>[]; callLog: string[] } {
  const updateCalls: Record<string, unknown>[] = [];
  const callLog: string[] = [];
  let updateCount = 0;

  const view = (f: FakeTreeFile) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    parents: [...f.parents],
    trashed: f.trashed ?? false,
    appProperties: f.appProperties ? { ...f.appProperties } : undefined,
    capabilities: {
      canMoveItemWithinDrive: f.capabilities?.canMoveItemWithinDrive ?? true,
      canRename: f.capabilities?.canRename ?? true,
      canTrash: f.capabilities?.canTrash ?? true,
      canAddChildren: f.capabilities?.canAddChildren ?? true,
    },
  });

  const drive = {
    files: {
      get: async (params: Record<string, unknown>) => {
        const fileId = params.fileId as string;
        callLog.push(`files.get(${fileId})`);
        const f = files.find((x) => x.id === fileId);
        if (!f) {
          const err = new Error('File not found') as Error & { code: number };
          err.code = 404;
          throw err;
        }
        return { data: view(f) };
      },
      list: async (params: Record<string, unknown>) => {
        const m = (params.q as string).match(QUERY_PATTERN);
        if (!m) throw new Error(`fakeTreeDrive: 未知のqueryパターンです: ${params.q}`);
        const parentId = m[1];
        callLog.push(`files.list(parent=${parentId})`);
        const matched = files.filter((f) => f.parents.includes(parentId) && !(f.trashed ?? false));
        const requested = (params.pageSize as number | undefined) ?? 100;
        const size = Math.min(requested, opts.listPageSize ?? Number.POSITIVE_INFINITY);
        const start = params.pageToken ? Number(params.pageToken) : 0;
        const page = matched.slice(start, start + size);
        const next = start + size;
        return {
          data: {
            files: page.map(view),
            nextPageToken: next < matched.length ? String(next) : undefined,
          },
        };
      },
      update: async (params: Record<string, unknown>) => {
        updateCalls.push(params);
        updateCount += 1;
        const fileId = params.fileId as string;
        callLog.push(`files.update(${fileId})`);
        const f = files.find((x) => x.id === fileId);
        if (!f) throw new Error(`fakeTreeDrive: update対象が見つかりません: ${fileId}`);

        const apply = (): void => {
          const add = params.addParents as string | undefined;
          const remove = params.removeParents as string | undefined;
          if (add) {
            const removeSet = new Set((remove ?? '').split(',').filter(Boolean));
            f.parents = f.parents.filter((p) => !removeSet.has(p));
            f.parents.push(add);
          }
          const body = params.requestBody as { name?: string; trashed?: boolean } | undefined;
          if (body?.name !== undefined) f.name = body.name;
          if (body?.trashed !== undefined) f.trashed = body.trashed;
        };
        const fire = (): void => {
          if (opts.afterNthUpdate && updateCount === opts.afterNthUpdate.n) opts.afterNthUpdate.apply();
        };

        const inj = opts.updateFailures?.get(fileId);
        if (inj) {
          if (inj.consumeOnce !== false) opts.updateFailures?.delete(fileId);
          if (inj.mode === 'not-applied-error') {
            fire();
            throw new Error('fakeTreeDrive: update failed (not applied)');
          }
          apply();
          fire();
          throw new Error('fakeTreeDrive: update timeout (applied)');
        }
        apply();
        fire();
        return { data: { id: f.id } };
      },
    },
  } as unknown as drive_v3.Drive;

  return { drive, files, updateCalls, callLog };
}

export interface FakeClaimStoreState {
  /** ルートclaim(`(rootFolderId,name)`)。nullなら存在しない。 */
  root: RootClaimSnapshot | null;
  claimReadEnabled: boolean;
  /** parentIdまたはfolderIdとして参照されているID集合(=これらを含むツリーはblocker)。 */
  referencedIds: Set<string>;
  /** `${parentId}/${name}`形式で存在するclaimスロット。 */
  slots: Set<string>;
  /** finalizeの結果を強制する(未指定なら'resolved'にしrootをresolvedへ更新)。 */
  finalizeOverride?: { outcome: 'no-op'; reason: string };
}

export function makeFakeClaimStore(
  state: FakeClaimStoreState,
  callLog: string[] = []
): TreeMergeClaimStore & { state: FakeClaimStoreState } {
  return {
    state,
    readRootClaim: async (parentId, name) => {
      callLog.push(`claim.readRoot(${parentId})`);
      void name;
      return state.root ? { ...state.root } : null;
    },
    isClaimReadEnabled: async () => state.claimReadEnabled,
    countClaimsReferencing: async (ids) => {
      const hit = ids.filter((id) => state.referencedIds.has(id));
      return { byParentId: hit.length, byFolderId: 0 };
    },
    hasClaim: async (parentId, name) => state.slots.has(`${parentId}/${name}`),
    finalizeResolved: async (parentId, name, fence) => {
      callLog.push(`claim.finalize(${parentId})`);
      void name;
      if (state.finalizeOverride) return state.finalizeOverride;
      if (!state.root || state.root.state !== 'divergent') return { outcome: 'no-op', reason: 'not-divergent' };
      if (state.root.updateTimeMs !== fence.expectedUpdateTimeMs) return { outcome: 'no-op', reason: 'fence-mismatch' };
      state.root = { ...state.root, state: 'resolved' };
      return { outcome: 'resolved' };
    },
  };
}
