/**
 * PdfUploadModal 単体テスト (Issue #1031)
 *
 * ストア(usePdfUploadStore)経由の表示専用コンポーネントとしての回帰テスト。
 * アップロードロジック・逐次実行・claimedFileNames等の詳細な回帰テストは
 * frontend/src/stores/__tests__/pdfUploadStore.test.tsへ移設済み。
 * ここではストアの状態がUIへ正しく反映されること、UI操作がストアのアクションを
 * 正しく呼び出すことのみを検証する。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const isDisabled = (el: HTMLElement): boolean => (el as HTMLButtonElement).disabled

vi.mock('@/lib/firebase', () => ({
  db: {},
}))

const mockCallFunction = vi.fn()
vi.mock('@/lib/callFunction', () => ({
  callFunction: (...args: unknown[]) => mockCallFunction(...args),
  getCallableErrorMessage: (_err: unknown, fallback: string) => fallback,
}))

vi.mock('sonner', () => ({
  toast: { dismiss: vi.fn(), loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

// onSnapshot は行ごとに独立したコールバックを保持するレジストリ形式でモックする
type SnapshotData = Record<string, unknown>
type SnapshotCallback = (snapshot: { data: () => SnapshotData | undefined }) => void
const snapshotCallbacks = new Map<string, SnapshotCallback>()

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, _collection: string, id: string) => ({ id }),
  onSnapshot: (ref: { id: string }, onNext: SnapshotCallback) => {
    snapshotCallbacks.set(ref.id, onNext)
    return vi.fn(() => {
      snapshotCallbacks.delete(ref.id)
    })
  },
}))

function emitSnapshot(documentId: string, data: SnapshotData) {
  const cb = snapshotCallbacks.get(documentId)
  if (!cb) throw new Error(`no snapshot subscriber for ${documentId}`)
  act(() => {
    cb({ data: () => data })
  })
}

import { PdfUploadModal } from '../PdfUploadModal'
import { usePdfUploadStore } from '@/stores/pdfUploadStore'

function makeFile(name: string, type = 'application/pdf', size = 1024): File {
  return new File(['x'.repeat(size)], name, { type })
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, writable: false, configurable: true })
  fireEvent.change(input)
}

function getFileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

function resetStore() {
  usePdfUploadStore.setState({
    files: [],
    claimedFileNames: new Map(),
    isAnyUploadInFlight: false,
    isModalOpen: true,
    completionCounter: 0,
    selectError: null,
  })
}

beforeEach(() => {
  mockCallFunction.mockReset()
  snapshotCallbacks.clear()
  resetStore()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PdfUploadModal — ファイル選択', () => {
  it('複数ファイル選択で有効なファイルのみ行として追加され、無効なファイルはエラー表示される', () => {
    render(<PdfUploadModal />)
    const validFile = makeFile('a.pdf')
    const invalidFile = makeFile('b.txt', 'text/plain')

    selectFiles(getFileInput(), [validFile, invalidFile])

    expect(screen.getByText('a.pdf')).toBeDefined()
    expect(screen.queryByText('b.txt')).toBeNull()
    expect(screen.getByText(/対応していないファイル形式です/)).toBeDefined()
  })

  it('idle行のみ削除ボタンが機能する', () => {
    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('a.pdf'), makeFile('b.pdf')])

    expect(screen.getByText('a.pdf')).toBeDefined()
    expect(screen.getByText('b.pdf')).toBeDefined()

    const removeButtons = screen.getAllByLabelText('削除')
    fireEvent.click(removeButtons[0]!)

    expect(screen.queryByText('a.pdf')).toBeNull()
    expect(screen.getByText('b.pdf')).toBeDefined()
  })
})

describe('PdfUploadModal — 逐次アップロード', () => {
  it('アップロードは逐次実行され、1件目が重複検出されても2件目が自動的に進む', async () => {
    let resolveFirst!: (v: unknown) => void
    const firstCallPromise = new Promise((resolve) => {
      resolveFirst = resolve
    })

    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      if (data.fileName === 'dup.pdf') return firstCallPromise
      return Promise.resolve({ success: true, documentId: 'doc-ok' })
    })

    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('dup.pdf'), makeFile('ok.pdf')])

    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))
    expect(mockCallFunction).toHaveBeenCalledTimes(1)

    resolveFirst({
      success: true,
      duplicate: true,
      existingFileName: 'dup.pdf',
      suggestedFileName: 'dup_2.pdf',
    })

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText(/同名ファイルが存在します/)).toBeDefined())
  })

  it('想定外レスポンス(duplicateでもdocumentIdでもない)はerrorへフォールバックする', async () => {
    mockCallFunction.mockResolvedValue({ success: true })

    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('weird.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(screen.getByText(/予期しない応答が返されました/)).toBeDefined())
  })
})

describe('PdfUploadModal — 排他制御(isAnyUploadInFlight)', () => {
  it('アップロード中はアップロードボタン・削除ボタンが無効化され、二重起動しない', async () => {
    let resolveUpload!: (v: unknown) => void
    mockCallFunction.mockImplementation(
      () => new Promise((resolve) => { resolveUpload = resolve })
    )

    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('a.pdf'), makeFile('b.pdf')])

    const uploadButton = screen.getByRole('button', { name: /アップロード/ })
    fireEvent.click(uploadButton)

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))

    expect(isDisabled(uploadButton)).toBe(true)
    const removeButtons = screen.getAllByLabelText('削除')
    expect(removeButtons.length).toBeGreaterThan(0)
    removeButtons.forEach((btn) => expect(isDisabled(btn)).toBe(true))

    fireEvent.click(uploadButton)
    expect(mockCallFunction).toHaveBeenCalledTimes(1)

    resolveUpload({ success: true, documentId: 'doc-a' })
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(2))
  })

  it('重複行の「別名で保存」・エラー行の「再試行」はその行単体のみ再実行する', async () => {
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string; confirmDuplicate?: boolean }) => {
      if (data.fileName === 'dup.pdf' && !data.confirmDuplicate) {
        return Promise.resolve({
          success: true,
          duplicate: true,
          existingFileName: 'dup.pdf',
          suggestedFileName: 'dup_2.pdf',
        })
      }
      if (data.fileName === 'bad.pdf') {
        return Promise.reject(new Error('invalid-argument: 壊れたファイル'))
      }
      return Promise.resolve({ success: true, documentId: 'doc-resolved' })
    })

    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('dup.pdf'), makeFile('bad.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(screen.getByText(/同名ファイルが存在します/)).toBeDefined())
    await waitFor(() => expect(screen.getByText('壊れたファイル')).toBeDefined())
    expect(mockCallFunction).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: /別名で保存/ }))
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(3))
    expect(mockCallFunction).toHaveBeenNthCalledWith(
      3,
      'uploadPdf',
      expect.objectContaining({ fileName: 'dup.pdf', confirmDuplicate: true, alternativeFileName: 'dup_2.pdf' }),
      expect.anything()
    )

    await waitFor(() => expect(isDisabled(screen.getByRole('button', { name: /再試行/ }))).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: /再試行/ }))
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(4))
    expect(mockCallFunction).toHaveBeenNthCalledWith(
      4,
      'uploadPdf',
      expect.objectContaining({ fileName: 'bad.pdf' }),
      expect.anything()
    )
  })
})

describe('PdfUploadModal — claimedFileNames同名衝突防止', () => {
  it('同一バッチ内の同名ファイル2件が同じ代替名を提案された場合、2件目の別名で保存は無効化され、1件目解決後に再試行できる', async () => {
    let callCount = 0
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string; confirmDuplicate?: boolean }) => {
      callCount++
      if (data.fileName === 'dup.pdf' && !data.confirmDuplicate) {
        return Promise.resolve({
          success: true,
          duplicate: true,
          existingFileName: 'dup.pdf',
          suggestedFileName: 'dup_2.pdf',
        })
      }
      return Promise.resolve({ success: true, documentId: `doc-${callCount}` })
    })

    render(<PdfUploadModal />)
    const fileA = new File(['aaaa'], 'dup.pdf', { type: 'application/pdf' })
    const fileB = new File(['bbbb'], 'dup.pdf', { type: 'application/pdf' })
    selectFiles(getFileInput(), [fileA, fileB])

    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByText(/同名ファイルが存在します/).length).toBe(2))

    expect(screen.getAllByRole('button', { name: /^別名で保存$/ }).length).toBe(2)

    fireEvent.click(screen.getAllByRole('button', { name: /^別名で保存$/ })[0]!)

    await waitFor(() => expect(screen.getByRole('button', { name: /他のファイルの処理完了後に再試行/ })).toBeDefined())
    expect(screen.queryByRole('button', { name: /^別名で保存$/ })).toBeNull()

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(3))
  })

  it('別名で保存の確定リクエストが失敗した場合、予約が解放され他の行が再試行できる(codex review指摘の回帰テスト)', async () => {
    let callCount = 0
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string; confirmDuplicate?: boolean }) => {
      callCount++
      if (data.fileName === 'dup.pdf' && !data.confirmDuplicate) {
        return Promise.resolve({
          success: true,
          duplicate: true,
          existingFileName: 'dup.pdf',
          suggestedFileName: 'dup_2.pdf',
        })
      }
      if (data.confirmDuplicate) {
        return Promise.reject(new Error('network error'))
      }
      return Promise.resolve({ success: true, documentId: `doc-${callCount}` })
    })

    render(<PdfUploadModal />)
    const fileA = new File(['aaaa'], 'dup.pdf', { type: 'application/pdf' })
    const fileB = new File(['bbbb'], 'dup.pdf', { type: 'application/pdf' })
    selectFiles(getFileInput(), [fileA, fileB])

    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))
    await waitFor(() => expect(screen.getAllByText(/同名ファイルが存在します/).length).toBe(2))

    fireEvent.click(screen.getAllByRole('button', { name: /^別名で保存$/ })[0]!)
    await waitFor(() => expect(screen.getByText('アップロードに失敗しました')).toBeDefined())

    await waitFor(() => expect(screen.getByRole('button', { name: /^別名で保存$/ })).toBeDefined())
    expect(screen.queryByRole('button', { name: /他のファイルの処理完了後に再試行/ })).toBeNull()
  })
})

describe('PdfUploadModal — モーダルクローズ制御(Issue #1031: 常に閉じられる+データ温存)', () => {
  it('uploading中でも閉じるボタンは有効で、閉じても購読・アップロードは継続する', async () => {
    let resolveUpload!: (v: unknown) => void
    mockCallFunction.mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve }))

    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('a.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))
    const closeButton = screen.getByRole('button', { name: /閉じる\(バックグラウンドで継続\)/ })
    expect(isDisabled(closeButton)).toBe(false)

    fireEvent.click(closeButton)
    expect(usePdfUploadStore.getState().isModalOpen).toBe(false)
    expect(usePdfUploadStore.getState().files.length).toBe(1)

    resolveUpload({ success: true, documentId: 'doc-a' })
    await waitFor(() => expect(usePdfUploadStore.getState().files[0]?.step).toBe('pending'))
  })

  it('進行中・要対応のいずれもない(idleのみ)場合のボタン文言は「キャンセル」', () => {
    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('a.pdf')])
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDefined()
  })

  it('全件processedのときのボタン文言は「閉じる」', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-ok' })
    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('ok.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))

    emitSnapshot('doc-ok', { status: 'processed' })
    await waitFor(() => expect(screen.getByRole('button', { name: '閉じる' })).toBeDefined())
  })

  it('error/duplicate行が残っている場合のボタン文言は「閉じる(バックグラウンドで継続)」', async () => {
    mockCallFunction.mockResolvedValue({ success: true, duplicate: true, existingFileName: 'dup.pdf', suggestedFileName: 'dup_2.pdf' })
    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('dup.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(screen.getByRole('button', { name: /閉じる\(バックグラウンドで継続\)/ })).toBeDefined())
  })
})

describe('PdfUploadModal — 行ごとのonSnapshot購読(ストア経由)', () => {
  it('行ごとの購読は他の行に影響せず、processed到達時にcompletionCounterが加算される', async () => {
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      const id = data.fileName === 'a.pdf' ? 'doc-a' : 'doc-b'
      return Promise.resolve({ success: true, documentId: id })
    })

    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('a.pdf'), makeFile('b.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(snapshotCallbacks.has('doc-a')).toBe(true))
    await waitFor(() => expect(snapshotCallbacks.has('doc-b')).toBe(true))

    emitSnapshot('doc-a', { status: 'processing' })
    await waitFor(() => expect(screen.queryAllByText('OCR処理中...').length).toBe(1))

    emitSnapshot('doc-a', { status: 'processed' })
    await waitFor(() => expect(usePdfUploadStore.getState().completionCounter).toBe(1))
    expect(snapshotCallbacks.has('doc-b')).toBe(true)
  })

  it('OCRエラー到達時にもエラー表示される', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-x' })

    render(<PdfUploadModal />)
    selectFiles(getFileInput(), [makeFile('x.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(snapshotCallbacks.has('doc-x')).toBe(true))
    emitSnapshot('doc-x', { status: 'error', lastErrorMessage: 'OCR失敗' })

    await waitFor(() => expect(screen.getByText('OCR失敗')).toBeDefined())
  })
})
