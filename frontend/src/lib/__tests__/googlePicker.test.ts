/**
 * pickerResponseToRootFolder / isPickerCancelled 単体テスト
 *
 * Google PickerのcallbackがonPickedへ渡すResponseObjectを、
 * settings/drive保存用ペイロード({rootFolderId, rootFolderName})へ変換する
 * 純粋関数の境界値・異常系を検証する。
 * openFolderPicker(window.google.picker依存)はscope外(googlePicker.tsのコメント参照)。
 */

import { describe, it, expect } from 'vitest'
import { pickerResponseToRootFolder, isPickerCancelled } from '../googlePicker'

describe('pickerResponseToRootFolder', () => {
  it('action:pickedかつdocs[0]にid/nameがある → {rootFolderId, rootFolderName}を返す', () => {
    const result = pickerResponseToRootFolder({
      action: 'picked',
      docs: [{ id: 'folder-abc', name: 'エクスポート先' }],
    })

    expect(result).toEqual({ rootFolderId: 'folder-abc', rootFolderName: 'エクスポート先' })
  })

  it('action:cancel（ユーザーがPickerを閉じた） → nullを返す', () => {
    const result = pickerResponseToRootFolder({ action: 'cancel', docs: [] })
    expect(result).toBeNull()
  })

  it('actionが未定義 → nullを返す', () => {
    expect(pickerResponseToRootFolder({})).toBeNull()
  })

  it('dataがnull/undefined → nullを返す（例外を投げない）', () => {
    expect(pickerResponseToRootFolder(null)).toBeNull()
    expect(pickerResponseToRootFolder(undefined)).toBeNull()
  })

  it('action:pickedだがdocsが空配列 → nullを返す', () => {
    const result = pickerResponseToRootFolder({ action: 'picked', docs: [] })
    expect(result).toBeNull()
  })

  it('action:pickedだがdocs自体が未定義 → nullを返す', () => {
    const result = pickerResponseToRootFolder({ action: 'picked' })
    expect(result).toBeNull()
  })

  it('docs[0].idが欠損 → nullを返す', () => {
    const result = pickerResponseToRootFolder({
      action: 'picked',
      docs: [{ name: 'フォルダ名のみ' }],
    })
    expect(result).toBeNull()
  })

  it('docs[0].nameが欠損 → rootFolderNameは空文字にフォールバック', () => {
    const result = pickerResponseToRootFolder({
      action: 'picked',
      docs: [{ id: 'folder-xyz' }],
    })
    expect(result).toEqual({ rootFolderId: 'folder-xyz', rootFolderName: '' })
  })
})

describe('isPickerCancelled', () => {
  it('action:cancel → trueを返す', () => {
    expect(isPickerCancelled({ action: 'cancel' })).toBe(true)
  })

  it('action:picked → falseを返す（選択成功はキャンセルではない）', () => {
    expect(isPickerCancelled({ action: 'picked', docs: [{ id: 'folder-abc' }] })).toBe(false)
  })

  it('action:loaded（Picker表示完了の中間イベント） → falseを返す（キャンセル確定ではない）', () => {
    expect(isPickerCancelled({ action: 'loaded' })).toBe(false)
  })

  it('actionが未定義 → falseを返す', () => {
    expect(isPickerCancelled({})).toBe(false)
  })

  it('dataがnull/undefined → falseを返す（例外を投げない）', () => {
    expect(isPickerCancelled(null)).toBe(false)
    expect(isPickerCancelled(undefined)).toBe(false)
  })
})
