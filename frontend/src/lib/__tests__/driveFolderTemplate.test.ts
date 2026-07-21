/**
 * driveFolderTemplate テスト(ADR-0022)
 *
 * DriveFolderTemplate配列操作の純粋関数群。React/Firestore非依存。
 */

import { describe, it, expect } from 'vitest'
import {
  addSegment,
  removeSegment,
  moveSegment,
  updateSegment,
  describeSegment,
  validateTemplate,
  KANAME_PRESET_TEMPLATE,
  COCORO_PRESET_TEMPLATE,
} from '../driveFolderTemplate'
import type { DriveFolderTemplate } from '@shared/types'

describe('addSegment', () => {
  it('fixedは空文字列valueで追加される', () => {
    const result = addSegment([], 'fixed')
    expect(result).toEqual([{ type: 'fixed', value: '' }])
  })

  it('careManagerはseparatorなし・surnameInitialSpaceNameで追加される', () => {
    const result = addSegment([], 'careManager')
    expect(result).toEqual([{ type: 'careManager', format: 'surnameInitialSpaceName' }])
  })

  it('customerはseparatorなし・furiganaInitialSpaceNameで追加される', () => {
    const result = addSegment([], 'customer')
    expect(result).toEqual([{ type: 'customer', format: 'furiganaInitialSpaceName' }])
  })

  it('documentCategoryは追加フィールドなしで追加される', () => {
    const result = addSegment([], 'documentCategory')
    expect(result).toEqual([{ type: 'documentCategory' }])
  })

  it('dateはonlyForCategories空配列で追加される', () => {
    const result = addSegment([], 'date')
    expect(result).toEqual([{ type: 'date', format: 'YYYY年MM月', onlyForCategories: [] }])
  })

  it('既存テンプレートの末尾に追加し、元の配列は変更しない', () => {
    const original: DriveFolderTemplate = [{ type: 'documentCategory' }]
    const result = addSegment(original, 'fixed')
    expect(original).toHaveLength(1)
    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({ type: 'fixed', value: '' })
  })
})

describe('removeSegment', () => {
  const template: DriveFolderTemplate = [
    { type: 'fixed', value: 'A' },
    { type: 'fixed', value: 'B' },
    { type: 'fixed', value: 'C' },
  ]

  it('指定indexの要素を削除する', () => {
    const result = removeSegment(template, 1)
    expect(result).toEqual([
      { type: 'fixed', value: 'A' },
      { type: 'fixed', value: 'C' },
    ])
  })

  it('先頭要素を削除できる', () => {
    const result = removeSegment(template, 0)
    expect(result[0]).toEqual({ type: 'fixed', value: 'B' })
  })

  it('範囲外index(負数)はno-op', () => {
    const result = removeSegment(template, -1)
    expect(result).toEqual(template)
  })

  it('範囲外index(超過)はno-op', () => {
    const result = removeSegment(template, 99)
    expect(result).toEqual(template)
  })

  it('元の配列を変更しない', () => {
    removeSegment(template, 0)
    expect(template).toHaveLength(3)
  })
})

describe('moveSegment', () => {
  const template: DriveFolderTemplate = [
    { type: 'fixed', value: 'A' },
    { type: 'fixed', value: 'B' },
    { type: 'fixed', value: 'C' },
  ]

  it('upで隣接要素と入れ替わる', () => {
    const result = moveSegment(template, 1, 'up')
    expect(result).toEqual([
      { type: 'fixed', value: 'B' },
      { type: 'fixed', value: 'A' },
      { type: 'fixed', value: 'C' },
    ])
  })

  it('downで隣接要素と入れ替わる', () => {
    const result = moveSegment(template, 1, 'down')
    expect(result).toEqual([
      { type: 'fixed', value: 'A' },
      { type: 'fixed', value: 'C' },
      { type: 'fixed', value: 'B' },
    ])
  })

  it('先頭要素をupするとno-op', () => {
    const result = moveSegment(template, 0, 'up')
    expect(result).toEqual(template)
  })

  it('末尾要素をdownするとno-op', () => {
    const result = moveSegment(template, 2, 'down')
    expect(result).toEqual(template)
  })

  it('範囲外indexはno-op', () => {
    const result = moveSegment(template, 99, 'up')
    expect(result).toEqual(template)
  })
})

describe('updateSegment', () => {
  it('指定indexの要素のみ置換し、他は保持する', () => {
    const template: DriveFolderTemplate = [
      { type: 'fixed', value: 'A' },
      { type: 'documentCategory' },
    ]
    const result = updateSegment(template, 0, { type: 'fixed', value: 'Z' })
    expect(result).toEqual([{ type: 'fixed', value: 'Z' }, { type: 'documentCategory' }])
  })

  it('範囲外indexはno-op', () => {
    const template: DriveFolderTemplate = [{ type: 'documentCategory' }]
    const result = updateSegment(template, 5, { type: 'fixed', value: 'X' })
    expect(result).toEqual(template)
  })
})

describe('describeSegment', () => {
  it('fixed: 値ありはその値を含む', () => {
    expect(describeSegment({ type: 'fixed', value: '北名古屋事業所' })).toContain('北名古屋事業所')
  })

  it('fixed: 未入力は明示される', () => {
    expect(describeSegment({ type: 'fixed', value: '' })).toContain('未入力')
  })

  it('careManager: separator未設定時は半角スペース(デフォルト)が表示される', () => {
    const label = describeSegment({ type: 'careManager', format: 'surnameInitialSpaceName' })
    expect(label).toContain('半角スペース')
  })

  it('careManager: separator明示指定時はその値が表示される', () => {
    const label = describeSegment({ type: 'careManager', format: 'surnameInitialSpaceName', separator: 'full' })
    expect(label).toContain('全角スペース')
  })

  it('customer: separator未設定時は全角スペース(デフォルト)が表示される', () => {
    const label = describeSegment({ type: 'customer', format: 'furiganaInitialSpaceName' })
    expect(label).toContain('全角スペース')
  })

  it('customer: nameOnlyはseparator表記を含まない', () => {
    const label = describeSegment({ type: 'customer', format: 'nameOnly' })
    expect(label).not.toContain('スペース')
  })

  it('documentCategory: 固定ラベル', () => {
    expect(describeSegment({ type: 'documentCategory' })).toBe('書類カテゴリ')
  })

  it('date: onlyForCategoriesありは対象書類種別名を含む', () => {
    const label = describeSegment({ type: 'date', format: 'YYYY年MM月', onlyForCategories: ['居宅サービス計画書（1）'] })
    expect(label).toContain('居宅サービス計画書（1）')
  })

  it('date: onlyForCategories空は警告文になる', () => {
    const label = describeSegment({ type: 'date', format: 'YYYY年MM月', onlyForCategories: [] })
    expect(label).toContain('常に生成されません')
  })
})

describe('validateTemplate', () => {
  it('空テンプレートは警告を返す', () => {
    expect(validateTemplate([])).toHaveLength(1)
  })

  it('fixedのvalueが空白のみの場合は警告を返す', () => {
    const warnings = validateTemplate([{ type: 'fixed', value: '   ' }])
    expect(warnings).toHaveLength(1)
  })

  it('dateのonlyForCategoriesが空の場合は警告を返す', () => {
    const warnings = validateTemplate([{ type: 'date', format: 'YYYY年MM月', onlyForCategories: [] }])
    expect(warnings).toHaveLength(1)
  })

  it('問題がない構成では警告なし', () => {
    const warnings = validateTemplate([
      { type: 'fixed', value: '共有フォルダ' },
      { type: 'careManager', format: 'nameOnly' },
      { type: 'customer', format: 'nameOnly' },
    ])
    expect(warnings).toEqual([])
  })

  it('複数の問題がある場合は複数の警告を返す', () => {
    const warnings = validateTemplate([
      { type: 'fixed', value: '' },
      { type: 'date', format: 'YYYY年MM月', onlyForCategories: [] },
    ])
    expect(warnings).toHaveLength(2)
  })
})

describe('プリセットテンプレート', () => {
  it('KANAME_PRESET_TEMPLATEはバリデーションを通過する', () => {
    expect(validateTemplate(KANAME_PRESET_TEMPLATE)).toEqual([])
  })

  it('COCORO_PRESET_TEMPLATEはバリデーションを通過する', () => {
    expect(validateTemplate(COCORO_PRESET_TEMPLATE)).toEqual([])
  })
})
