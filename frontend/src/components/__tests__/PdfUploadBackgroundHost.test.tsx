/**
 * PdfUploadBackgroundHost 単体テスト (Issue #1031)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

const toastLoading = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()
const toastDismiss = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    loading: (...args: unknown[]) => toastLoading(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    dismiss: (...args: unknown[]) => toastDismiss(...args),
  },
}))

import { PdfUploadBackgroundHost } from '../PdfUploadBackgroundHost'
import { usePdfUploadStore, PDF_UPLOAD_TOAST_ID } from '@/stores/pdfUploadStore'
import type { FileUploadItem } from '@/lib/pdfUpload'

function makeItem(step: FileUploadItem['step']): FileUploadItem {
  return { id: crypto.randomUUID(), file: new File(['x'], 'a.pdf'), step }
}

function setState(partial: Partial<ReturnType<typeof usePdfUploadStore.getState>>) {
  act(() => {
    usePdfUploadStore.setState(partial)
  })
}

beforeEach(() => {
  toastLoading.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  toastDismiss.mockReset()
  usePdfUploadStore.setState({
    files: [],
    claimedFileNames: new Map(),
    isAnyUploadInFlight: false,
    isModalOpen: false,
    completionCounter: 0,
    selectError: null,
  })
})

describe('PdfUploadBackgroundHost', () => {
  it('何も描画しない', () => {
    const { container } = render(<PdfUploadBackgroundHost />)
    expect(container.innerHTML).toBe('')
  })

  it('非表示+activeなファイルありでtoast.loadingを呼ぶ', () => {
    render(<PdfUploadBackgroundHost />)
    setState({ files: [makeItem('uploading')], isModalOpen: false })
    expect(toastLoading).toHaveBeenCalledWith(expect.any(String), { id: PDF_UPLOAD_TOAST_ID })
  })

  it('非表示+needsAttentionでtoast.errorをアクションボタン付き・duration:Infinityで呼ぶ', () => {
    render(<PdfUploadBackgroundHost />)
    setState({ files: [makeItem('error')], isModalOpen: false })

    expect(toastError).toHaveBeenCalledTimes(1)
    const [, options] = toastError.mock.calls[0] as [string, { id: string; duration: number; action: { label: string; onClick: () => void } }]
    expect(options.id).toBe(PDF_UPLOAD_TOAST_ID)
    expect(options.action.label).toBeTruthy()
    // silent-failure-hunter指摘: sonner既定duration(約4秒)で自動消滅すると、裏側で
    // 恒久的に残るerror行に対する唯一の通知手段が失われるため、明示的にInfinityにする
    expect(options.duration).toBe(Infinity)

    act(() => options.action.onClick())
    expect(usePdfUploadStore.getState().isModalOpen).toBe(true)
  })

  it('非表示+全件processedでtoast.successを呼ぶ', () => {
    render(<PdfUploadBackgroundHost />)
    setState({ files: [makeItem('processed')], isModalOpen: false })
    expect(toastSuccess).toHaveBeenCalledWith(expect.any(String), { id: PDF_UPLOAD_TOAST_ID })
  })

  it('モーダルが開いていればtoast.dismissを呼ぶ', () => {
    render(<PdfUploadBackgroundHost />)
    setState({ files: [makeItem('uploading')], isModalOpen: true })
    expect(toastDismiss).toHaveBeenCalledWith(PDF_UPLOAD_TOAST_ID)
  })

  it('同一トースト内容のstate更新ではtoast.*を再呼出ししない(plan-crossreview Medium#9)', () => {
    render(<PdfUploadBackgroundHost />)
    const item = makeItem('uploading')
    setState({ files: [item], isModalOpen: false })
    expect(toastLoading).toHaveBeenCalledTimes(1)

    // filesの配列参照・オブジェクト参照が変わっても(件数・stepの構成が同じで)
    // 導出されるトースト仕様(kind+message)が変わらなければ再呼出ししない
    setState({ files: [{ ...item }], isModalOpen: false })
    expect(toastLoading).toHaveBeenCalledTimes(1)
  })

  it('トースト仕様が実際に変化すれば再度呼び出す', () => {
    render(<PdfUploadBackgroundHost />)
    setState({ files: [makeItem('uploading')], isModalOpen: false })
    expect(toastLoading).toHaveBeenCalledTimes(1)

    setState({ files: [makeItem('processed')], isModalOpen: false })
    expect(toastSuccess).toHaveBeenCalledTimes(1)
  })
})
