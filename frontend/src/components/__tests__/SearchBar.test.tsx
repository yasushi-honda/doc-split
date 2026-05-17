/**
 * SearchBar コンポーネントテスト (Issue #497)
 *
 * OOM ガード発動時バナーの表示/非表示を検証する。silent-failure-hunter CRT-1 対応
 * (Issue #402 段階2、PR #496) で BE 側に `truncated` / `actualMatchedCount` flag を
 * 追加した後、FE 側でユーザーが切り捨て事実に気付ける semi-silent 状態を実現する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchBar } from '../SearchBar'

// useDebouncedSearch をモックして戻り値を直接制御
vi.mock('@/hooks/useSearch', async () => {
  return {
    useDebouncedSearch: vi.fn(),
  }
})

import { useDebouncedSearch } from '@/hooks/useSearch'

type MockedHookReturn = ReturnType<typeof useDebouncedSearch>

function setupMockedSearch(overrides: Partial<MockedHookReturn>): void {
  const base: MockedHookReturn = {
    query: 'test',
    setQuery: vi.fn(),
    results: [
      {
        id: 'doc-1',
        fileName: 'sample.pdf',
        customerName: 'テスト顧客',
        officeName: 'テスト事業所',
        documentType: '請求書',
        fileDate: '2026-05-17',
        score: 1.0,
      },
    ],
    total: 20,
    hasMore: false,
    truncated: false,
    actualMatchedCount: 0,
    isLoading: false,
    isError: false,
    error: null,
    search: vi.fn(),
    loadMore: vi.fn(),
    reset: vi.fn(),
  }
  ;(useDebouncedSearch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    ...base,
    ...overrides,
  })
}

describe('SearchBar — OOM ガード発動時バナー (Issue #497)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('truncated=true + actualMatchedCount>0 でバナーが表示される (silent loss → semi-silent)', () => {
    setupMockedSearch({
      total: 500,
      truncated: true,
      actualMatchedCount: 501,
    })

    render(<SearchBar />)

    // dropdown は query.length >= 2 + focus で開く設計だが、テストでは初期 isOpen=false
    // のため、まず query を入力扱いにする必要がある。ここでは isOpen を制御できないので、
    // 直接 useDebouncedSearch の query を 2 文字以上 + onFocus シミュレーションは不要で、
    // テスト対象は「results.length > 0 のとき truncated=true ならバナーが現れる」。
    // 実際の DOM は dropdown 内 (isOpen=true) でしか描画されないため、テストでは
    // SearchBar 内部の isOpen を強制的に true にする手段が必要。
    //
    // 簡易策: input に value='test' (query.length>=2) を入れた状態で focus を発火させて
    // dropdown を開く。
    const input = screen.getByPlaceholderText('顧客名、事業所名、書類種別で検索...')
    fireEvent.focus(input)

    // バナー role="status" を直接検索 (dropdown open 後に DOM に存在)
    const banner = screen.queryByRole('status')
    if (banner) {
      expect(banner.textContent).toContain('該当が多すぎるため上位 500 件のみ表示しています')
      expect(banner.textContent).toContain('501 件中')
      expect(banner.textContent).toContain('検索語句を追加すると絞り込めます')
    } else {
      // dropdown が open していない場合は isOpen 制御が必要。本テストは描画ロジック確認
      // のため、focus 後に dropdown が開いていない場合は SearchBar の isOpen state を
      // 検証できない。代わりに「results が描画される DOM 構造を Card 配下に持つ」前提で
      // 不開状態をスキップせず明示的に fail させる。
      throw new Error(
        'dropdown が open していないためバナー検証不可。SearchBar の onFocus 条件を確認してください。',
      )
    }
  })

  it('truncated=false ではバナーが表示されない (非発動側)', () => {
    setupMockedSearch({
      total: 20,
      truncated: false,
      actualMatchedCount: 0,
    })

    render(<SearchBar />)
    const input = screen.getByPlaceholderText('顧客名、事業所名、書類種別で検索...')
    fireEvent.focus(input)

    // バナーは存在してはならない
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('truncated=true でも actualMatchedCount=0 ならバナーが表示されない (防御的 short-circuit)', () => {
    // 異常系: BE 側 contract 違反で truncated=true なのに actualMatchedCount が欠落する
    // ケース。SearchBar 側は && actualMatchedCount > 0 でガードしているため非表示が正解。
    setupMockedSearch({
      total: 500,
      truncated: true,
      actualMatchedCount: 0,
    })

    render(<SearchBar />)
    const input = screen.getByPlaceholderText('顧客名、事業所名、書類種別で検索...')
    fireEvent.focus(input)

    expect(screen.queryByRole('status')).toBeNull()
  })
})
