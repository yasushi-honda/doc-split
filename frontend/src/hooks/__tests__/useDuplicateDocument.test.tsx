/**
 * useDuplicateDocument 単体テスト (ADR-0032)
 *
 * 検証する契約:
 *   - Callable `duplicateDocumentForCustomers` を { documentId, customerIds } で呼ぶ
 *   - 成功後、書類・グループ・「N名に配信」の兄弟数のキャッシュを更新する
 *     (兄弟数 ['distributionSiblingCount', id] は staleTime 30秒のため、無効化しないと
 *      既存グループへの追加後もモーダル表示中は古い人数のまま。codex review P3)
 *   - 失敗時は更新しない(aborted のみ、サーバー側が変わった可能性があるため更新する)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/lib/firebase', () => ({ storage: {}, db: {}, functions: {}, auth: {} }))

const mockCallFunction = vi.fn()
vi.mock('@/lib/callFunction', async () => {
  const actual = await vi.importActual<typeof import('@/lib/callFunction')>('@/lib/callFunction')
  return { ...actual, callFunction: (...args: unknown[]) => mockCallFunction(...args) }
})

import { useDuplicateDocument } from '../useDuplicateDocument'

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useDuplicateDocument(), { wrapper })
  const invalidatedKeys = () => invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0])
  /** 指定キーの invalidateQueries 呼び出しに渡されたオプション(複数回呼ばれた場合は最後) */
  const invalidateOptionsFor = (key: string) =>
    invalidate.mock.calls
      .map((c) => c[0] as { queryKey: unknown[]; refetchType?: string })
      .filter((o) => o.queryKey[0] === key)
      .pop()
  return { result, invalidate, invalidatedKeys, invalidateOptionsFor }
}

function callableError(code: string): Error {
  return Object.assign(new Error(code), { code: `functions/${code}` })
}

describe('useDuplicateDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Callable を { documentId, customerIds } で呼び、レスポンスをそのまま返す', async () => {
    const response = { created: [{ customerId: 'c-a', documentId: 'src1_dup_c-a' }], skipped: [] }
    mockCallFunction.mockResolvedValue(response)
    const { result } = setup()

    let returned: unknown
    await act(async () => {
      returned = await result.current.mutateAsync({ documentId: 'src1', customerIds: ['c-a'] })
    })

    expect(returned).toEqual(response)
    expect(mockCallFunction).toHaveBeenCalledWith(
      'duplicateDocumentForCustomers',
      { documentId: 'src1', customerIds: ['c-a'] },
      expect.objectContaining({ timeout: expect.any(Number) })
    )
  })

  it('成功すると、書類・グループ・兄弟数のキャッシュを無効化する', async () => {
    mockCallFunction.mockResolvedValue({ created: [], skipped: [] })
    const { result, invalidatedKeys } = setup()

    await act(async () => {
      await result.current.mutateAsync({ documentId: 'src1', customerIds: ['c-a'] })
    })

    await waitFor(() => expect(invalidatedKeys().length).toBeGreaterThan(0))
    const keys = invalidatedKeys()
    expect(keys).toContain('document')
    expect(keys).toContain('documentGroups')
    expect(keys).toContain('groupStats')
    expect(keys).toContain('distributionSiblingCount')
  })

  it('書類一覧(documentsInfinite)は即時の全ページ再取得をさせない(refetchType: none)', async () => {
    // 即時再取得にすると、読み込み済みの全ページを再取得して Firestore の読み取りが跳ね上がる(#891型)
    mockCallFunction.mockResolvedValue({ created: [], skipped: [] })
    const { result, invalidateOptionsFor } = setup()

    await act(async () => {
      await result.current.mutateAsync({ documentId: 'src1', customerIds: ['c-a'] })
    })

    expect(invalidateOptionsFor('documentsInfinite')?.refetchType).toBe('none')
  })

  it('失敗(failed-precondition 等)ではキャッシュを無効化しない', async () => {
    mockCallFunction.mockRejectedValue(callableError('failed-precondition'))
    const { result, invalidate } = setup()

    await act(async () => {
      await expect(result.current.mutateAsync({ documentId: 'src1', customerIds: ['c-a'] })).rejects.toThrow()
    })

    expect(invalidate).not.toHaveBeenCalled()
  })

  // commit 済みなのに応答が失われうるエラー。サーバーの状態が変わっている可能性があるため画面を最新化する。
  // この Callable は aborted を返さない(Firestoreの競合リトライが尽きると internal になる)が、
  // 他の onCall と同じ分類で aborted も含める。
  for (const code of ['internal', 'deadline-exceeded', 'aborted']) {
    it(`${code}(結果が不明)では、サーバー側が変わった可能性があるため無効化する`, async () => {
      mockCallFunction.mockRejectedValue(callableError(code))
      const { result, invalidatedKeys } = setup()

      await act(async () => {
        await expect(result.current.mutateAsync({ documentId: 'src1', customerIds: ['c-a'] })).rejects.toThrow()
      })

      expect(invalidatedKeys()).toContain('distributionSiblingCount')
      expect(invalidatedKeys()).toContain('document')
    })
  }

  for (const code of ['failed-precondition', 'invalid-argument', 'not-found', 'permission-denied', 'unavailable']) {
    it(`${code}(サーバーの状態は変わっていない)では無効化しない`, async () => {
      mockCallFunction.mockRejectedValue(callableError(code))
      const { result, invalidate } = setup()

      await act(async () => {
        await expect(result.current.mutateAsync({ documentId: 'src1', customerIds: ['c-a'] })).rejects.toThrow()
      })

      expect(invalidate).not.toHaveBeenCalled()
    })
  }
})
