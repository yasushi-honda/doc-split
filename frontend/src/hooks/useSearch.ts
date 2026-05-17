/**
 * ドキュメント検索フック
 *
 * searchDocuments Callable Function を呼び出して検索を実行
 * - debounce対応
 * - ページネーション対応
 * - キャッシュ対応（TanStack Query）
 */

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { callFunction } from '@/lib/callFunction';

/** 検索結果ドキュメント */
export interface SearchResultDocument {
  id: string;
  fileName: string;
  customerName: string;
  officeName: string;
  documentType: string;
  fileDate: string | null;
  score: number;
}

/** 検索結果 */
export interface SearchResult {
  documents: SearchResultDocument[];
  total: number;
  hasMore: boolean;
  /**
   * Issue #402 段階2 OOM ガード発動時のみ true。BE 側 (functions/src/search/searchDocuments.ts)
   * の SearchResult 型と同期する optional field。true のとき total = MAX_GETALL (= 取得件数)
   * で、実マッチ件数は actualMatchedCount を参照。
   */
  truncated?: boolean;
  /**
   * Issue #402 段階2 OOM ガード発動時のみ存在。truncate 前の実マッチ件数。
   * SearchBar で「上位 N 件のみ表示しています (実 M 件中)」バナー表示用 (Issue #497)。
   */
  actualMatchedCount?: number;
}

/** 検索リクエスト */
interface SearchRequest {
  query: string;
  limit?: number;
  offset?: number;
}

/** 検索フックの戻り値 */
interface UseSearchResult {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResultDocument[];
  total: number;
  hasMore: boolean;
  /**
   * Issue #402 段階2 OOM ガード発動時のみ true。SearchBar の表示判定は
   * `truncated && actualMatchedCount > 0` の AND 条件 (BE contract 違反時の防御短絡)。
   * BE が field を返さない場合は `?? false` でフォールバック。
   */
  truncated: boolean;
  /**
   * Issue #402 段階2 OOM ガード発動時のみ BE から付与される (optional)。truncate 前の
   * 実マッチ件数。FE では未発動時 / フィールド欠落時に 0 にフォールバック (`?? 0`)。
   * 0 のときは BE contract 違反として SearchBar のバナーは非表示 (上の AND 短絡)。
   */
  actualMatchedCount: number;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  search: (query: string) => void;
  loadMore: () => void;
  reset: () => void;
}

/**
 * 検索API呼び出し
 */
async function searchDocumentsApi(request: SearchRequest): Promise<SearchResult> {
  return callFunction<SearchRequest, SearchResult>(
    'searchDocuments', request, { timeout: 30_000 }
  );
}

/**
 * ドキュメント検索フック
 */
export function useSearch(): UseSearchResult {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [allResults, setAllResults] = useState<SearchResultDocument[]>([]);
  const limit = 20;

  // 検索クエリ実行
  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['search', query, offset],
    queryFn: () => searchDocumentsApi({ query, limit, offset }),
    enabled: query.length >= 2,  // 2文字以上で検索開始
    staleTime: 5 * 60 * 1000,  // 5分キャッシュ
  });

  // 検索実行
  const search = useCallback((newQuery: string) => {
    setQuery(newQuery);
    setOffset(0);
    setAllResults([]);
  }, []);

  // もっと読み込む
  const loadMore = useCallback(() => {
    if (data?.hasMore) {
      setOffset((prev) => prev + limit);
    }
  }, [data?.hasMore]);

  // リセット
  const reset = useCallback(() => {
    setQuery('');
    setOffset(0);
    setAllResults([]);
    queryClient.invalidateQueries({ queryKey: ['search'] });
  }, [queryClient]);

  // 結果を結合（ページネーション対応）
  const results = offset === 0
    ? (data?.documents || [])
    : [...allResults, ...(data?.documents || [])];

  // offsetが変わった時に結果を蓄積
  useEffect(() => {
    if (offset > 0 && data?.documents && data.documents.length > 0) {
      setAllResults((prev) => {
        if (prev.includes(data.documents[0] as SearchResultDocument)) {
          return prev;
        }
        return [...prev, ...data.documents];
      });
    }
  }, [offset, data]);

  return {
    query,
    setQuery: search,
    results,
    total: data?.total || 0,
    hasMore: data?.hasMore || false,
    truncated: data?.truncated ?? false,
    actualMatchedCount: data?.actualMatchedCount ?? 0,
    isLoading,
    isError,
    error: error as Error | null,
    search,
    loadMore,
    reset,
  };
}

/**
 * debounce付き検索フック
 */
export function useDebouncedSearch(debounceMs: number = 300): UseSearchResult {
  const searchHook = useSearch();
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const setQuery = useCallback((newQuery: string) => {
    setDebouncedQuery(newQuery);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const id = setTimeout(() => {
      searchHook.search(newQuery);
    }, debounceMs);

    setTimeoutId(id);
  }, [searchHook, debounceMs, timeoutId]);

  // リセット（debouncedQueryもクリア）
  const reset = useCallback(() => {
    setDebouncedQuery('');
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    searchHook.reset();
  }, [searchHook, timeoutId]);

  return {
    ...searchHook,
    query: debouncedQuery,
    setQuery,
    reset,
  };
}
