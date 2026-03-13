import { describe, it, expect } from 'vitest'
import { resolveCareManager } from '../resolveCareManager'

describe('resolveCareManager', () => {
  const customers = [
    { name: '田村 勝義', careManagerName: '長谷川 由紀' },
    { name: '杉山 洋子', careManagerName: '板垣 亜紀子' },
    { name: '中村 太郎', careManagerName: undefined },
    // 同名顧客（isDuplicate相当）
    { name: '鈴木 花子', careManagerName: '長谷川 由紀' },
    { name: '鈴木 花子', careManagerName: '板垣 亜紀子' },
  ]

  it('一意にマッチする顧客のcareManagerNameを返す', () => {
    expect(resolveCareManager('田村 勝義', customers)).toBe('長谷川 由紀')
    expect(resolveCareManager('杉山 洋子', customers)).toBe('板垣 亜紀子')
  })

  it('careManagerNameが未設定の顧客は空文字を返す', () => {
    expect(resolveCareManager('中村 太郎', customers)).toBe('')
  })

  it('同名顧客が複数存在する場合はnullを返す（補完しない）', () => {
    expect(resolveCareManager('鈴木 花子', customers)).toBeNull()
  })

  it('マッチする顧客がいない場合はnullを返す', () => {
    expect(resolveCareManager('存在しない名前', customers)).toBeNull()
  })

  it('空の顧客リストではnullを返す', () => {
    expect(resolveCareManager('田村 勝義', [])).toBeNull()
  })
})
