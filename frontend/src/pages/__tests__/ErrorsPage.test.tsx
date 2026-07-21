/**
 * ErrorsPage - Driveエクスポートエラータブ テスト(ADR-0022 Phase1 Task13)
 *
 * OCRエラータブは既定表示のため常にマウントされる(Radix Tabsは非アクティブタブを
 * デフォルトでアンマウントするが、defaultValue="ocr"のOcrErrorsTabは初回から描画される)。
 * 依存hookのFirestoreアクセスをクラッシュさせないため、OCR/Drive両タブの依存hookを
 * モックする。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ErrorsPage } from '../ErrorsPage'
import type { DriveExportErrorRow, RetryDriveExportResult } from '@/hooks/useDriveExportErrors'

// @testing-library/jest-dom は未導入のため、disabled 判定はネイティブDOMプロパティで検証する
const isDisabled = (el: HTMLElement): boolean => (el as HTMLButtonElement).disabled

// OCRエラータブ(defaultValue)が初回描画時に依存するhookをバイパス
vi.mock('@/hooks/useErrors', () => ({
  useErrors: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useErrorStats: () => ({ data: { total: 0, unhandled: 0, inProgress: 0, completed: 0 } }),
  useUpdateErrorStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReprocessError: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

let mockRows: DriveExportErrorRow[] = []
let mockIsAdmin = true
const mockMutateAsync = vi.fn<(docId: string) => Promise<RetryDriveExportResult>>()
let mockIsPending = false

vi.mock('@/hooks/useDriveExportErrors', () => ({
  useDriveExportErrors: () => ({ data: mockRows, isLoading: false, refetch: vi.fn() }),
  useRetryDriveExport: () => ({ mutateAsync: mockMutateAsync, isPending: mockIsPending }),
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { isAdmin: boolean }) => unknown) =>
    selector({ isAdmin: mockIsAdmin }),
}))

const sampleRow: DriveExportErrorRow = {
  id: 'doc-1',
  updatedAt: new Date('2026-07-21T10:00:00'),
  fileName: '介護保険被保険者証.pdf',
  customerName: '鈴木花子',
  officeName: '北名古屋事業所',
  careManager: '田中太郎',
  documentType: '介護保険被保険者証',
  driveExportError: 'フリガナが未設定のため利用者フォルダ名を解決できません: 鈴木花子',
}

// Radix Tabs.Trigger(@radix-ui/react-tabs 1.1.13)はonClickではなくonMouseDownで
// onValueChangeを発火するため、fireEvent.clickだけではjsdom上でタブが切り替わらない
function openDriveTab() {
  fireEvent.mouseDown(screen.getByText('Driveエクスポートエラー'))
}

describe('ErrorsPage - Driveエクスポートエラータブ', () => {
  beforeEach(() => {
    mockRows = []
    mockIsAdmin = true
    mockIsPending = false
    mockMutateAsync.mockReset()
  })

  it('タブをクリックするとDriveエクスポートエラー一覧が表示される', () => {
    mockRows = [sampleRow]
    render(<ErrorsPage />)
    openDriveTab()

    expect(screen.getByText('介護保険被保険者証.pdf')).toBeDefined()
    expect(screen.getByText('鈴木花子')).toBeDefined()
  })

  it('0件の場合「エラーはありません」と表示される', () => {
    mockRows = []
    render(<ErrorsPage />)
    openDriveTab()

    expect(screen.getByText('エラーはありません')).toBeDefined()
  })

  it('adminユーザーにはリトライボタンが表示される', () => {
    mockRows = [sampleRow]
    mockIsAdmin = true
    render(<ErrorsPage />)
    openDriveTab()

    expect(screen.getByRole('button', { name: 'リトライ' })).toBeDefined()
  })

  it('非adminユーザーにはリトライボタンが表示されない', () => {
    mockRows = [sampleRow]
    mockIsAdmin = false
    render(<ErrorsPage />)
    openDriveTab()

    expect(screen.queryByRole('button', { name: 'リトライ' })).toBeNull()
  })

  it('リトライボタン→確認ダイアログ→実行で正しいdocIdでmutateAsyncが呼ばれる', async () => {
    mockRows = [sampleRow]
    mockMutateAsync.mockResolvedValue({ success: true, status: 'exported', error: null })
    render(<ErrorsPage />)
    openDriveTab()

    fireEvent.click(screen.getByRole('button', { name: 'リトライ' }))
    fireEvent.click(screen.getByText('リトライを実行'))

    expect(mockMutateAsync).toHaveBeenCalledWith('doc-1')
  })

  it('mutation実行中はリトライボタンがdisabledになる', () => {
    mockRows = [sampleRow]
    mockIsPending = true
    render(<ErrorsPage />)
    openDriveTab()

    expect(isDisabled(screen.getByRole('button', { name: 'リトライ' }))).toBe(true)
  })

  it('success:trueの場合、成功メッセージが表示される(tri-state)', async () => {
    mockRows = [sampleRow]
    mockMutateAsync.mockResolvedValue({ success: true, status: 'exported', error: null })
    render(<ErrorsPage />)
    openDriveTab()

    fireEvent.click(screen.getByRole('button', { name: 'リトライ' }))
    fireEvent.click(screen.getByText('リトライを実行'))

    expect(await screen.findByText('エクスポートに成功しました')).toBeDefined()
  })

  it('success:falseの場合、例外にならずresult.errorが表示される(tri-state最重要ケース)', async () => {
    mockRows = [sampleRow]
    mockMutateAsync.mockResolvedValue({
      success: false,
      status: 'error',
      error: 'フリガナが未設定のため利用者フォルダ名を解決できません: 鈴木花子',
    })
    render(<ErrorsPage />)
    openDriveTab()

    fireEvent.click(screen.getByRole('button', { name: 'リトライ' }))
    fireEvent.click(screen.getByText('リトライを実行'))

    expect(
      await screen.findByText('フリガナが未設定のため利用者フォルダ名を解決できません: 鈴木花子')
    ).toBeDefined()
  })

  it('failed-preconditionでthrowされた場合、BEの日本語メッセージがそのまま表示される(getCallableErrorMessage回帰防止)', async () => {
    mockRows = [sampleRow]
    const err = new Error('Google Drive連携機能が無効です')
    ;(err as Error & { code: string }).code = 'functions/failed-precondition'
    mockMutateAsync.mockRejectedValue(err)
    render(<ErrorsPage />)
    openDriveTab()

    fireEvent.click(screen.getByRole('button', { name: 'リトライ' }))
    fireEvent.click(screen.getByText('リトライを実行'))

    expect(await screen.findByText('Google Drive連携機能が無効です')).toBeDefined()
  })

  it('permission-deniedでthrowされた場合、「権限がありません。」が表示される', async () => {
    mockRows = [sampleRow]
    const err = new Error('Admin permission required')
    ;(err as Error & { code: string }).code = 'functions/permission-denied'
    mockMutateAsync.mockRejectedValue(err)
    render(<ErrorsPage />)
    openDriveTab()

    fireEvent.click(screen.getByRole('button', { name: 'リトライ' }))
    fireEvent.click(screen.getByText('リトライを実行'))

    expect(await screen.findByText('権限がありません。')).toBeDefined()
  })

  it('詳細ダイアログにdriveExportErrorの生文字列が<pre>表示される', () => {
    mockRows = [sampleRow]
    render(<ErrorsPage />)
    openDriveTab()

    fireEvent.click(screen.getByRole('button', { name: '詳細を表示' }))

    const dialog = screen.getByText('Driveエクスポートエラー詳細').closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(sampleRow.driveExportError)).toBeDefined()
  })

  it('OCRエラータブは既存表示のまま壊れていない(スモーク)', () => {
    render(<ErrorsPage />)
    expect(screen.getByText('エラー一覧')).toBeDefined()
    expect(screen.getByText('全エラー')).toBeDefined()
  })
})
