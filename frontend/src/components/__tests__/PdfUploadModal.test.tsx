/**
 * PdfUploadModal 単体テスト (Issue #815)
 *
 * 単一ファイル前提だった状態モデルを配列化(複数ファイル同時アップロード対応)したための
 * 新規テストスイート。plan-crossreview(grip + codex 2巡)で洗い出された以下の設計要件を
 * 回帰テストとして固定する:
 * - アップロードは逐次実行され、1件目の重複/エラーが2件目をブロックしない
 * - isAnyUploadInFlight による排他制御(バッチループ・行単位の別名で保存/再試行を横断)
 * - claimedFileNames(候補名→行ID予約)による同一バッチ内の同名衝突防止
 * - 行ごとのonSnapshot購読が他行に影響せず、終端状態で解除される
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

// onSnapshot は行ごとに独立したコールバックを保持するレジストリ形式でモックする
type SnapshotData = Record<string, unknown>
type SnapshotCallback = (snapshot: { data: () => SnapshotData | undefined }) => void
const snapshotCallbacks = new Map<string, SnapshotCallback>()
const unsubscribeSpies = new Map<string, ReturnType<typeof vi.fn>>()

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, _collection: string, id: string) => ({ id }),
  onSnapshot: (ref: { id: string }, onNext: SnapshotCallback) => {
    snapshotCallbacks.set(ref.id, onNext)
    const unsubscribe = vi.fn(() => {
      snapshotCallbacks.delete(ref.id)
    })
    unsubscribeSpies.set(ref.id, unsubscribe)
    return unsubscribe
  },
}))

function emitSnapshot(documentId: string, data: SnapshotData) {
  const cb = snapshotCallbacks.get(documentId)
  if (!cb) throw new Error(`no snapshot subscriber for ${documentId}`)
  act(() => {
    cb({ data: () => data })
  })
}

import { PdfUploadModal, claimFileName, releaseRowClaims, isNameClaimedByOther } from '../PdfUploadModal'

function makeFile(name: string, type = 'application/pdf', size = 1024): File {
  const file = new File(['x'.repeat(size)], name, { type })
  return file
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, writable: false, configurable: true })
  fireEvent.change(input)
}

function getFileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

beforeEach(() => {
  mockCallFunction.mockReset()
  snapshotCallbacks.clear()
  unsubscribeSpies.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PdfUploadModal — ファイル選択(Issue #815)', () => {
  it('複数ファイル選択で有効なファイルのみ行として追加され、無効なファイルはエラー表示される', () => {
    render(<PdfUploadModal open onOpenChange={vi.fn()} />)
    const validFile = makeFile('a.pdf')
    const invalidFile = makeFile('b.txt', 'text/plain')

    selectFiles(getFileInput(), [validFile, invalidFile])

    expect(screen.getByText('a.pdf')).toBeDefined()
    expect(screen.queryByText('b.txt')).toBeNull()
    expect(screen.getByText(/対応していないファイル形式です/)).toBeDefined()
  })

  it('idle行のみ削除ボタンが機能する', () => {
    render(<PdfUploadModal open onOpenChange={vi.fn()} />)
    selectFiles(getFileInput(), [makeFile('a.pdf'), makeFile('b.pdf')])

    expect(screen.getByText('a.pdf')).toBeDefined()
    expect(screen.getByText('b.pdf')).toBeDefined()

    const removeButtons = screen.getAllByLabelText('削除')
    fireEvent.click(removeButtons[0]!)

    expect(screen.queryByText('a.pdf')).toBeNull()
    expect(screen.getByText('b.pdf')).toBeDefined()
  })
})

describe('PdfUploadModal — 逐次アップロード(Issue #815)', () => {
  it('アップロードは逐次実行され、1件目が重複検出されても2件目が自動的に進む', async () => {
    let resolveFirst!: (v: unknown) => void
    const firstCallPromise = new Promise((resolve) => {
      resolveFirst = resolve
    })

    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      if (data.fileName === 'dup.pdf') return firstCallPromise
      return Promise.resolve({ success: true, documentId: 'doc-ok' })
    })

    render(<PdfUploadModal open onOpenChange={vi.fn()} />)
    selectFiles(getFileInput(), [makeFile('dup.pdf'), makeFile('ok.pdf')])

    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))
    expect(mockCallFunction).toHaveBeenNthCalledWith(
      1,
      'uploadPdf',
      expect.objectContaining({ fileName: 'dup.pdf' }),
      expect.anything()
    )

    // 1件目が未解決の間は2件目は呼ばれない(逐次実行であることの確認)
    expect(mockCallFunction).toHaveBeenCalledTimes(1)

    resolveFirst({
      success: true,
      duplicate: true,
      existingFileName: 'dup.pdf',
      suggestedFileName: 'dup_2.pdf',
    })

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(2))
    expect(mockCallFunction).toHaveBeenNthCalledWith(
      2,
      'uploadPdf',
      expect.objectContaining({ fileName: 'ok.pdf' }),
      expect.anything()
    )

    await waitFor(() => expect(screen.getByText(/同名ファイルが存在します/)).toBeDefined())
  })

  it('想定外レスポンス(duplicateでもdocumentIdでもない)はerrorへフォールバックする', async () => {
    mockCallFunction.mockResolvedValue({ success: true })

    render(<PdfUploadModal open onOpenChange={vi.fn()} />)
    selectFiles(getFileInput(), [makeFile('weird.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(screen.getByText(/予期しない応答が返されました/)).toBeDefined())
  })
})

describe('PdfUploadModal — 排他制御(isAnyUploadInFlight, Issue #815)', () => {
  it('アップロード中はアップロードボタン・削除ボタンが無効化され、二重起動しない', async () => {
    let resolveUpload!: (v: unknown) => void
    mockCallFunction.mockImplementation(
      () => new Promise((resolve) => { resolveUpload = resolve })
    )

    render(<PdfUploadModal open onOpenChange={vi.fn()} />)
    selectFiles(getFileInput(), [makeFile('a.pdf'), makeFile('b.pdf')])

    const uploadButton = screen.getByRole('button', { name: /アップロード/ })
    fireEvent.click(uploadButton)

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))

    // 実行中はアップロードボタンが無効化される
    expect(isDisabled(uploadButton)).toBe(true)
    // b.pdfはまだidleだが、削除ボタンは無効化される
    const removeButtons = screen.getAllByLabelText('削除')
    expect(removeButtons.length).toBeGreaterThan(0)
    removeButtons.forEach((btn) => expect(isDisabled(btn)).toBe(true))

    // 実行中に再度クリックしても呼び出し回数は増えない(二重起動防止)
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

    render(<PdfUploadModal open onOpenChange={vi.fn()} />)
    selectFiles(getFileInput(), [makeFile('dup.pdf'), makeFile('bad.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(screen.getByText(/同名ファイルが存在します/)).toBeDefined())
    await waitFor(() => expect(screen.getByText('壊れたファイル')).toBeDefined())
    expect(mockCallFunction).toHaveBeenCalledTimes(2)

    // 重複行のみ「別名で保存」を実行
    fireEvent.click(screen.getByRole('button', { name: /別名で保存/ }))
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(3))
    expect(mockCallFunction).toHaveBeenNthCalledWith(
      3,
      'uploadPdf',
      expect.objectContaining({ fileName: 'dup.pdf', confirmDuplicate: true, alternativeFileName: 'dup_2.pdf' }),
      expect.anything()
    )

    // エラー行の「再試行」はエラー行のみ再実行(dup.pdf側は再度呼ばれない)
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

describe('PdfUploadModal — claimedFileNames同名衝突防止(Issue #815)', () => {
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

    render(<PdfUploadModal open onOpenChange={vi.fn()} />)
    // 同名の異なる2ファイル(同じdup.pdfという名前で内容だけ変える)
    const fileA = new File(['aaaa'], 'dup.pdf', { type: 'application/pdf' })
    const fileB = new File(['bbbb'], 'dup.pdf', { type: 'application/pdf' })
    selectFiles(getFileInput(), [fileA, fileB])

    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByText(/同名ファイルが存在します/).length).toBe(2))

    // 2行とも同じ代替名(dup_2.pdf)を提案されている段階では、両方とも「別名で保存」を表示
    expect(screen.getAllByRole('button', { name: /^別名で保存$/ }).length).toBe(2)

    // 1件目を「別名で保存」で確定
    fireEvent.click(screen.getAllByRole('button', { name: /^別名で保存$/ })[0]!)

    // 2件目は自動的に「別名で保存」が無効化され、「他のファイルの処理完了後に再試行」に切り替わる
    await waitFor(() => expect(screen.getByRole('button', { name: /他のファイルの処理完了後に再試行/ })).toBeDefined())
    expect(screen.queryByRole('button', { name: /^別名で保存$/ })).toBeNull()

    // 1件目の「別名で保存」確定リクエストが完全に完了するまで待ってからテストを終える
    // (未解決のまま終えるとFileReaderの非同期完了が次のテストへ漏れ込み、mockCallFunctionの
    //  呼び出し回数を汚染する)
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(3))
  })
})

describe('PdfUploadModal — claimedFileNames 予約ロジック(純粋関数、Issue #815)', () => {
  it('claimFileNameは未予約の名前を予約できる', () => {
    const claimed = claimFileName(new Map(), 'a.pdf', 'row-1')
    expect(claimed?.get('a.pdf')).toBe('row-1')
  })

  it('claimFileNameは他の行が予約済みの名前を奪えない', () => {
    const claimed = claimFileName(new Map([['a.pdf', 'row-1']]), 'a.pdf', 'row-2')
    expect(claimed).toBeNull()
  })

  it('claimFileNameは自分自身の既存予約は上書きできる', () => {
    const claimed = claimFileName(new Map([['a.pdf', 'row-1']]), 'a.pdf', 'row-1')
    expect(claimed?.get('a.pdf')).toBe('row-1')
  })

  it('releaseRowClaimsは指定行が予約した名前のみ解放する', () => {
    const map = new Map([['a.pdf', 'row-1'], ['b.pdf', 'row-2']])
    const released = releaseRowClaims(map, 'row-1')
    expect(released.has('a.pdf')).toBe(false)
    expect(released.get('b.pdf')).toBe('row-2')
  })

  it('isNameClaimedByOtherは他行の予約のみtrueを返す', () => {
    const map = new Map([['a.pdf', 'row-1']])
    expect(isNameClaimedByOther(map, 'a.pdf', 'row-2')).toBe(true)
    expect(isNameClaimedByOther(map, 'a.pdf', 'row-1')).toBe(false)
    expect(isNameClaimedByOther(map, 'unknown.pdf', 'row-2')).toBe(false)
  })
})

describe('PdfUploadModal — モーダルクローズ制御(Issue #815)', () => {
  it('閉じるボタンはuploading中の行がある間のみ無効化される', async () => {
    let resolveUpload!: (v: unknown) => void
    mockCallFunction.mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve }))

    const onOpenChange = vi.fn()
    render(<PdfUploadModal open onOpenChange={onOpenChange} />)
    selectFiles(getFileInput(), [makeFile('a.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))
    const closeButton = screen.getByRole('button', { name: /キャンセル|閉じる/ })
    expect(isDisabled(closeButton)).toBe(true)

    resolveUpload({ success: true, documentId: 'doc-a' })
    await waitFor(() => expect(isDisabled(screen.getByRole('button', { name: /キャンセル|閉じる/ }))).toBe(false))
  })

  it('全件processedのときのみ自動クローズし、1件でもerror/duplicateが残れば発火しない', async () => {
    vi.useFakeTimers()
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      if (data.fileName === 'ok.pdf') return Promise.resolve({ success: true, documentId: 'doc-ok' })
      return Promise.reject(new Error('failure'))
    })

    const onOpenChange = vi.fn()
    render(<PdfUploadModal open onOpenChange={onOpenChange} />)
    selectFiles(getFileInput(), [makeFile('ok.pdf'), makeFile('ng.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await vi.waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(2))
    // ng.pdfのエラー処理(catch内のsetFiles)が完全に反映されるまで待ってから次に進む
    // (未解決のまま進めると次のテストへ漏れ込み、mockCallFunctionの呼び出し回数を汚染する)
    await vi.waitFor(() => expect(screen.getByText('アップロードに失敗しました')).toBeDefined())

    // ok.pdf行をprocessedへ遷移させる(ng.pdfはerrorのまま残る)
    emitSnapshot('doc-ok', { status: 'processed' })

    await vi.advanceTimersByTimeAsync(3000)
    // 1件(ng.pdf)がerrorのまま残っているため自動クローズしない
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('PdfUploadModal — 行ごとのonSnapshot購読(Issue #815)', () => {
  it('行ごとの購読は他の行に影響せず、processed到達時に購読が解除される', async () => {
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      const id = data.fileName === 'a.pdf' ? 'doc-a' : 'doc-b'
      return Promise.resolve({ success: true, documentId: id })
    })

    const onSuccess = vi.fn()
    render(<PdfUploadModal open onOpenChange={vi.fn()} onSuccess={onSuccess} />)
    selectFiles(getFileInput(), [makeFile('a.pdf'), makeFile('b.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(snapshotCallbacks.has('doc-a')).toBe(true))
    await waitFor(() => expect(snapshotCallbacks.has('doc-b')).toBe(true))

    emitSnapshot('doc-a', { status: 'processing' })
    // b側は無関係な状態のまま(a側の更新の影響を受けない)
    await waitFor(() => expect(screen.queryAllByText('OCR処理中...').length).toBe(1))

    emitSnapshot('doc-a', { status: 'processed' })
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('doc-a'))
    expect(unsubscribeSpies.get('doc-a')).toHaveBeenCalled()
    // b側の購読は解除されていない
    expect(snapshotCallbacks.has('doc-b')).toBe(true)
  })

  it('OCRエラー到達時にも購読が解除される', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-x' })

    render(<PdfUploadModal open onOpenChange={vi.fn()} />)
    selectFiles(getFileInput(), [makeFile('x.pdf')])
    fireEvent.click(screen.getByRole('button', { name: /アップロード/ }))

    await waitFor(() => expect(snapshotCallbacks.has('doc-x')).toBe(true))
    emitSnapshot('doc-x', { status: 'error', lastErrorMessage: 'OCR失敗' })

    await waitFor(() => expect(screen.getByText('OCR失敗')).toBeDefined())
    expect(unsubscribeSpies.get('doc-x')).toHaveBeenCalled()
  })
})
