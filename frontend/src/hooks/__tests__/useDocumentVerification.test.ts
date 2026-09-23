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
const mockAddDoc = vi.fn().mockResolvedValue(undefined)
const mockCollection = vi.fn().mockReturnValue({ id: 'editLogs-ref' })

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    doc: (...args: unknown[]) => mockDoc(...args),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
    addDoc: (...args: unknown[]) => mockAddDoc(...args),
    collection: (...args: unknown[]) => mockCollection(...args),
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

const mockUpdateDocumentInListCache = vi.fn()
const mockMarkDocumentsInfiniteVariantsDirty = vi.fn()
vi.mock('../useDocuments', () => ({
  updateDocumentInListCache: (...args: unknown[]) => mockUpdateDocumentInListCache(...args),
  markDocumentsInfiniteVariantsDirty: (...args: unknown[]) => mockMarkDocumentsInfiniteVariantsDirty(...args),
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
import type { CustomerIdentityLookup } from '../useMasters'

// Issue #1034以前の挙動(customerConfirmed/officeConfirmedへ一切触れない)を検証する
// 既存テストは、意図的に isReady:false のlookupを渡して確定ロジックを発火させない。
// 確定ロジック自体のテストは本ファイル末尾の専用describeで行う。
const notReadyLookup: CustomerIdentityLookup = {
  isReady: false,
  sameNameCollisionNames: new Set(),
  customerMasterNameById: new Map(),
}

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
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

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
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

      await act(async () => {
        await result.current.markAsUnverified()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect('driveFileId' in updateData).toBe(false)
    })

    it('verified/verifiedBy/verifiedAt/updatedAtの既存フィールドも引き続き更新される(回帰防止)', async () => {
      const doc = makeDocument({ verified: true })
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

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
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

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

  // 2026-09-08追記(second-opinionレビュー指摘、Firestore読み取り過大バグ修正):
  // この書類がdocumentsInfiniteのどのvariantにもキャッシュされていない場合(グループ
  // 表示やdeep linkから開いた場合等)、updateDocumentInListCacheのパッチは無言のno-opに
  // なる。また確認状態の変更はdocumentStatsに反映されないクライアント側フィルタ
  // (「未確認のみ表示」)対象のため、markDocumentsInfiniteVariantsDirtyを呼ばない限り
  // 更新バナーの検知シグナルが一切発火しない回帰テスト。
  describe('markDocumentsInfiniteVariantsDirtyの呼び出し(更新バナー検知シグナル)', () => {
    it('markAsVerified成功時、確認・ロールバックいずれの経路でもdirty化する', async () => {
      const doc = makeDocument({ verified: false })
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      expect(mockMarkDocumentsInfiniteVariantsDirty).toHaveBeenCalled()
    })

    it('markAsUnverified成功時もdirty化する', async () => {
      const doc = makeDocument({ verified: true })
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

      await act(async () => {
        await result.current.markAsUnverified()
      })

      expect(mockMarkDocumentsInfiniteVariantsDirty).toHaveBeenCalled()
    })
  })

  // 2026-09-08追記(second-opinionレビュー指摘): 楽観的更新(optimisticUpdate、内部で
  // updateDocumentInListCache/markDocumentsInfiniteVariantsDirtyを呼ぶ)がtryブロックの
  // 外にあると、これらが例外を投げた場合にfinally(isUpdatingのリセット)が実行されず、
  // 確認トグルが永久disabledになる回帰テスト。
  describe('optimisticUpdate失敗時もisUpdatingが固着しない', () => {
    it('markAsVerified: 楽観的更新(updateDocumentInListCache)が例外を投げても、isUpdatingがfalseに戻りfalseを返す(rejectしない)', async () => {
      mockUpdateDocumentInListCache.mockImplementationOnce(() => {
        throw new Error('unexpected cache error')
      })
      const doc = makeDocument({ verified: false })
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

      let returned: boolean | undefined
      await act(async () => {
        returned = await result.current.markAsVerified()
      })

      // tryブロック内に移動したため例外はcatchで捕捉され、finally(isUpdating=false)が
      // 必ず実行される。ここでrejectしてしまう(=finallyがスキップされる)のが
      // 修正前の不具合だった。
      expect(returned).toBe(false)
      expect(result.current.isUpdating).toBe(false)
      // Firestoreへの書込み自体は行われていないはず(optimisticUpdate段階で失敗したため)
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('markAsUnverified: 楽観的更新(updateDocumentInListCache)が例外を投げても、isUpdatingがfalseに戻りfalseを返す(rejectしない)', async () => {
      mockUpdateDocumentInListCache.mockImplementationOnce(() => {
        throw new Error('unexpected cache error')
      })
      const doc = makeDocument({ verified: true })
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

      let returned: boolean | undefined
      await act(async () => {
        returned = await result.current.markAsUnverified()
      })

      expect(returned).toBe(false)
      expect(result.current.isUpdating).toBe(false)
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })

  // Issue #1034: 「確認済み」にする操作がcustomerConfirmed/officeConfirmedも
  // 同時に確定するようになった(shared/confirmOnVerify.ts経由)。
  describe('markAsVerified (#1034: 確定フラグの統合)', () => {
    const readyLookup: CustomerIdentityLookup = {
      isReady: true,
      sameNameCollisionNames: new Set(),
      customerMasterNameById: new Map([['customer-1', '田村 勝義']]),
    }

    it('identityLookup.isReady:falseのときはcustomerConfirmed/officeConfirmedを更新しない(既存動作維持)', async () => {
      const doc = makeDocument({ verified: false, customerId: 'customer-1' })
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect('customerConfirmed' in updateData).toBe(false)
      expect('officeConfirmed' in updateData).toBe(false)
      expect(mockAddDoc).not.toHaveBeenCalled()
    })

    it('同姓同名でない有効な顧客・事業所名ならcustomerConfirmed/officeConfirmedもtrueにする', async () => {
      const doc = makeDocument({ verified: false, customerId: 'customer-1' })
      const { result } = renderHook(() => useDocumentVerification(doc, readyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updateData.customerConfirmed).toBe(true)
      expect(updateData.confirmedBy).toBe('user-001')
      expect(updateData.officeConfirmed).toBe(true)
      expect(updateData.officeConfirmedBy).toBe('user-001')
      // 監査ログ(editLogs)も書かれる(Issue #398と同じ規約)
      expect(mockAddDoc).toHaveBeenCalledTimes(2)
    })

    it('同姓同名の顧客は確定しない(ADR-0022の安全装置を維持)', async () => {
      const collisionLookup: CustomerIdentityLookup = {
        isReady: true,
        sameNameCollisionNames: new Set(['田村 勝義']),
        customerMasterNameById: new Map([['customer-1', '田村 勝義']]),
      }
      const doc = makeDocument({ verified: false, customerId: 'customer-1' })
      const { result } = renderHook(() => useDocumentVerification(doc, collisionLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect('customerConfirmed' in updateData).toBe(false)
      // 事業所側は顧客の同姓同名と無関係に確定される
      expect(updateData.officeConfirmed).toBe(true)
    })

    it('customerId・customerName・officeId・officeNameは更新データに含まれない', async () => {
      const doc = makeDocument({ verified: false, customerId: 'customer-1' })
      const { result } = renderHook(() => useDocumentVerification(doc, readyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      for (const key of ['customerId', 'customerName', 'officeId', 'officeName']) {
        expect(key in updateData).toBe(false)
      }
    })

    it('既にcustomerConfirmed:trueの書類は再確定しない(already-confirmedでskip)', async () => {
      const doc = makeDocument({
        verified: false,
        customerId: 'customer-1',
        customerConfirmed: true,
        officeConfirmed: false,
      })
      const { result } = renderHook(() => useDocumentVerification(doc, readyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect('customerConfirmed' in updateData).toBe(false)
      expect(updateData.officeConfirmed).toBe(true)
    })

    // codexレビュー指摘(2026-09-23): updateDoc成功後にeditLogsのaddDocが失敗すると、
    // 従来は外側catchでUIが未確認へロールバックされ、Firestoreには既に確定済み内容が
    // 保存されているのにUIと状態が食い違っていた。監査ログの失敗は本体の成功を妨げない。
    it('updateDoc成功後にeditLogs書込み(addDoc)が失敗しても、trueを返しロールバックしない', async () => {
      mockAddDoc.mockRejectedValueOnce(new Error('editLogs write failed'))
      const doc = makeDocument({ verified: false, customerId: 'customer-1' })
      const { result } = renderHook(() => useDocumentVerification(doc, readyLookup))

      let returned: boolean | undefined
      await act(async () => {
        returned = await result.current.markAsVerified()
      })

      expect(returned).toBe(true)
      // updateDocumentInListCacheの2回目呼び出し(ロールバック用)が発生していないこと
      expect(mockUpdateDocumentInListCache).toHaveBeenCalledTimes(1)
      const cachePatch = mockUpdateDocumentInListCache.mock.calls[0]?.[2] as Record<string, unknown>
      expect(cachePatch.verified).toBe(true)
      expect(cachePatch.customerConfirmed).toBe(true)
    })
  })
})
