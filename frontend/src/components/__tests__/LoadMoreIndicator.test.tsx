/**
 * LoadMoreIndicator 単体テスト
 *
 * 無限スクロール用ローディングインジケーターの表示ロジック
 */

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadMoreIndicator } from '../LoadMoreIndicator'

describe('LoadMoreIndicator', () => {
  it('hasNextPage=falseのとき何もレンダリングしない', () => {
    const { container } = render(
      <LoadMoreIndicator hasNextPage={false} isFetchingNextPage={false} />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('hasNextPage=undefinedのとき何もレンダリングしない', () => {
    const { container } = render(
      <LoadMoreIndicator hasNextPage={undefined} isFetchingNextPage={false} />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('hasNextPage=true, isFetchingNextPage=falseのとき空のdivのみ', () => {
    const { container } = render(
      <LoadMoreIndicator hasNextPage={true} isFetchingNextPage={false} />,
    )

    // divは存在するがローディングテキストはない
    expect(container.querySelector('div')).toBeTruthy()
    expect(screen.queryByText('読み込み中...')).toBeNull()
  })

  it('hasNextPage=true, isFetchingNextPage=trueのときローディング表示', () => {
    render(
      <LoadMoreIndicator hasNextPage={true} isFetchingNextPage={true} />,
    )

    expect(screen.getByText('読み込み中...')).toBeTruthy()
  })

  it('classNameが適用される', () => {
    const { container } = render(
      <LoadMoreIndicator
        hasNextPage={true}
        isFetchingNextPage={false}
        className="border-t border-gray-100"
      />,
    )

    const div = container.firstChild as HTMLElement
    expect(div.className).toContain('border-t')
    expect(div.className).toContain('border-gray-100')
  })

  it('refが正しく転送される', () => {
    const ref = React.createRef<HTMLDivElement>()

    render(
      <LoadMoreIndicator
        ref={ref}
        hasNextPage={true}
        isFetchingNextPage={false}
      />,
    )

    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })
})
