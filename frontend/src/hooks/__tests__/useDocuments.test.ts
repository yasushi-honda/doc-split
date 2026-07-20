/**
 * firestoreToDocument 単体テスト
 *
 * TDD: 事業所同名対応バグ修正の検証
 * - officeConfirmed / officeCandidates フィールドが正しく変換されること
 */

import { describe, it, expect } from 'vitest'
import { deleteField, Timestamp } from 'firebase/firestore'
import {
  firestoreToDocument,
  normalizeSummary,
  getReprocessClearFields,
  getReprocessDetailClearFields,
  resolveDetailFields,
  applySearchTextFilter,
} from '../useDocuments'
import type { Document } from '@shared/types'

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

    // ADR-0018 Phase B (Issue #547, #178教訓): ocrExcerptがfirestoreToDocument()で
    // マッピングされないと、Functions側が書込んでもFEで永久に読めなくなる
    it('ocrExcerpt を正しく変換する (ADR-0018 Phase B)', () => {
      const data = { ...baseFirestoreData, ocrExcerpt: '抜粋テキスト' }
      const result = firestoreToDocument('doc-001', data)
      expect(result.ocrExcerpt).toBe('抜粋テキスト')
    })

    it('ocrExcerpt が未設定の場合は undefined', () => {
      const result = firestoreToDocument('doc-001', baseFirestoreData)
      expect(result.ocrExcerpt).toBeUndefined()
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

    it('documentTypeConfirmed: false を正しく変換する (Issue #526)', () => {
      const data = {
        ...baseFirestoreData,
        documentTypeConfirmed: false,
      }

      const result = firestoreToDocument('doc-001', data)

      expect(result.documentTypeConfirmed).toBe(false)
    })

    it('documentTypeConfirmed: true を正しく変換する (Issue #526)', () => {
      const data = {
        ...baseFirestoreData,
        documentTypeConfirmed: true,
      }

      const result = firestoreToDocument('doc-001', data)

      expect(result.documentTypeConfirmed).toBe(true)
    })

    it('documentTypeConfirmed が undefined の場合も正しく処理する (Issue #526)', () => {
      const result = firestoreToDocument('doc-001', baseFirestoreData)

      expect(result.documentTypeConfirmed).toBeUndefined()
    })

    it('distributionId を正しく変換する (GOAL.md task 6-1, PR-C)', () => {
      const data = {
        ...baseFirestoreData,
        distributionId: 'orig-doc-1',
      }

      const result = firestoreToDocument('doc-001', data)

      expect(result.distributionId).toBe('orig-doc-1')
    })

    it('distributionId が undefined の場合も正しく処理する (GOAL.md task 6-1, PR-C)', () => {
      const result = firestoreToDocument('doc-001', baseFirestoreData)

      expect(result.distributionId).toBeUndefined()
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

  // ADR-0018 Phase B (Issue #547): 一覧表示用軽量抜粋も再処理時にクリアしないと、
  // OCR完了までの間、古いocrExcerptが一覧に残存する
  it('ocrExcerpt も含む (ADR-0018 Phase B)', () => {
    const fields = getReprocessClearFields()
    expect(fields).toHaveProperty('ocrExcerpt')
  })

  it('確認ステータスのリセット値 (customerConfirmed=false, verified=false 等) を含む', () => {
    const fields = getReprocessClearFields()
    expect(fields.customerConfirmed).toBe(false)
    expect(fields.officeConfirmed).toBe(false)
    expect(fields.verified).toBe(false)
    expect(fields.confirmedBy).toBeNull()
    expect(fields.verifiedBy).toBeNull()
  })

  // #360 code-reviewer I3: PR #359 で rescue が error/pending 両経路で retryCount/retryAfter を
  // 扱うようになった。reprocess (FE 手動再処理) でも古い値を残さずクリアすることで、
  // 再処理後の monitor (retryCount が古い値から始まる等) を防ぐ。
  it('retryCount / retryAfter を含む (#360)', () => {
    const fields = getReprocessClearFields()
    expect(fields).toHaveProperty('retryCount')
    expect(fields).toHaveProperty('retryAfter')
  })

  it('documentTypeConfirmed を false にリセットする (Issue #526)', () => {
    const fields = getReprocessClearFields()
    expect(fields.documentTypeConfirmed).toBe(false)
  })

  // ADR-0022 Phase1 code-review CONFIRMED指摘対応: エクスポート済み(driveExportStatus:
  // 'exported')docを再処理してもフィールドが残存すると、訂正後の再確認でトリガーの
  // クレームが既存ステータスを検知しスキップしてしまい、二度と再エクスポートされない
  it('Drive エクスポート系5フィールドを含む (ADR-0022)', () => {
    const fields = getReprocessClearFields()
    expect(fields).toHaveProperty('driveExportStatus')
    expect(fields).toHaveProperty('driveFileId')
    expect(fields).toHaveProperty('driveExportedAt')
    expect(fields).toHaveProperty('driveExportError')
    expect(fields).toHaveProperty('driveExportRunId')
  })

  // GOAL.md task 6-2 (PR-C): distributionId保持docは顧客系フィールドを再処理で
  // 上書きしてはならない(BE側confirmedFieldMerge保護が機能する前提を崩さないため)
  describe('preserveDistributionFields (GOAL.md task 6-2, PR-C)', () => {
    it('デフォルト(引数省略)では customerId/customerName/customerConfirmed/careManager をクリア対象に含む', () => {
      const fields = getReprocessClearFields()
      expect(fields).toHaveProperty('customerId')
      expect(fields).toHaveProperty('customerName')
      expect(fields).toHaveProperty('careManager')
      expect(fields.customerConfirmed).toBe(false)
    })

    it('preserveDistributionFields=false では通常どおりクリア対象に含む', () => {
      const fields = getReprocessClearFields(false)
      expect(fields).toHaveProperty('customerId')
      expect(fields).toHaveProperty('customerName')
      expect(fields).toHaveProperty('careManager')
      expect(fields.customerConfirmed).toBe(false)
    })

    it('preserveDistributionFields=true では customerId/customerName/customerConfirmed/careManager をクリア対象から除外する', () => {
      const fields = getReprocessClearFields(true)
      expect(fields).not.toHaveProperty('customerId')
      expect(fields).not.toHaveProperty('customerName')
      expect(fields).not.toHaveProperty('careManager')
      expect(fields).not.toHaveProperty('customerConfirmed')
    })

    it('preserveDistributionFields=true でも他の顧客系フィールド(officeId等)は通常どおりクリア対象に含む', () => {
      const fields = getReprocessClearFields(true)
      expect(fields).toHaveProperty('officeId')
      expect(fields).toHaveProperty('officeName')
      expect(fields.officeConfirmed).toBe(false)
      expect(fields.verified).toBe(false)
    })
  })
})

describe('getReprocessDetailClearFields (ADR-0018 Phase D PR4b, Issue #547)', () => {
  it('detail/main の update 対象は ocrResult / pageResults の2キーのみ (更新対象外フィールドに触れない)', () => {
    const fields = getReprocessDetailClearFields()
    // firestore.rules は affectedKeys().hasOnly(['ocrResult', 'pageResults']) を要求する。
    // キーが増減すると permission-denied で再処理 batch 全体が失敗する
    expect(Object.keys(fields).sort()).toEqual(['ocrResult', 'pageResults'])
  })

  it('両フィールドとも deleteField sentinel (値の設定は rules が拒否するため不可)', () => {
    const fields = getReprocessDetailClearFields()
    // rules は「フィールド削除または無変更」のみ許可。'' や null の設定は
    // 値の上書きとして permission-denied になる
    expect(deleteField().isEqual(fields.ocrResult)).toBe(true)
    expect(deleteField().isEqual(fields.pageResults)).toBe(true)
  })
})

describe('resolveDetailFields (ADR-0018 Phase D PR-D3, Issue #547 — FE版、BE resolveDetailFields とペア不変条件)', () => {
  it('detail優先: detailに両フィールドがあれば親の値は使わない', () => {
    const r = resolveDetailFields(
      { ocrResult: 'detail-text', pageResults: [{ pageNumber: 1 }] as Document['pageResults'] },
      { ocrResult: 'parent-text', pageResults: [{ pageNumber: 99 }] as Document['pageResults'] }
    )
    expect(r.ocrResult).toBe('detail-text')
    expect(r.pageResults).toEqual([{ pageNumber: 1 }])
  })

  it('親フォールバック: detail不在(undefined)なら親の値を使う', () => {
    const r = resolveDetailFields(undefined, {
      ocrResult: 'parent-text',
      pageResults: [{ pageNumber: 2 }] as Document['pageResults'],
    })
    expect(r.ocrResult).toBe('parent-text')
    expect(r.pageResults).toEqual([{ pageNumber: 2 }])
  })

  it('フィールド単位フォールバック: detail存在・フィールド不在(reprocess-clear後)は親を参照', () => {
    const r = resolveDetailFields({}, { ocrResult: 'parent-text', pageResults: [] })
    expect(r.ocrResult).toBe('parent-text')
    expect(r.pageResults).toEqual([])
  })

  it("detailのocrResult=''は有効値(Storage offload済み): 親へフォールバックしない", () => {
    const r = resolveDetailFields({ ocrResult: '' }, { ocrResult: 'stale-parent-text' })
    expect(r.ocrResult).toBe('')
  })

  it('親がnull(loading中): detail優先値のみで解決する', () => {
    const r = resolveDetailFields({ ocrResult: 'detail-text' }, null)
    expect(r.ocrResult).toBe('detail-text')
  })

  it('両方欠落: フィールドはundefined(捏造しない、Phase E後の想定挙動)', () => {
    const r = resolveDetailFields(undefined, undefined)
    expect(r.ocrResult).toBeUndefined()
    expect(r.pageResults).toBeUndefined()
  })

  it('空配列のpageResultsは有効値: 親へフォールバックしない', () => {
    const r = resolveDetailFields(
      { pageResults: [] },
      { ocrResult: 'parent-text', pageResults: [{ pageNumber: 1 }] as Document['pageResults'] }
    )
    expect(r.pageResults).toEqual([])
  })
})

describe('applySearchTextFilter (ADR-0018 Phase D、Issue #547: ocrResult条件除去)', () => {
  const docs = [
    { fileName: 'invoice.pdf', customerName: '山田太郎', documentType: '請求書' },
    { fileName: 'careplan.pdf', customerName: '佐藤花子', documentType: 'ケアプラン' },
  ] as Document[]

  it('searchText未指定なら全件そのまま返す', () => {
    expect(applySearchTextFilter(docs, undefined)).toEqual(docs)
  })

  it('fileName / customerName / documentType の部分一致でフィルタする', () => {
    expect(applySearchTextFilter(docs, '山田')).toEqual([docs[0]])
    expect(applySearchTextFilter(docs, 'ケアプラン')).toEqual([docs[1]])
    expect(applySearchTextFilter(docs, 'invoice')).toEqual([docs[0]])
  })

  it('ocrResultがundefinedでも例外を投げない (Phase E後、本体からocrResultが削除された状態を再現)', () => {
    const docsWithoutOcrResult = docs.map((d) => {
      const withoutOcr = { ...d } as unknown as Record<string, unknown>
      delete withoutOcr.ocrResult
      return withoutOcr as unknown as Document
    })
    expect(() => applySearchTextFilter(docsWithoutOcrResult, '山田')).not.toThrow()
    expect(applySearchTextFilter(docsWithoutOcrResult, '山田')).toEqual([docsWithoutOcrResult[0]])
  })
})
