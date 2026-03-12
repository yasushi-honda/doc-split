/**
 * useDocumentEdit 単体テスト
 *
 * TDD: #171 顧客手動選択時にcareManagerが自動補完されない
 * - EditableFieldsにcareManagerが含まれること
 * - saveChangesでcareManagerが更新データに含まれること
 * - careManager変更が監査ログに記録されること
 * - ロールバック時にcareManagerが復元されること
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Timestamp } from 'firebase/firestore'
import type { Document } from '../../../../shared/types'

// Firebase mocks
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined)
const mockAddDoc = vi.fn().mockResolvedValue({ id: 'log-001' })
const mockDoc = vi.fn().mockReturnValue({ id: 'doc-ref' })
const mockCollection = vi.fn().mockReturnValue({ id: 'col-ref' })

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    doc: (...args: unknown[]) => mockDoc(...args),
    collection: (...args: unknown[]) => mockCollection(...args),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
    addDoc: (...args: unknown[]) => mockAddDoc(...args),
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

const mockInvalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}))

vi.mock('../useDocuments', () => ({
  updateDocumentInListCache: vi.fn(),
}))

import { useDocumentEdit } from '../useDocumentEdit'

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
  careManager: undefined,
  careManagerKey: '',
  ...overrides,
})

describe('useDocumentEdit - careManager自動補完', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('editedFieldsにcareManagerが含まれる', () => {
    it('startEditingでcareManagerの初期値がセットされる', () => {
      const doc = makeDocument({ careManager: '長谷川 由紀' })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())

      expect(result.current.editedFields.careManager).toBe('長谷川 由紀')
    })

    it('careManagerが未設定の場合は空文字がセットされる', () => {
      const doc = makeDocument({ careManager: undefined })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())

      expect(result.current.editedFields.careManager).toBe('')
    })

    it('updateFieldでcareManagerを更新できる', () => {
      const doc = makeDocument()
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('careManager', '長谷川 由紀'))

      expect(result.current.editedFields.careManager).toBe('長谷川 由紀')
    })
  })

  describe('saveChangesでcareManagerが保存される', () => {
    it('careManagerが変更された場合、Firestoreに保存される', async () => {
      const doc = makeDocument({ careManager: undefined })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('careManager', '長谷川 由紀'))

      let success: boolean = false
      await act(async () => {
        success = await result.current.saveChanges()
      })

      expect(success).toBe(true)
      // updateDocの第2引数に careManager が含まれている
      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.careManager).toBe('長谷川 由紀')
      expect(updateData.careManagerKey).toBe('長谷川 由紀')
    })

    it('careManager変更が監査ログに記録される', async () => {
      const doc = makeDocument({ careManager: undefined })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('careManager', '長谷川 由紀'))

      await act(async () => {
        await result.current.saveChanges()
      })

      // addDocが careManager の変更ログを含んでいる
      const logCalls = mockAddDoc.mock.calls
      const careManagerLog = logCalls.find(
        (call: unknown[]) => (call[1] as Record<string, unknown>)?.fieldName === 'careManager'
      ) as unknown[] | undefined
      expect(careManagerLog).toBeDefined()
      expect((careManagerLog![1] as Record<string, unknown>).oldValue).toBeNull()
      expect((careManagerLog![1] as Record<string, unknown>).newValue).toBe('長谷川 由紀')
    })

    it('careManagerが変更されていない場合は保存に含まれない', async () => {
      const doc = makeDocument({ careManager: '板垣 亜紀子' })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      // careManagerは変更しない、他のフィールドを変更
      act(() => result.current.updateField('documentType', '実績'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.careManager).toBeUndefined()
    })
  })

  describe('ロールバック', () => {
    it('Firestore書き込み失敗時にcareManagerがロールバックされる', async () => {
      mockUpdateDoc.mockRejectedValueOnce(new Error('write failed'))
      const doc = makeDocument({ careManager: '板垣 亜紀子', careManagerKey: '板垣亜紀子' })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('careManager', '長谷川 由紀'))

      await act(async () => {
        await result.current.saveChanges()
      })

      // updateDocumentInListCacheが2回呼ばれる（楽観的更新 + ロールバック）
      const { updateDocumentInListCache } = await import('../useDocuments')
      const calls = vi.mocked(updateDocumentInListCache).mock.calls
      expect(calls.length).toBe(2)
      // 2回目（ロールバック）でcareManagerが元の値に復元
      const rollbackData = calls[1]?.[2] as Record<string, unknown>
      expect(rollbackData.careManager).toBe('板垣 亜紀子')
      expect(rollbackData.careManagerKey).toBe('板垣亜紀子')
    })
  })
})
