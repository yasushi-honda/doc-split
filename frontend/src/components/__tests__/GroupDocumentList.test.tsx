/**
 * GroupDocumentList 単体テスト(Issue #1032回帰テスト)
 *
 * 担当CM別(groupType='careManager')表示は、利用者別・フォルダ別の件数を
 * useGroupDocuments(無限スクロール)が読み込み済みのページのみからクライアント集計する
 * (CustomerSubGroup.tsxが受け取るdocuments.length)。全件読み込み完了前に件数を見せると
 * 不正確になるため、展開時に自動で残りページを読み切り、完了(hasNextPage===false)まで
 * ローディング表示に留める挙動(GroupDocumentList.tsx)を検証する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Timestamp } from 'firebase/firestore'
import type { Document } from '@shared/types'
import { GroupDocumentList } from '../views/GroupDocumentList'

const mockUseGroupDocuments = vi.fn()

vi.mock('@/hooks/useDocumentGroups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDocumentGroups')>()
  return {
    ...actual,
    useGroupDocuments: (...args: unknown[]) => mockUseGroupDocuments(...args),
  }
})

vi.mock('@/hooks/useGroupDocumentListRefresh', () => ({
  useGroupDocumentListRefresh: () => ({
    hasUpdates: false,
    message: '',
    resetBaseline: vi.fn(),
  }),
}))

vi.mock('@/hooks/useMasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useMasters')>()
  return {
    ...actual,
    useDocumentTypes: () => ({ data: undefined, isError: false, error: null }),
    useCustomerIdentityLookup: () => ({
      isReady: true,
      sameNameCollisionNames: new Set<string>(),
      customerMasterNameById: new Map<string, string | null>(),
    }),
  }
})

vi.mock('@/hooks/useDocuments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDocuments')>()
  return {
    ...actual,
    useReprocessDocument: () => ({ reprocess: vi.fn(), reprocessingId: null }),
  }
})

// 実IntersectionObserverはjsdom未実装のため、無限スクロール検知自体は本テストの関心事外としてモック化
vi.mock('@/hooks/useInfiniteScroll', () => ({
  useInfiniteScroll: () => ({ loadMoreRef: { current: null } }),
}))

const makeDocument = (overrides: Partial<Document> = {}): Document => ({
  id: 'doc-001',
  processedAt: Timestamp.now(),
  fileId: 'file-001',
  fileName: 'test.pdf',
  mimeType: 'application/pdf',
  ocrResult: '',
  documentType: 'ケアプラン',
  customerName: '松本 実',
  officeName: 'テスト事業所',
  fileUrl: 'https://example.com/test.pdf',
  fileDate: Timestamp.now(),
  isDuplicateCustomer: false,
  totalPages: 1,
  targetPageNumber: 1,
  status: 'processed',
  verified: true,
  ...overrides,
})

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}

describe('GroupDocumentList - 担当CM別の件数表示(Issue #1032)', () => {
  beforeEach(() => {
    mockUseGroupDocuments.mockReset()
  })

  it('未読込ページが残る間(hasNextPage:true)は件数を出さずローディング表示にし、自動でfetchNextPageを呼ぶ', () => {
    const fetchNextPage = vi.fn()
    mockUseGroupDocuments.mockReturnValue({
      data: { pages: [{ documents: [makeDocument()], lastDoc: null, hasMore: true }] },
      fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: vi.fn(),
    })

    renderWithClient(
      <GroupDocumentList groupType="careManager" groupKey="cm-1" />
    )

    expect(fetchNextPage).toHaveBeenCalled()
    expect(screen.getByText(/件数を集計中/)).toBeDefined()
    // 部分読み込み分からの暫定的な顧客表示が出ていないこと
    expect(screen.queryByText('松本 実')).toBeNull()
  })

  it('全ページ読み込み完了(hasNextPage:false)後は追加fetchせず、正確な件数で顧客サブグループを表示する', () => {
    const fetchNextPage = vi.fn()
    const docs = [
      makeDocument({ id: 'doc-001' }),
      makeDocument({ id: 'doc-002' }),
      makeDocument({ id: 'doc-003' }),
    ]
    mockUseGroupDocuments.mockReturnValue({
      data: { pages: [{ documents: docs, lastDoc: null, hasMore: false }] },
      fetchNextPage,
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: vi.fn(),
    })

    renderWithClient(
      <GroupDocumentList groupType="careManager" groupKey="cm-1" />
    )

    expect(fetchNextPage).not.toHaveBeenCalled()
    expect(screen.queryByText(/件数を集計中/)).toBeNull()
    expect(screen.getByText('松本 実')).toBeDefined()
    expect(screen.getByText('3件')).toBeDefined()
  })

  it('追加ページ取得が失敗(isFetchNextPageError:true、react-query仕様上isErrorも同時にtrue)した場合、useEffectはfetchNextPageを自動再呼び出ししない(codex review P1回帰テスト、無限リトライループ防止)', () => {
    // react-queryの型上、isFetchNextPageError:trueはisError:trueと同時に成立する
    // (InfiniteQueryObserverRefetchErrorResult)。このときコンポーネント冒頭の
    // isError早期returnが先に発火し、汎用エラー画面(他groupTypeと共通、refetch呼び出しの
    // 再試行ボタン)が表示される。ここで検証したい本質は「effectが無限にfetchNextPageを
    // 呼び直さないこと」。
    const fetchNextPage = vi.fn()
    const refetch = vi.fn()
    mockUseGroupDocuments.mockReturnValue({
      data: { pages: [{ documents: [makeDocument()], lastDoc: null, hasMore: true }] },
      fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: true,
      isLoading: false,
      isError: true,
      isRefetching: false,
      refetch,
    })

    renderWithClient(
      <GroupDocumentList groupType="careManager" groupKey="cm-1" />
    )

    // isFetchNextPageError:true の間、useEffectはfetchNextPageを呼ばない(無限リトライループ防止)
    expect(fetchNextPage).not.toHaveBeenCalled()
    expect(screen.getByText('データの読み込みに失敗しました')).toBeDefined()
    expect(screen.queryByText(/件数を集計中/)).toBeNull()

    // 既存の汎用再試行ボタンはrefetch(1ページ目からの再取得)を呼ぶ
    fireEvent.click(screen.getByRole('button', { name: /再試行/ }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('手動再試行(refetch)の実行中(isRefetching:true)はfetchNextPageを呼ばない(codex review P2回帰テスト、手動再試行キャンセル防止)', () => {
    // refetch()はforward-fetchのメタ情報をクリアするため、失敗直後の再試行操作は
    // isFetchNextPageError:false・isRefetching:trueという状態を一瞬経由しうる。ここで
    // effectがfetchNextPageを呼ぶと、TanStack Queryの既定動作(cancelRefetch)でユーザーが
    // 起動したrefetchそのものがキャンセルされてしまう。
    const fetchNextPage = vi.fn()
    mockUseGroupDocuments.mockReturnValue({
      data: { pages: [{ documents: [makeDocument()], lastDoc: null, hasMore: true }] },
      fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      isLoading: false,
      isError: true,
      isRefetching: true,
      refetch: vi.fn(),
    })

    renderWithClient(
      <GroupDocumentList groupType="careManager" groupKey="cm-1" />
    )

    expect(fetchNextPage).not.toHaveBeenCalled()
  })
})
