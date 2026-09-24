/**
 * useCustomers / useCustomerMasters queryKey統合の回帰テスト(Issue #1033、/plan-crossreview codex指摘P1)
 *
 * useMasters.tsのuseCustomers()とuseDocuments.tsのuseCustomerMasters()は同じqueryKey
 * ['masters','customers']を共有している。以前は別々の取得関数(フィールド構成が異なる)を
 * 使っていたため、PdfSplitModal(useCustomerMasters呼出元)が先にキャッシュを埋めると
 * isContractEndedが欠落する恐れがあった。fetchCustomers(useMasters.ts)へ一本化した後、
 * どちらから先に読んでもisContractEndedが含まれることを確認する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDocs = vi.fn()
const mockCollection = vi.fn().mockReturnValue({ id: 'customers-ref' })

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    collection: (...args: unknown[]) => mockCollection(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
  }
})

vi.mock('@/lib/firebase', () => ({
  db: { type: 'firestore' },
}))

function makeSnapshot() {
  return {
    docs: [
      {
        id: 'c1',
        data: () => ({ name: '契約終了太郎', furigana: 'ケイヤクシュウリョウタロウ', isContractEnded: true }),
      },
    ],
  }
}

describe('useCustomers / useCustomerMasters queryKey統合', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDocs.mockResolvedValue(makeSnapshot())
  })

  it('useCustomerMasters(useDocuments.ts)が先にキャッシュを埋めても、useCustomers(useMasters.ts)の結果にisContractEndedが含まれる', async () => {
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { renderHook, waitFor } = await import('@testing-library/react')
    const React = await import('react')
    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const docsMod = await import('../useDocuments')
    const mastersMod = await import('../useMasters')

    // useCustomerMasters(useDocuments.ts側)を先にマウントしてキャッシュを埋める
    const first = renderHook(() => docsMod.useCustomerMasters(), { wrapper })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))

    // useCustomers(useMasters.ts側)は同じキャッシュを読む
    const second = renderHook(() => mastersMod.useCustomers(), { wrapper })
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))

    expect(mockGetDocs).toHaveBeenCalledTimes(1) // キャッシュ共有により再フェッチしない
    expect(second.result.current.data?.[0]?.isContractEnded).toBe(true)
  })
})
