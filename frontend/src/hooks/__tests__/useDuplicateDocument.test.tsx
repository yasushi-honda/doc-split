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
  return { result, invalidate, invalidatedKeys }
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

  it('失敗(failed-precondition 等)ではキャッシュを無効化しない', async () => {
    mockCallFunction.mockRejectedValue(callableError('failed-precondition'))
    const { result, invalidate } = setup()

    await act(async () => {
      await expect(result.current.mutateAsync({ documentId: 'src1', customerIds: ['c-a'] })).rejects.toThrow()
    })

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('aborted(別の操作と競合)では、サーバー側が変わった可能性があるため無効化する', async () => {
    mockCallFunction.mockRejectedValue(callableError('aborted'))
    const { result, invalidatedKeys } = setup()

    await act(async () => {
      await expect(result.current.mutateAsync({ documentId: 'src1', customerIds: ['c-a'] })).rejects.toThrow()
    })

    expect(invalidatedKeys()).toContain('distributionSiblingCount')
  })
})
