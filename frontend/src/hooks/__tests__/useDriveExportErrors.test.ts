/**
 * useDriveExportErrors テスト(ADR-0022 Phase1 Task13)
 *
 * toDriveExportErrorRow(純粋関数)のみをテスト対象とする。React Query/Firestore
 * 依存のhook本体はuseDriveSettings.test.ts等と同じ方針でテスト対象外。
 */

import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { toDriveExportErrorRow } from '../useDriveExportErrors'

describe('toDriveExportErrorRow', () => {
  it('全フィールドが揃っている場合、正しくマップする', () => {
    const updatedAt = Timestamp.fromDate(new Date('2026-07-21T10:00:00Z'))
    const row = toDriveExportErrorRow('doc-1', {
      updatedAt,
      displayFileName: '表示用ファイル名.pdf',
      fileName: '元ファイル名.pdf',
      customerName: '鈴木花子',
      officeName: '北名古屋事業所',
      careManager: '田中太郎',
      documentType: '居宅サービス計画書（1）',
      driveExportError: 'フリガナが未設定のため利用者フォルダ名を解決できません: 鈴木花子',
    })

    expect(row).toEqual({
      id: 'doc-1',
      updatedAt: updatedAt.toDate(),
      fileName: '表示用ファイル名.pdf',
      customerName: '鈴木花子',
      officeName: '北名古屋事業所',
      careManager: '田中太郎',
      documentType: '居宅サービス計画書（1）',
      driveExportError: 'フリガナが未設定のため利用者フォルダ名を解決できません: 鈴木花子',
    })
  })

  it('displayFileName欠損時はfileNameにフォールバックする', () => {
    const row = toDriveExportErrorRow('doc-2', { fileName: '元ファイル名.pdf' })
    expect(row.fileName).toBe('元ファイル名.pdf')
  })

  it('displayFileName/fileNameどちらも欠損時はプレースホルダになる', () => {
    const row = toDriveExportErrorRow('doc-3', {})
    expect(row.fileName).toBe('（未設定）')
  })

  it('updatedAtが欠損していてもクラッシュせずnullになる', () => {
    const row = toDriveExportErrorRow('doc-4', { fileName: 'a.pdf' })
    expect(row.updatedAt).toBeNull()
  })

  it('updatedAtがTimestamp型でない不正値の場合もクラッシュせずnullになる', () => {
    const row = toDriveExportErrorRow('doc-5', { updatedAt: '2026-07-21', fileName: 'a.pdf' })
    expect(row.updatedAt).toBeNull()
  })

  it('driveExportErrorがnullの場合は空文字になる', () => {
    const row = toDriveExportErrorRow('doc-6', { driveExportError: null })
    expect(row.driveExportError).toBe('')
  })

  it('driveExportErrorが未定義の場合は空文字になる', () => {
    const row = toDriveExportErrorRow('doc-7', {})
    expect(row.driveExportError).toBe('')
  })

  it('customerName/officeName/careManager/documentType欠損時はプレースホルダになる', () => {
    const row = toDriveExportErrorRow('doc-8', {})
    expect(row.customerName).toBe('（未設定）')
    expect(row.officeName).toBe('（未設定）')
    expect(row.careManager).toBe('（未設定）')
    expect(row.documentType).toBe('（未設定）')
  })

  it('英語の生例外文もそのまま保持する(driveExportErrorは技術的メッセージが入りうる)', () => {
    const row = toDriveExportErrorRow('doc-9', {
      driveExportError: "TypeError: Cannot read properties of null (reading 'toDate')",
    })
    expect(row.driveExportError).toBe("TypeError: Cannot read properties of null (reading 'toDate')")
  })
})
