/**
 * SearchBar コンポーネントテスト (Issue #497)
 *
 * OOM ガード発動時バナーの表示/非表示を検証する。silent-failure-hunter CRT-1 対応
 * (Issue #402 段階2、PR #496) で BE 側に `truncated` / `actualMatchedCount` flag を
 * 追加した後、FE 側でユーザーが切り捨て事実に気付ける semi-silent 状態を実現する。
 *
 * E2E (Playwright) では別 issue で実機確認予定 (dark mode 視覚検証、aria-live 通知の
 * 実際の screen reader 挙動)。本ファイルは描画ロジック契約 (props 駆動の表示判定 +
 * accessibility role 属性 + 防御短絡) の単体検証に範囲を限定する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchBar } from '../SearchBar'

vi.mock('@/hooks/useSearch', async () => ({
  useDebouncedSearch: vi.fn(),
}))

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

/**
 * dropdown を open させて render する shorthand。mock の query='test' により
 * `query.length >= 2 && setIsOpen(true)` で focus 1 回で確実に dropdown が描画される。
 */
function renderAndOpen(): void {
  render(<SearchBar />)
  const input = screen.getByPlaceholderText('顧客名、事業所名、書類種別で検索...')
  fireEvent.focus(input)
}

describe('SearchBar — OOM ガード発動時バナー (Issue #497)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('truncated=true + actualMatchedCount>0 でバナー描画 + role=status + 文言固定', () => {
    setupMockedSearch({ total: 500, truncated: true, actualMatchedCount: 501 })
    renderAndOpen()

    // CRIT-1 対応: getByRole は要素未発見で自動 fail (前回 fail 時の if-else fallback 廃止)。
    const banner = screen.getByRole('status')

    // CRIT-2 対応: aria-live region 相当の role="status" 属性を直接 fixate。
    // class だけ残して role が消えるリファクタは silent regression のため明示固定する。
    expect(banner.getAttribute('role')).toBe('status')

    // 文言は silent loss 改善の核心 UX (= ユーザーが「実 M 件中の上位 N 件」事実に
    // 気付けて検索語句絞り込みに誘導される) のため 3 要素を独立検証する。
    const text = banner.textContent ?? ''
    expect(text).toContain('該当が多すぎるため上位 500 件のみ表示しています')
    expect(text).toContain('501 件中')
    expect(text).toContain('検索語句を追加すると絞り込めます')
  })

  it('truncated=false ではバナー非表示', () => {
    setupMockedSearch({ total: 20, truncated: false, actualMatchedCount: 0 })
    renderAndOpen()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('truncated=true でも actualMatchedCount=0 ならバナー非表示 (防御短絡: 数値不正値)', () => {
    setupMockedSearch({ total: 500, truncated: true, actualMatchedCount: 0 })
    renderAndOpen()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('truncated=true でも actualMatchedCount=undefined ならバナー非表示 (防御短絡: 型契約)', () => {
    // BE contract 違反シミュレーション: spread 漏れで `truncated: true` のみ送られ
    // `actualMatchedCount` が欠落するケース。FE 側 `?? 0` フォールバック後に
    // `&& actualMatchedCount > 0` で短絡されるため非表示が正解 (IMP-3 対応)。
    setupMockedSearch({
      total: 500,
      truncated: true,
      actualMatchedCount: undefined as unknown as number,
    })
    renderAndOpen()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('isLoading=true のときは truncated=true でもバナー非表示 (描画ネスト位置の固定)', () => {
    // バナーは `{!isLoading && results.length > 0 && (<>...</>)}` 配下にネスト。
    // ローディング中にバナーが残るリファクタを silent regression として検出 (IMP-4 対応)。
    setupMockedSearch({
      isLoading: true,
      total: 500,
      truncated: true,
      actualMatchedCount: 501,
    })
    renderAndOpen()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('results.length===0 のときは truncated=true でもバナー非表示 (BE contract 違反防御)', () => {
    // 論理的にあり得ないが BE 側 contract 違反 (truncated=true なのに documents=[]) で
    // 起こり得る。`results.length > 0` ガード破壊を回帰検出 (IMP-4 対応)。
    setupMockedSearch({
      results: [],
      total: 0,
      truncated: true,
      actualMatchedCount: 501,
    })
    renderAndOpen()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
