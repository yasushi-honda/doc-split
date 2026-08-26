/**
 * useDocumentStats 単体テスト (Issue #816)
 *
 * fetchDocumentStats() は従来 getDocs()(全件フェッチ)×5並列で `.size` を数えるだけの
 * 実装だったため、processedステータスの累積件数が多いほど全文書データをダウンロードして
 * しまい、TOP画面ロード毎(+30秒毎の自動再取得)に不要な通信コストが発生していた。
 * getCountFromServer() ベースの集計クエリへ置き換えたことを固定する回帰テスト。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const mockGetCountFromServer = vi.fn()
const mockGetDocs = vi.fn()

// collection/query/where は実SDKだとFirestoreインスタンスの型検証で失敗する(fake dbのため)。
// 本テストはクエリの中身ではなく「getDocs()ではなくgetCountFromServer()が呼ばれること」と
// 「集計結果」のみ検証するため、パススルーの薄いstubで置き換える。
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  query: vi.fn((...args: unknown[]) => ({ args })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  getCountFromServer: (...args: unknown[]) => mockGetCountFromServer(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}))

vi.mock('@/lib/firebase', () => ({
  db: { type: 'firestore' },
}))

import { useDocumentStats } from '../useDocuments'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return wrapper
}

describe('useDocumentStats — getCountFromServer化 (Issue #816)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getDocs()ではなくgetCountFromServer()で件数を取得する(全件フェッチ回帰防止)', async () => {
    // fetchDocumentStats()内のPromise.all(statuses.map(...))は、statuses配列
    // ['pending','processing','processed','error','split']の順でgetCountFromServer()を
    // 同期的に呼び出す(各async関数本体は最初のawaitまで即時実行される)ため、呼び出し順が
    // 決定的であることを前提にできる。
    const counts = [1, 2, 100, 3, 4] // pending, processing, processed, error, split
    let callIndex = 0
    mockGetCountFromServer.mockImplementation(() => {
      const count = counts[callIndex]
      callIndex++
      return Promise.resolve({ data: () => ({ count }) })
    })

    const { result } = renderHook(() => useDocumentStats(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockGetDocs).not.toHaveBeenCalled()
    expect(mockGetCountFromServer).toHaveBeenCalledTimes(5)
    expect(result.current.data).toEqual({
      total: 1 + 2 + 100 + 3 + 4,
      pending: 1,
      processing: 2,
      processed: 100,
      error: 3,
      split: 4,
    })
  })
})
