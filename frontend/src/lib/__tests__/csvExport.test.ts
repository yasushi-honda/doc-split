/**
 * csvExport テスト（Issue #1036）
 *
 * 4マスターの列順・区切り文字・ID列の有無、エスケープ、
 * 書き出した文字列をparseCSV+mapXxxCSVで読み戻して元データと一致すること
 * （ラウンドトリップ）を確認する。
 */

import { describe, it, expect } from 'vitest'
import type { CustomerMaster, OfficeMaster, DocumentMaster, CareManagerMaster } from '@shared/types'
import {
  exportCustomersToCsv,
  exportOfficesToCsv,
  exportDocumentTypesToCsv,
  exportCareManagersToCsv,
} from '../csvExport'
import {
  parseCSV,
  mapCustomerCSV,
  mapOfficeCSV,
  mapDocumentTypeCSV,
  mapCareManagerCSV,
} from '../csvParser'

describe('exportCustomersToCsv', () => {
  const customers: CustomerMaster[] = [
    {
      id: 'cust-1',
      name: '山田太郎',
      furigana: 'ヤマダタロウ',
      careManagerName: '佐藤花子',
      notes: '北区在住',
      aliases: ['やまだ太郎', '山田 太郎'],
    },
    {
      id: 'cust-2',
      name: '田中花子',
    },
  ]

  it('先頭にID列、続けてCSV_TEMPLATES.customers.headersと同じ列順で書き出す', () => {
    const csv = exportCustomersToCsv(customers)
    const firstLine = csv.split('\n')[0]
    expect(firstLine).toBe('id,name,furigana,careManagerName,notes,aliases')
  })

  it('別表記は|区切りで連結する', () => {
    const csv = exportCustomersToCsv(customers)
    expect(csv).toContain('やまだ太郎|山田 太郎')
  })

  it('カンマ・改行を含む値をエスケープする', () => {
    const csv = exportCustomersToCsv([
      { id: 'cust-3', name: '鈴木一郎', notes: '東京都,渋谷区\n備考2行目' },
    ])
    expect(csv).toContain('"東京都,渋谷区\n備考2行目"')
  })

  it('空配列はヘッダー行のみを返す', () => {
    const csv = exportCustomersToCsv([])
    expect(csv).toBe('id,name,furigana,careManagerName,notes,aliases')
  })

  it('ラウンドトリップ: 書き出したCSVをparseCSV+mapCustomerCSVで読み戻すと元データと一致する', () => {
    const csv = exportCustomersToCsv(customers)
    const mapped = mapCustomerCSV(parseCSV(csv))
    expect(mapped).toEqual([
      {
        id: 'cust-1',
        name: '山田太郎',
        furigana: 'ヤマダタロウ',
        careManagerName: '佐藤花子',
        notes: '北区在住',
        aliases: 'やまだ太郎|山田 太郎',
        isDuplicate: false,
      },
      {
        id: 'cust-2',
        name: '田中花子',
        furigana: '',
        careManagerName: '',
        notes: '',
        aliases: '',
        isDuplicate: false,
      },
    ])
  })

  it('ラウンドトリップ: 改行を含む備考も正しく読み戻せる', () => {
    const csv = exportCustomersToCsv([
      { id: 'cust-4', name: '高橋次郎', notes: '1行目\n2行目' },
    ])
    const mapped = mapCustomerCSV(parseCSV(csv))
    expect(mapped[0]?.notes).toBe('1行目\n2行目')
  })
})

describe('exportOfficesToCsv', () => {
  const offices: OfficeMaster[] = [
    { id: 'office-1', name: '〇〇訪問介護ステーション', notes: '東部地区担当', aliases: ['〇〇訪問介護'] },
  ]

  it('先頭にID列、続けてCSV_TEMPLATES.offices.headersと同じ列順で書き出す', () => {
    const csv = exportOfficesToCsv(offices)
    expect(csv.split('\n')[0]).toBe('id,name,notes,aliases')
  })

  it('ラウンドトリップ: 書き出したCSVをparseCSV+mapOfficeCSVで読み戻すと元データと一致する', () => {
    const csv = exportOfficesToCsv(offices)
    const mapped = mapOfficeCSV(parseCSV(csv))
    expect(mapped).toEqual([
      { id: 'office-1', name: '〇〇訪問介護ステーション', shortName: '', notes: '東部地区担当', aliases: '〇〇訪問介護' },
    ])
  })
})

describe('exportDocumentTypesToCsv', () => {
  const documentTypes: DocumentMaster[] = [
    {
      name: '介護保険被保険者証',
      dateMarker: '有効期限',
      category: '保険証',
      keywords: ['被保険者証', '介護保険', '要介護'],
      aliases: ['被保険者証', '介護保険証'],
    },
  ]

  it('ID列なしでCSV_TEMPLATES.documents.headersと同じ列順で書き出す', () => {
    const csv = exportDocumentTypesToCsv(documentTypes)
    expect(csv.split('\n')[0]).toBe('name,dateMarker,category,keywords,aliases')
  })

  it('キーワードは;区切り、別表記は|区切りで連結する', () => {
    const csv = exportDocumentTypesToCsv(documentTypes)
    expect(csv).toContain('被保険者証;介護保険;要介護')
    expect(csv).toContain('被保険者証|介護保険証')
  })

  it('ラウンドトリップ: 書き出したCSVをparseCSV+mapDocumentTypeCSVで読み戻すと元データと一致する', () => {
    const csv = exportDocumentTypesToCsv(documentTypes)
    const mapped = mapDocumentTypeCSV(parseCSV(csv))
    expect(mapped).toEqual([
      {
        name: '介護保険被保険者証',
        dateMarker: '有効期限',
        category: '保険証',
        keywords: '被保険者証;介護保険;要介護',
        aliases: '被保険者証|介護保険証',
      },
    ])
  })
})

describe('exportCareManagersToCsv', () => {
  const careManagers: CareManagerMaster[] = [
    { id: 'cm-1', name: '佐藤花子', email: 'sato@example.com' },
  ]

  it('ID列なしでCSV_TEMPLATES.caremanagers.headersと同じ列順で書き出す', () => {
    const csv = exportCareManagersToCsv(careManagers)
    expect(csv.split('\n')[0]).toBe('name,email')
  })

  it('ラウンドトリップ: 書き出したCSVをparseCSV+mapCareManagerCSVで読み戻すと元データと一致する', () => {
    const csv = exportCareManagersToCsv(careManagers)
    const mapped = mapCareManagerCSV(parseCSV(csv))
    expect(mapped).toEqual([{ name: '佐藤花子', email: 'sato@example.com' }])
  })

  it('空配列はヘッダー行のみを返す', () => {
    expect(exportCareManagersToCsv([])).toBe('name,email')
  })
})
