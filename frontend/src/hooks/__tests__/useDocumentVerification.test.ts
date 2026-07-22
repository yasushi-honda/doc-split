/**
 * useDocumentVerification 単体テスト
 *
 * ADR-0022 Phase1、code-review指摘#42対応(2026-07-22):
 * markAsUnverified が Drive エクスポート状態(driveExportStatus等)をクリアしないと、
 * 訂正のために未確認へ戻し→再確認するフローで、driveExportTrigger.tsのクレーム
 * (driveExportStatus不在のdocのみ対象)が古い'exported'値を検知してスキップされ、
 * 二度と再エクスポートされなくなる。この回帰を防ぐテスト。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { deleteField, Timestamp } from 'firebase/firestore'
import type { Document } from '../../../../shared/types'

const mockUpdateDoc = vi.fn().mockResolvedValue(undefined)
const mockDoc = vi.fn().mockReturnValue({ id: 'doc-ref' })

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    doc: (...args: unknown[]) => mockDoc(...args),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  }
})

vi.mock('../../lib/firebase', () => ({
  db: { type: 'firestore' },
  auth: {
    currentUser: {
      uid: 'user-001',
      email: 'test@example.com',
    },
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}))

vi.mock('../useDocuments', () => ({
  updateDocumentInListCache: vi.fn(),
  getDriveExportClearFields: vi.fn(() => {
    const df = deleteField()
    return {
      driveExportStatus: df,
      driveExportedAt: df,
      driveExportError: df,
      driveExportRunId: df,
    }
  }),
}))

import { useDocumentVerification } from '../useDocumentVerification'

const makeDocument = (overrides: Partial<Document> = {}): Document => ({
  id: 'doc-001',
  processedAt: Timestamp.now(),
  fileId: 'file-001',
  fileName: 'test.pdf',
  mimeType: 'application/pdf',
  ocrResult: '',
  documentType: '請求書',
  customerName: '田村 勝義',
  officeName: 'テスト事業所',
  fileUrl: 'gs://bucket/test.pdf',
  fileDate: Timestamp.now(),
  isDuplicateCustomer: false,
  totalPages: 1,
  targetPageNumber: 1,
  status: 'processed',
  verified: false,
  ...overrides,
})

describe('useDocumentVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('markAsUnverified (#42: Drive状態クリア)', () => {
    it('updateDocにDrive系4フィールド(deleteField sentinel)が含まれる', async () => {
      const doc = makeDocument({ verified: true })
      const { result } = renderHook(() => useDocumentVerification(doc))

      await act(async () => {
        await result.current.markAsUnverified()
      })

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(deleteField().isEqual(updateData.driveExportStatus as ReturnType<typeof deleteField>)).toBe(true)
      expect(deleteField().isEqual(updateData.driveExportedAt as ReturnType<typeof deleteField>)).toBe(true)
      expect(deleteField().isEqual(updateData.driveExportError as ReturnType<typeof deleteField>)).toBe(true)
      expect(deleteField().isEqual(updateData.driveExportRunId as ReturnType<typeof deleteField>)).toBe(true)
    })

    it('driveFileId は含まない(旧Driveファイルへの参照を保持する必要があるため)', async () => {
      const doc = makeDocument({ verified: true })
      const { result } = renderHook(() => useDocumentVerification(doc))

      await act(async () => {
        await result.current.markAsUnverified()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect('driveFileId' in updateData).toBe(false)
    })

    it('verified/verifiedBy/verifiedAt/updatedAtの既存フィールドも引き続き更新される(回帰防止)', async () => {
      const doc = makeDocument({ verified: true })
      const { result } = renderHook(() => useDocumentVerification(doc))

      await act(async () => {
        await result.current.markAsUnverified()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.verified).toBe(false)
      expect(updateData.verifiedBy).toBeNull()
      expect(updateData.verifiedAt).toBeNull()
      expect(updateData.updatedAt).toBe('SERVER_TIMESTAMP')
    })
  })

  describe('markAsVerified (Drive状態は触らない、変更不要範囲の確認)', () => {
    it('updateDocにDrive系フィールドを含めない(未確認→確認済みではDrive状態は既にクリア済みの前提)', async () => {
      const doc = makeDocument({ verified: false })
      const { result } = renderHook(() => useDocumentVerification(doc))

      await act(async () => {
        await result.current.markAsVerified()
      })

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect('driveExportStatus' in updateData).toBe(false)
      expect('driveExportedAt' in updateData).toBe(false)
      expect('driveExportError' in updateData).toBe(false)
      expect('driveExportRunId' in updateData).toBe(false)
    })
  })
})
