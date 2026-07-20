/**
 * normalizeDriveSettings 単体テスト
 *
 * settings/drive の生データ→DriveSettings正規化ロジックを検証する。
 * hook本体(useDriveSettings/useUpdateDriveSettings)はReact Query + Firestoreへの
 * 依存が大きいためscope外(既存のuseProcessingHistory等と同じ方針)。
 */

import { describe, it, expect } from 'vitest'
import { normalizeDriveSettings } from '../useDriveSettings'

describe('normalizeDriveSettings', () => {
  it('データがundefined（ドキュメント未作成）→ 空オブジェクトを返す', () => {
    expect(normalizeDriveSettings(undefined)).toEqual({})
  })

  it('空オブジェクト → 全フィールドundefinedの空オブジェクト相当を返す', () => {
    expect(normalizeDriveSettings({})).toEqual({})
  })

  it('全フィールドが揃ったデータ → そのまま保持する', () => {
    const template = [{ type: 'customer', format: 'furiganaInitialSpaceName' }]
    const result = normalizeDriveSettings({
      authMode: 'oauth',
      connectedEmail: 'drive-service@example.com',
      rootFolderId: 'folder-abc',
      rootFolderName: 'エクスポート先',
      template,
      furiganaFallback: 'useNameInitial',
    })

    expect(result).toEqual({
      authMode: 'oauth',
      connectedEmail: 'drive-service@example.com',
      rootFolderId: 'folder-abc',
      rootFolderName: 'エクスポート先',
      template,
      furiganaFallback: 'useNameInitial',
    })
  })

  it('部分データ（rootFolderIdのみ） → 指定フィールドのみ保持し他はundefined', () => {
    const result = normalizeDriveSettings({ rootFolderId: 'folder-xyz' })

    expect(result.rootFolderId).toBe('folder-xyz')
    expect(result.authMode).toBeUndefined()
    expect(result.connectedEmail).toBeUndefined()
    expect(result.rootFolderName).toBeUndefined()
    expect(result.template).toBeUndefined()
    expect(result.furiganaFallback).toBeUndefined()
  })

  it('DriveSettingsに存在しない未知フィールドが混入していても無視する', () => {
    const result = normalizeDriveSettings({
      rootFolderId: 'folder-abc',
      unknownLegacyField: 'should-be-dropped',
    })

    expect(result).toEqual({ rootFolderId: 'folder-abc' })
    expect('unknownLegacyField' in result).toBe(false)
  })
})
