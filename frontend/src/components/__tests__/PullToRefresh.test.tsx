/**
 * PullToRefresh 単体テスト (Issue #1031)
 *
 * PDFアップロード中(初回リクエスト中 or OCR処理中)はフルリロードを抑止することの回帰テスト。
 * pr-review-toolkit(pr-test-analyzer)指摘: 新規ガードロジックにテストが無かったため追加。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('@/lib/firebase', () => ({
  db: {},
}))

import { PullToRefresh } from '../PullToRefresh'
import { usePdfUploadStore } from '@/stores/pdfUploadStore'
import type { FileUploadItem } from '@/lib/pdfUpload'

const THRESHOLD_EXCEEDING_DELTA = 300 // *0.4 = 120 > THRESHOLD(80)

function makeItem(step: FileUploadItem['step']): FileUploadItem {
  return { id: crypto.randomUUID(), file: new File(['x'], 'a.pdf'), step }
}

function dispatchTouch(type: 'touchstart' | 'touchmove' | 'touchend', clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: [{ clientY }], configurable: true })
  document.dispatchEvent(event)
}

function pullBeyondThreshold() {
  // touchend の onTouchEnd ハンドラは useCallback([isPulling, pullDistance]) で再生成され、
  // useEffect経由でリスナーが再登録されるまで古いクロージャのままになる。1つのact()に
  // まとめて同期発火すると再レンダーが挟まらずtouchendが古いisPulling/pullDistanceを
  // 見てしまうため、イベントごとにact()を分けて再レンダーを挟む
  act(() => dispatchTouch('touchstart', 0))
  act(() => dispatchTouch('touchmove', THRESHOLD_EXCEEDING_DELTA))
  act(() => dispatchTouch('touchend', THRESHOLD_EXCEEDING_DELTA))
}

const reloadMock = vi.fn()

beforeEach(() => {
  reloadMock.mockReset()
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  // jsdomのwindow.location.reloadは再定義不可のため、location自体を差し替える
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadMock },
  })
  usePdfUploadStore.setState({
    files: [],
    claimedFileNames: new Map(),
    isAnyUploadInFlight: false,
    isModalOpen: false,
    completionCounter: 0,
    selectError: null,
  })
})

describe('PullToRefresh', () => {
  it('アップロード中でなければ、しきい値を超えて引っ張るとリロードする', () => {
    render(<PullToRefresh><div>content</div></PullToRefresh>)

    pullBeyondThreshold()

    expect(reloadMock).toHaveBeenCalled()
  })

  it('初回アップロードリクエスト中(isAnyUploadInFlight)はリロードを抑止する', () => {
    usePdfUploadStore.setState({ isAnyUploadInFlight: true })
    render(<PullToRefresh><div>content</div></PullToRefresh>)

    pullBeyondThreshold()

    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('OCR処理中(pending/processing行あり)もリロードを抑止する(codex review P2指摘の回帰テスト)', () => {
    usePdfUploadStore.setState({ files: [makeItem('pending')] })
    render(<PullToRefresh><div>content</div></PullToRefresh>)

    pullBeyondThreshold()

    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('processed/error行のみ(activeでない)ならリロードを抑止しない', () => {
    usePdfUploadStore.setState({ files: [makeItem('processed'), makeItem('error')] })
    render(<PullToRefresh><div>content</div></PullToRefresh>)

    pullBeyondThreshold()

    expect(reloadMock).toHaveBeenCalled()
  })
})
