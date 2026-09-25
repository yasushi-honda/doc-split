/**
 * csvImportMatching テスト（Issue #1036）
 */

import { describe, it, expect } from 'vitest'
import { matchRowsById, type CsvRowWithId, type ExistingRecordWithId } from '../csvImportMatching'

interface Row extends CsvRowWithId {
  notes?: string
}

describe('matchRowsById', () => {
  const existing: ExistingRecordWithId[] = [
    { id: 'cust-1', name: '山田太郎' },
    { id: 'cust-2', name: '田中花子' },
  ]

  it('IDが一致する行はidMatchRowsに振り分けられる', () => {
    const rows: Row[] = [{ id: 'cust-1', name: '山田太郎', notes: '更新後の備考' }]
    const result = matchRowsById(rows, existing)
    expect(result.idMatchRows).toHaveLength(1)
    expect(result.idMatchRows[0]?.existing.id).toBe('cust-1')
    expect(result.remainingRows).toHaveLength(0)
  })

  it('IDがあるがDBに無い行は名前照合(remainingRows)へフォールバックする', () => {
    const rows: Row[] = [{ id: 'cust-999', name: '削除済み太郎' }]
    const result = matchRowsById(rows, existing)
    expect(result.idMatchRows).toHaveLength(0)
    expect(result.remainingRows).toEqual(rows)
  })

  it('ID無しの行は名前照合(remainingRows)へ回る', () => {
    const rows: Row[] = [{ name: '新規太郎' }]
    const result = matchRowsById(rows, existing)
    expect(result.idMatchRows).toHaveLength(0)
    expect(result.remainingRows).toEqual(rows)
  })

  it('existingRecordsがundefined(書類種別・ケアマネ相当)のときは常に名前照合へ回る', () => {
    const rows: Row[] = [{ id: 'doc-1', name: '介護保険被保険者証' }]
    const result = matchRowsById(rows, undefined)
    expect(result.idMatchRows).toHaveLength(0)
    expect(result.remainingRows).toEqual(rows)
    expect(result.duplicateIds).toEqual([])
  })

  it('名前を書き換えたID一致行もidMatchとして扱われ、resolvedData.nameは既存値のまま維持される', () => {
    const rows: Row[] = [{ id: 'cust-1', name: '山田太郎(改名後)' }]
    const result = matchRowsById(rows, existing)
    expect(result.idMatchRows).toHaveLength(1)
    // 名前照合で「新規」扱いになっていない(remainingRowsは空)こと
    expect(result.remainingRows).toHaveLength(0)
    // 書込み用データの名前は既存値のまま(CSV側の改名は反映しない)
    expect(result.idMatchRows[0]?.resolvedData.name).toBe('山田太郎')
    // 元のCSV行(プレビュー用)にはCSV側の改名後の名前が残っている
    expect(result.idMatchRows[0]?.csvRow.name).toBe('山田太郎(改名後)')
  })

  it('CSV内でID列が重複している行はduplicateIdsに記録され、idMatchRowsには含めない', () => {
    const rows: Row[] = [
      { id: 'cust-1', name: '山田太郎' },
      { id: 'cust-1', name: '山田太郎(誤って複製)' },
    ]
    const result = matchRowsById(rows, existing)
    expect(result.duplicateIds).toEqual(['cust-1'])
    expect(result.idMatchRows).toHaveLength(0)
    expect(result.remainingRows).toHaveLength(2)
  })

  it('重複していないID一致行と重複しているID行が混在する場合、重複分のみ名前照合へ回る', () => {
    const rows: Row[] = [
      { id: 'cust-2', name: '田中花子' },
      { id: 'cust-1', name: 'A' },
      { id: 'cust-1', name: 'B' },
    ]
    const result = matchRowsById(rows, existing)
    expect(result.idMatchRows).toHaveLength(1)
    expect(result.idMatchRows[0]?.existing.id).toBe('cust-2')
    expect(result.remainingRows).toHaveLength(2)
    expect(result.duplicateIds).toEqual(['cust-1'])
  })
})
