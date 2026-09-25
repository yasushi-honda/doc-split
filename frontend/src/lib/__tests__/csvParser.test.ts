/**
 * csvParser テスト
 *
 * Issue #1036: parseCSVがクォート内改行を含む値を正しくレコードとして扱えるか
 * （改行で先に行分割していた旧実装は、備考等の改行を含む値でレコードが分断される
 * 不具合があった）の回帰テストを中心に、id列の読み取りも確認する。
 */

import { describe, it, expect } from 'vitest'
import { parseCSV, mapCustomerCSV, mapOfficeCSV } from '../csvParser'

describe('parseCSV', () => {
  it('通常のCSVを行オブジェクトの配列にパースできる', () => {
    const content = 'name,furigana\n山田太郎,ヤマダタロウ\n田中花子,タナカハナコ\n'
    const rows = parseCSV(content)
    expect(rows).toEqual([
      { name: '山田太郎', furigana: 'ヤマダタロウ' },
      { name: '田中花子', furigana: 'タナカハナコ' },
    ])
  })

  it('ダブルクォートで囲んだ改行を含む値を1レコードとして扱う（回帰テスト）', () => {
    const content = 'name,notes\n山田太郎,"1行目\n2行目"\n田中花子,通常の備考\n'
    const rows = parseCSV(content)
    expect(rows).toEqual([
      { name: '山田太郎', notes: '1行目\n2行目' },
      { name: '田中花子', notes: '通常の備考' },
    ])
  })

  it('CRLF改行を含む値も1レコードとして扱う', () => {
    const content = 'name,notes\r\n山田太郎,"1行目\r\n2行目"\r\n田中花子,通常の備考\r\n'
    const rows = parseCSV(content)
    expect(rows).toEqual([
      { name: '山田太郎', notes: '1行目\r\n2行目' },
      { name: '田中花子', notes: '通常の備考' },
    ])
  })

  it('カンマを含む値をダブルクォートで正しく読み取れる', () => {
    const content = 'name,notes\n山田太郎,"東京都,渋谷区"\n'
    const rows = parseCSV(content)
    expect(rows).toEqual([{ name: '山田太郎', notes: '東京都,渋谷区' }])
  })

  it('エスケープされたダブルクォート（""）を1つのダブルクォートとして読み取れる', () => {
    const content = 'name,notes\n山田太郎,"""重要""です"\n'
    const rows = parseCSV(content)
    expect(rows).toEqual([{ name: '山田太郎', notes: '"重要"です' }])
  })

  it('空行はスキップする', () => {
    const content = 'name,notes\n山田太郎,備考A\n\n田中花子,備考B\n'
    const rows = parseCSV(content)
    expect(rows).toEqual([
      { name: '山田太郎', notes: '備考A' },
      { name: '田中花子', notes: '備考B' },
    ])
  })

  it('末尾に改行が無いCSVでも最後の行を読み取れる', () => {
    const content = 'name,notes\n山田太郎,備考A'
    const rows = parseCSV(content)
    expect(rows).toEqual([{ name: '山田太郎', notes: '備考A' }])
  })

  it('ヘッダーのみ（データ行が無い）場合は空配列を返す', () => {
    const content = 'name,notes\n'
    expect(parseCSV(content)).toEqual([])
  })

  it('ダブルクォートが閉じられないまま終端に達した場合はエラーを投げる（silent-failure-hunter指摘の回帰、レコードのサイレント消失防止）', () => {
    const content = 'name,notes\n山田太郎,"閉じていない\n田中花子,備考B\n'
    expect(() => parseCSV(content)).toThrow('ダブルクォートが閉じられていません')
  })
})

describe('mapCustomerCSV / mapOfficeCSV のid列対応', () => {
  it('id列がある場合はidを読み取る', () => {
    const rows = parseCSV('id,name,furigana\ncust-1,山田太郎,ヤマダタロウ\n')
    const mapped = mapCustomerCSV(rows)
    expect(mapped).toEqual([
      {
        name: '山田太郎',
        furigana: 'ヤマダタロウ',
        isDuplicate: false,
        careManagerName: '',
        notes: '',
        aliases: '',
        id: 'cust-1',
      },
    ])
  })

  it('id列が無いCSV（既存テンプレート）ではidはundefinedのまま', () => {
    const rows = parseCSV('name,furigana\n山田太郎,ヤマダタロウ\n')
    const mapped = mapCustomerCSV(rows)
    expect(mapped[0]?.id).toBeUndefined()
  })

  it('事業所CSVもid列を読み取れる', () => {
    const rows = parseCSV('id,name\noffice-1,〇〇訪問介護\n')
    const mapped = mapOfficeCSV(rows)
    expect(mapped[0]?.id).toBe('office-1')
  })
})
