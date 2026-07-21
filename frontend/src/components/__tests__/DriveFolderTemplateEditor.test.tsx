/**
 * DriveFolderTemplateEditor テスト(ADR-0022)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DriveFolderTemplateEditor } from '../DriveFolderTemplateEditor'
import { KANAME_PRESET_TEMPLATE, COCORO_PRESET_TEMPLATE } from '@/lib/driveFolderTemplate'
import type { DriveFolderTemplate } from '@shared/types'

// @testing-library/jest-dom は未導入のため、disabled 判定はネイティブDOMプロパティで検証する
const isDisabled = (el: HTMLElement): boolean => (el as HTMLButtonElement).disabled

// noUncheckedIndexedAccess下でgetAllBy*の配列アクセスがundefined許容型になるため、
// テスト内では「見つからなければ即失敗」を明示するヘルパーを介す
function nth<T>(arr: T[], index: number): T {
  const el = arr[index]
  if (el === undefined) throw new Error(`要素が見つかりません: index=${index}`)
  return el
}

let mockDocumentMastersData: { name: string }[] | undefined = [
  { name: '居宅サービス計画書（1）' },
  { name: '主治医意見書' },
]

vi.mock('@/hooks/useDocuments', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useDocuments')>('@/hooks/useDocuments')
  return {
    ...actual,
    useDocumentMasters: () => ({ data: mockDocumentMastersData }),
  }
})

describe('DriveFolderTemplateEditor', () => {
  let onChange: Mock<(t: DriveFolderTemplate) => void>
  let onFuriganaFallbackChange: Mock<(v: 'stop' | 'useNameInitial') => void>

  beforeEach(() => {
    onChange = vi.fn()
    onFuriganaFallbackChange = vi.fn()
    mockDocumentMastersData = [{ name: '居宅サービス計画書（1）' }, { name: '主治医意見書' }]
  })

  function renderEditor(template: DriveFolderTemplate, furiganaFallback: 'stop' | 'useNameInitial' = 'stop') {
    return render(
      <DriveFolderTemplateEditor
        template={template}
        furiganaFallback={furiganaFallback}
        onChange={onChange}
        onFuriganaFallbackChange={onFuriganaFallbackChange}
      />
    )
  }

  it('各セグメント種別のミニフォームが描画される', () => {
    renderEditor(KANAME_PRESET_TEMPLATE)
    expect(screen.getByLabelText('固定文字列')).toBeDefined()
    expect(screen.getByLabelText('ケアマネの表示形式')).toBeDefined()
    expect(screen.getByLabelText('利用者の表示形式')).toBeDefined()
    expect(screen.getByText('書類の種別名がそのままフォルダ名になります')).toBeDefined()
  })

  it('テンプレートが空の場合、警告メッセージが表示される', () => {
    renderEditor([])
    expect(screen.getByText('フォルダ階層を1つ以上設定してください')).toBeDefined()
  })

  it('「階層を追加」で新しいセグメントが末尾に追加される', () => {
    renderEditor([{ type: 'documentCategory' }])
    fireEvent.click(screen.getByText('階層を追加'))
    expect(onChange).toHaveBeenCalledWith([
      { type: 'documentCategory' },
      { type: 'fixed', value: '' },
    ])
  })

  it('削除ボタンでセグメントが除去される', () => {
    renderEditor([{ type: 'fixed', value: 'A' }, { type: 'documentCategory' }])
    const removeButtons = screen.getAllByTitle('削除')
    fireEvent.click(nth(removeButtons, 0))
    expect(onChange).toHaveBeenCalledWith([{ type: 'documentCategory' }])
  })

  it('先頭セグメントの上移動ボタンは無効化される', () => {
    renderEditor([{ type: 'fixed', value: 'A' }, { type: 'documentCategory' }])
    const upButtons = screen.getAllByTitle('上へ移動')
    expect(isDisabled(nth(upButtons, 0))).toBe(true)
    expect(isDisabled(nth(upButtons, 1))).toBe(false)
  })

  it('末尾セグメントの下移動ボタンは無効化される', () => {
    renderEditor([{ type: 'fixed', value: 'A' }, { type: 'documentCategory' }])
    const downButtons = screen.getAllByTitle('下へ移動')
    expect(isDisabled(nth(downButtons, 0))).toBe(false)
    expect(isDisabled(nth(downButtons, 1))).toBe(true)
  })

  it('下移動ボタンでセグメントの順序が入れ替わる', () => {
    renderEditor([{ type: 'fixed', value: 'A' }, { type: 'documentCategory' }])
    const downButtons = screen.getAllByTitle('下へ移動')
    fireEvent.click(nth(downButtons, 0))
    expect(onChange).toHaveBeenCalledWith([{ type: 'documentCategory' }, { type: 'fixed', value: 'A' }])
  })

  it('fixedセグメントのテキスト入力でonChangeが発火する', () => {
    renderEditor([{ type: 'fixed', value: '' }])
    fireEvent.change(screen.getByLabelText('固定文字列'), { target: { value: '新フォルダ' } })
    expect(onChange).toHaveBeenCalledWith([{ type: 'fixed', value: '新フォルダ' }])
  })

  it('dateセグメント: 現行マスタの書類種別名がcheckboxで表示される', () => {
    renderEditor([{ type: 'date', format: 'YYYY年MM月', onlyForCategories: [] }])
    expect(screen.getByText('居宅サービス計画書（1）')).toBeDefined()
    expect(screen.getByText('主治医意見書')).toBeDefined()
  })

  it('dateセグメント: マスタに無い保存値は「マスタに存在しません」マーカー付きで表示され、外せる', () => {
    renderEditor([
      { type: 'date', format: 'YYYY年MM月', onlyForCategories: ['廃止された書類種別'] },
    ])
    expect(screen.getByText('廃止された書類種別')).toBeDefined()
    expect(screen.getByText('（マスタに存在しません）')).toBeDefined()

    const checkbox = screen.getByRole('checkbox', { name: /廃止された書類種別/ })
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith([
      { type: 'date', format: 'YYYY年MM月', onlyForCategories: [] },
    ])
  })

  it('dateセグメント: checkboxチェックでonlyForCategoriesに追加される', () => {
    renderEditor([{ type: 'date', format: 'YYYY年MM月', onlyForCategories: [] }])
    const checkbox = screen.getByRole('checkbox', { name: /主治医意見書/ })
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith([
      { type: 'date', format: 'YYYY年MM月', onlyForCategories: ['主治医意見書'] },
    ])
  })

  it('dateセグメント: useDocumentMasters()が未ロード(undefined)でもクラッシュしない', () => {
    mockDocumentMastersData = undefined
    expect(() =>
      renderEditor([{ type: 'date', format: 'YYYY年MM月', onlyForCategories: ['何か'] }])
    ).not.toThrow()
    expect(screen.getByText('何か')).toBeDefined()
  })

  it('dateセグメント: マスタが空配列でもクラッシュしない', () => {
    mockDocumentMastersData = []
    expect(() => renderEditor([{ type: 'date', format: 'YYYY年MM月', onlyForCategories: [] }])).not.toThrow()
    expect(screen.getByText('書類種別マスターが未登録です')).toBeDefined()
  })

  it('furiganaInitialSpaceNameのcustomerセグメントが無ければフリガナ欠損設定は表示されない', () => {
    renderEditor([{ type: 'customer', format: 'nameOnly' }])
    expect(screen.queryByLabelText('フリガナ欠損時の挙動')).toBeNull()
  })

  it('furiganaInitialSpaceNameのcustomerセグメントがあればフリガナ欠損設定が表示される', () => {
    renderEditor([{ type: 'customer', format: 'furiganaInitialSpaceName' }])
    expect(screen.getByLabelText('フリガナ欠損時の挙動')).toBeDefined()
  })

  it('フリガナ欠損時の挙動をuseNameInitialにすると警告文が表示される', () => {
    renderEditor([{ type: 'customer', format: 'furiganaInitialSpaceName' }], 'useNameInitial')
    expect(screen.getByText(/誤った利用者フォルダへ配置されるリスク/)).toBeDefined()
  })

  it('フリガナ欠損時の挙動を変更するとonFuriganaFallbackChangeが発火する', () => {
    renderEditor([{ type: 'customer', format: 'furiganaInitialSpaceName' }])
    fireEvent.change(screen.getByLabelText('フリガナ欠損時の挙動'), {
      target: { value: 'useNameInitial' },
    })
    expect(onFuriganaFallbackChange).toHaveBeenCalledWith('useNameInitial')
  })

  it('「かなめ式で初期化」でKANAME_PRESET_TEMPLATEがonChangeされる', () => {
    renderEditor([])
    fireEvent.click(screen.getByText('かなめ式で初期化'))
    expect(onChange).toHaveBeenCalledWith(KANAME_PRESET_TEMPLATE)
  })

  it('「cocoro式で初期化」でCOCORO_PRESET_TEMPLATEがonChangeされる', () => {
    renderEditor([])
    fireEvent.click(screen.getByText('cocoro式で初期化'))
    expect(onChange).toHaveBeenCalledWith(COCORO_PRESET_TEMPLATE)
  })
})
