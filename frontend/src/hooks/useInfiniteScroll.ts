import { useRef, useEffect, useCallback } from 'react'

interface UseInfiniteScrollOptions {
  hasNextPage: boolean | undefined
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  threshold?: number
  /**
   * trueの間はIntersectionObserverが交差を検知してもfetchNextPageを呼ばない。
   * 2026-09-08追記(Firestore読み取り過大バグ修正、crossreview High #1): 一覧を
   * 1ページ目へリセットする処理(DocumentsPage.tsx `refreshDocumentList`)は、
   * 画面を先頭へスクロールしてからキャッシュを切り詰めるが、切り詰め完了までの
   * 一瞬でもobserverが有効なままだと、スクロール直後に末尾のsentinelが再び画面内に
   * 入り`fetchNextPage`が再発火して、切り詰めた直後にまたページが増えてしまう
   * (reset処理そのものが無意味になる)。呼び出し側がreset中はこれをtrueにして
   * observerの発火自体を止める。observerの生成/破棄ロジックは変えない
   * (disabled切替のたびに無駄な再観測が走らないようにするため)。
   */
  disabled?: boolean
}

/**
 * 無限スクロール用フック
 * IntersectionObserverでリスト末尾到達を検知し、自動で次ページを読み込む
 */
export function useInfiniteScroll({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  threshold = 0.1,
  disabled = false,
}: UseInfiniteScrollOptions) {
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !disabled) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, disabled, fetchNextPage])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          handleLoadMore()
        }
      },
      { threshold },
    )

    const current = loadMoreRef.current
    if (current) {
      observer.observe(current)
    }

    return () => {
      if (current) {
        observer.unobserve(current)
      }
    }
  }, [handleLoadMore, threshold])

  return { loadMoreRef }
}
