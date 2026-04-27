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

    // AC5 強化（Codex 指摘 R1 対応）: マスタ外既存値の保持
    // caremanagers マスタに登録されていない既存値（例: 過去取り込み時の手書きデータ）
    // が入っている書類で、他項目だけ編集して保存したときに、careManager の値が
    // 空クリアされたり書き換えられたりしないことを保証する。
    // 注: 実装上、careManagerKey は editedFields 経由で再書き込みされるが
    // 元値と同じ値が書かれるため値は不変（実害なし）。
    it('マスタ外既存値の書類で書類日付のみ編集 → careManager 値が保持される', async () => {
      const doc = makeDocument({
        careManager: 'マスタ未登録CM太郎',
        careManagerKey: 'マスタ未登録CM太郎',
        fileDate: Timestamp.fromDate(new Date('2026-01-01')),
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      // 書類日付のみ変更、careManager は触らない
      act(() => result.current.updateField('fileDate', new Date('2026-02-15')))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.fileDate).toBeInstanceOf(Date)
      // careManager フィールド自体は updateData に含まれない（変更されていないため）
      expect('careManager' in updateData).toBe(false)
      // careManagerKey は再書き込みされるが値は元と同じ（実害なし）
      expect(updateData.careManagerKey).toBe('マスタ未登録CM太郎')
    })

    // AC6 補強: 既存 careManager から明示的に空に変更したケース
    // 「担当ケアマネを削除する」操作（例: マスタ外値を消去したい）の境界値。
    // editLogs には oldValue=元値, newValue=null が記録される。
    it('既存 careManager を空文字に変更 → updateData/editLogs に正しく反映される', async () => {
      const doc = makeDocument({ careManager: '板垣 亜紀子' })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('careManager', ''))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.careManager).toBe('')
      expect(updateData.careManagerKey).toBe('')

      const careManagerLog = mockAddDoc.mock.calls.find(
        (call: unknown[]) => (call[1] as Record<string, unknown>)?.fieldName === 'careManager'
      ) as unknown[] | undefined
      expect(careManagerLog).toBeDefined()
      expect((careManagerLog![1] as Record<string, unknown>).oldValue).toBe('板垣 亜紀子')
      expect((careManagerLog![1] as Record<string, unknown>).newValue).toBeNull()
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

// ============================================
// 確定フラグ更新（Issue #396）
// ============================================
// 編集モーダルで顧客名・事業所名を選択して保存したとき、確定フラグ
// (customerConfirmed/officeConfirmed/needsManualCustomerSelection) を
// 適切に更新することを検証する。
//
// Acceptance Criteria（PR #397 で定義）:
// - AC1:   有効な顧客名選択 → customerConfirmed=true & needsManualCustomerSelection=false
// - AC2:   有効な事業所名選択 → officeConfirmed=true + officeConfirmedBy=uid + officeConfirmedAt
// - AC3:   invalid sentinel 選択 → 確定フラグを書き込まない
// - AC3.5: 既存 confirmed=true を invalid 値で false に上書きしない（regression 防止）
// - AC4:   既に両方 confirmed=true & 変更なし保存 → updateDoc/cache 更新/監査ログ全て呼ばれない
// - AC5:   confirmed=false の有効ドキュメント、変更なし保存 → 確定フラグのみ書き込み
// - AC5.5: optimisticData にも確定フラグを反映
// - AC6/7: dev 環境ホーム画面/編集モーダルの目視確認（テスト対象外、PR Test plan 参照）
// - AC8:   Firestore 書き込み失敗時、optimistic で立てた確定フラグをロールバック
// - AC9:   invalid 値・downgrade attempt の挙動 pin（review-pr 指摘 T2/T3/T4 対応）
// - AC10:  rollback 対称性 — optimistic で書き込んだ全 key が rollback で復元される（drift 防止）

describe('useDocumentEdit - 確定フラグ更新 (#396)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AC1: 有効な顧客名選択時は customerConfirmed=true を書き込む', () => {
    it('customerName を有効値に変更 → customerConfirmed=true & needsManualCustomerSelection=false', async () => {
      const doc = makeDocument({
        customerName: '未判定',
        customerConfirmed: false,
        needsManualCustomerSelection: true,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('customerName', '河野 文江'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.customerConfirmed).toBe(true)
      expect(updateData.needsManualCustomerSelection).toBe(false)
    })
  })

  describe('AC2: 有効な事業所名選択時は officeConfirmed=true + By/At を書き込む', () => {
    it('officeName を有効値に変更 → officeConfirmed=true & officeConfirmedBy=uid & officeConfirmedAt=serverTimestamp', async () => {
      const doc = makeDocument({
        officeName: '未判定',
        officeConfirmed: false,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('officeName', 'ケアサポートきらり'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.officeConfirmed).toBe(true)
      expect(updateData.officeConfirmedBy).toBe('user-001')
      expect(updateData.officeConfirmedAt).toBe('SERVER_TIMESTAMP')
    })
  })

  describe('AC3: invalid 値選択時はフラグを書き込まない', () => {
    it.each([
      ['空文字', ''],
      ['未判定', '未判定'],
      ['不明顧客', '不明顧客'],
    ])('customerName を "%s" に変更 → customerConfirmed が updateData に含まれない', async (_label, invalidValue) => {
      const doc = makeDocument({
        customerName: '田村 勝義',
        customerConfirmed: false,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('customerName', invalidValue))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.customerConfirmed).toBeUndefined()
      expect(updateData.needsManualCustomerSelection).toBeUndefined()
    })

    it.each([
      ['空文字', ''],
      ['未判定', '未判定'],
      ['不明事業所', '不明事業所'],
    ])('officeName を "%s" に変更 → officeConfirmed が updateData に含まれない', async (_label, invalidValue) => {
      const doc = makeDocument({
        officeName: 'テスト事業所',
        officeConfirmed: false,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('officeName', invalidValue))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.officeConfirmed).toBeUndefined()
      expect(updateData.officeConfirmedBy).toBeUndefined()
      expect(updateData.officeConfirmedAt).toBeUndefined()
    })
  })

  describe('AC3.5: 既存 confirmed=true を invalid 値で false に戻さない', () => {
    it('customerConfirmed=true のドキュメントで invalid 値選択 → customerConfirmed が updateData に含まれない', async () => {
      const doc = makeDocument({
        customerName: '田村 勝義',
        customerConfirmed: true,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('customerName', '未判定'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      // customerConfirmed が updateData に含まれない（false に上書きされない）
      expect('customerConfirmed' in updateData).toBe(false)
    })

    it('officeConfirmed=true のドキュメントで invalid 値選択 → officeConfirmed/By/At が updateData に含まれない', async () => {
      const doc = makeDocument({
        officeName: 'テスト事業所',
        officeConfirmed: true,
        officeConfirmedBy: 'previous-user',
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('officeName', '未判定'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect('officeConfirmed' in updateData).toBe(false)
      expect('officeConfirmedBy' in updateData).toBe(false)
      expect('officeConfirmedAt' in updateData).toBe(false)
    })
  })

  describe('AC4: 既に両方 confirmed=true で変更なし保存 → updateDoc 呼ばない', () => {
    it('両方 confirmed=true、編集モードを開いて何も変更せず保存 → updateDoc/cache/監査ログ全て呼ばれない', async () => {
      const doc = makeDocument({
        customerName: '田村 勝義',
        customerConfirmed: true,
        officeName: 'テスト事業所',
        officeConfirmed: true,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())

      await act(async () => {
        await result.current.saveChanges()
      })

      // early-return が cache 更新前に走っていることを保証（AC4 強化、review-pr T1）
      expect(mockUpdateDoc).not.toHaveBeenCalled()
      expect(mockAddDoc).not.toHaveBeenCalled()
      const { updateDocumentInListCache } = await import('../useDocuments')
      expect(updateDocumentInListCache).not.toHaveBeenCalled()
    })
  })

  describe('AC5: customerConfirmed=false で変更なし保存（現在値が有効）→ confirmed のみ書き込み', () => {
    it('既存 needsManualCustomerSelection=true のドキュメント、変更なし保存 → customerConfirmed=true & needsManualCustomerSelection=false', async () => {
      const doc = makeDocument({
        customerName: '田村 勝義',
        customerConfirmed: false,
        needsManualCustomerSelection: true,  // 既存値あり → 同期更新対象
        officeName: 'テスト事業所',
        officeConfirmed: true,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())

      await act(async () => {
        await result.current.saveChanges()
      })

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.customerConfirmed).toBe(true)
      expect(updateData.needsManualCustomerSelection).toBe(false)
      expect('officeConfirmed' in updateData).toBe(false)
      expect(mockAddDoc).not.toHaveBeenCalled()
    })

    it('needsManualCustomerSelection=undefined のドキュメント、変更なし保存 → customerConfirmed=true のみ書き込み（needsManualCustomerSelection は新規作成しない）', async () => {
      const doc = makeDocument({
        customerName: '田村 勝義',
        customerConfirmed: false,
        // needsManualCustomerSelection: undefined（明示しない）
        officeName: 'テスト事業所',
        officeConfirmed: true,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())

      await act(async () => {
        await result.current.saveChanges()
      })

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.customerConfirmed).toBe(true)
      // 新規フィールドを生成しない（不要な書き込みを避ける）
      expect('needsManualCustomerSelection' in updateData).toBe(false)
    })
  })

  describe('AC8: Firestore 書き込み失敗時、確定フラグもロールバックされる', () => {
    it('customerConfirmed のロールバック: write 失敗 → optimisticData の true を元の false に復元', async () => {
      mockUpdateDoc.mockRejectedValueOnce(new Error('write failed'))
      const doc = makeDocument({
        customerName: '未判定',
        customerConfirmed: false,
        needsManualCustomerSelection: true,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('customerName', '河野 文江'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const { updateDocumentInListCache } = await import('../useDocuments')
      const calls = vi.mocked(updateDocumentInListCache).mock.calls
      // 楽観的更新 + ロールバックで 2 回呼ばれる
      expect(calls.length).toBe(2)
      const rollbackData = calls[1]?.[2] as Record<string, unknown>
      expect(rollbackData.customerConfirmed).toBe(false)
      expect(rollbackData.needsManualCustomerSelection).toBe(true)
    })

    it('officeConfirmed のロールバック: write 失敗 → optimisticData の true/By/At を元の値に復元', async () => {
      mockUpdateDoc.mockRejectedValueOnce(new Error('write failed'))
      const doc = makeDocument({
        officeName: '未判定',
        officeConfirmed: false,
        officeConfirmedBy: null,
        officeConfirmedAt: null,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('officeName', 'ケアサポートきらり'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const { updateDocumentInListCache } = await import('../useDocuments')
      const calls = vi.mocked(updateDocumentInListCache).mock.calls
      expect(calls.length).toBe(2)
      const rollbackData = calls[1]?.[2] as Record<string, unknown>
      expect(rollbackData.officeConfirmed).toBe(false)
      expect(rollbackData.officeConfirmedBy).toBeNull()
      expect(rollbackData.officeConfirmedAt).toBeNull()
    })
  })

  describe('AC5.5: optimisticData にも confirmed フラグを反映', () => {
    it('AC1 実行時、updateDocumentInListCache に customerConfirmed=true が渡される', async () => {
      const doc = makeDocument({
        customerName: '未判定',
        customerConfirmed: false,
        needsManualCustomerSelection: true,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('customerName', '河野 文江'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const { updateDocumentInListCache } = await import('../useDocuments')
      const calls = vi.mocked(updateDocumentInListCache).mock.calls
      expect(calls.length).toBeGreaterThanOrEqual(1)
      const optimistic = calls[0]?.[2] as Record<string, unknown>
      expect(optimistic.customerConfirmed).toBe(true)
      expect(optimistic.needsManualCustomerSelection).toBe(false)
    })

    it('AC2 実行時、updateDocumentInListCache に officeConfirmed=true & officeConfirmedBy & officeConfirmedAt が渡される', async () => {
      const doc = makeDocument({
        officeName: '未判定',
        officeConfirmed: false,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('officeName', 'ケアサポートきらり'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const { updateDocumentInListCache } = await import('../useDocuments')
      const calls = vi.mocked(updateDocumentInListCache).mock.calls
      expect(calls.length).toBeGreaterThanOrEqual(1)
      const optimistic = calls[0]?.[2] as Record<string, unknown>
      expect(optimistic.officeConfirmed).toBe(true)
      expect(optimistic.officeConfirmedBy).toBe('user-001')
      // optimisticData は Timestamp.now() を使う（serverTimestamp はサーバー側のみ）
      expect(optimistic.officeConfirmedAt).toBeInstanceOf(Timestamp)
    })
  })

  describe('AC9: invalid 値・downgrade attempt の挙動 pin', () => {
    it('whitespace-only 入力（空白3つ）で保存 → customerName は trim せず書き込み、確定フラグは立てない', async () => {
      // ユーザーが半角空白のみ入力したケース。isValidCustomerSelection は trim 後判定で
      // false を返すため確定フラグは立たない一方、customerName 自体は editedFields の値が
      // そのまま書き込まれる（既存の挙動 = MasterSelectField から空白文字列が来ても許容）。
      // 将来この挙動を変える場合（例: バリデーションで弾く）、このテストが先に落ちて意図が伝わる。
      const doc = makeDocument({
        customerName: '河野 文江',
        customerConfirmed: false,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('customerName', '   '))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.customerName).toBe('   ')
      expect('customerConfirmed' in updateData).toBe(false)
    })

    it('混合変更: documentType 変更 + customerName を未判定に → customerName 書き込み + customerConfirmed は立てない', async () => {
      // 他フィールドの変更と invalid sentinel 選択が同時に発生するケース。
      // changes.length > 0 で updateDoc は呼ばれるが、customerConfirmed フラグは
      // invalid 値のため書き込まれない。
      const doc = makeDocument({
        customerName: '河野 文江',
        customerConfirmed: false,
        documentType: '請求書',
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('documentType', '実績'))
      act(() => result.current.updateField('customerName', '未判定'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.documentType).toBe('実績')
      expect(updateData.customerName).toBe('未判定')
      expect('customerConfirmed' in updateData).toBe(false)
    })

    it('downgrade attempt: customerConfirmed=false + 名前を未判定に変更 → customerName 書き込み・確定フラグ立てない', async () => {
      // 既に customerConfirmed=false のドキュメントで invalid 値を選ぶケース。
      // customerName 自体は書き込まれるが、確定フラグは false のままで上書きしない。
      const doc = makeDocument({
        customerName: '河野 文江',
        customerConfirmed: false,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('customerName', '未判定'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.customerName).toBe('未判定')
      expect('customerConfirmed' in updateData).toBe(false)
      expect('needsManualCustomerSelection' in updateData).toBe(false)
    })
  })

  describe('AC10: rollback 対称性 — optimistic で書き込んだ確定フラグ全 key が rollback で復元される', () => {
    // review-pr S2 (rollback drift-prone) 対応。
    // 次に確定フラグが追加されたとき、optimistic に書いて rollback に追加し忘れる
    // ケースを検出するための「対称性テスト」。AC8 がフラグ値を検証するのに対し、
    // ここでは optimistic で書いた key 集合 ⊆ rollback で復元した key 集合 を保証する。
    it('write 失敗時、optimistic 側で書いた確定フラグ key 全てが rollback の対象に含まれる', async () => {
      mockUpdateDoc.mockRejectedValueOnce(new Error('write failed'))
      const doc = makeDocument({
        customerName: '未判定',
        customerConfirmed: false,
        needsManualCustomerSelection: true,
        officeName: '未判定',
        officeConfirmed: false,
        officeConfirmedBy: null,
        officeConfirmedAt: null,
      })
      const { result } = renderHook(() => useDocumentEdit(doc))

      act(() => result.current.startEditing())
      act(() => result.current.updateField('customerName', '河野 文江'))
      act(() => result.current.updateField('officeName', 'ケアサポートきらり'))

      await act(async () => {
        await result.current.saveChanges()
      })

      const { updateDocumentInListCache } = await import('../useDocuments')
      const calls = vi.mocked(updateDocumentInListCache).mock.calls
      expect(calls.length).toBe(2)
      const optimisticData = calls[0]?.[2] as Record<string, unknown>
      const rollbackData = calls[1]?.[2] as Record<string, unknown>

      // 確定フラグ系の key を抽出（他フィールドの差分は AC8 / 既存テストでカバー済み）
      const confirmedFlagKeys = [
        'customerConfirmed',
        'needsManualCustomerSelection',
        'officeConfirmed',
        'officeConfirmedBy',
        'officeConfirmedAt',
      ]
      const optimisticFlagKeys = confirmedFlagKeys.filter((k) => k in optimisticData)
      const rollbackFlagKeys = confirmedFlagKeys.filter((k) => k in rollbackData)

      // optimistic で書いた確定フラグ key は全て rollback でも復元対象になっていること
      expect(optimisticFlagKeys.sort()).toEqual(rollbackFlagKeys.sort())
      // 念のため空集合でないことも確認（optimistic 自体が機能しているか）
      expect(optimisticFlagKeys.length).toBeGreaterThan(0)
    })
  })
})
