/**
 * useReprocessDocument / useUpdateDocument 統合テスト (2026-08-06)
 *
 * PR #802のセカンドオピニオンレビュー(pr-test-analyzer)で、この2フックが
 * invalidateDocumentAndGroupQueriesを実際に呼び出していることを検証するテストが
 * 皆無(ヘルパー自体の単体テストのみ、useDocuments.test.ts参照)と指摘された。
 * この2フックは本PRが解消したバグ(グループ表示キャッシュinvalidate漏れ)の
 * 発生元そのものであり、ヘルパー呼び出しが将来のマージコンフリクト等で外れても
 * 検知できない穴だったため追加する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const mockGetDoc = vi.fn()
const mockDoc = vi.fn((...args: unknown[]) => ({ __ref: args }))
const mockBatchUpdate = vi.fn()
const mockBatchCommit = vi.fn().mockResolvedValue(undefined)
const mockWriteBatch = vi.fn().mockReturnValue({ update: mockBatchUpdate, commit: mockBatchCommit })
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined)

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore')
  return {
    ...actual,
    doc: (...args: unknown[]) => mockDoc(...args),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  }
})

vi.mock('../../lib/firebase', () => ({
  db: { type: 'firestore' },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { useReprocessDocument, useUpdateDocument } from '../useDocuments'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { wrapper, invalidateSpy }
}

function invalidatedKeysOf(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)
}

describe('useReprocessDocument (2026-08-06回帰テスト: グループキャッシュinvalidate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteBatch.mockReturnValue({ update: mockBatchUpdate, commit: mockBatchCommit })
  })

  it('再処理成功時、document本体・documentsInfinite・グループ系(documentGroups/groupDocuments/groupStats)を全てinvalidateする', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ data: () => ({}) }) // 親doc
      .mockResolvedValueOnce({ exists: () => false }) // detail/main
    const { wrapper, invalidateSpy } = createWrapper()
    const { result } = renderHook(() => useReprocessDocument(), { wrapper })

    const success = await act(async () => result.current.reprocess('doc-1'))

    expect(success).toBe(true)
    const invalidatedKeys = invalidatedKeysOf(invalidateSpy)
    expect(invalidatedKeys).toContainEqual(['documentsInfinite'])
    expect(invalidatedKeys).toContainEqual(['document', 'doc-1'])
    expect(invalidatedKeys).toContainEqual(['documentDetail', 'doc-1'])
    expect(invalidatedKeys).toContainEqual(['documentGroups'])
    expect(invalidatedKeys).toContainEqual(['groupDocuments'])
    expect(invalidatedKeys).toContainEqual(['groupStats'])
  })

  it('batch commit失敗時はグループキャッシュをinvalidateせずfalseを返す', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ data: () => ({}) })
      .mockResolvedValueOnce({ exists: () => false })
    mockBatchCommit.mockRejectedValueOnce(new Error('commit failed'))
    const { wrapper, invalidateSpy } = createWrapper()
    const { result } = renderHook(() => useReprocessDocument(), { wrapper })

    const success = await act(async () => result.current.reprocess('doc-err'))

    expect(success).toBe(false)
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('useUpdateDocument (2026-08-06回帰テスト: グループキャッシュinvalidate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('更新成功時、document本体・documentsInfinite・グループ系を全てinvalidateする', async () => {
    const { wrapper, invalidateSpy } = createWrapper()
    const { result } = renderHook(() => useUpdateDocument(), { wrapper })

    await act(async () =>
      result.current.mutateAsync({ documentId: 'doc-2', updates: { fileName: 'renamed.pdf' } })
    )

    await waitFor(() => {
      expect(invalidatedKeysOf(invalidateSpy)).toContainEqual(['documentGroups'])
    })
    const invalidatedKeys = invalidatedKeysOf(invalidateSpy)
    expect(invalidatedKeys).toContainEqual(['documentsInfinite'])
    expect(invalidatedKeys).toContainEqual(['document', 'doc-2'])
    expect(invalidatedKeys).toContainEqual(['groupDocuments'])
    expect(invalidatedKeys).toContainEqual(['groupStats'])
  })
})
