/**
 * firestoreToDocument 単体テスト
 *
 * TDD: 事業所同名対応バグ修正の検証
 * - officeConfirmed / officeCandidates フィールドが正しく変換されること
 */

import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { firestoreToDocument, normalizeSummary, getReprocessClearFields } from '../useDocuments'

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
        confirmedBy: 'user-001',
        confirmedAt: Timestamp.now(),
      }

      const result = firestoreToDocument('doc-001', data)

      expect(result.customerConfirmed).toBe(true)
      expect(result.customerId).toBe('customer-001')
      expect(result.confirmedBy).toBe('user-001')
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

  // Issue #253: 派生フィールド追加時の同期漏れ (#178 教訓) を防ぐ lock-in。
  // useProcessingHistory の劣化コピーを削除して useDocuments 版に集約した際に、
  // 旧 useProcessingHistory 固有だった needsManualCustomerSelection を取りこぼさないことを保証。
  describe('後方互換フィールド (#253)', () => {
    it('needsManualCustomerSelection: true を正しく変換する', () => {
      const data = {
        ...baseFirestoreData,
        needsManualCustomerSelection: true,
      }

      const result = firestoreToDocument('doc-001', data)

      expect(result.needsManualCustomerSelection).toBe(true)
    })

    it('needsManualCustomerSelection: false を正しく変換する', () => {
      const data = {
        ...baseFirestoreData,
        needsManualCustomerSelection: false,
      }

      const result = firestoreToDocument('doc-001', data)

      expect(result.needsManualCustomerSelection).toBe(false)
    })

    it('needsManualCustomerSelection が undefined (Phase 6 以前) の場合も正しく処理する', () => {
      const result = firestoreToDocument('doc-001', baseFirestoreData)

      expect(result.needsManualCustomerSelection).toBeUndefined()
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

  describe('summary フィールド (Issue #215 discriminated union + 後方互換読込)', () => {
    it('summary が存在しない場合は undefined を返す', () => {
      const result = firestoreToDocument('doc-001', baseFirestoreData)
      expect(result.summary).toBeUndefined()
    })

    it('新ネスト形式 (truncated=false) をそのまま SummaryField として返す', () => {
      const data = {
        ...baseFirestoreData,
        summary: { text: '要約テキスト', truncated: false },
      }
      const result = firestoreToDocument('doc-001', data)
      expect(result.summary).toEqual({ text: '要約テキスト', truncated: false })
    })

    it('新ネスト形式 (truncated=true) で originalLength を保持する', () => {
      const data = {
        ...baseFirestoreData,
        summary: { text: '切り詰め後', truncated: true, originalLength: 1_100_000 },
      }
      const result = firestoreToDocument('doc-001', data)
      expect(result.summary).toEqual({
        text: '切り詰め後',
        truncated: true,
        originalLength: 1_100_000,
      })
    })

    it('旧フラット形式 (summary: string + summaryTruncated: false) を新ネスト型に変換する', () => {
      const data = {
        ...baseFirestoreData,
        summary: '旧形式の要約',
        summaryTruncated: false,
        summaryOriginalLength: 50,
      }
      const result = firestoreToDocument('doc-001', data)
      // truncated=false では originalLength は不在 (型不変条件)
      expect(result.summary).toEqual({ text: '旧形式の要約', truncated: false })
    })

    it('旧フラット形式 (summary: string + summaryTruncated: true) を新ネスト型に変換し originalLength を保持する', () => {
      const data = {
        ...baseFirestoreData,
        summary: '旧形式の切り詰め要約',
        summaryTruncated: true,
        summaryOriginalLength: 1_100_000,
      }
      const result = firestoreToDocument('doc-001', data)
      expect(result.summary).toEqual({
        text: '旧形式の切り詰め要約',
        truncated: true,
        originalLength: 1_100_000,
      })
    })

    it('旧フラット形式で truncated=true だが originalLength 欠落の場合は truncated=false 扱いでフォールバック', () => {
      // 過去データ不整合への防御: truncated=true だが originalLength が無ければ非切り詰め扱いとする
      const data = {
        ...baseFirestoreData,
        summary: '不整合データ',
        summaryTruncated: true,
        // summaryOriginalLength は欠落
      }
      const result = firestoreToDocument('doc-001', data)
      expect(result.summary).toEqual({ text: '不整合データ', truncated: false })
    })

    it('不正な形式 (summary がオブジェクトだが text キー欠落) は undefined を返す', () => {
      const data = {
        ...baseFirestoreData,
        summary: { truncated: false },
      }
      const result = firestoreToDocument('doc-001', data)
      expect(result.summary).toBeUndefined()
    })
  })
})

describe('normalizeSummary (Issue #215 単体)', () => {
  it('summary フィールド欠落は undefined', () => {
    expect(normalizeSummary({})).toBeUndefined()
  })

  it('summary=null は undefined', () => {
    expect(normalizeSummary({ summary: null })).toBeUndefined()
  })

  it('新形式 truncated=false', () => {
    expect(normalizeSummary({ summary: { text: 'x', truncated: false } })).toEqual({
      text: 'x',
      truncated: false,
    })
  })

  it('新形式 truncated=true + originalLength', () => {
    expect(
      normalizeSummary({ summary: { text: 'x', truncated: true, originalLength: 100 } })
    ).toEqual({ text: 'x', truncated: true, originalLength: 100 })
  })

  it('新形式 truncated=true だが originalLength 欠落は undefined (illegal state)', () => {
    expect(normalizeSummary({ summary: { text: 'x', truncated: true } })).toBeUndefined()
  })

  it('旧形式 string + truncated メタなし → truncated=false', () => {
    expect(normalizeSummary({ summary: '旧要約' })).toEqual({
      text: '旧要約',
      truncated: false,
    })
  })

  it('旧形式 string + summaryTruncated=true + originalLength → truncated=true', () => {
    expect(
      normalizeSummary({
        summary: '旧要約',
        summaryTruncated: true,
        summaryOriginalLength: 500,
      })
    ).toEqual({ text: '旧要約', truncated: true, originalLength: 500 })
  })

  it('新形式で truncated が文字列 "true" の場合は undefined (型防御)', () => {
    // Firestore は型安全でないため、誤った書込で summary.truncated が文字列になるケースを想定
    expect(
      normalizeSummary({ summary: { text: 'x', truncated: 'true' } })
    ).toBeUndefined()
  })

  it('summary が数値の場合は undefined (不正型防御)', () => {
    expect(normalizeSummary({ summary: 42 })).toBeUndefined()
  })
})

describe('getReprocessClearFields (Issue #215: 旧3キー + 新summary 全て delete)', () => {
  it('summary + 旧 summaryTruncated + 旧 summaryOriginalLength を含む', () => {
    const fields = getReprocessClearFields()
    // Issue #215: 新ネスト summary と旧フラット3キーを同時にクリア
    // (再処理時に Firestore に残存する旧フィールドも明示削除)
    expect(fields).toHaveProperty('summary')
    expect(fields).toHaveProperty('summaryTruncated')
    expect(fields).toHaveProperty('summaryOriginalLength')
  })

  it('OCR結果 / ocrResult / pageResults / ocrExtraction も含む', () => {
    const fields = getReprocessClearFields()
    expect(fields).toHaveProperty('ocrResult')
    expect(fields).toHaveProperty('ocrResultUrl')
    expect(fields).toHaveProperty('pageResults')
    expect(fields).toHaveProperty('ocrExtraction')
  })

  it('確認ステータスのリセット値 (customerConfirmed=false, verified=false 等) を含む', () => {
    const fields = getReprocessClearFields()
    expect(fields.customerConfirmed).toBe(false)
    expect(fields.officeConfirmed).toBe(false)
    expect(fields.verified).toBe(false)
    expect(fields.confirmedBy).toBeNull()
    expect(fields.verifiedBy).toBeNull()
  })
})
