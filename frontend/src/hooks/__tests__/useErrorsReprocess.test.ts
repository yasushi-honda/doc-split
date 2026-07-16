/**
 * useReprocessError (requestReprocess) 単体テスト
 *
 * code-review high指摘(CONFIRMED): 複数顧客FAX複製機能により同一fileIdを複数documentが
 * 共有しうるようになったため、fileId単独の`where('fileId','==',fileId).limit(1)`検索は
 * 兄弟docのどれかを誤って再処理・クリア対象にしてしまう恐れがあった。error記録に
 * documentIdが記録されている場合はそれを最優先で使い、fileId検索は旧error記録
 * (documentId未記録)へのフォールバックとしてのみ使う設計に修正した。本テストはその
 * 分岐を直接検証する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockGetDoc = vi.fn()
const mockGetDocs = vi.fn()
const mockDoc = vi.fn((...args: unknown[]) => ({ __ref: args }))
const mockCollection = vi.fn().mockReturnValue({ id: 'col-ref' })
const mockQuery = vi.fn().mockReturnValue({ id: 'query-ref' })
const mockWhere = vi.fn()
const mockLimit = vi.fn()
const mockBatchUpdate = vi.fn()
const mockBatchCommit = vi.fn().mockResolvedValue(undefined)
const mockWriteBatch = vi.fn().mockReturnValue({ update: mockBatchUpdate, commit: mockBatchCommit })

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    doc: (...args: unknown[]) => mockDoc(...args),
    collection: (...args: unknown[]) => mockCollection(...args),
    query: (...args: unknown[]) => mockQuery(...args),
    where: (...args: unknown[]) => mockWhere(...args),
    limit: (...args: unknown[]) => mockLimit(...args),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
  }
})

vi.mock('../../lib/firebase', () => ({
  db: { type: 'firestore' },
}))

const mockAppendReprocessClearToBatch = vi.fn().mockResolvedValue(undefined)
vi.mock('../useDocuments', () => ({
  appendReprocessClearToBatch: (...args: unknown[]) => mockAppendReprocessClearToBatch(...args),
}))

const mockInvalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  useMutation: (opts: { mutationFn: (params: unknown) => Promise<unknown> }) => ({
    mutateAsync: opts.mutationFn,
  }),
}))

import { useReprocessError } from '../useErrors'

describe('useReprocessError / requestReprocess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteBatch.mockReturnValue({ update: mockBatchUpdate, commit: mockBatchCommit })
  })

  it('documentIdが渡された場合、fileId検索を行わずdocumentIdを直接使う(複製配信の兄弟doc誤操作防止)', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true })
    const { result } = renderHook(() => useReprocessError())

    const response = await act(async () =>
      result.current.mutateAsync({ errorId: 'err-1', fileId: 'shared-file-1', documentId: 'the-actual-doc' })
    )

    expect(mockGetDoc).toHaveBeenCalledTimes(1)
    expect(mockGetDocs).not.toHaveBeenCalled()
    expect(mockAppendReprocessClearToBatch).toHaveBeenCalledWith(expect.anything(), 'the-actual-doc')
    expect(response).toEqual({ documentId: 'the-actual-doc' })
  })

  it('documentId未指定(旧error記録)の場合のみ、fileIdでの検索にフォールバックする', async () => {
    mockGetDocs.mockResolvedValue({ docs: [{ id: 'fallback-doc' }] })
    const { result } = renderHook(() => useReprocessError())

    const response = await act(async () =>
      result.current.mutateAsync({ errorId: 'err-2', fileId: 'legacy-file-1' })
    )

    expect(mockGetDocs).toHaveBeenCalledTimes(1)
    expect(mockGetDoc).not.toHaveBeenCalled()
    expect(mockAppendReprocessClearToBatch).toHaveBeenCalledWith(expect.anything(), 'fallback-doc')
    expect(response).toEqual({ documentId: 'fallback-doc' })
  })

  it('documentIdが渡されたがdocが存在しない場合、クリア対象なしでerror status更新のみ行う(クラッシュしない)', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false })
    const { result } = renderHook(() => useReprocessError())

    const response = await act(async () =>
      result.current.mutateAsync({ errorId: 'err-3', fileId: 'shared-file-1', documentId: 'deleted-doc' })
    )

    expect(mockAppendReprocessClearToBatch).not.toHaveBeenCalled()
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
    expect(response).toEqual({ documentId: null })
  })
})
