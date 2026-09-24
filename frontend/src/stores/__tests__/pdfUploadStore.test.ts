/**
 * pdfUploadStore.ts 単体テスト (Issue #1031)
 *
 * PdfUploadModal.tsxのローカルstateだったアップロード処理・Firestore onSnapshot購読を
 * ストアへ引き上げたことの回帰テスト一式(Issue #815からの既存回帰テスト移設分 +
 * plan-crossreview(grip+codex)で洗い出したepoch/購読エラー/reset契約の新規テスト)。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, waitFor } from '@testing-library/react'

vi.mock('@/lib/firebase', () => ({
  db: {},
}))

const mockCallFunction = vi.fn()
vi.mock('@/lib/callFunction', () => ({
  callFunction: (...args: unknown[]) => mockCallFunction(...args),
  getCallableErrorMessage: (_err: unknown, fallback: string) => fallback,
}))

const toastDismiss = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    dismiss: (...args: unknown[]) => toastDismiss(...args),
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/stores/authStore', async () => {
  const { create } = await import('zustand')
  interface MockAuthState {
    user: { uid: string } | null
  }
  return { useAuthStore: create<MockAuthState>(() => ({ user: null })) }
})

// onSnapshot は行ごとに独立したnext/errorコールバックを保持するレジストリ形式でモックする
type SnapshotData = Record<string, unknown>
type NextCallback = (snapshot: { data: () => SnapshotData | undefined }) => void
type ErrorCallback = (err: Error) => void
const nextCallbacks = new Map<string, NextCallback>()
const errorCallbacks = new Map<string, ErrorCallback>()
const unsubscribeSpies = new Map<string, ReturnType<typeof vi.fn>>()

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, _collection: string, id: string) => ({ id }),
  onSnapshot: (ref: { id: string }, onNext: NextCallback, onError: ErrorCallback) => {
    nextCallbacks.set(ref.id, onNext)
    errorCallbacks.set(ref.id, onError)
    const unsubscribe = vi.fn(() => {
      nextCallbacks.delete(ref.id)
      errorCallbacks.delete(ref.id)
    })
    unsubscribeSpies.set(ref.id, unsubscribe)
    return unsubscribe
  },
}))

function emitSnapshot(documentId: string, data: SnapshotData) {
  const cb = nextCallbacks.get(documentId)
  if (!cb) throw new Error(`no snapshot subscriber for ${documentId}`)
  act(() => {
    cb({ data: () => data })
  })
}

function emitSnapshotError(documentId: string) {
  const cb = errorCallbacks.get(documentId)
  if (!cb) throw new Error(`no snapshot error subscriber for ${documentId}`)
  act(() => {
    cb(new Error('permission-denied'))
  })
}

import { usePdfUploadStore, PDF_UPLOAD_TOAST_ID } from '../pdfUploadStore'
import { useAuthStore } from '@/stores/authStore'
import type { User as FirebaseUser } from 'firebase/auth'

function makeFile(name: string, type = 'application/pdf', size = 1024): File {
  return new File(['x'.repeat(size)], name, { type })
}

// authStore.tsは本物のFirebaseUser型を要求するが、テストではuidの値遷移のみが
// 検証対象のため、モック用authStore(実体はzustand create、User型全体は不要)には
// uidだけを持つ最小オブジェクトをキャストして渡す
function setAuthUid(uid: string | null) {
  useAuthStore.setState({ user: (uid ? { uid } : null) as unknown as FirebaseUser | null })
}

function resetStore() {
  usePdfUploadStore.setState({
    files: [],
    claimedFileNames: new Map(),
    isAnyUploadInFlight: false,
    isModalOpen: false,
    completionCounter: 0,
    selectError: null,
  })
}

beforeEach(() => {
  mockCallFunction.mockReset()
  toastDismiss.mockReset()
  nextCallbacks.clear()
  errorCallbacks.clear()
  unsubscribeSpies.clear()
  resetStore()
  useAuthStore.setState({ user: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('addFiles', () => {
  it('有効なファイルのみ行として追加され、無効なファイルはselectErrorに集約される', () => {
    usePdfUploadStore.getState().addFiles([makeFile('a.pdf'), makeFile('b.txt', 'text/plain')])
    const state = usePdfUploadStore.getState()
    expect(state.files.map((f) => f.file.name)).toEqual(['a.pdf'])
    expect(state.selectError).toMatch(/対応していないファイル形式です/)
  })

  it('同名ファイルが同一バッチに複数含まれる場合、先着の1行のみ予約される(plan-crossreview Medium#8)', () => {
    const fileA = new File(['aaaa'], 'dup.pdf', { type: 'application/pdf' })
    const fileB = new File(['bbbb'], 'dup.pdf', { type: 'application/pdf' })
    usePdfUploadStore.getState().addFiles([fileA, fileB])
    const state = usePdfUploadStore.getState()
    expect(state.files.length).toBe(2)
    const [rowA, rowB] = state.files
    expect(state.claimedFileNames.get('dup.pdf')).toBe(rowA!.id)
    expect(state.claimedFileNames.get('dup.pdf')).not.toBe(rowB!.id)
  })
})

describe('uploadAll — 逐次実行・排他制御', () => {
  it('アップロードは逐次実行され、1件目が重複検出されても2件目が自動的に進む', async () => {
    let resolveFirst!: (v: unknown) => void
    const firstCallPromise = new Promise((resolve) => {
      resolveFirst = resolve
    })
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      if (data.fileName === 'dup.pdf') return firstCallPromise
      return Promise.resolve({ success: true, documentId: 'doc-ok' })
    })

    usePdfUploadStore.getState().addFiles([makeFile('dup.pdf'), makeFile('ok.pdf')])
    const uploadPromise = act(() => usePdfUploadStore.getState().uploadAll())

    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))
    expect(mockCallFunction).toHaveBeenCalledTimes(1)

    resolveFirst({ success: true, duplicate: true, existingFileName: 'dup.pdf', suggestedFileName: 'dup_2.pdf' })
    await uploadPromise

    expect(mockCallFunction).toHaveBeenCalledTimes(2)
    const files = usePdfUploadStore.getState().files
    expect(files.find((f) => f.file.name === 'dup.pdf')?.step).toBe('duplicate')
    expect(files.find((f) => f.file.name === 'ok.pdf')?.step).toBe('pending')
  })

  it('isAnyUploadInFlightがtrueの間は再度uploadAllを呼んでも二重起動しない', async () => {
    let resolveUpload!: (v: unknown) => void
    mockCallFunction.mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve }))

    usePdfUploadStore.getState().addFiles([makeFile('a.pdf')])
    const uploadPromise = act(() => usePdfUploadStore.getState().uploadAll())
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))
    expect(usePdfUploadStore.getState().isAnyUploadInFlight).toBe(true)

    await act(() => usePdfUploadStore.getState().uploadAll())
    expect(mockCallFunction).toHaveBeenCalledTimes(1)

    resolveUpload({ success: true, documentId: 'doc-a' })
    await uploadPromise
  })

  it('想定外レスポンス(duplicateでもdocumentIdでもない)はerrorへフォールバックし予約が解放され、診断ログが残る(silent-failure-hunter指摘)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCallFunction.mockResolvedValue({ success: true })
    usePdfUploadStore.getState().addFiles([makeFile('weird.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    const state = usePdfUploadStore.getState()
    expect(state.files[0]?.step).toBe('error')
    expect(state.files[0]?.error).toMatch(/予期しない応答/)
    expect(state.claimedFileNames.has('weird.pdf')).toBe(false)
    expect(consoleError).toHaveBeenCalledWith('Unexpected uploadPdf response:', expect.objectContaining({ success: true }))
    consoleError.mockRestore()
  })

  it('addFiles()は保留中の自動クリアタイマーをキャンセルする(バッチ1完了直後2秒以内にバッチ2を追加しても消えない)', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-batch1' })
    usePdfUploadStore.getState().addFiles([makeFile('batch1.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    vi.useFakeTimers()
    act(() => emitSnapshot('doc-batch1', { status: 'processed' }))
    // この時点でautoClearTimerがスケジュールされている(2秒後に発火予定)

    // 2秒経過する前に新しいバッチを追加する
    await act(() => vi.advanceTimersByTimeAsync(500))
    usePdfUploadStore.getState().addFiles([makeFile('batch2.pdf')])

    await act(() => vi.advanceTimersByTimeAsync(2000))
    // 旧タイマーがaddFiles()でキャンセルされているため、全件processedではなくなった
    // (batch1=processed, batch2=idleの混在)状態のまま両方とも残っていること
    // (新タイマーは全件processedでない限り再スケジュールされない)
    expect(usePdfUploadStore.getState().files.map((f) => f.file.name).sort()).toEqual(['batch1.pdf', 'batch2.pdf'])
  })
})

describe('retry / resolveDuplicate', () => {
  it('重複行の別名で保存・エラー行の再試行はその行単体のみ再実行する', async () => {
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string; confirmDuplicate?: boolean }) => {
      if (data.fileName === 'dup.pdf' && !data.confirmDuplicate) {
        return Promise.resolve({ success: true, duplicate: true, existingFileName: 'dup.pdf', suggestedFileName: 'dup_2.pdf' })
      }
      if (data.fileName === 'bad.pdf') {
        return Promise.reject(new Error('invalid-argument: 壊れたファイル'))
      }
      return Promise.resolve({ success: true, documentId: 'doc-resolved' })
    })

    usePdfUploadStore.getState().addFiles([makeFile('dup.pdf'), makeFile('bad.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())
    expect(mockCallFunction).toHaveBeenCalledTimes(2)

    const dupId = usePdfUploadStore.getState().files.find((f) => f.file.name === 'dup.pdf')!.id
    const badId = usePdfUploadStore.getState().files.find((f) => f.file.name === 'bad.pdf')!.id

    act(() => usePdfUploadStore.getState().resolveDuplicate(dupId))
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(3))
    expect(mockCallFunction).toHaveBeenNthCalledWith(
      3, 'uploadPdf',
      expect.objectContaining({ fileName: 'dup.pdf', confirmDuplicate: true, alternativeFileName: 'dup_2.pdf' }),
      expect.anything()
    )

    act(() => usePdfUploadStore.getState().retry(badId))
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(4))
    expect(mockCallFunction).toHaveBeenNthCalledWith(4, 'uploadPdf', expect.objectContaining({ fileName: 'bad.pdf' }), expect.anything())
  })

  it('同一バッチ内で同名2件が同じ代替名を提案された場合、1件目確定後に2件目が再試行できる', async () => {
    let callCount = 0
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string; confirmDuplicate?: boolean }) => {
      callCount++
      if (data.fileName === 'dup.pdf' && !data.confirmDuplicate) {
        return Promise.resolve({ success: true, duplicate: true, existingFileName: 'dup.pdf', suggestedFileName: 'dup_2.pdf' })
      }
      return Promise.resolve({ success: true, documentId: `doc-${callCount}` })
    })

    const fileA = new File(['aaaa'], 'dup.pdf', { type: 'application/pdf' })
    const fileB = new File(['bbbb'], 'dup.pdf', { type: 'application/pdf' })
    usePdfUploadStore.getState().addFiles([fileA, fileB])
    await act(() => usePdfUploadStore.getState().uploadAll())
    expect(mockCallFunction).toHaveBeenCalledTimes(2)

    const [rowA, rowB] = usePdfUploadStore.getState().files
    expect(rowA!.step).toBe('duplicate')
    expect(rowB!.step).toBe('duplicate')

    act(() => usePdfUploadStore.getState().resolveDuplicate(rowA!.id))
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(3))

    // 2件目は1件目が予約中のためclaimFileNameが失敗するが、予約失敗を無視してアップロードは進む
    // (plan-crossreview Medium#8: 既存挙動の固定。UI側のisNameClaimedByOther判定で
    //  ボタン表示を制御するのはコンポーネント層の責務で、ストア層は止めない)
    act(() => usePdfUploadStore.getState().resolveDuplicate(rowB!.id))
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(4))
    expect(mockCallFunction).toHaveBeenNthCalledWith(
      4, 'uploadPdf',
      expect.objectContaining({ fileName: 'dup.pdf', alternativeFileName: 'dup_2.pdf' }),
      expect.anything()
    )
  })

  it('別名で保存の確定リクエストが失敗した場合、予約が解放される(codex review指摘の回帰テスト)', async () => {
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string; confirmDuplicate?: boolean }) => {
      if (data.fileName === 'dup.pdf' && !data.confirmDuplicate) {
        return Promise.resolve({ success: true, duplicate: true, existingFileName: 'dup.pdf', suggestedFileName: 'dup_2.pdf' })
      }
      if (data.confirmDuplicate) {
        return Promise.reject(new Error('network error'))
      }
      return Promise.resolve({ success: true })
    })

    usePdfUploadStore.getState().addFiles([makeFile('dup.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())
    const row = usePdfUploadStore.getState().files[0]!

    act(() => usePdfUploadStore.getState().resolveDuplicate(row.id))
    await waitFor(() => expect(usePdfUploadStore.getState().files[0]?.step).toBe('error'))
    expect(usePdfUploadStore.getState().claimedFileNames.has('dup_2.pdf')).toBe(false)
  })

  it('uploadAll進行中に別行のretry/resolveDuplicateを呼んでも無視される(isAnyUploadInFlightの排他ガード)', async () => {
    let resolveFirst!: (v: unknown) => void
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      if (data.fileName === 'a.pdf') return new Promise((resolve) => { resolveFirst = resolve })
      return Promise.resolve({ success: true, documentId: 'doc-b' })
    })

    usePdfUploadStore.getState().addFiles([makeFile('a.pdf'), makeFile('b.pdf')])
    const uploadPromise = act(() => usePdfUploadStore.getState().uploadAll())
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))
    expect(usePdfUploadStore.getState().isAnyUploadInFlight).toBe(true)

    // b.pdfはまだidleのまま(uploadAllのループがa.pdfで止まっている)。ここでretry/resolveDuplicateを
    // 呼んでも、uploadOneFile内のisAnyUploadInFlightガードにより無視されるべき
    const bId = usePdfUploadStore.getState().files.find((f) => f.file.name === 'b.pdf')!.id
    act(() => usePdfUploadStore.getState().retry(bId))
    expect(mockCallFunction).toHaveBeenCalledTimes(1)

    resolveFirst({ success: true, documentId: 'doc-a' })
    await uploadPromise
  })
})

describe('行ごとのonSnapshot購読', () => {
  it('processed到達時に購読解除+completionCounter加算、他行には影響しない', async () => {
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      const id = data.fileName === 'a.pdf' ? 'doc-a' : 'doc-b'
      return Promise.resolve({ success: true, documentId: id })
    })

    usePdfUploadStore.getState().addFiles([makeFile('a.pdf'), makeFile('b.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())
    expect(nextCallbacks.has('doc-a')).toBe(true)
    expect(nextCallbacks.has('doc-b')).toBe(true)

    emitSnapshot('doc-a', { status: 'processing' })
    expect(usePdfUploadStore.getState().files.find((f) => f.documentId === 'doc-a')?.step).toBe('processing')
    expect(usePdfUploadStore.getState().files.find((f) => f.documentId === 'doc-b')?.step).toBe('pending')

    emitSnapshot('doc-a', { status: 'processed' })
    expect(usePdfUploadStore.getState().completionCounter).toBe(1)
    expect(unsubscribeSpies.get('doc-a')).toHaveBeenCalled()
    expect(nextCallbacks.has('doc-b')).toBe(true)
  })

  it('OCRエラー到達時にも購読解除+予約解放される', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-x' })
    usePdfUploadStore.getState().addFiles([makeFile('x.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    emitSnapshot('doc-x', { status: 'error', lastErrorMessage: 'OCR失敗' })
    expect(usePdfUploadStore.getState().files[0]?.step).toBe('error')
    expect(usePdfUploadStore.getState().files[0]?.error).toBe('OCR失敗')
    expect(unsubscribeSpies.get('doc-x')).toHaveBeenCalled()
    expect(usePdfUploadStore.getState().claimedFileNames.has('x.pdf')).toBe(false)
  })

  it('文書消失(dataがundefined)はerror終端として扱う(判断1)', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-gone' })
    usePdfUploadStore.getState().addFiles([makeFile('gone.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    emitSnapshot('doc-gone', undefined as unknown as SnapshotData)
    expect(usePdfUploadStore.getState().files[0]?.step).toBe('error')
  })

  it('splitはprocessed扱いになる(判断1)', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-split' })
    usePdfUploadStore.getState().addFiles([makeFile('split.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    emitSnapshot('doc-split', { status: 'split' })
    expect(usePdfUploadStore.getState().files[0]?.step).toBe('processed')
    expect(usePdfUploadStore.getState().completionCounter).toBe(1)
  })

  it('未知のstatus値はerror終端になり、診断ログが残る(silent-failure-hunter指摘)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-unknown-status' })
    usePdfUploadStore.getState().addFiles([makeFile('unknown.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    emitSnapshot('doc-unknown-status', { status: 'some-future-status' })
    expect(usePdfUploadStore.getState().files[0]?.step).toBe('error')
    expect(consoleError).toHaveBeenCalledWith(
      'Unexpected document snapshot state:',
      expect.objectContaining({ documentId: 'doc-unknown-status', status: 'some-future-status' })
    )
    consoleError.mockRestore()
  })

  it('アプリの正常なerror終端(status===error)では想定外状態の診断ログを出さない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-normal-error' })
    usePdfUploadStore.getState().addFiles([makeFile('normalerror.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    emitSnapshot('doc-normal-error', { status: 'error', lastErrorMessage: 'OCR失敗' })
    expect(usePdfUploadStore.getState().files[0]?.step).toBe('error')
    expect(consoleError).not.toHaveBeenCalledWith('Unexpected document snapshot state:', expect.anything())
    consoleError.mockRestore()
  })

  it('onSnapshotのerrorコールバックでもerror終端+購読解除+予約解放される(plan-crossreview Medium#3)', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-snap-err' })
    usePdfUploadStore.getState().addFiles([makeFile('snaperr.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    emitSnapshotError('doc-snap-err')
    expect(usePdfUploadStore.getState().files[0]?.step).toBe('error')
    expect(unsubscribeSpies.get('doc-snap-err')).toHaveBeenCalled()
    expect(usePdfUploadStore.getState().claimedFileNames.has('snaperr.pdf')).toBe(false)
  })

  it('OCRエラー後の再試行でdocumentIdが変わる場合、旧購読が解除され新規購読に差し替わる', async () => {
    let callCount = 0
    mockCallFunction.mockImplementation(() => {
      callCount++
      return Promise.resolve({ success: true, documentId: `doc-retry-${callCount}` })
    })

    usePdfUploadStore.getState().addFiles([makeFile('retry.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())
    expect(nextCallbacks.has('doc-retry-1')).toBe(true)

    emitSnapshot('doc-retry-1', { status: 'error', lastErrorMessage: '失敗' })
    expect(unsubscribeSpies.get('doc-retry-1')).toHaveBeenCalled()

    const rowId = usePdfUploadStore.getState().files[0]!.id
    act(() => usePdfUploadStore.getState().retry(rowId))
    await waitFor(() => expect(nextCallbacks.has('doc-retry-2')).toBe(true))
    expect(nextCallbacks.has('doc-retry-1')).toBe(false)
  })

  it('active行(購読中)をremoveFileで削除すると購読も解除される(PR review指摘: 購読リーク防止)', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-remove' })
    usePdfUploadStore.getState().addFiles([makeFile('remove.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())
    expect(nextCallbacks.has('doc-remove')).toBe(true)

    const rowId = usePdfUploadStore.getState().files[0]!.id
    act(() => usePdfUploadStore.getState().removeFile(rowId))

    expect(usePdfUploadStore.getState().files.length).toBe(0)
    expect(unsubscribeSpies.get('doc-remove')).toHaveBeenCalled()
    expect(nextCallbacks.has('doc-remove')).toBe(false)
  })
})

describe('closeModal — データ温存(plan-crossreview: closeModal()実装時訂正)', () => {
  it('active行がある間はcloseModal()を呼んでもfiles・購読が温存され、processedまで進む(本Issueの中心回帰テスト)', async () => {
    let resolveUpload!: (v: unknown) => void
    mockCallFunction.mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve }))

    usePdfUploadStore.getState().addFiles([makeFile('a.pdf')])
    usePdfUploadStore.getState().openModal()
    const uploadPromise = act(() => usePdfUploadStore.getState().uploadAll())
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))

    act(() => usePdfUploadStore.getState().closeModal())
    expect(usePdfUploadStore.getState().isModalOpen).toBe(false)
    expect(usePdfUploadStore.getState().files.length).toBe(1)

    resolveUpload({ success: true, documentId: 'doc-a' })
    await uploadPromise
    emitSnapshot('doc-a', { status: 'processed' })
    expect(usePdfUploadStore.getState().files[0]?.step).toBe('processed')
  })

  it('error/duplicate行(NeedsAttention)が残っている場合もcloseModal()で温存される(検証手順b)', async () => {
    mockCallFunction.mockResolvedValue({ success: true, duplicate: true, existingFileName: 'dup.pdf', suggestedFileName: 'dup_2.pdf' })
    usePdfUploadStore.getState().addFiles([makeFile('dup.pdf')])
    usePdfUploadStore.getState().openModal()
    await act(() => usePdfUploadStore.getState().uploadAll())
    expect(usePdfUploadStore.getState().files[0]?.step).toBe('duplicate')

    act(() => usePdfUploadStore.getState().closeModal())
    expect(usePdfUploadStore.getState().files.length).toBe(1)
    expect(usePdfUploadStore.getState().files[0]?.step).toBe('duplicate')

    // 再度モーダルを開いて「別名で保存」を続行できる
    usePdfUploadStore.getState().openModal()
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-resolved' })
    act(() => usePdfUploadStore.getState().resolveDuplicate(usePdfUploadStore.getState().files[0]!.id))
    await waitFor(() => expect(usePdfUploadStore.getState().files[0]?.step).toBe('pending'))
  })

  it('進行中・要対応のいずれもない場合(idleのみ)はcloseModal()で即クリアされる', () => {
    usePdfUploadStore.getState().addFiles([makeFile('a.pdf')])
    usePdfUploadStore.getState().openModal()
    act(() => usePdfUploadStore.getState().closeModal())

    expect(usePdfUploadStore.getState().files.length).toBe(0)
    expect(usePdfUploadStore.getState().claimedFileNames.size).toBe(0)
    expect(usePdfUploadStore.getState().isModalOpen).toBe(false)
  })
})

describe('全件processed後の自動クリア', () => {
  it('全件processedで2秒後にfiles/claimedFileNamesが自動クリアされる(fake timers)', async () => {
    // FileReaderベースのreadFileAsBase64は実タイマー/実マクロタスクに依存するため、
    // アップロード完了までは実時間で進め、自動クリアの待機区間だけfake timersに切り替える
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-a' })
    usePdfUploadStore.getState().addFiles([makeFile('a.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    // scheduleAutoClearIfDone()のsetTimeoutをfake timersで制御するため、
    // 完了イベントを発火する前にfake timersへ切り替える
    vi.useFakeTimers()
    act(() => emitSnapshot('doc-a', { status: 'processed' }))
    expect(usePdfUploadStore.getState().files.length).toBe(1)

    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(usePdfUploadStore.getState().files.length).toBe(0)
    expect(usePdfUploadStore.getState().claimedFileNames.size).toBe(0)
  })

  it('1件でもerror/duplicateが残れば自動クリアは発火しない', async () => {
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      if (data.fileName === 'ok.pdf') return Promise.resolve({ success: true, documentId: 'doc-ok' })
      return Promise.reject(new Error('failure'))
    })

    usePdfUploadStore.getState().addFiles([makeFile('ok.pdf'), makeFile('ng.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())
    act(() => emitSnapshot('doc-ok', { status: 'processed' }))

    vi.useFakeTimers()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(usePdfUploadStore.getState().files.length).toBe(2)
  })
})

describe('reset() とepochによる古い結果の破棄(plan-crossreview High#1)', () => {
  it('reset()後に旧epochのonSnapshot next/errorコールバックが発火しても状態は変化しない', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-a' })
    usePdfUploadStore.getState().addFiles([makeFile('a.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    act(() => usePdfUploadStore.getState().reset())
    expect(usePdfUploadStore.getState().files.length).toBe(0)

    // resetでunsubscribeAllが呼ばれているはずだが、コールバック自体が万一残存発火しても
    // epochチェックが最終防波堤として状態を変えないことを確認する
    if (nextCallbacks.has('doc-a')) {
      emitSnapshot('doc-a', { status: 'processed' })
    }
    expect(usePdfUploadStore.getState().files.length).toBe(0)
    expect(usePdfUploadStore.getState().completionCounter).toBe(0)
  })

  it('reset()後に旧autoClearTimerが発火しても新バッチを消さない', async () => {
    mockCallFunction.mockResolvedValue({ success: true, documentId: 'doc-old' })
    usePdfUploadStore.getState().addFiles([makeFile('old.pdf')])
    await act(() => usePdfUploadStore.getState().uploadAll())

    // 旧epochのautoClearTimerがfake timerとして実際に発火し、epochチェックで
    // ブロックされることを検証するため、タイマー登録前にfake timersへ切り替える
    vi.useFakeTimers()
    act(() => emitSnapshot('doc-old', { status: 'processed' }))
    // この時点でautoClearTimerがスケジュールされている(2秒後に発火予定)

    act(() => usePdfUploadStore.getState().reset())
    // 新しいバッチを追加(reset後、新epoch)
    usePdfUploadStore.getState().addFiles([makeFile('new.pdf')])

    await act(() => vi.advanceTimersByTimeAsync(2000))
    // 旧epochのタイマーが新バッチを消していないこと
    expect(usePdfUploadStore.getState().files.map((f) => f.file.name)).toEqual(['new.pdf'])
  })

  it('reset()後、旧ループは中断された残りファイルを処理しない(古いbatchのtargetsが取り残されても新ループが正しく拾う)', async () => {
    let resolveFirst!: (v: unknown) => void
    let secondCallCount = 0
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      if (data.fileName === 'first.pdf') {
        return new Promise((resolve) => { resolveFirst = resolve })
      }
      secondCallCount++
      return Promise.resolve({ success: true, documentId: `doc-second-${secondCallCount}` })
    })

    usePdfUploadStore.getState().addFiles([makeFile('first.pdf'), makeFile('second.pdf')])
    const oldLoopPromise = act(() => usePdfUploadStore.getState().uploadAll())
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))

    // ログアウト等でreset。旧ループは'first.pdf'のcallFunction待ちのまま中断される
    act(() => usePdfUploadStore.getState().reset())
    resolveFirst({ success: true, documentId: 'doc-first' })
    await oldLoopPromise

    // 旧ループのfor-loopはepoch不一致でbreakし、'second.pdf'(次のtarget)を一度も処理していない
    expect(secondCallCount).toBe(0)
  })

  it('旧ループのfinallyが、既に開始している新バッチのisAnyUploadInFlightを落とさない', async () => {
    let resolveFirst!: (v: unknown) => void
    let resolveNew!: (v: unknown) => void
    mockCallFunction.mockImplementation((_name: string, data: { fileName: string }) => {
      if (data.fileName === 'first.pdf') return new Promise((resolve) => { resolveFirst = resolve })
      if (data.fileName === 'new.pdf') return new Promise((resolve) => { resolveNew = resolve })
      throw new Error(`unexpected file: ${data.fileName}`)
    })

    usePdfUploadStore.getState().addFiles([makeFile('first.pdf')])
    const oldLoopPromise = act(() => usePdfUploadStore.getState().uploadAll())
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(1))

    // ログアウト等でreset。旧ループの'first.pdf'は保留(resolveFirst未呼出)のまま中断される
    act(() => usePdfUploadStore.getState().reset())
    usePdfUploadStore.getState().addFiles([makeFile('new.pdf')])
    const newLoopPromise = act(() => usePdfUploadStore.getState().uploadAll())
    await waitFor(() => expect(mockCallFunction).toHaveBeenCalledTimes(2))
    expect(usePdfUploadStore.getState().isAnyUploadInFlight).toBe(true)

    // 旧ループの保留中だったcallFunctionを今ここで(新バッチ進行中に)解決させる
    act(() => resolveFirst({ success: true, documentId: 'doc-first' }))
    await oldLoopPromise

    // 新バッチはまだ処理中のはず。旧ループのfinallyに落とされていないことの確認
    expect(usePdfUploadStore.getState().isAnyUploadInFlight).toBe(true)

    act(() => resolveNew({ success: true, documentId: 'doc-new' }))
    await newLoopPromise
    expect(usePdfUploadStore.getState().isAnyUploadInFlight).toBe(false)
  })
})

describe('auth連動reset(plan-crossreview High#2)', () => {
  it('uidがdefined→undefinedに遷移した場合はreset()される(ログアウト)', () => {
    act(() => setAuthUid('user-a'))
    usePdfUploadStore.getState().addFiles([makeFile('a.pdf')])
    expect(usePdfUploadStore.getState().files.length).toBe(1)

    act(() => setAuthUid(null))
    expect(usePdfUploadStore.getState().files.length).toBe(0)
    expect(toastDismiss).toHaveBeenCalledWith(PDF_UPLOAD_TOAST_ID)
  })

  it('uidが別ユーザーへ遷移した場合もreset()される', () => {
    act(() => setAuthUid('user-a'))
    usePdfUploadStore.getState().addFiles([makeFile('a.pdf')])

    act(() => setAuthUid('user-b'))
    expect(usePdfUploadStore.getState().files.length).toBe(0)
  })

  it('undefined→defined(初回ログイン)ではreset()されない', () => {
    usePdfUploadStore.getState().addFiles([makeFile('a.pdf')])
    act(() => setAuthUid('user-a'))
    expect(usePdfUploadStore.getState().files.length).toBe(1)
  })

  it('同一uidへの再設定(通常の再レンダー相当)ではreset()されない', () => {
    act(() => setAuthUid('user-a'))
    usePdfUploadStore.getState().addFiles([makeFile('a.pdf')])

    act(() => setAuthUid('user-a'))
    expect(usePdfUploadStore.getState().files.length).toBe(1)
  })
})
