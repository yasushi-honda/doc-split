/**
 * useSettings (fetchSettings) 単体テスト(Issue #1033)
 *
 * showContractEndedCustomersは`||`ではなく`=== true`で厳密判定する(未設定とfalseを
 * 区別する必要は無いが、文字列等の誤った値をtrueとして拾わないため)。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDoc = vi.fn()
const mockDoc = vi.fn().mockReturnValue({ id: 'settings-app-ref' })

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    doc: (...args: unknown[]) => mockDoc(...args),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
  }
})

vi.mock('@/lib/firebase', () => ({
  db: { type: 'firestore' },
}))

function makeDocSnap(exists: boolean, data?: Record<string, unknown>) {
  return {
    exists: () => exists,
    data: () => data,
  }
}

describe('fetchSettings (useSettings.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ドキュメントが存在しない場合、showContractEndedCustomersはfalse', async () => {
    mockGetDoc.mockResolvedValue(makeDocSnap(false))
    const mod = await import('../useSettings')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { renderHook, waitFor } = await import('@testing-library/react')
    const React = await import('react')
    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => mod.useSettings(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.showContractEndedCustomers).toBe(false)
  })

  it('showContractEndedCustomers: trueが保存されていればtrueを返す', async () => {
    mockGetDoc.mockResolvedValue(makeDocSnap(true, { showContractEndedCustomers: true }))
    const mod = await import('../useSettings')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { renderHook, waitFor } = await import('@testing-library/react')
    const React = await import('react')
    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => mod.useSettings(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.showContractEndedCustomers).toBe(true)
  })

  it('showContractEndedCustomersが文字列"true"等の誤った値ならfalse扱いにする', async () => {
    mockGetDoc.mockResolvedValue(makeDocSnap(true, { showContractEndedCustomers: 'true' }))
    const mod = await import('../useSettings')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { renderHook, waitFor } = await import('@testing-library/react')
    const React = await import('react')
    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => mod.useSettings(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.showContractEndedCustomers).toBe(false)
  })
})
