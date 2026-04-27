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

  // 呼び出し側（DocumentDetailModal の顧客選択 onChange）では、
  // resolveCareManager の戻り値に加えて「careManager が空欄かどうか」も判定する。
  // ここでは関数自体ではなく、その合成ロジックの意図をテストとして固定する。
  // 実装: `if (cm !== null && !editedFields.careManager) updateField('careManager', cm)`
  describe('呼び出し側の合成ロジック（DocumentDetailModal の顧客変更時）', () => {
    const shouldAutoComplete = (
      newCustomerName: string,
      currentCareManager: string,
      customerList: typeof customers,
    ): boolean => {
      const cm = resolveCareManager(newCustomerName, customerList)
      return cm !== null && !currentCareManager
    }

    it('AC2: careManager が空 + 一意マッチ → 自動補完 true', () => {
      expect(shouldAutoComplete('田村 勝義', '', customers)).toBe(true)
    })

    it('AC3: careManager に既存値あり → 一意マッチでも自動補完 false', () => {
      expect(shouldAutoComplete('田村 勝義', '手動入力CM', customers)).toBe(false)
    })

    it('AC3: careManager に既存値あり → 同名顧客（null）でも自動補完 false', () => {
      expect(shouldAutoComplete('鈴木 花子', '手動入力CM', customers)).toBe(false)
    })

    it('careManager が空 + 同名顧客（null）→ 自動補完 false', () => {
      expect(shouldAutoComplete('鈴木 花子', '', customers)).toBe(false)
    })

    it('careManager が空 + マッチなし → 自動補完 false', () => {
      expect(shouldAutoComplete('存在しない', '', customers)).toBe(false)
    })
  })
})
