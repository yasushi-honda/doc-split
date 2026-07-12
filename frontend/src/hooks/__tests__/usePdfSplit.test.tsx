/**
 * useSplitPdf 単体テスト (Issue #621)
 *
 * splitPdf は already-exists (既に分割済み) / aborted (並行split競合) で失敗する場合、
 * いずれもサーバー側の状態が実際に変化した(または既に変化していた)ことを示すため、
 * onSuccess と同じキャッシュキーを invalidate して画面を最新化する必要がある。
 * それ以外のエラー(internal等)では従来通り invalidate しない。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const mockCallFunction = vi.fn()
vi.mock('@/lib/callFunction', async () => {
  const actual = await vi.importActual<typeof import('@/lib/callFunction')>('@/lib/callFunction')
  return {
    ...actual,
    callFunction: (...args: unknown[]) => mockCallFunction(...args),
  }
})

import { useSplitPdf } from '../usePdfSplit'

function makeFunctionsError(code: string, message: string): Error {
  const err = new Error(message)
  ;(err as Error & { code: string }).code = `functions/${code}`
  return err
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { wrapper, invalidateSpy }
}

const request = { documentId: 'doc-001', splitPoints: [1], segments: [] }

describe('useSplitPdf - Issue #621 already-exists/aborted時のキャッシュ無効化', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('already-exists で失敗した場合、documentsInfinite/document を invalidate する', async () => {
    mockCallFunction.mockRejectedValueOnce(
      makeFunctionsError('already-exists', "Document doc-001 has already been split (status='split')")
    )
    const { wrapper, invalidateSpy } = createWrapper()
    const { result } = renderHook(() => useSplitPdf(), { wrapper })

    result.current.mutate(request)

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['documentsInfinite'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['document'] })
  })

  it('aborted で失敗した場合、documentsInfinite/document を invalidate する', async () => {
    mockCallFunction.mockRejectedValueOnce(
      makeFunctionsError('aborted', 'splitPdf aborted: concurrent split detected (parent=doc-001 was modified since read)')
    )
    const { wrapper, invalidateSpy } = createWrapper()
    const { result } = renderHook(() => useSplitPdf(), { wrapper })

    result.current.mutate(request)

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['documentsInfinite'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['document'] })
  })

  it('internal 等の他コードで失敗した場合は invalidate しない', async () => {
    mockCallFunction.mockRejectedValueOnce(makeFunctionsError('internal', 'unexpected server error'))
    const { wrapper, invalidateSpy } = createWrapper()
    const { result } = renderHook(() => useSplitPdf(), { wrapper })

    result.current.mutate(request)

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('成功時は従来通り documentsInfinite/document を invalidate する(回帰確認)', async () => {
    mockCallFunction.mockResolvedValueOnce({ success: true, createdDocuments: ['doc-002'] })
    const { wrapper, invalidateSpy } = createWrapper()
    const { result } = renderHook(() => useSplitPdf(), { wrapper })

    result.current.mutate(request)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['documentsInfinite'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['document'] })
  })
})
