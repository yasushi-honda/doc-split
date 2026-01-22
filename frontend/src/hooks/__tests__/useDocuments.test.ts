/**
 * firestoreToDocument 単体テスト
 *
 * TDD: 事業所同名対応バグ修正の検証
 * - officeConfirmed / officeCandidates フィールドが正しく変換されること
 */

import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { firestoreToDocument } from '../useDocuments'

describe('firestoreToDocument', () => {
  // 基本フィールドのモックデータ
  const baseFirestoreData = {
    processedAt: Timestamp.now(),
    fileId: 'file-001',
    fileName: 'test.pdf',
    mimeType: 'application/pdf',
    ocrResult: 'OCR結果テキスト',
    documentType: '請求書',
    customerName: '山田太郎',
    officeName: 'テスト事業所',
    fileUrl: 'gs://bucket/test.pdf',
    fileDate: Timestamp.now(),
    isDuplicateCustomer: false,
    totalPages: 1,
    targetPageNumber: 1,
    status: 'processed',
  }

  describe('基本フィールド変換', () => {
    it('IDと基本フィールドを正しく変換する', () => {
      const result = firestoreToDocument('doc-001', baseFirestoreData)

      expect(result.id).toBe('doc-001')
      expect(result.fileName).toBe('test.pdf')
      expect(result.customerName).toBe('山田太郎')
      expect(result.officeName).toBe('テスト事業所')
      expect(result.status).toBe('processed')
    })
  })

  describe('顧客確定フィールド（Phase 7）', () => {
    it('customerConfirmed: true を正しく変換する', () => {
      const data = {
        ...baseFirestoreData,
        customerId: 'customer-001',
        customerConfirmed: true,
        customerConfirmedBy: 'user-001',
        customerConfirmedAt: Timestamp.now(),
      }

      const result = firestoreToDocument('doc-001', data)

      expect(result.customerConfirmed).toBe(true)
      expect(result.customerId).toBe('customer-001')
      expect(result.customerConfirmedBy).toBe('user-001')
    })

    it('customerConfirmed: false を正しく変換する', () => {
      const data = {
        ...baseFirestoreData,
        customerConfirmed: false,
        customerCandidates: [
          { customerId: 'c-001', customerName: '山田太郎A', score: 90 },
          { customerId: 'c-002', customerName: '山田太郎B', score: 85 },
        ],
      }

      const result = firestoreToDocument('doc-001', data)

      expect(result.customerConfirmed).toBe(false)
      expect(result.customerCandidates).toHaveLength(2)
      expect(result.customerCandidates?.[0]?.customerName).toBe('山田太郎A')
    })

    it('customerConfirmed が undefined の場合も正しく処理する', () => {
      const result = firestoreToDocument('doc-001', baseFirestoreData)

      expect(result.customerConfirmed).toBeUndefined()
    })
  })

  describe('事業所確定フィールド（Phase 8 同名対応）★重要', () => {
    it('officeConfirmed: true を正しく変換する', () => {
      const data = {
        ...baseFirestoreData,
        officeId: 'office-001',
        officeConfirmed: true,
        officeConfirmedBy: 'user-001',
        officeConfirmedAt: Timestamp.now(),
      }

      const result = firestoreToDocument('doc-001', data)

      expect(result.officeConfirmed).toBe(true)
      expect(result.officeId).toBe('office-001')
      expect(result.officeConfirmedBy).toBe('user-001')
    })

    it('officeConfirmed: false を正しく変換する（バグ修正確認）', () => {
      const data = {
        ...baseFirestoreData,
        officeConfirmed: false,
        officeCandidates: [
          {
            officeId: 'office-001',
            officeName: 'テスト第一事業所',
            shortName: 'テスト第一',
            isDuplicate: true,
            score: 90,
            matchType: 'partial',
          },
          {
            officeId: 'office-002',
            officeName: 'テスト第二事業所',
            shortName: 'テスト第二',
            isDuplicate: true,
            score: 85,
            matchType: 'partial',
          },
        ],
      }

      const result = firestoreToDocument('doc-001', data)

      // ★ これが以前のバグの根本原因だった
      // officeConfirmed と officeCandidates が undefined になっていた
      expect(result.officeConfirmed).toBe(false)
      expect(result.officeCandidates).toBeDefined()
      expect(result.officeCandidates).toHaveLength(2)
      expect(result.officeCandidates?.[0]?.officeName).toBe('テスト第一事業所')
      expect(result.officeCandidates?.[0]?.isDuplicate).toBe(true)
      expect(result.officeCandidates?.[1]?.officeName).toBe('テスト第二事業所')
    })

    it('officeConfirmed が undefined の場合も正しく処理する', () => {
      const result = firestoreToDocument('doc-001', baseFirestoreData)

      expect(result.officeConfirmed).toBeUndefined()
      expect(result.officeCandidates).toBeUndefined()
    })

    it('officeCandidates の各フィールドが正しく変換される', () => {
      const data = {
        ...baseFirestoreData,
        officeConfirmed: false,
        officeCandidates: [
          {
            officeId: 'office-abc',
            officeName: '詳細テスト事業所',
            shortName: '詳細テスト',
            isDuplicate: true,
            score: 95,
            matchType: 'exact',
          },
        ],
      }

      const result = firestoreToDocument('doc-001', data)

      const candidate = result.officeCandidates?.[0]
      expect(candidate?.officeId).toBe('office-abc')
      expect(candidate?.officeName).toBe('詳細テスト事業所')
      expect(candidate?.shortName).toBe('詳細テスト')
      expect(candidate?.isDuplicate).toBe(true)
      expect(candidate?.score).toBe(95)
      expect(candidate?.matchType).toBe('exact')
    })
  })

  describe('確認待ち判定用フィールド', () => {
    it('顧客未確定ドキュメントを正しく識別できる', () => {
      const data = {
        ...baseFirestoreData,
        customerConfirmed: false,
        officeConfirmed: true,
      }

      const result = firestoreToDocument('doc-001', data)

      // 確認待ち判定ロジック用
      const needsCustomerConfirmation = result.customerConfirmed === false
      const needsOfficeConfirmation = result.officeConfirmed === false

      expect(needsCustomerConfirmation).toBe(true)
      expect(needsOfficeConfirmation).toBe(false)
    })

    it('事業所未確定ドキュメントを正しく識別できる', () => {
      const data = {
        ...baseFirestoreData,
        customerConfirmed: true,
        officeConfirmed: false,
      }

      const result = firestoreToDocument('doc-001', data)

      const needsCustomerConfirmation = result.customerConfirmed === false
      const needsOfficeConfirmation = result.officeConfirmed === false

      expect(needsCustomerConfirmation).toBe(false)
      expect(needsOfficeConfirmation).toBe(true)
    })

    it('両方未確定のドキュメントを正しく識別できる', () => {
      const data = {
        ...baseFirestoreData,
        customerConfirmed: false,
        officeConfirmed: false,
        customerCandidates: [{ customerId: 'c1', customerName: 'A', score: 90 }],
        officeCandidates: [
          { officeId: 'o1', officeName: 'B', isDuplicate: true, score: 90 },
        ],
      }

      const result = firestoreToDocument('doc-001', data)

      expect(result.customerConfirmed).toBe(false)
      expect(result.officeConfirmed).toBe(false)
      expect(result.customerCandidates).toHaveLength(1)
      expect(result.officeCandidates).toHaveLength(1)
    })
  })
})
