/**
 * appendReprocessClearToBatch 単体テスト (GOAL.md task 6-2, PR-C)
 *
 * distributionId保持doc(複製元・複製コピー)の再処理時、customerId/customerName/
 * customerConfirmed/careManagerがクリア対象から除外されることを検証する。
 * BE側(functions/src/ocr/confirmedFieldMerge.ts)の既存confirmed保護マージが
 * customerConfirmed:trueのまま機能する前提を崩さないための分岐。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WriteBatch } from 'firebase/firestore'

const mockGetDoc = vi.fn()
const mockDoc = vi.fn((...args: unknown[]) => ({ __ref: args }))
const mockBatchUpdate = vi.fn()

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    doc: (...args: unknown[]) => mockDoc(...args),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
  }
})

vi.mock('../../lib/firebase', () => ({
  db: { type: 'firestore' },
}))

import { appendReprocessClearToBatch } from '../useDocuments'

describe('appendReprocessClearToBatch', () => {
  const batch = { update: mockBatchUpdate } as unknown as WriteBatch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('distributionId保持docは customerId/customerName/customerConfirmed/careManager をクリア対象から除外し、true を返す', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ data: () => ({ distributionId: 'orig-doc-1' }) }) // 親doc
      .mockResolvedValueOnce({ exists: () => false }) // detail/main
    const hasDistributionId = await appendReprocessClearToBatch(batch, 'doc-1')

    expect(hasDistributionId).toBe(true)
    const [, updatePayload] = mockBatchUpdate.mock.calls[0]!
    expect(updatePayload).not.toHaveProperty('customerId')
    expect(updatePayload).not.toHaveProperty('customerName')
    expect(updatePayload).not.toHaveProperty('careManager')
    expect(updatePayload).not.toHaveProperty('customerConfirmed')
    // 顧客系以外は通常どおりクリア対象に含む
    expect(updatePayload).toHaveProperty('officeId')
    expect(updatePayload.officeConfirmed).toBe(false)
    expect(updatePayload.status).toBe('pending')
  })

  it('distributionId未保持docは通常どおり全顧客フィールドをクリア対象に含め、false を返す', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ data: () => ({}) })
      .mockResolvedValueOnce({ exists: () => false })
    const hasDistributionId = await appendReprocessClearToBatch(batch, 'doc-2')

    expect(hasDistributionId).toBe(false)
    const [, updatePayload] = mockBatchUpdate.mock.calls[0]!
    expect(updatePayload).toHaveProperty('customerId')
    expect(updatePayload).toHaveProperty('customerName')
    expect(updatePayload).toHaveProperty('careManager')
    expect(updatePayload.customerConfirmed).toBe(false)
  })

  it('distributionIdが空文字の場合は保持doc扱いしない(異常系)', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ data: () => ({ distributionId: '' }) })
      .mockResolvedValueOnce({ exists: () => false })
    const hasDistributionId = await appendReprocessClearToBatch(batch, 'doc-3')

    expect(hasDistributionId).toBe(false)
  })

  it('detail/mainが存在する場合、detailクリアもbatchに積む', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ data: () => ({}) })
      .mockResolvedValueOnce({ exists: () => true })
    await appendReprocessClearToBatch(batch, 'doc-4')

    expect(mockBatchUpdate).toHaveBeenCalledTimes(2)
  })

  it('detail/mainが不在の場合、detailクリアはbatchに積まない', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ data: () => ({}) })
      .mockResolvedValueOnce({ exists: () => false })
    await appendReprocessClearToBatch(batch, 'doc-5')

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1)
  })
})
