/**
 * useSetCustomerContractEnded 単体テスト
 *
 * 全スタッフ開放の書き込み経路。Firestoreルールは isContractEnded 以外のキーを含む更新を拒否するため、
 * 送信データが { isContractEnded } のみであること(updatedAt等の混入で本番だけ権限エラーになる回帰の防止)
 * と、成功・失敗のどちらでも顧客マスターのキャッシュを取り直すことを固定する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act } from '@testing-library/react'

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

import { useSetCustomerContractEnded } from '../useMasters'

function setup() {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  const { result } = renderHook(() => useSetCustomerContractEnded(), { wrapper })
  return { result, invalidate }
}

describe('useSetCustomerContractEnded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateDoc.mockResolvedValue(undefined)
  })

  it('送信データは isContractEnded のみで、対象顧客のドキュメントを指す', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.mutateAsync({ id: 'c1', isContractEnded: true })
    })
    expect(mockDoc).toHaveBeenCalledWith({ type: 'firestore' }, expect.stringContaining('customers'), 'c1')
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
    const [, data] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(data).toEqual({ isContractEnded: true })
  })

  it('契約中に戻す場合は false を送る', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.mutateAsync({ id: 'c1', isContractEnded: false })
    })
    const [, data] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(data).toEqual({ isContractEnded: false })
  })

  it('成功しても失敗しても顧客マスターのキャッシュを無効化する', async () => {
    const { result, invalidate } = setup()
    await act(async () => {
      await result.current.mutateAsync({ id: 'c1', isContractEnded: true })
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['masters', 'customers'] })

    invalidate.mockClear()
    mockUpdateDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'c1', isContractEnded: true })).rejects.toThrow('denied')
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['masters', 'customers'] })
  })
})
