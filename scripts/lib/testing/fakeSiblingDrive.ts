/**
 * Issue #1039 恒久対応: `scripts/lib/executeSiblingMerge.ts` / `scripts/lib/
 * auditSiblingDuplicates.ts` の統合テスト共用in-memory fake Drive。
 *
 * `scripts/executeDivergenceResync.integration.test.ts`の`makeFakeDrive`と同型の
 * 設計方針(files.get/list/updateをin-memory配列で模擬)だが、既存のfakeには手を
 * 加えず(他テストが依存する安定資産のため)、sibling-merge/audit固有の要件に
 * 合わせて拡張した別実装として新設する:
 *   - mimeTypeによるフォルダ/非フォルダ区別(audit側BFS・execute側のファイル列挙で必須)
 *   - q文字列は「対象コードが実際に発行する既知パターンの完全一致」のみ許可し、
 *     未知のqueryはthrowする(plan-crossreview Medium指摘: 汎用正規表現パーサーだと
 *     安全分岐のテストがパーサーの取りこぼしで無関係に緑化する事故が起きうる)
 *   - files.updateの障害注入に「成功応答だが無反映(no-op)」パターンを含む
 *     (plan-crossreview High#2指摘: 既存fakeのupdateNoOps概念を踏襲していなかった)
 *   - Drive呼出し+claim関数呼出しを横断した`callLog`で観測順序を検証可能にする
 *     (plan-crossreview Medium指摘: コピペによる順序入替えの機械的検知)
 */

import type { drive_v3 } from 'googleapis';
import type { SiblingMergeClaimFunctions } from '../executeSiblingMerge';

export interface FakeSiblingFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed?: boolean;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

/**
 * files.update()の障害注入モード(plan-crossreview High#2対応)。
 * - 'not-applied-error': 権限エラー等。例外を投げ、実データは変化しない。
 * - 'applied-error': タイムアウト/切断等。実データは変化するが、呼び出し元には例外を投げる。
 * - 'applied-success-but-noop': Drive側の無言no-op。200相当の成功応答を返すが、実データは変化しない。
 * 未指定(デフォルト)のfileIdは通常成功('applied-success'相当)として扱う。
 */
export type FakeUpdateInjectionMode = 'not-applied-error' | 'applied-error' | 'applied-success-but-noop';

export interface FakeUpdateInjection {
  mode: FakeUpdateInjectionMode;
  message?: string;
  /** false指定時のみ、同一fileIdへの複数回のupdate呼出しすべてに適用され続ける(既定true=1回消費して以降は通常成功)。 */
  consumeOnce?: boolean;
}

export interface FakeSiblingDriveOptions {
  updateFailures?: Map<string, FakeUpdateInjection>;
  /** 指定回数目のfiles.update()呼出し完了「後」にDrive側の状態を変化させる(並行exportの割込み模擬)。 */
  afterNthUpdate?: { n: number; apply: () => void };
  /** files.listのサーバ側応答上限(未指定時は無制限=1ページで全件返す)。リクエストのpageSizeとは独立。 */
  listPageSize?: number;
}

interface ParsedQuery {
  parentId: string;
  excludeMimeType?: string;
}

/**
 * `execute-drive-sibling-merge.ts`/`audit-drive-sibling-duplicates.ts`が実際に発行する
 * queryパターンのみを完全一致で許可する。パターン:
 *   'PARENT_ID' in parents and trashed=false
 *   'PARENT_ID' in parents and trashed=false and mimeType!='MIME_TYPE'
 */
function parseKnownQuery(q: string): ParsedQuery {
  const match = q.match(/^'([^']+)' in parents and trashed=false(?: and mimeType!='([^']+)')?$/);
  if (!match) {
    throw new Error(`fakeSiblingDrive: 未知のqueryパターンです(想定外のDrive呼出し): ${q}`);
  }
  return { parentId: match[1], excludeMimeType: match[2] };
}

export function makeFakeSiblingDrive(
  files: FakeSiblingFile[],
  opts: FakeSiblingDriveOptions = {}
): { drive: drive_v3.Drive; updateCalls: Record<string, unknown>[]; callLog: string[] } {
  const updateCalls: Record<string, unknown>[] = [];
  const callLog: string[] = [];
  let updateCallCount = 0;

  const drive = {
    files: {
      get: async (params: Record<string, unknown>) => {
        const fileId = params.fileId as string;
        callLog.push(`files.get(${fileId})`);
        const file = files.find((f) => f.id === fileId);
        if (!file) {
          const err = new Error('File not found') as Error & { code: number };
          err.code = 404;
          throw err;
        }
        return {
          data: {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            parents: [...file.parents],
            trashed: file.trashed ?? false,
            modifiedTime: file.modifiedTime ?? '2026-01-01T00:00:00.000Z',
            appProperties: file.appProperties ? { ...file.appProperties } : undefined,
          },
        };
      },
      list: async (params: Record<string, unknown>) => {
        const { parentId, excludeMimeType } = parseKnownQuery(params.q as string);
        callLog.push(
          `files.list(parent=${parentId}${excludeMimeType ? `,exclude=${excludeMimeType}` : ''})`
        );
        let matched = files.filter((f) => f.parents.includes(parentId) && !(f.trashed ?? false));
        if (excludeMimeType) {
          matched = matched.filter((f) => f.mimeType !== excludeMimeType);
        }
        const requestedPageSize = (params.pageSize as number | undefined) ?? 100;
        const serverPageSize = Math.min(requestedPageSize, opts.listPageSize ?? Number.POSITIVE_INFINITY);
        const startIndex = params.pageToken ? Number(params.pageToken) : 0;
        const pageItems = matched.slice(startIndex, startIndex + serverPageSize);
        const nextIndex = startIndex + serverPageSize;
        const nextPageToken = nextIndex < matched.length ? String(nextIndex) : undefined;
        return {
          data: {
            files: pageItems.map((f) => ({
              id: f.id,
              name: f.name,
              mimeType: f.mimeType,
              trashed: f.trashed ?? false,
              modifiedTime: f.modifiedTime ?? '2026-01-01T00:00:00.000Z',
              appProperties: f.appProperties ? { ...f.appProperties } : undefined,
            })),
            nextPageToken,
          },
        };
      },
      update: async (params: Record<string, unknown>) => {
        updateCalls.push(params);
        updateCallCount += 1;
        const fileId = params.fileId as string;
        callLog.push(`files.update(${fileId})`);
        const file = files.find((f) => f.id === fileId);
        if (!file) throw new Error(`fakeSiblingDrive: update対象が見つかりません: ${fileId}`);

        const applyChange = (): void => {
          const addParents = params.addParents as string | undefined;
          const removeParents = params.removeParents as string | undefined;
          if (addParents) {
            const removeSet = new Set((removeParents ?? '').split(',').filter(Boolean));
            file.parents = file.parents.filter((p) => !removeSet.has(p));
            file.parents.push(addParents);
          }
          const requestBody = params.requestBody as { name?: string; trashed?: boolean } | undefined;
          if (requestBody?.name !== undefined) file.name = requestBody.name;
          if (requestBody?.trashed !== undefined) file.trashed = requestBody.trashed;
        };

        const respond = () => ({
          data: { id: file.id, name: file.name, parents: [...file.parents], trashed: file.trashed ?? false },
        });

        const maybeFireAfterNth = (): void => {
          if (opts.afterNthUpdate && updateCallCount === opts.afterNthUpdate.n) {
            opts.afterNthUpdate.apply();
          }
        };

        const injection = opts.updateFailures?.get(fileId);
        if (injection) {
          if (injection.consumeOnce !== false) opts.updateFailures?.delete(fileId);
          if (injection.mode === 'not-applied-error') {
            maybeFireAfterNth();
            throw new Error(injection.message ?? 'fakeSiblingDrive: update failed (not applied)');
          }
          if (injection.mode === 'applied-error') {
            applyChange();
            maybeFireAfterNth();
            throw new Error(injection.message ?? 'fakeSiblingDrive: update timeout (applied)');
          }
          if (injection.mode === 'applied-success-but-noop') {
            maybeFireAfterNth();
            return respond();
          }
        }

        applyChange();
        maybeFireAfterNth();
        return respond();
      },
    },
  } as unknown as drive_v3.Drive;

  return { drive, updateCalls, callLog };
}

/** claim関数(readClaim/invalidateResolvedClaimByFolderId)呼出しをcallLogへ記録するdecorator。 */
export function wrapClaimFnsForCallLog(
  claimFns: SiblingMergeClaimFunctions,
  callLog: string[]
): SiblingMergeClaimFunctions {
  return {
    readClaim: async (firestore, parentId, name) => {
      callLog.push('readClaim');
      return claimFns.readClaim(firestore, parentId, name);
    },
    invalidateResolvedClaimByFolderId: async (firestore, folderId) => {
      callLog.push('invalidateResolvedClaimByFolderId');
      return claimFns.invalidateResolvedClaimByFolderId(firestore, folderId);
    },
  };
}

/**
 * TOCTOU検証用(plan-crossreview High#6対応): `invalidateResolvedClaimByFolderId`本体は
 * 実関数のまま使い、その呼出し「直前」にFirestore上のclaim状態を書き換えるhookだけを
 * 差し込む。単純スタブと異なり、実関数内部のquery+transaction fencingを実際に通過させる。
 */
export function wrapClaimFnsWithBeforeInvalidateHook(
  claimFns: SiblingMergeClaimFunctions,
  beforeInvalidate: () => Promise<void>
): SiblingMergeClaimFunctions {
  return {
    readClaim: claimFns.readClaim,
    invalidateResolvedClaimByFolderId: async (firestore, folderId) => {
      await beforeInvalidate();
      return claimFns.invalidateResolvedClaimByFolderId(firestore, folderId);
    },
  };
}
