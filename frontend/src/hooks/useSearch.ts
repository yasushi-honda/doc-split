/**
 * ドキュメント検索フック
 *
 * searchDocuments Callable Function を呼び出して検索を実行
 * - debounce対応
 * - ページネーション対応
 * - キャッシュ対応（TanStack Query）
 */

import { useState, useCallback } from 'react';
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
  if (offset > 0 && data?.documents && !allResults.includes(data.documents[0] as SearchResultDocument)) {
    setAllResults(results);
  }

  return {
    query,
    setQuery: search,
    results,
    total: data?.total || 0,
    hasMore: data?.hasMore || false,
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
