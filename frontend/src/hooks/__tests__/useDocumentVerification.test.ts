/**
 * useDocumentVerification 単体テスト
 *
 * ADR-0022 Phase1、code-review指摘#42対応(2026-07-22):
 * markAsUnverified が Drive エクスポート状態(driveExportStatus等)をクリアしないと、
 * 訂正のために未確認へ戻し→再確認するフローで、driveExportTrigger.tsのクレーム
 * (driveExportStatus不在のdocのみ対象)が古い'exported'値を検知してスキップされ、
 * 二度と再エクスポートされなくなる。この回帰を防ぐテスト。
 *
 * Issue #1034 + codexレビュー指摘(P1、2026-09-23): markAsVerifiedはruntTransaction経由で
 * Firestoreから直前に再読込した最新データに対して確定判定・書込みを行う(モーダルを開いた
 * 時点のpropの`document`が古い可能性があるため)。テストのrunTransactionモックは、
 * `tx.get()`の戻り値を明示指定しない限りフックへ渡した`doc`をそのまま返す
 * (「再読込しても内容は変わっていない」通常ケースを既定値とする)。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { deleteField, Timestamp } from 'firebase/firestore'
import type { Document } from '../../../../shared/types'

const mockUpdateDoc = vi.fn().mockResolvedValue(undefined)
const mockDoc = vi.fn().mockReturnValue({ id: 'doc-ref' })
const mockTxUpdate = vi.fn()
const mockTxSet = vi.fn()
const mockCollection = vi.fn().mockReturnValue({ id: 'editLogs-ref' })

// runTransactionのtx.get()が返す文書データ。nullなら「フックへ渡したdocument」を返す
// (通常ケース)。テストごとに上書きして「再読込したら中身が違っていた」競合を再現する。
let txGetOverride: Document | null = null
let txGetExists = true
const mockRunTransaction = vi.fn(async (_db: unknown, updateFn: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    get: async (_ref: unknown) => ({
      exists: () => txGetExists,
      data: () => txGetOverride,
    }),
    update: (...args: unknown[]) => mockTxUpdate(...args),
    set: (...args: unknown[]) => mockTxSet(...args),
  }
  return await updateFn(tx)
})

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore')
  return {
    ...actual,
    doc: (...args: unknown[]) => mockDoc(...args),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
    collection: (...args: unknown[]) => mockCollection(...args),
    runTransaction: (...args: [unknown, (tx: unknown) => Promise<unknown>]) => mockRunTransaction(...args),
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

/** markAsVerifiedのtx.update()に渡された更新データを取得するヘルパー。 */
function getTxUpdateData(): Record<string, unknown> {
  return mockTxUpdate.mock.calls[0]?.[1] as Record<string, unknown>
}

describe('useDocumentVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    txGetOverride = null
    txGetExists = true
  })

  describe('markAsUnverified (#42: Drive状態クリア)', () => {
    it('updateDocにDrive系4フィールド(deleteField sentinel)が含まれる', async () => {
      const doc = makeDocument({ verified: true })
      txGetOverride = doc
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
      txGetOverride = doc
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

      await act(async () => {
        await result.current.markAsUnverified()
      })

      const updateData = mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>
      expect('driveFileId' in updateData).toBe(false)
    })

    it('verified/verifiedBy/verifiedAt/updatedAtの既存フィールドも引き続き更新される(回帰防止)', async () => {
      const doc = makeDocument({ verified: true })
      txGetOverride = doc
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
    it('tx.updateにDrive系フィールドを含めない(未確認→確認済みではDrive状態は既にクリア済みの前提)', async () => {
      const doc = makeDocument({ verified: false })
      txGetOverride = doc
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      expect(mockRunTransaction).toHaveBeenCalledTimes(1)
      expect(mockTxUpdate).toHaveBeenCalledTimes(1)
      const updateData = getTxUpdateData()
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
      txGetOverride = doc
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      expect(mockMarkDocumentsInfiniteVariantsDirty).toHaveBeenCalled()
    })

    it('markAsUnverified成功時もdirty化する', async () => {
      const doc = makeDocument({ verified: true })
      txGetOverride = doc
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
      txGetOverride = doc
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
      expect(mockRunTransaction).not.toHaveBeenCalled()
    })

    it('markAsUnverified: 楽観的更新(updateDocumentInListCache)が例外を投げても、isUpdatingがfalseに戻りfalseを返す(rejectしない)', async () => {
      mockUpdateDocumentInListCache.mockImplementationOnce(() => {
        throw new Error('unexpected cache error')
      })
      const doc = makeDocument({ verified: true })
      txGetOverride = doc
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
      txGetOverride = doc
      const { result } = renderHook(() => useDocumentVerification(doc, notReadyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = getTxUpdateData()
      expect('customerConfirmed' in updateData).toBe(false)
      expect('officeConfirmed' in updateData).toBe(false)
      expect(mockTxSet).not.toHaveBeenCalled()
    })

    it('同姓同名でない有効な顧客・事業所名ならcustomerConfirmed/officeConfirmedもtrueにする', async () => {
      const doc = makeDocument({ verified: false, customerId: 'customer-1' })
      txGetOverride = doc
      const { result } = renderHook(() => useDocumentVerification(doc, readyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = getTxUpdateData()
      expect(updateData.customerConfirmed).toBe(true)
      expect(updateData.confirmedBy).toBe('user-001')
      expect(updateData.officeConfirmed).toBe(true)
      expect(updateData.officeConfirmedBy).toBe('user-001')
      // 監査ログ(editLogs)も同一トランザクション内でtx.set()される(Issue #398と同じ規約)
      expect(mockTxSet).toHaveBeenCalledTimes(2)
    })

    it('同姓同名の顧客は確定しない(ADR-0022の安全装置を維持)', async () => {
      const collisionLookup: CustomerIdentityLookup = {
        isReady: true,
        sameNameCollisionNames: new Set(['田村 勝義']),
        customerMasterNameById: new Map([['customer-1', '田村 勝義']]),
      }
      const doc = makeDocument({ verified: false, customerId: 'customer-1' })
      txGetOverride = doc
      const { result } = renderHook(() => useDocumentVerification(doc, collisionLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = getTxUpdateData()
      expect('customerConfirmed' in updateData).toBe(false)
      // 事業所側は顧客の同姓同名と無関係に確定される
      expect(updateData.officeConfirmed).toBe(true)
    })

    it('customerId・customerName・officeId・officeNameは更新データに含まれない', async () => {
      const doc = makeDocument({ verified: false, customerId: 'customer-1' })
      txGetOverride = doc
      const { result } = renderHook(() => useDocumentVerification(doc, readyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = getTxUpdateData()
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
      txGetOverride = doc
      const { result } = renderHook(() => useDocumentVerification(doc, readyLookup))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = getTxUpdateData()
      expect('customerConfirmed' in updateData).toBe(false)
      expect(updateData.officeConfirmed).toBe(true)
    })

    // codexレビュー指摘(P2、2026-09-23、修正済み): editLogsの書込み(tx.set)がドキュメント本体の
    // 更新(tx.update)と同一トランザクションに含まれるため、監査ログ書込みが失敗すると
    // トランザクション全体が失敗し、Firestoreの状態とUIの食い違いは発生しない
    // (以前はupdateDoc成功後に独立したaddDocが失敗しうる構造だった)。
    it('トランザクションが失敗した場合はverifiedのみロールバックし、確定フラグは書き込まれていない', async () => {
      mockRunTransaction.mockRejectedValueOnce(new Error('transaction failed'))
      const doc = makeDocument({ verified: false, customerId: 'customer-1' })
      txGetOverride = doc
      const { result } = renderHook(() => useDocumentVerification(doc, readyLookup))

      let returned: boolean | undefined
      await act(async () => {
        returned = await result.current.markAsVerified()
      })

      expect(returned).toBe(false)
      // 最後の呼び出し(catchでのロールバック)がverifiedをfalseへ戻していること
      const lastCall = mockUpdateDocumentInListCache.mock.calls.at(-1)
      const rollbackPatch = lastCall?.[2] as Record<string, unknown>
      expect(rollbackPatch.verified).toBe(false)
    })

    // codexレビュー指摘(P1、2026-09-23): モーダルを開いた時点のpropの`document`が古い場合、
    // トランザクション内でFirestoreから再読込した最新データを使って判定すること
    // (古いスナップショットのまま確定してしまわないこと)を検証する。
    it('propのdocumentが古くても、トランザクション内で再読込した最新データで確定可否を判定する(P1回帰テスト)', async () => {
      // フックへ渡すdocumentは「同姓同名なし」の状態(確定できそうに見える)。
      const staleDoc = makeDocument({ verified: false, customerId: 'customer-1', customerName: '田村 勝義' })
      // しかしFirestore側は既に同姓同名の別名に変更されている(他者による編集を想定)。
      txGetOverride = makeDocument({
        verified: false,
        customerId: 'customer-1',
        customerName: '鈴木花子',
        officeName: '未判定',
      })
      const collisionOnFreshRead: CustomerIdentityLookup = {
        isReady: true,
        sameNameCollisionNames: new Set(['鈴木花子']),
        customerMasterNameById: new Map([['customer-1', '鈴木花子']]),
      }
      const { result } = renderHook(() => useDocumentVerification(staleDoc, collisionOnFreshRead))

      await act(async () => {
        await result.current.markAsVerified()
      })

      const updateData = getTxUpdateData()
      // 最新データ(鈴木花子、同姓同名あり)で判定した結果、顧客側は確定されない。
      // 古いプロパティ(田村勝義、同姓同名なし)のまま判定していれば誤って確定していたはず。
      expect('customerConfirmed' in updateData).toBe(false)
      // 事業所側も最新データ(未判定=invalid-name)で判定されるため確定されない。
      expect('officeConfirmed' in updateData).toBe(false)
    })
  })
})
