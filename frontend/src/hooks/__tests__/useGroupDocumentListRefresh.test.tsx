/**
 * useGroupDocumentListRefresh 単体テスト (2026-09-15、Issue #891修正)
 *
 * `useDocumentListRefresh.test.tsx`のgroupDocuments版。`useGroupStats()`はFirestore
 * 実装(getDocs)を含むため、テストの関心事(baseline/signature/dirtyのロジック)に
 * 集中するためモックに置き換える。groupDocumentsQueryKey/markGroupDocumentsVariantsDirty
 * 等の独立トラッキング系は実物を使う(モジュール状態を直接検証したいため)。
 *
 * plan-crossreview(codex pass2)指摘対応の回帰テストを含む: dirtyフラグ単独では
 * 非同期完了(OCR等)を再検知できない問題を、groupStatsのシグネチャ変化(30秒
 * ポーリング相当)で検知できることを確認する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { GroupStats } from '../useDocumentGroups'

let mockStatsData: GroupStats | undefined

vi.mock('../useDocumentGroups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../useDocumentGroups')>()
  return {
    ...actual,
    useGroupStats: () => ({ data: mockStatsData }),
  }
})

import {
  groupDocumentsQueryKey,
  markGroupDocumentsVariantsDirty,
  clearGroupDocumentsVariantDirty,
} from '../useDocumentGroups'
import { useGroupDocumentListRefresh } from '../useGroupDocumentListRefresh'

const baseStats: GroupStats = {
  totalGroups: 5,
  totalDocuments: 42,
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

// dirtyGroupDocumentsVariantsはモジュールレベルの共有状態のため、他テストと
// 衝突しないよう本ファイル専用の一意なgroupKeyを使う。
const GROUP_TYPE = 'customer' as const
const GROUP_KEY = 'useGroupDocumentListRefresh-test-marker'
const PAGE_SIZE = 100
const ACTIVE_KEY = groupDocumentsQueryKey(GROUP_TYPE, GROUP_KEY, PAGE_SIZE)

describe('useGroupDocumentListRefresh', () => {
  beforeEach(() => {
    mockStatsData = undefined
    clearGroupDocumentsVariantDirty(ACTIVE_KEY)
  })

  it('stats未到着の間はhasUpdates=falseで、baselineも確定しない', () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(
      () => useGroupDocumentListRefresh({ groupType: GROUP_TYPE, groupKey: GROUP_KEY, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )

    expect(result.current.hasUpdates).toBe(false)
  })

  it('初回stats到着時にbaselineを確定し、以降そのstatsのままではhasUpdates=falseを維持する', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    const { result, rerender } = renderHook(
      () => useGroupDocumentListRefresh({ groupType: GROUP_TYPE, groupKey: GROUP_KEY, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    rerender()

    expect(result.current.hasUpdates).toBe(false)
  })

  it('groupStatsのシグネチャが変化するとhasUpdates=trueになる(非同期完了の検知、codex pass2回帰テスト)', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    const { result, rerender } = renderHook(
      () => useGroupDocumentListRefresh({ groupType: GROUP_TYPE, groupKey: GROUP_KEY, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    rerender()
    expect(result.current.hasUpdates).toBe(false)

    // dirtyフラグを一切立てず(=invalidateGroupQueriesを経由しない非同期完了を模す)、
    // groupStatsの集計値のみが変化したケース
    mockStatsData = { ...baseStats, totalDocuments: 43 }
    rerender()

    expect(result.current.hasUpdates).toBe(true)
    expect(result.current.message).toBe('一覧の内容が更新されています')
  })

  it('markGroupDocumentsVariantsDirtyでこのvariantがdirty化されるとhasUpdates=trueになる(statsが不変でも)', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    queryClient.setQueryData(ACTIVE_KEY, { pages: [], pageParams: [] })
    const { result, rerender } = renderHook(
      () => useGroupDocumentListRefresh({ groupType: GROUP_TYPE, groupKey: GROUP_KEY, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    rerender()
    expect(result.current.hasUpdates).toBe(false)

    act(() => {
      markGroupDocumentsVariantsDirty(queryClient)
    })

    expect(result.current.hasUpdates).toBe(true)
  })

  it('resetBaselineはstatsベースのhasUpdatesのみ解消し、dirtyフラグは別途clearが必要', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    const { result, rerender } = renderHook(
      () => useGroupDocumentListRefresh({ groupType: GROUP_TYPE, groupKey: GROUP_KEY, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    rerender()

    mockStatsData = { ...baseStats, totalDocuments: 43 }
    rerender()
    expect(result.current.hasUpdates).toBe(true)

    act(() => {
      result.current.resetBaseline()
    })
    rerender()

    expect(result.current.hasUpdates).toBe(false)
  })

  it('activeQueryKeyはgroupDocumentsQueryKey(groupType, groupKey, pageSize)と完全一致する', () => {
    mockStatsData = baseStats
    const queryClient = new QueryClient()
    queryClient.setQueryData(ACTIVE_KEY, { pages: [], pageParams: [] })
    renderHook(
      () => useGroupDocumentListRefresh({ groupType: GROUP_TYPE, groupKey: GROUP_KEY, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )

    act(() => {
      markGroupDocumentsVariantsDirty(queryClient)
    })

    const { result } = renderHook(
      () => useGroupDocumentListRefresh({ groupType: GROUP_TYPE, groupKey: GROUP_KEY, pageSize: PAGE_SIZE }),
      { wrapper: createWrapper(queryClient) }
    )
    expect(result.current.hasUpdates).toBe(true)
  })
})
