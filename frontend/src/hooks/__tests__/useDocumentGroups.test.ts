/**
 * shouldIncludeInGroupDocuments 単体テスト
 *
 * fetchGroupDocuments()のクライアントサイドフィルタ述語を検証する。
 * 背景: careManager未設定書類のCM未設定グループ集計修正(functions/src/utils/
 * groupAggregation.tsのcanFallbackToUnassigned)により、集計対象がcustomerKey
 * 非空の書類に限定された。フロントエンドのグループ展開クエリが同じ条件を
 * 持たないと、表示件数とグループのcountバッジが食い違う不整合が発生する
 * （/codex review-diff指摘、PR #656で一度発生・修正済み）。
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  shouldIncludeInGroupDocuments,
  useGroupDocuments,
  useGroupStats,
  groupDocumentsQueryKey,
  markGroupDocumentsStale,
  markGroupDocumentsVariantsDirty,
  clearGroupDocumentsVariantDirty,
  isGroupDocumentsVariantDirty,
  resetGroupDocumentsToFirstPage,
  useInvalidateGroups,
} from '../useDocumentGroups';

// 本ファイルは.ts(JSX非対応)のため、ProviderラップにcreateElementを使う
// (`useDocumentListRefresh.test.tsx`等の.tsx側はJSX記法を使うが揃える必要はない)。
function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('shouldIncludeInGroupDocuments', () => {
  it('CM未設定グループ + customerKey空文字 → 除外される', () => {
    const result = shouldIncludeInGroupDocuments(
      { status: 'pending', customerKey: '' },
      true
    );

    expect(result).toBe(false);
  });

  it('CM未設定グループ + customerKeyあり → 含まれる', () => {
    const result = shouldIncludeInGroupDocuments(
      { status: 'processed', customerKey: '山田太郎' },
      true
    );

    expect(result).toBe(true);
  });

  it('CM未設定グループでない場合はcustomerKey空文字でも含まれる（ルールはCM未設定グループ限定）', () => {
    const result = shouldIncludeInGroupDocuments(
      { status: 'pending', customerKey: '' },
      false
    );

    expect(result).toBe(true);
  });

  it('status:splitは、CM未設定グループか否かに関わらず除外される', () => {
    expect(
      shouldIncludeInGroupDocuments({ status: 'split', customerKey: '山田太郎' }, true)
    ).toBe(false);
    expect(
      shouldIncludeInGroupDocuments({ status: 'split', customerKey: '山田太郎' }, false)
    ).toBe(false);
  });

  it('customerKeyがundefined（フィールド未設定）でもCM未設定グループなら除外される', () => {
    const result = shouldIncludeInGroupDocuments(
      { status: 'pending' },
      true
    );

    expect(result).toBe(false);
  });
});

// 2026-09-15 Issue #891修正: useGroupDocuments(groupDocuments)が、documentsInfinite
// (PR #890)と同型のFirestore読み取り過大バグを抱えていた。invalidateGroupQueries
// (useDocuments.ts)がrefetchType未指定でinvalidateしており、開いているグループの
// 読み込み済み全ページが即座に再取得されていた。documentsInfinite側の対策
// (refetchType:'none' + 独立dirty-tracking + バナー)を横展開する。
// /plan-crossreview(grip判断モード + codex pass1/pass2)を経た設計。

describe('groupDocumentsQueryKey', () => {
  it('["groupDocuments", groupType, groupKey, pageSize]の形でqueryKeyを組み立てる', () => {
    expect(groupDocumentsQueryKey('customer', '山田太郎', 100)).toEqual([
      'groupDocuments',
      'customer',
      '山田太郎',
      100,
    ]);
  });
});

describe('useGroupDocuments (自動再取得の無効化、Issue #891修正)', () => {
  it('staleTime:Infinity・gcTime:60000を持つ(invalidateQueries(refetchType:none)だけでは、再マウント時等の自動再取得を防げないため)', () => {
    const queryClient = new QueryClient();
    const groupKey = 'useGroupDocuments-options-test-marker';
    // enabled:falseで実フェッチ(Firestore呼び出し)を発生させずにオプションのみ検証する
    // (TanStack QueryはenabledがfalseでもQueryオブジェクト自体はマウント時に登録する)。
    // 注意: refetchOnWindowFocus/refetchOnMount/refetchOnReconnectはobserver側
    // (QueryObserver)のオプションであり、QueryCache上のQueryオブジェクトの
    // `options`には現れない(staleTime/gcTimeはquery側オプションのため現れる)ため、
    // ここでは検証できない。ソースコード(useDocumentGroups.ts)の直接確認で担保する。
    renderHook(
      () => useGroupDocuments({ groupType: 'customer', groupKey, pageSize: 100, enabled: false }),
      { wrapper: createWrapper(queryClient) }
    );

    const query = queryClient
      .getQueryCache()
      .find({ queryKey: groupDocumentsQueryKey('customer', groupKey, 100) });
    // staleTimeはQueryOptions型定義上には現れないが実行時には保持されているため、
    // 型検査を通すためRecord<string, unknown>として読む。
    const options = query?.options as Record<string, unknown> | undefined;

    expect(options?.staleTime).toBe(Infinity);
    expect(options?.gcTime).toBe(60_000);

    queryClient.clear();
  });
});

describe('markGroupDocumentsVariantsDirty / isGroupDocumentsVariantDirty / clearGroupDocumentsVariantDirty', () => {
  // 注意: dirtyGroupDocumentsVariantsはモジュールレベルの共有状態のため、他describe
  // ブロックと衝突しないよう本ブロック専用の一意なgroupKeyを使う。

  it('["groupDocuments"]部分一致の全variantをdirty化する(1グループのみではない、plan-crossreview codex pass1 High指摘反映)', () => {
    const queryClient = new QueryClient();
    const keyA = groupDocumentsQueryKey('customer', 'dirty-store-test-marker-a', 100);
    const keyB = groupDocumentsQueryKey('documentType', 'dirty-store-test-marker-b', 100);
    queryClient.setQueryData(keyA, { pages: [], pageParams: [] });
    queryClient.setQueryData(keyB, { pages: [], pageParams: [] });

    markGroupDocumentsVariantsDirty(queryClient);

    // グループ移動時、呼び出し元は移動元・移動先のどちらのグループも特定できないため、
    // documentsInfinite同様に安全側で全variantを一律dirty化する(「1グループのみ
    // dirty化」ではない)。
    expect(isGroupDocumentsVariantDirty(keyA)).toBe(true);
    expect(isGroupDocumentsVariantDirty(keyB)).toBe(true);

    queryClient.clear();
  });

  it('dirty化されたvariantのうち、実際にfetchが成功して呼び出し側がclearしたものだけ解除される', () => {
    const queryClient = new QueryClient();
    const keyA = groupDocumentsQueryKey('customer', 'dirty-store-test-marker-c', 100);
    const keyB = groupDocumentsQueryKey('office', 'dirty-store-test-marker-d', 100);
    queryClient.setQueryData(keyA, { pages: [], pageParams: [] });
    queryClient.setQueryData(keyB, { pages: [], pageParams: [] });

    markGroupDocumentsVariantsDirty(queryClient);
    expect(isGroupDocumentsVariantDirty(keyA)).toBe(true);
    expect(isGroupDocumentsVariantDirty(keyB)).toBe(true);

    // keyAのみ表示中グループとしてfetch成功しclearされたと仮定
    clearGroupDocumentsVariantDirty(keyA);

    expect(isGroupDocumentsVariantDirty(keyA)).toBe(false);
    expect(isGroupDocumentsVariantDirty(keyB)).toBe(true);

    queryClient.clear();
  });

  it('queryがQueryCacheからgcTime経過で破棄(removed)されると、対応するdirtyエントリも自動的に削除される(plan-crossreview codex pass2 Medium指摘反映)', () => {
    const queryClient = new QueryClient();
    const key = groupDocumentsQueryKey('customer', 'gc-pruning-test-marker', 100);
    queryClient.setQueryData(key, { pages: [], pageParams: [] });

    markGroupDocumentsVariantsDirty(queryClient);
    expect(isGroupDocumentsVariantDirty(key)).toBe(true);

    // gcTime経過を模してqueryをキャッシュから物理的に破棄する
    queryClient.removeQueries({ queryKey: key });

    expect(isGroupDocumentsVariantDirty(key)).toBe(false);

    queryClient.clear();
  });

  it('queryClient.getQueryCache()が例外を投げても、markGroupDocumentsVariantsDirty自体は例外を伝播しない', () => {
    const brokenQueryClient = {
      getQueryCache: () => {
        throw new Error('queryCache is broken');
      },
    } as unknown as QueryClient;

    expect(() => markGroupDocumentsVariantsDirty(brokenQueryClient)).not.toThrow();
  });
});

describe('markGroupDocumentsStale', () => {
  it('groupDocumentsをrefetchType:noneでinvalidateし、かつdirty化する', () => {
    const queryClient = new QueryClient();
    const key = groupDocumentsQueryKey('customer', 'mark-stale-test-marker', 100);
    queryClient.setQueryData(key, { pages: [], pageParams: [] });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    markGroupDocumentsStale(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['groupDocuments'], refetchType: 'none' });
    expect(isGroupDocumentsVariantDirty(key)).toBe(true);

    queryClient.clear();
  });
});

describe('resetGroupDocumentsToFirstPage (documentsInfinite版resetDocumentsInfiniteToFirstPageと同型)', () => {
  function createMockQueryClient() {
    return {
      cancelQueries: vi.fn().mockResolvedValue(undefined),
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
      getQueryCache: () => ({ findAll: () => [], subscribe: () => () => {} }),
    } as unknown as QueryClient & {
      cancelQueries: ReturnType<typeof vi.fn>;
      invalidateQueries: ReturnType<typeof vi.fn>;
      setQueryData: ReturnType<typeof vi.fn>;
    };
  }

  const activeKey = groupDocumentsQueryKey('customer', 'reset-test-marker', 100);

  it('アクティブなqueryKeyに対してcancelQueriesを呼ぶ', async () => {
    const queryClient = createMockQueryClient();
    await resetGroupDocumentsToFirstPage(queryClient, activeKey);
    expect(queryClient.cancelQueries).toHaveBeenCalledWith({ queryKey: activeKey });
  });

  it('["groupDocuments"]部分一致の全variantをrefetchType:noneでstale化する', async () => {
    const queryClient = createMockQueryClient();
    await resetGroupDocumentsToFirstPage(queryClient, activeKey);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['groupDocuments'],
      refetchType: 'none',
    });
  });

  it('アクティブなqueryKeyに対してのみsetQueryDataを呼ぶ', async () => {
    const queryClient = createMockQueryClient();
    await resetGroupDocumentsToFirstPage(queryClient, activeKey);
    expect(queryClient.setQueryData).toHaveBeenCalledTimes(1);
    expect(queryClient.setQueryData.mock.calls[0]![0]).toEqual(activeKey);
  });

  it('setQueryDataのupdater関数はpages/pageParamsを先頭1件のみに切り詰める', async () => {
    const queryClient = createMockQueryClient();
    await resetGroupDocumentsToFirstPage(queryClient, activeKey);

    const updater = queryClient.setQueryData.mock.calls[0]![1] as (old: unknown) => unknown;
    const oldData = {
      pages: [{ documents: ['doc-1'] }, { documents: ['doc-2'] }],
      pageParams: [undefined, 'cursor-1'],
    };
    const result = updater(oldData) as typeof oldData;

    expect(result.pages).toEqual([{ documents: ['doc-1'] }]);
    expect(result.pageParams).toEqual([undefined]);
  });

  it('setQueryDataのupdater関数はキャッシュ未存在(undefined)の場合はundefinedのまま返す', async () => {
    const queryClient = createMockQueryClient();
    await resetGroupDocumentsToFirstPage(queryClient, activeKey);

    const updater = queryClient.setQueryData.mock.calls[0]![1] as (old: unknown) => unknown;
    expect(updater(undefined)).toBeUndefined();
  });
});

describe('useInvalidateGroups (plan-crossreview codex pass1/pass2 Medium指摘反映: groupDocumentsもrefetchType:noneへ統一)', () => {
  it('invalidateAllはgroupDocumentsをrefetchType:noneでdirty化する(即時全ページ再取得を発火しない)', () => {
    const queryClient = new QueryClient();
    const key = groupDocumentsQueryKey('customer', 'invalidate-all-test-marker', 100);
    queryClient.setQueryData(key, { pages: [], pageParams: [] });

    const { result } = renderHook(() => useInvalidateGroups(), { wrapper: createWrapper(queryClient) });
    result.current.invalidateAll();

    expect(isGroupDocumentsVariantDirty(key)).toBe(true);

    queryClient.clear();
  });

  it('invalidateGroupもgroupDocumentsをrefetchType:noneでdirty化する(以前はデフォルトrefetchで全ページ再取得していた)', () => {
    const queryClient = new QueryClient();
    const key = groupDocumentsQueryKey('office', 'invalidate-group-test-marker', 100);
    queryClient.setQueryData(key, { pages: [], pageParams: [] });

    const { result } = renderHook(() => useInvalidateGroups(), { wrapper: createWrapper(queryClient) });
    result.current.invalidateGroup('office', 'invalidate-group-test-marker');

    expect(isGroupDocumentsVariantDirty(key)).toBe(true);

    queryClient.clear();
  });
});

// pr-review-toolkit:pr-test-analyzer指摘(2026-09-15)反映: useGroupStats/GCプルーニング周りの
// 追加カバレッジ

describe('useGroupStats (非同期完了検知用ポーリング、Issue #891修正 + code-reviewer Critical指摘反映)', () => {
  it('pollForUpdates未指定(既定false)ではrefetchIntervalが無効(false)になる(GroupList.tsxの無条件マウント経路でのポーリング過大読み取りを防ぐ)', () => {
    const queryClient = new QueryClient();
    renderHook(() => useGroupStats('customer', false), { wrapper: createWrapper(queryClient) });

    const query = queryClient.getQueryCache().find({ queryKey: ['groupStats', 'customer'] });
    const options = query?.options as Record<string, unknown> | undefined;

    expect(options?.refetchInterval).toBe(false);

    queryClient.clear();
  });

  it('pollForUpdates:trueを明示指定した場合のみrefetchInterval:30000になる(useGroupDocumentListRefresh専用経路)', () => {
    const queryClient = new QueryClient();
    renderHook(() => useGroupStats('office', false, true), { wrapper: createWrapper(queryClient) });

    const query = queryClient.getQueryCache().find({ queryKey: ['groupStats', 'office'] });
    const options = query?.options as Record<string, unknown> | undefined;

    expect(options?.refetchInterval).toBe(30 * 1000);

    queryClient.clear();
  });
});

describe('ensureGroupCachePruning (GC連動pruningの境界条件、pr-test-analyzer指摘対応)', () => {
  it('"removed"以外のイベント(例: データ更新によるupdatedイベント)ではdirtyエントリを削除しない', () => {
    const queryClient = new QueryClient();
    const key = groupDocumentsQueryKey('customer', 'gc-boundary-test-marker-a', 100);
    queryClient.setQueryData(key, { pages: [], pageParams: [] });

    // markGroupDocumentsVariantsDirty呼び出し時にGCプルーニング購読(ensureGroupCachePruning)
    // が有効化される
    markGroupDocumentsVariantsDirty(queryClient);
    expect(isGroupDocumentsVariantDirty(key)).toBe(true);

    // 同じqueryKeyへの再setQueryData("updated"イベント、"removed"ではない)
    queryClient.setQueryData(key, { pages: [{ documents: [] }], pageParams: [undefined] });

    expect(isGroupDocumentsVariantDirty(key)).toBe(true);

    queryClient.clear();
  });

  it('groupDocuments以外のqueryKeyが破棄されても、groupDocumentsのdirtyエントリには影響しない', () => {
    const queryClient = new QueryClient();
    const groupKey = groupDocumentsQueryKey('customer', 'gc-boundary-test-marker-b', 100);
    const unrelatedKey = ['documentGroups', 'customer'];
    queryClient.setQueryData(groupKey, { pages: [], pageParams: [] });
    queryClient.setQueryData(unrelatedKey, []);

    markGroupDocumentsVariantsDirty(queryClient);
    expect(isGroupDocumentsVariantDirty(groupKey)).toBe(true);

    queryClient.removeQueries({ queryKey: unrelatedKey });

    expect(isGroupDocumentsVariantDirty(groupKey)).toBe(true);

    queryClient.clear();
  });

  it('複数のQueryClientインスタンスがそれぞれ独立して購読され、一方のremovedイベントがもう一方の同名キーのdirtyエントリを誤って削除しない実運用相当のケース(pr-test-analyzer Rating6指摘)', () => {
    // 注意: dirtyGroupDocumentsVariantsはモジュールレベルで全QueryClientに共有される
    // (アプリ実運用は単一QueryClientインスタンス前提、useDocumentGroups.tsのコメント参照)。
    // このテストは「片方のclientでの購読処理自体が正しく機能し、明示的にremoveした
    // queryのみが削除される」という購読機構そのものの健全性を検証する
    // (クロスclient分離までは保証しない、既知の限界としてコード側に明記済み)。
    const queryClientA = new QueryClient();
    const queryClientB = new QueryClient();
    const keyA = groupDocumentsQueryKey('customer', 'multi-client-test-marker-a', 100);
    const keyB = groupDocumentsQueryKey('office', 'multi-client-test-marker-b', 100);
    queryClientA.setQueryData(keyA, { pages: [], pageParams: [] });
    queryClientB.setQueryData(keyB, { pages: [], pageParams: [] });

    // 両方のclientそれぞれでensureGroupCachePruningがWeakSet経由で個別に購読される
    // (以前の実装はbooleanフラグで2個目以降のclientが購読漏れするバグがあった)
    markGroupDocumentsVariantsDirty(queryClientA);
    markGroupDocumentsVariantsDirty(queryClientB);
    expect(isGroupDocumentsVariantDirty(keyA)).toBe(true);
    expect(isGroupDocumentsVariantDirty(keyB)).toBe(true);

    // clientAのqueryのみ破棄 → keyAのdirtyエントリのみ削除される(clientBの購読が
    // 正しく機能していれば、keyBには影響しないはず)
    queryClientA.removeQueries({ queryKey: keyA });
    expect(isGroupDocumentsVariantDirty(keyA)).toBe(false);
    expect(isGroupDocumentsVariantDirty(keyB)).toBe(true);

    queryClientA.clear();
    queryClientB.clear();
  });
});
