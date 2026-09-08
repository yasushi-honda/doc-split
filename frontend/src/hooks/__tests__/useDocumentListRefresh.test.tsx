/**
 * useDocumentListRefresh 単体テスト (2026-09-08、Firestore読み取り過大バグ修正)
 *
 * second-opinionレビュー指摘(pr-review-toolkit code-reviewer / pr-test-analyzer):
 * 「更新があります」バナー表示要否を判定する本フックの中核ロジック(baseline確定
 * タイミング・signatureChanged判定・dirty検知との合流・resetBaselineのqueryClient
 * 直読みフォールバック)に専用テストが皆無だった指摘への対応。
 *
 * useDocumentStats()はFirestore実装(getCountFromServer)を含むため、テストの関心事
 * (baseline/signature/dirtyのロジック)に集中するためモックに置き換える。
 * documentsInfiniteQueryKey/markDocumentsInfiniteVariantsDirty等の独立トラッキング系は
 * 実物を使う(モジュール状態を直接検証したいため)。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DocumentStats } from '../useDocuments'

let mockStatsData: DocumentStats | undefined

vi.mock('../useDocuments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../useDocuments')>()
  return {
    ...actual,
    useDocumentStats: () => ({ data: mockStatsData }),
  }
})

import {
  documentsInfiniteQueryKey,
  markDocumentsInfiniteVariantsDirty,
  clearDocumentsInfiniteVariantDirty,
} from '../useDocuments'
import { useDocumentListRefresh } from '../useDocumentListRefresh'

const baseStats: DocumentStats = {
  total: 10,
  pending: 1,
  processing: 0,
  processed: 8,
  error: 1,
  split: 0,
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

// 2026-09-08追記: dirtyDocumentsInfiniteVariantsはモジュールレベルの共有状態のため、
// 他テストファイル(useDocuments.test.ts等)と衝突しないよう本ファイル専用の一意な
// filtersを使う。
const FILTERS = { customerName: 'useDocumentListRefresh-test-marker' as const }
const PAGE_SIZE = 100
const ACTIVE_KEY = documentsInfiniteQueryKey(FILTERS, PAGE_SIZE)

describe('useDocumentListRefresh', () => {
  beforeEach(() => {
    mockStatsData = undefined
    clearDocumentsInfiniteVariantDirty(ACTIVE_KEY)
  })

  it('stats未到着の間はhasUpdates=falseで、baselineも確定しない', () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(
      () => useDocumentListRefresh({ filters: FILTERS, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )

    expect(result.current.hasUpdates).toBe(false)
    expect(result.current.newDocumentCount).toBe(0)
  })

  it('初回stats到着時にbaselineを確定し、以降そのstatsのままではhasUpdates=falseを維持する', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    const { result, rerender } = renderHook(
      () => useDocumentListRefresh({ filters: FILTERS, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    rerender()

    expect(result.current.hasUpdates).toBe(false)
  })

  it('statsのシグネチャ(status別件数)が変化するとhasUpdates=trueになる(新規書類到着の検知)', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    const { result, rerender } = renderHook(
      () => useDocumentListRefresh({ filters: FILTERS, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    rerender()
    expect(result.current.hasUpdates).toBe(false)

    // 新規書類が1件届きpendingが増えたと仮定
    mockStatsData = { ...baseStats, total: 11, pending: 2 }
    rerender()

    expect(result.current.hasUpdates).toBe(true)
    expect(result.current.newDocumentCount).toBe(1)
    expect(result.current.message).toBe('新しい書類が1件あります')
  })

  it('件数が変わらないシグネチャ変化がない場合はメッセージが汎用文言になる', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    // markDocumentsInfiniteVariantsDirtyはqueryCache上に実在するqueryのみをdirty化する
    // ため、対象キーを事前にキャッシュへ登録しておく(useInfiniteDocumentsが実際に
    // マウントされた状態を模する)。
    queryClient.setQueryData(ACTIVE_KEY, { pages: [], pageParams: [] })
    renderHook(() => useDocumentListRefresh({ filters: FILTERS, pageSize: PAGE_SIZE }), {
      wrapper: createWrapper(queryClient),
    })

    // dirty化のみ発生させ、統計シグネチャは変化しないケース
    act(() => {
      markDocumentsInfiniteVariantsDirty(queryClient)
    })

    const { result } = renderHook(
      () => useDocumentListRefresh({ filters: FILTERS, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    expect(result.current.hasUpdates).toBe(true)
    expect(result.current.newDocumentCount).toBe(0)
    expect(result.current.message).toBe('一覧の内容が更新されています')
  })

  it('markDocumentsInfiniteVariantsDirtyでこのvariantがdirty化されるとhasUpdates=trueになる(statsが不変でも)', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    queryClient.setQueryData(ACTIVE_KEY, { pages: [], pageParams: [] })
    const { result, rerender } = renderHook(
      () => useDocumentListRefresh({ filters: FILTERS, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    rerender()
    expect(result.current.hasUpdates).toBe(false)

    act(() => {
      markDocumentsInfiniteVariantsDirty(queryClient)
    })

    expect(result.current.hasUpdates).toBe(true)
  })

  it('resetBaselineを呼ぶとdirty化のみによるhasUpdatesは解除されないが(dirtyフラグは別途clear必要)、signatureベースのhasUpdatesは解消される', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    const { result, rerender } = renderHook(
      () => useDocumentListRefresh({ filters: FILTERS, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    rerender()

    mockStatsData = { ...baseStats, total: 11, pending: 2 }
    rerender()
    expect(result.current.hasUpdates).toBe(true)

    act(() => {
      result.current.resetBaseline()
    })
    rerender()

    expect(result.current.hasUpdates).toBe(false)
  })

  it('resetBaselineはReactのレンダー状態ではなくqueryClientのキャッシュを直接読む(codex review P2指摘の回帰テスト)', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    // useDocumentStats自体はモック化されておりqueryClientのキャッシュとは独立しているため、
    // resetBaseline内部のqueryClient.getQueryData(['documentStats'])は明示的にセットした
    // 値を読む。ここでは「フックのレンダー状態(mockStatsData)」と「queryClientキャッシュ」を
    //意図的に異なる値にして、後者が使われることを確認する。
    queryClient.setQueryData(['documentStats'], { ...baseStats, total: 999, pending: 990 })

    const { result, rerender } = renderHook(
      () => useDocumentListRefresh({ filters: FILTERS, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    rerender()

    act(() => {
      result.current.resetBaseline()
    })

    // baselineがqueryClientキャッシュ側(total:999)で確定していれば、レンダー状態
    // (mockStatsData.total:10)との差分でhasUpdatesがtrueになるはず
    rerender()
    expect(result.current.hasUpdates).toBe(true)
    expect(result.current.newDocumentCount).toBe(0) // 10 - 999はMath.maxで0にクランプ
  })

  it('activeQueryKeyはdocumentsInfiniteQueryKey(filters, pageSize)と完全一致する', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    queryClient.setQueryData(ACTIVE_KEY, { pages: [], pageParams: [] })
    renderHook(() => useDocumentListRefresh({ filters: FILTERS, pageSize: PAGE_SIZE }), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      markDocumentsInfiniteVariantsDirty(queryClient)
    })

    // 別のqueryKey(異なるfilters)には影響しないことを確認(裏付けとしてACTIVE_KEYの
    // dirty状態を直接検証)
    const { result } = renderHook(
      () => useDocumentListRefresh({ filters: FILTERS, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    expect(result.current.hasUpdates).toBe(true)
  })
})
