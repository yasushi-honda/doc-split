/**
 * ドキュメントグループ取得フック
 *
 * documentGroupsコレクションからグループ一覧を取得
 * グループ内ドキュメントの無限スクロール対応
 */

import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, InfiniteData } from '@tanstack/react-query';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  startAfter,
  DocumentSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CONSTANTS } from '@shared/types';
import type { Document } from '@shared/types';

// ============================================
// 型定義
// ============================================

export type GroupType = 'customer' | 'office' | 'documentType' | 'careManager';

export interface GroupPreviewDoc {
  id: string;
  fileName: string;
  documentType: string;
  processedAt: Timestamp;
}

export interface DocumentGroup {
  id: string;
  groupType: GroupType;
  groupKey: string;
  displayName: string;
  count: number;
  latestAt: Timestamp;
  latestDocs: GroupPreviewDoc[];
  updatedAt: Timestamp;
}

export interface UseDocumentGroupsOptions {
  groupType: GroupType;
  sortBy?: 'count' | 'latestAt' | 'none';
  limitCount?: number;
  enabled?: boolean;
}

export interface UseGroupDocumentsOptions {
  groupType: GroupType;
  groupKey: string;
  pageSize?: number;
  enabled?: boolean;
}

// ============================================
// グループキー取得用のフィールドマッピング
// ============================================

const GROUP_KEY_FIELD: Record<GroupType, string> = {
  customer: 'customerKey',
  office: 'officeKey',
  documentType: 'documentTypeKey',
  careManager: 'careManagerKey',
};

// ============================================
// グループ一覧取得
// ============================================

async function fetchDocumentGroups(
  groupType: GroupType,
  sortBy: 'count' | 'latestAt' | 'none',
  limitCount: number
): Promise<DocumentGroup[]> {
  // 顧客別はクライアントソート（あいうえお順）のため orderBy/limit なしで全件取得
  const q = sortBy === 'none'
    ? query(
        collection(db, 'documentGroups'),
        where('groupType', '==', groupType)
      )
    : query(
        collection(db, 'documentGroups'),
        where('groupType', '==', groupType),
        orderBy(sortBy, 'desc'),
        limit(limitCount)
      );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  } as DocumentGroup));
}

/**
 * ドキュメントグループ一覧を取得するフック
 */
export function useDocumentGroups(options: UseDocumentGroupsOptions) {
  const {
    groupType,
    sortBy = 'count',
    limitCount = 50,
    enabled = true,
  } = options;

  return useQuery({
    queryKey: ['documentGroups', groupType, sortBy, limitCount],
    queryFn: () => fetchDocumentGroups(groupType, sortBy, limitCount),
    enabled,
    staleTime: 60 * 1000, // 1分間キャッシュ
  });
}

// ============================================
// グループ内ドキュメント取得（無限スクロール対応）
// ============================================

interface GroupDocumentsPage {
  documents: Document[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
}

/**
 * fetchGroupDocumentsのクライアントサイドフィルタ述語。
 * split除外に加え、CM未設定グループの場合はcustomerKeyが未確定
 * （pending/processing/error等でOCR未完了）の書類も除外する。これらは
 * careManagerKeyも空文字のためクエリだけでは一覧に混入するが、集計側
 * (resolveGroupKeyAndDisplayのcanFallbackToUnassigned)ではCM未設定
 * グループのcountに含まれていないため、除外しないと表示件数がcountと
 * 食い違う（Codexレビュー指摘）。
 */
export function shouldIncludeInGroupDocuments(
  data: { status?: string; customerKey?: string },
  isUnassignedCareManagerGroup: boolean
): boolean {
  if (data.status === 'split') return false;
  if (isUnassignedCareManagerGroup && !data.customerKey) return false;
  return true;
}

async function fetchGroupDocuments(
  groupType: GroupType,
  groupKey: string,
  pageSize: number,
  pageParam?: DocumentSnapshot
): Promise<GroupDocumentsPage> {
  const keyField = GROUP_KEY_FIELD[groupType];

  // documentGroups側は「CM未設定」等を予約keyで集計しているが、documents側の
  // 実データは正規化キーが空文字のまま（予約keyは書き込まれない）。予約keyで
  // クエリすると書類側と一致せず0件になるため、空文字に変換してからクエリする。
  const isUnassignedCareManagerGroup = groupKey === CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY;
  const firestoreKeyValue = isUnassignedCareManagerGroup ? '' : groupKey;

  // シンプルなクエリ（splitのフィルタリングはクライアントサイドで実施）
  // 複合インデックス: {keyField} + processedAt DESC を使用
  let q = query(
    collection(db, 'documents'),
    where(keyField, '==', firestoreKeyValue),
    orderBy('processedAt', 'desc'),
    limit(pageSize * 2) // splitを除外する余地を確保
  );

  if (pageParam) {
    q = query(q, startAfter(pageParam));
  }

  const snapshot = await getDocs(q);

  const allDocs = snapshot.docs.filter((docSnap) =>
    shouldIncludeInGroupDocuments(docSnap.data(), isUnassignedCareManagerGroup)
  );

  const hasMore = allDocs.length > pageSize;
  const docs = allDocs.slice(0, pageSize);

  const documents: Document[] = docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as Document));

  return {
    documents,
    lastDoc: docs.length > 0 ? docs[docs.length - 1] ?? null : null,
    hasMore,
  };
}

/**
 * `groupDocuments`のqueryKeyを組み立てる（`documentsInfiniteQueryKey`と同型）。
 * 外部から現在表示中variantのactiveQueryKeyを正確に組み立てるために使う
 * （dirty-tracking・reset処理の両方が必要とする）。
 */
export function groupDocumentsQueryKey(
  groupType: GroupType,
  groupKey: string,
  pageSize: number
) {
  return ['groupDocuments', groupType, groupKey, pageSize] as const;
}

/**
 * グループ内ドキュメントを取得するフック（無限スクロール対応）
 *
 * 2026-09-15 Issue #891修正: Firestore読み取り過大バグ(`documentsInfinite`と同型)を
 * 解消するため、自動再取得の経路を全て塞ぐ。詳細は`markGroupDocumentsStale`・
 * `resetGroupDocumentsToFirstPage`のコメント、および`useDocuments.ts`の
 * `useInfiniteDocuments`のコメント(同型の対策の元実装)を参照。
 */
export function useGroupDocuments(options: UseGroupDocumentsOptions) {
  const {
    groupType,
    groupKey,
    pageSize = 100,
    enabled = true,
  } = options;

  return useInfiniteQuery({
    queryKey: groupDocumentsQueryKey(groupType, groupKey, pageSize),
    queryFn: ({ pageParam }) =>
      fetchGroupDocuments(groupType, groupKey, pageSize, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.lastDoc : undefined,
    initialPageParam: undefined as DocumentSnapshot | undefined,
    enabled: enabled && !!groupKey,
    staleTime: Infinity,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}

// ============================================
// グループ統計取得
// ============================================

export interface GroupStats {
  totalGroups: number;
  totalDocuments: number;
}

async function fetchGroupStats(groupType: GroupType): Promise<GroupStats> {
  const q = query(
    collection(db, 'documentGroups'),
    where('groupType', '==', groupType)
  );

  const snapshot = await getDocs(q);

  let totalDocuments = 0;
  snapshot.docs.forEach((doc) => {
    const data = doc.data() as DocumentGroup;
    totalDocuments += data.count;
  });

  return {
    totalGroups: snapshot.size,
    totalDocuments,
  };
}

/**
 * グループ統計を取得するフック
 *
 * 2026-09-15 Issue #891修正: `useGroupDocuments`の自動再取得を全廃したため、
 * 再処理等の非同期完了(Cloud Functionsバッチ)を検知する手段が無くなった。
 * `useDocumentStats`(`refetchInterval:30000`)と同じ役割を`groupDocuments`側でも
 * 持たせるため、`useGroupDocumentListRefresh`から呼ぶ場合のみ`pollForUpdates:true`で
 * 30秒ポーリングを有効化する(このシグネチャ変化を検知シグナルとして使う)。
 *
 * **`pollForUpdates`を既定でtrueにしないこと(pr-review-toolkit:code-reviewer
 * Critical指摘、2026-09-15)**: `fetchGroupStats`は`getCountFromServer`のような
 * aggregationクエリではなく、対象groupType配下の`documentGroups`ドキュメントを
 * 毎回フル読み取り(`getDocs`)している。`GroupList.tsx`はグループタブそのものに
 * 無条件で`useGroupStats(groupType)`をマウントしており、`refetchInterval`を
 * フック本体に付与すると同じqueryKeyを共有する全呼び出し元(=タブを開いている間
 * ずっと、個別グループを1件も展開していなくても)がポーリング対象になってしまう
 * (kanameone顧客別グループは1,400件超、30秒ごとに継続的な大量読み取りが発生し、
 * 本Issue #891が解消しようとしている過大読み取り問題を別経路で再発させる)。
 * TanStack Query v5は同一queryKeyでもobserverごとに`refetchInterval`を独立して
 * 評価するため、`useGroupDocumentListRefresh`(グループ詳細展開時のみマウント)側
 * だけで有効化すれば、ポーリングは実際にグループが展開されている間だけに限定される。
 */
export function useGroupStats(groupType: GroupType, enabled = true, pollForUpdates = false) {
  return useQuery({
    queryKey: ['groupStats', groupType],
    queryFn: () => fetchGroupStats(groupType),
    enabled,
    staleTime: 60 * 1000,
    refetchInterval: pollForUpdates ? 30 * 1000 : false,
  });
}

// ============================================
// groupDocuments variant「dirty(要更新)」トラッキング
// ============================================
//
// 2026-09-15 Issue #891修正: useDocuments.tsのdocumentsInfinite版dirty-trackingと
// 同型の独立トラッキング(TanStack内部のisInvalidatedはsetQueriesData呼び出しで
// 意図せずクリアされるため信頼できない、詳細はuseDocuments.ts参照)。
//
// documentsInfinite側と異なる点: groupKeyの組み合わせ数はフィルタの組み合わせ数
// (documentsInfinite)より遥かに大きい(例: kanameone顧客別で1,400以上)。
// documentsInfinite側が採用した「フィルタ組み合わせは有限で実害なし」という
// pruning省略の判断はそのまま流用できないため、QueryCacheの'removed'イベントを
// 購読しqueryがgcTimeでキャッシュから破棄されたタイミングでdirtyエントリも
// 一緒に削除する(plan-crossreview codex pass2指摘対応)。

type GroupDirtyStoreListener = () => void

const dirtyGroupDocumentsVariants = new Set<string>()
const groupDirtyStoreListeners = new Set<GroupDirtyStoreListener>()
// QueryClientインスタンス単位で購読済みかを管理する(WeakSetで自動GC対象にする)。
// 単純なbooleanフラグだと、複数のQueryClientインスタンスが存在する場合(テスト環境で
// 各テストが独自のQueryClientを作る場合や、将来複数QueryClientが共存する場合)に、
// 最初の1つだけ購読され残りが購読されないまま「購読済み」扱いになってしまう
// (実際にテストで検出: 複数QueryClientインスタンスを跨いで発生する不具合)。
const groupCachePruningSubscribedClients = new WeakSet<QueryClient>()

function groupDirtyKeyOf(queryKey: readonly unknown[]): string {
  return JSON.stringify(queryKey)
}

function notifyGroupDirtyStoreListeners(): void {
  groupDirtyStoreListeners.forEach((listener) => listener())
}

/**
 * QueryCacheの'removed'イベントを購読し、groupDocumentsのqueryがgcTime経過で
 * キャッシュから破棄されたタイミングでdirtyエントリも削除する。QueryClient
 * インスタンスごとに1回だけ購読する。
 *
 * 既知の限界(codex review指摘、2026-09-15): `dirtyGroupDocumentsVariants`自体は
 * QueryClientをまたいだ単一のモジュール共有Setであるため、複数のQueryClient
 * インスタンスが同一queryKeyを持つ状況(このアプリの実運用では発生しない。
 * `QueryClientProvider`はルートで単一インスタンスを提供する設計)では、片方の
 * clientでのremovedイベントがもう片方がまだdirtyとして必要としているエントリを
 * 誤って削除しうる。documentsInfinite側の既存のdirty-tracking設計も同じ
 * 「単一QueryClientインスタンス」を前提としており(useDocuments.ts参照)、本実装は
 * その前提を踏襲する。複数QueryClient共存を正式にサポートする場合は、dirtyエントリの
 * キーにQueryClient自体の識別子を含める設計変更が必要。
 */
function ensureGroupCachePruning(queryClient: QueryClient): void {
  if (groupCachePruningSubscribedClients.has(queryClient)) return
  groupCachePruningSubscribedClients.add(queryClient)
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'removed') return
    const key = event.query.queryKey
    if (key[0] !== 'groupDocuments') return
    if (dirtyGroupDocumentsVariants.delete(groupDirtyKeyOf(key))) {
      notifyGroupDirtyStoreListeners()
    }
  })
}

/**
 * ['groupDocuments']部分一致の全variant(画面表示中のものを含む)をdirty化する。
 * documentsInfinite版(`markDocumentsInfiniteVariantsDirty`)と同じ理由で、
 * グループ移動の可能性がある操作は非アクティブなvariantも含め一律dirty化する
 * (呼び出し元は移動元・移動先のグループを特定できないため)。
 *
 * 例外を投げない(呼び出し元の多くはuseMutationのonSuccess内であるため、
 * documentsInfinite版と同じ理由)。
 */
export function markGroupDocumentsVariantsDirty(queryClient: QueryClient): void {
  try {
    ensureGroupCachePruning(queryClient)
    const queries = queryClient.getQueryCache().findAll({ queryKey: ['groupDocuments'] })
    let changed = false
    queries.forEach((q) => {
      const key = groupDirtyKeyOf(q.queryKey)
      if (!dirtyGroupDocumentsVariants.has(key)) {
        dirtyGroupDocumentsVariants.add(key)
        changed = true
      }
    })
    if (changed) notifyGroupDirtyStoreListeners()
  } catch (err) {
    console.error('[markGroupDocumentsVariantsDirty] unexpected error (ignored, banner UX only):', err)
  }
}

/**
 * `groupDocuments`を「即時再取得しないがstale化する」ための定型2行を1箇所に
 * まとめたヘルパー(`markDocumentsInfiniteStale`と同型)。
 */
export function markGroupDocumentsStale(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['groupDocuments'], refetchType: 'none' })
  markGroupDocumentsVariantsDirty(queryClient)
}

/**
 * 指定したqueryKeyのdirtyフラグを解除する。呼び出し側は対象variantの実際の
 * fetchが成功したことを確認してから呼ぶこと(documentsInfinite版と同じ理由:
 * refetch失敗時にフラグだけ先に解除すると「要更新」を知らせる手段が失われる)。
 */
export function clearGroupDocumentsVariantDirty(queryKey: readonly unknown[]): void {
  if (dirtyGroupDocumentsVariants.delete(groupDirtyKeyOf(queryKey))) {
    notifyGroupDirtyStoreListeners()
  }
}

export function isGroupDocumentsVariantDirty(queryKey: readonly unknown[]): boolean {
  return dirtyGroupDocumentsVariants.has(groupDirtyKeyOf(queryKey))
}

/** `useSyncExternalStore`用のsubscribe関数(`useGroupDocumentListRefresh.ts`が使用) */
export function subscribeGroupDocumentsDirtyStore(listener: GroupDirtyStoreListener): () => void {
  groupDirtyStoreListeners.add(listener)
  return () => {
    groupDirtyStoreListeners.delete(listener)
  }
}

/**
 * groupDocumentsを1ページ目のみへリセットする(`resetDocumentsInfiniteToFirstPage`と同型)。
 * バナー押下時の「更新があります」解消に使う: 進行中のfetchNextPageを破棄→
 * 全variantをstale化(dirty化)→アクティブなvariantのみpages/pageParamsを
 * 先頭1件に切り詰める。呼び出し側はこの後refetch()を実行し、成功を確認してから
 * clearGroupDocumentsVariantDirtyを呼ぶこと。
 */
export async function resetGroupDocumentsToFirstPage(
  queryClient: QueryClient,
  activeQueryKey: readonly [string, GroupType, string, number]
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: activeQueryKey })
  markGroupDocumentsStale(queryClient)
  queryClient.setQueryData(
    activeQueryKey,
    (old: InfiniteData<GroupDocumentsPage> | undefined) => {
      if (!old?.pages?.length) return old
      return {
        ...old,
        pages: old.pages.slice(0, 1),
        pageParams: old.pageParams.slice(0, 1),
      }
    }
  )
}

// ============================================
// キャッシュ無効化ユーティリティ
// ============================================

/**
 * グループ関連のキャッシュを無効化
 *
 * 2026-09-15 Issue #891修正: `groupDocuments`は`invalidateGroupQueries`
 * (`useDocuments.ts`)が唯一の呼び出し元という前提は誤りで、本フックも
 * デフォルトrefetchで`groupDocuments`をinvalidateしていた(plan-crossreview
 * codex pass2指摘)。呼び出し実績はないが公開APIである以上、同じ全ページ
 * 再取得バグを再発させないよう`markGroupDocumentsStale`へ統一する。
 */
export function useInvalidateGroups() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ['documentGroups'] });
      markGroupDocumentsStale(queryClient);
      queryClient.invalidateQueries({ queryKey: ['groupStats'] });
    },
    invalidateGroupType: (groupType: GroupType) => {
      queryClient.invalidateQueries({ queryKey: ['documentGroups', groupType] });
      queryClient.invalidateQueries({ queryKey: ['groupStats', groupType] });
    },
    invalidateGroup: (_groupType: GroupType, _groupKey: string) => {
      // 特定groupType/groupKeyへの部分invalidateではなく、全variant一律dirty化に
      // 統一する(markGroupDocumentsVariantsDirtyと同じ理由: 呼び出し元は移動元・
      // 移動先のグループを特定できないため)。引数は既存の呼び出し形を維持するため
      // 残すが未使用。
      markGroupDocumentsStale(queryClient);
    },
  };
}
