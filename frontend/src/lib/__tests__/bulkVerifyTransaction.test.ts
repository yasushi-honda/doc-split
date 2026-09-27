/**
 * executeBulkVerifyDocumentTransaction 単体テスト(Issue #1044、evaluator/pr-test-analyzer
 * 指摘対応)
 *
 * 背景: bulkVerifyOutcome.test.tsはsummarizeBulkVerifyOutcomes(集計・選択保持ロジック)を
 * テストしているが、それは「identityLookupFailedという既に確定したbooleanと、既に確定した
 * decisions配列」を受け取った後の話でしかない。fail-closedの発生源そのもの
 * (fetchFreshCustomerIdentityLookup失敗時にdecisionsがnullになる経路、同姓同名判定、
 * トランザクション失敗時のerror outcome化)はDocumentsPage.tsx側にテストファイルが無いため
 * 一切検証されていなかった(evaluator: AC「fail-closed動作」FAIL判定)。
 *
 * frontend/src/hooks/__tests__/useDocumentVerification.test.ts(単体トグル版)と同じ
 * runTransactionモックパターンを使い、fail-closedの発生源自体を検証する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import type { Document } from '../../../../shared/types'
import type { CustomerIdentityLookup } from '../../hooks/useMasters'

const mockDoc = vi.fn().mockReturnValue({ id: 'doc-ref' })
const mockTxUpdate = vi.fn()
const mockTxSet = vi.fn()
const mockCollection = vi.fn().mockReturnValue({ id: 'editLogs-ref' })

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
    collection: (...args: unknown[]) => mockCollection(...args),
    runTransaction: (...args: [unknown, (tx: unknown) => Promise<unknown>]) => mockRunTransaction(...args),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  }
})

import { executeBulkVerifyDocumentTransaction } from '../bulkVerifyTransaction'

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

const readyLookup: Omit<CustomerIdentityLookup, 'isReady'> = {
  sameNameCollisionNames: new Set(),
  customerMasterNameById: new Map([['customer-1', '田村 勝義']]),
}

function getTxUpdateData(): Record<string, unknown> {
  return mockTxUpdate.mock.calls[0]?.[1] as Record<string, unknown>
}

describe('executeBulkVerifyDocumentTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    txGetOverride = null
    txGetExists = true
  })

  describe('fail-closed(fetchFreshCustomerIdentityLookup失敗、freshIdentityLookup:null)', () => {
    it('freshIdentityLookup:nullなら確定判定を一律スキップし、verifiedのみ更新する(decisionsもnull)', async () => {
      const doc = makeDocument({ customerId: 'customer-1' })
      txGetOverride = doc

      const outcome = await executeBulkVerifyDocumentTransaction({} as never, 'doc-001', {
        freshIdentityLookup: null,
        uid: 'user-001',
        email: 'test@example.com',
      })

      expect(outcome).toEqual({
        docId: 'doc-001',
        status: 'ok',
        decisions: null,
        alreadyFullyConfirmed: false,
      })
      const updateData = getTxUpdateData()
      expect(updateData.verified).toBe(true)
      expect('customerConfirmed' in updateData).toBe(false)
      expect('officeConfirmed' in updateData).toBe(false)
      // 確定フィールドが無いため監査ログ(editLogs)も書かれない
      expect(mockTxSet).not.toHaveBeenCalled()
    })

    it('freshIdentityLookup:null + 既に両方確定済みの書類はalreadyFullyConfirmed:trueを返す(識別警告の要否判定に使われる)', async () => {
      const doc = makeDocument({ customerId: 'customer-1', customerConfirmed: true, officeConfirmed: true })
      txGetOverride = doc

      const outcome = await executeBulkVerifyDocumentTransaction({} as never, 'doc-001', {
        freshIdentityLookup: null,
        uid: 'user-001',
        email: 'test@example.com',
      })

      expect(outcome.alreadyFullyConfirmed).toBe(true)
    })
  })

  describe('freshIdentityLookup取得成功', () => {
    it('同姓同名でない有効な顧客・事業所名ならcustomerConfirmed/officeConfirmedを確定し、editLogsを書く', async () => {
      const doc = makeDocument({ customerId: 'customer-1' })
      txGetOverride = doc

      const outcome = await executeBulkVerifyDocumentTransaction({} as never, 'doc-001', {
        freshIdentityLookup: readyLookup,
        uid: 'user-001',
        email: 'test@example.com',
      })

      expect(outcome.status).toBe('ok')
      expect(outcome.decisions?.customer).toEqual({ action: 'confirm' })
      expect(outcome.decisions?.office).toEqual({ action: 'confirm' })
      const updateData = getTxUpdateData()
      expect(updateData.customerConfirmed).toBe(true)
      expect(updateData.confirmedBy).toBe('user-001')
      expect(updateData.officeConfirmed).toBe(true)
      expect(mockTxSet).toHaveBeenCalledTimes(2)
    })

    it('同姓同名の顧客は確定しない(ADR-0022の安全装置、freshIdentityLookup経由でも維持される)', async () => {
      const doc = makeDocument({ customerId: 'customer-1' })
      txGetOverride = doc
      const collisionLookup: Omit<CustomerIdentityLookup, 'isReady'> = {
        sameNameCollisionNames: new Set(['田村 勝義']),
        customerMasterNameById: new Map([['customer-1', '田村 勝義']]),
      }

      const outcome = await executeBulkVerifyDocumentTransaction({} as never, 'doc-001', {
        freshIdentityLookup: collisionLookup,
        uid: 'user-001',
        email: 'test@example.com',
      })

      expect(outcome.decisions?.customer).toEqual({ action: 'skip', reason: 'same-name-collision' })
      const updateData = getTxUpdateData()
      expect('customerConfirmed' in updateData).toBe(false)
      // 事業所側は顧客の同姓同名と無関係に確定される
      expect(updateData.officeConfirmed).toBe(true)
    })
  })

  describe('トランザクション失敗', () => {
    it('文書が存在しない場合はerror outcomeを返し、例外を投げない(呼び出し元の他文書処理を継続できるようにする)', async () => {
      txGetExists = false

      const outcome = await executeBulkVerifyDocumentTransaction({} as never, 'doc-missing', {
        freshIdentityLookup: readyLookup,
        uid: 'user-001',
        email: 'test@example.com',
      })

      expect(outcome).toEqual({
        docId: 'doc-missing',
        status: 'error',
        decisions: null,
        alreadyFullyConfirmed: false,
      })
    })

    it('runTransaction自体が例外を投げた場合もerror outcomeを返す', async () => {
      mockRunTransaction.mockRejectedValueOnce(new Error('transaction failed'))

      const outcome = await executeBulkVerifyDocumentTransaction({} as never, 'doc-001', {
        freshIdentityLookup: readyLookup,
        uid: 'user-001',
        email: 'test@example.com',
      })

      expect(outcome.status).toBe('error')
      expect(outcome.decisions).toBeNull()
    })
  })
})
