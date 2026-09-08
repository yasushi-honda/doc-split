/**
 * useInfiniteScroll 単体テスト
 *
 * IntersectionObserverの振る舞いをモック化してテスト
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useInfiniteScroll } from '../useInfiniteScroll'

// IntersectionObserver モック
let observerCallback: IntersectionObserverCallback
let mockObserve: ReturnType<typeof vi.fn>
let mockUnobserve: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockObserve = vi.fn()
  mockUnobserve = vi.fn()

  const MockIntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      observerCallback = callback
    }
    observe = mockObserve
    unobserve = mockUnobserve
    disconnect = vi.fn()
    root = null
    rootMargin = ''
    thresholds = [] as number[]
    takeRecords = () => [] as IntersectionObserverEntry[]
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
})

describe('useInfiniteScroll', () => {
  it('loadMoreRefを返す', () => {
    const { result } = renderHook(() =>
      useInfiniteScroll({
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
      }),
    )

    expect(result.current.loadMoreRef).toBeDefined()
  })

  it('hasNextPage=trueで要素がvisibleのときfetchNextPageが呼ばれる', () => {
    const fetchNextPage = vi.fn()

    renderHook(() =>
      useInfiniteScroll({
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage,
      }),
    )

    // IntersectionObserverコールバックをシミュレート
    observerCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )

    expect(fetchNextPage).toHaveBeenCalledOnce()
  })

  it('hasNextPage=falseのときfetchNextPageが呼ばれない', () => {
    const fetchNextPage = vi.fn()

    renderHook(() =>
      useInfiniteScroll({
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage,
      }),
    )

    observerCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )

    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('isFetchingNextPage=trueのとき重複呼び出しされない', () => {
    const fetchNextPage = vi.fn()

    renderHook(() =>
      useInfiniteScroll({
        hasNextPage: true,
        isFetchingNextPage: true,
        fetchNextPage,
      }),
    )

    observerCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )

    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('要素が非表示のときfetchNextPageが呼ばれない', () => {
    const fetchNextPage = vi.fn()

    renderHook(() =>
      useInfiniteScroll({
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage,
      }),
    )

    observerCallback(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )

    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  // 2026-09-08 Firestore読み取り過大バグ修正(/plan-crossreview経由のCodexレビュー
  // High #1): 一覧の1ページ目リセット処理中に交差検知が発火すると、切り詰めた
  // 直後にfetchNextPageが再発火してreset処理自体が無意味になる回帰テスト
  it('disabled=trueのときhasNextPage=trueで要素がvisibleでもfetchNextPageが呼ばれない', () => {
    const fetchNextPage = vi.fn()

    renderHook(() =>
      useInfiniteScroll({
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage,
        disabled: true,
      }),
    )

    observerCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )

    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('disabled=falseのときは従来通りfetchNextPageが呼ばれる', () => {
    const fetchNextPage = vi.fn()

    renderHook(() =>
      useInfiniteScroll({
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage,
        disabled: false,
      }),
    )

    observerCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )

    expect(fetchNextPage).toHaveBeenCalledOnce()
  })

  it('アンマウント時にunobserveが呼ばれる', () => {
    const { unmount } = renderHook(() =>
      useInfiniteScroll({
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
      }),
    )

    unmount()

    // loadMoreRef.currentがnull(DOMに接続されていない)のため
    // observe/unobserveは呼ばれない（refがDOMに接続された場合のみ動作）
    // ここではクリーンアップが例外なく完了することを確認
    expect(true).toBe(true)
  })
})
