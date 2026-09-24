/**
 * updateCustomer 単体テスト(Issue #1033)
 *
 * CLAUDE.md MUST: DB Partial Update関数の追加/変更 → 更新対象外フィールドが不変であることを
 * テストに含める。isContractEndedが未指定のときは送信データにキー自体が含まれないこと、
 * 指定時のみ含まれることを確認する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpdateDoc = vi.fn()
const mockDoc = vi.fn().mockReturnValue({ id: 'customer-ref' })

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    doc: (...args: unknown[]) => mockDoc(...args),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  }
})

vi.mock('@/lib/firebase', () => ({
  db: { type: 'firestore' },
}))

describe('updateCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateDoc.mockResolvedValue(undefined)
  })

  it('isContractEnded未指定なら送信データにキーが含まれない', async () => {
    const { useUpdateCustomer } = await import('../useMasters')
    void useUpdateCustomer

    const mod = await import('../useMasters')
    // updateCustomerはexportされていないため、useUpdateCustomerのmutationFn経由で検証する
    const { QueryClient } = await import('@tanstack/react-query')
    const { renderHook, act } = await import('@testing-library/react')
    const React = await import('react')
    const { QueryClientProvider } = await import('@tanstack/react-query')

    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => mod.useUpdateCustomer(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        id: 'c1',
        name: '田中太郎',
        furigana: 'タナカタロウ',
        isDuplicate: false,
      })
    })

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
    const [, data] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>]
    expect('isContractEnded' in data).toBe(false)
    // 対象外フィールドaliasesも送信されない
    expect('aliases' in data).toBe(false)
  })

  it('isContractEnded指定時は送信データに含まれる', async () => {
    const mod = await import('../useMasters')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { renderHook, act } = await import('@testing-library/react')
    const React = await import('react')

    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => mod.useUpdateCustomer(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        id: 'c1',
        name: '田中太郎',
        furigana: 'タナカタロウ',
        isDuplicate: false,
        isContractEnded: true,
      })
    })

    const [, data] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(data.isContractEnded).toBe(true)
  })
})
