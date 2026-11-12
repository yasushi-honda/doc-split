/**
 * csvImportMatching テスト（Issue #1036）
 */

import { describe, it, expect } from 'vitest'
import {
  matchRowsById,
  pickBestExistingForCsvRow,
  type CsvRowWithId,
  type ExistingRecordWithId,
} from '../csvImportMatching'

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

describe('pickBestExistingForCsvRow(同名の既存が複数あるとき、CSV行に最も合う既存を選ぶ)', () => {
  // 同姓同名3件(架空)。担当ケアマネ・備考・フリガナで区別する。配列の順は取得順(後ろが「最後の1件」)
  const a = { id: 'a', name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当甲', notes: '(旧)', aliases: '' }
  const b = { id: 'b', name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当乙', notes: '', aliases: '' }
  const c = { id: 'c', name: '架空太郎', furigana: 'かくうたろう', careManagerName: '担当丙', notes: '(現)', aliases: '' }
  const keys = ['furigana', 'careManagerName', 'notes', 'aliases'] as const

  it('候補が空ならundefined', () => {
    expect(pickBestExistingForCsvRow([], { careManagerName: '担当甲' }, keys)).toBeUndefined()
  })

  it('候補が1件ならそれを返す(CSV行が一致しなくても。従来どおり)', () => {
    expect(pickBestExistingForCsvRow([a], { careManagerName: '担当乙' }, keys)?.id).toBe('a')
  })

  it('最後以外の候補と全項目一致するなら、それを選ぶ(既存の人を新規追加にしない)', () => {
    const row = { furigana: 'かくうたろう', careManagerName: '担当甲', notes: '(旧)', aliases: '' }
    expect(pickBestExistingForCsvRow([a, b, c], row, keys)?.id).toBe('a')
  })

  it('途中の候補とだけ一致するなら、その候補を選ぶ', () => {
    const row = { furigana: 'かくうたろう', careManagerName: '担当乙', notes: '', aliases: '' }
    expect(pickBestExistingForCsvRow([a, b, c], row, keys)?.id).toBe('b')
  })

  it('完全一致が無ければ、一致する項目が最も多い候補を選ぶ', () => {
    // フリガナと担当が一致するaが2項目一致で最多(b・cはフリガナだけの1項目)
    const row = { furigana: 'かくうたろう', careManagerName: '担当甲', notes: '(別の備考)', aliases: '' }
    expect(pickBestExistingForCsvRow([a, b, c], row, keys)?.id).toBe('a')
  })

  it('どの候補とも同じだけ一致するなら、後ろの候補(従来の「最後の1件」と同じ)を選ぶ', () => {
    const row = { furigana: 'かくうたろう', careManagerName: '担当丁', notes: '', aliases: '' }
    expect(pickBestExistingForCsvRow([a, b, c], row, keys)?.id).toBe('c')
  })

  it('空欄セルは比較から除く(空欄=変更しない)。名前だけの行は、全候補が一致扱いで後ろを選ぶ', () => {
    expect(pickBestExistingForCsvRow([a, b, c], { furigana: '', careManagerName: '', notes: '', aliases: '' }, keys)?.id).toBe('c')
  })

  it('空欄の項目は無視し、値のある項目だけで選ぶ(担当だけ指定された行)', () => {
    expect(pickBestExistingForCsvRow([a, b, c], { careManagerName: '担当乙' }, keys)?.id).toBe('b')
  })

  it('前後の空白は無視して比較する', () => {
    expect(pickBestExistingForCsvRow([a, b, c], { careManagerName: '  担当甲  ' }, keys)?.id).toBe('a')
  })

  it('既存側が未設定(undefined)の項目は空文字として扱う', () => {
    const noCm = { id: 'x', name: '架空太郎' } as { id: string; name: string; careManagerName?: string }
    const hasCm = { id: 'y', name: '架空太郎', careManagerName: '担当甲' }
    expect(pickBestExistingForCsvRow([hasCm, noCm], { careManagerName: '担当甲' }, ['careManagerName'])?.id).toBe('y')
  })
})
