/**
 * PdfSplitModal 単体テスト
 *
 * ADR-0018 Phase E (Issue #547) 事前調査の既知リスク対応:
 * documents/{id}/detail/main (useDocumentDetail) の取得が未完了(isLoading)
 * または失敗(isError)のまま「次へ」「分割を実行」を操作できてしまうと、
 * Phase E後は document.pageResults が本体から削除されるため、分割プレビュー
 * (generateSplitPreview) の documentType/customerName がエラーなく黙って
 * 「未判定」にフォールバックしてしまう。detailLoading/detailError props
 * によってこの操作をブロックできることを検証する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Timestamp } from 'firebase/firestore'
import type { Document } from '@shared/types'

// @testing-library/jest-dom は未導入のため、disabled 判定はネイティブDOMプロパティで検証する
const isDisabled = (el: HTMLElement): boolean => (el as HTMLButtonElement).disabled

// Firebase Storage: fileUrl は https:// を使い gs:// 変換分岐を通さないため、
// ref/getDownloadURL は呼ばれない想定だが import 解決のためモックしておく。
vi.mock('@/lib/firebase', () => ({
  storage: {},
}))
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  getDownloadURL: vi.fn(),
}))

// PDF実描画（react-pdf/pdf.js）は jsdom では動作しないためスタブ化。
// 本テストの対象は分割実行系ボタンの disabled 制御であり、プレビュー描画は対象外。
vi.mock('@/components/PdfSplitPreview', () => ({
  PdfSplitPreview: () => <div data-testid="pdf-split-preview-stub" />,
}))

// MasterSelectField は内部で RegisterNewMasterModal → useCareManagers 等の
// react-query hookを無条件に呼び出すため QueryClientProvider が別途必要になる。
// 本テストの対象はセグメント編集UIではなく分割実行系ボタンのdisabled制御なので、
// 表示用の最小スタブに置き換えてスコープ外の依存を切り離す。
vi.mock('@/components/MasterSelectField', () => ({
  MasterSelectField: ({ value }: { value: string }) => <span>{value}</span>,
}))

// マスターデータ取得（Firestore getDocs 経由）をバイパス
vi.mock('@/hooks/useDocuments', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useDocuments')>('@/hooks/useDocuments')
  return {
    ...actual,
    useDocumentMasters: () => ({ data: [] }),
    useCustomerMasters: () => ({ data: [] }),
    useOfficeMasters: () => ({ data: [] }),
  }
})

// 分割系mutation（Cloud Functions呼び出し）をバイパス。isPending: false固定。
const mockSplitPdfMutateAsync = vi.fn().mockResolvedValue({ success: true, createdDocuments: [] })
vi.mock('@/hooks/usePdfSplit', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/usePdfSplit')>('@/hooks/usePdfSplit')
  return {
    ...actual,
    useDetectSplitPoints: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSplitPdf: () => ({ mutateAsync: mockSplitPdfMutateAsync, isPending: false }),
    useRotatePdfPages: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})

import { PdfSplitModal } from '../PdfSplitModal'

const makeDocument = (overrides: Partial<Document> = {}): Document => ({
  id: 'doc-001',
  processedAt: Timestamp.now(),
  fileId: 'file-001',
  fileName: 'test.pdf',
  mimeType: 'application/pdf',
  ocrResult: '',
  documentType: '請求書',
  customerName: '田村 勝義',
  officeName: 'テスト事業所',
  fileUrl: 'https://example.com/test.pdf',
  fileDate: Timestamp.now(),
  isDuplicateCustomer: false,
  totalPages: 2,
  targetPageNumber: 1,
  status: 'processed',
  // 分割ポイントが最初から1件存在する状態にして、
  // 「次へ」ボタンの disabled 判定が splitPoints ではなく
  // detailLoading/detailError 由来であることを切り分けやすくする
  splitSuggestions: [
    {
      afterPageNumber: 1,
      reason: 'manual',
      confidence: 100,
      newDocumentType: null,
      newCustomerName: null,
    },
  ],
  ...overrides,
})

describe('PdfSplitModal - detail取得状態によるボタン制御 (Issue #547 Phase E既知リスク対応)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detailLoading=false かつ detailError=false のとき「次へ」ボタンが有効になる', () => {
    render(
      <PdfSplitModal
        document={makeDocument()}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        detailLoading={false}
        detailError={false}
      />
    )

    const nextButton = screen.getByRole('button', { name: '次へ: 分割内容の確認' })
    expect(isDisabled(nextButton)).toBe(false)
    // 読み込み中/失敗のバナーは表示されない
    expect(screen.queryByText(/書類詳細/)).toBeNull()
  })

  it('detailLoading=true のとき「次へ」ボタンが無効化され、読み込み中メッセージが表示される', () => {
    render(
      <PdfSplitModal
        document={makeDocument()}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        detailLoading={true}
        detailError={false}
      />
    )

    const nextButton = screen.getByRole('button', { name: '次へ: 分割内容の確認' })
    expect(isDisabled(nextButton)).toBe(true)
    expect(
      screen.getByText('書類詳細を読み込み中です。読み込みが完了するまで分割は実行できません。')
    ).toBeDefined()
  })

  it('detailError=true のとき「次へ」ボタンが無効化され、エラーメッセージが表示される', () => {
    render(
      <PdfSplitModal
        document={makeDocument()}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        detailLoading={false}
        detailError={true}
      />
    )

    const nextButton = screen.getByRole('button', { name: '次へ: 分割内容の確認' })
    expect(isDisabled(nextButton)).toBe(true)
    expect(
      screen.getByText('書類詳細の取得に失敗したため分割を実行できません。モーダルを閉じて開き直してください。')
    ).toBeDefined()
  })

  it('splitPoints が空でも detailLoading/detailError が false なら「次へ」の disabled 理由は分割ポイント欠如のみになる', () => {
    render(
      <PdfSplitModal
        document={makeDocument({ splitSuggestions: [] })}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        detailLoading={false}
        detailError={false}
      />
    )

    // splitPoints.length === 0 により無効化されるが、detail起因のバナーは出ない
    expect(isDisabled(screen.getByRole('button', { name: '次へ: 分割内容の確認' }))).toBe(true)
    expect(screen.queryByText(/書類詳細/)).toBeNull()
  })

  it('確認ステップに進んだ後に detailError が true になった場合、「分割を実行」ボタンが無効化される（防御的二重チェック）', async () => {
    const { rerender } = render(
      <PdfSplitModal
        document={makeDocument()}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        detailLoading={false}
        detailError={false}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '次へ: 分割内容の確認' }))
    const executeButton = await screen.findByRole('button', { name: /分割を実行/ })
    expect(isDisabled(executeButton)).toBe(false)

    // モーダルを開いたまま detail クエリが後から失敗した状態を模擬
    rerender(
      <PdfSplitModal
        document={makeDocument()}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        detailLoading={false}
        detailError={true}
      />
    )

    expect(isDisabled(screen.getByRole('button', { name: /分割を実行/ }))).toBe(true)
  })
})
