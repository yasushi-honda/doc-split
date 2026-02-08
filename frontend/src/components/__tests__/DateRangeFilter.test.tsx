import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DateRangeFilter, type DateRange } from '../DateRangeFilter'

describe('DateRangeFilter', () => {
  const defaultValue: DateRange = {
    dateFrom: undefined,
    dateTo: undefined,
    dateField: 'fileDate',
  }
  let onChange: Mock<(range: DateRange) => void>

  beforeEach(() => {
    onChange = vi.fn<(range: DateRange) => void>()
    // 時刻を固定
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 6)) // 2026-02-06
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('プリセットボタンが表示される', () => {
    render(<DateRangeFilter value={defaultValue} onChange={onChange} />)
    expect(screen.getByText('今月')).toBeDefined()
    expect(screen.getByText('今年')).toBeDefined()
    expect(screen.getByText('過去3ヶ月')).toBeDefined()
    expect(screen.getByText('カスタム')).toBeDefined()
  })

  it('日付種別ボタンが表示される', () => {
    render(<DateRangeFilter value={defaultValue} onChange={onChange} />)
    expect(screen.getByText('書類日付')).toBeDefined()
    expect(screen.getByText('登録日')).toBeDefined()
  })

  it('今月プリセットをクリックすると月初〜今日の範囲が設定される', () => {
    render(<DateRangeFilter value={defaultValue} onChange={onChange} />)
    fireEvent.click(screen.getByText('今月'))

    expect(onChange).toHaveBeenCalledWith({
      dateFrom: new Date(2026, 1, 1), // 2月1日
      dateTo: expect.any(Date),
      dateField: 'fileDate',
    })
    // dateTo は今日の23:59:59
    const call = onChange.mock.calls[0]![0]!
    expect(call.dateTo!.getFullYear()).toBe(2026)
    expect(call.dateTo!.getMonth()).toBe(1)
    expect(call.dateTo!.getDate()).toBe(6)
  })

  it('今年プリセットをクリックすると年初〜今日の範囲が設定される', () => {
    render(<DateRangeFilter value={defaultValue} onChange={onChange} />)
    fireEvent.click(screen.getByText('今年'))

    const call = onChange.mock.calls[0]![0]!
    expect(call.dateFrom).toEqual(new Date(2026, 0, 1)) // 1月1日
    expect(call.dateTo!.getFullYear()).toBe(2026)
  })

  it('過去3ヶ月プリセットをクリックすると3ヶ月前の月初〜今日の範囲が設定される', () => {
    render(<DateRangeFilter value={defaultValue} onChange={onChange} />)
    fireEvent.click(screen.getByText('過去3ヶ月'))

    const call = onChange.mock.calls[0]![0]!
    expect(call.dateFrom).toEqual(new Date(2025, 10, 1)) // 11月1日
    expect(call.dateTo!.getFullYear()).toBe(2026)
  })

  it('カスタムボタンをクリックすると日付入力が表示される', () => {
    render(<DateRangeFilter value={defaultValue} onChange={onChange} />)
    fireEvent.click(screen.getByText('カスタム'))

    const dateInputs = document.querySelectorAll('input[type="date"]')
    expect(dateInputs.length).toBe(2)
  })

  it('日付種別を切り替えるとdateFieldが変更される', () => {
    render(<DateRangeFilter value={defaultValue} onChange={onChange} />)
    fireEvent.click(screen.getByText('登録日'))

    expect(onChange).toHaveBeenCalledWith({
      ...defaultValue,
      dateField: 'processedAt',
    })
  })

  it('同じプリセットを再クリックするとクリアされる', () => {
    const activeValue: DateRange = {
      dateFrom: new Date(2026, 1, 1),
      dateTo: new Date(2026, 1, 6, 23, 59, 59),
      dateField: 'fileDate',
    }
    render(<DateRangeFilter value={activeValue} onChange={onChange} />)
    fireEvent.click(screen.getByText('今月'))

    expect(onChange).toHaveBeenCalledWith({
      dateFrom: undefined,
      dateTo: undefined,
      dateField: 'fileDate',
    })
  })

  it('クリアボタンは日付が設定されている場合のみ表示される', () => {
    const { rerender } = render(<DateRangeFilter value={defaultValue} onChange={onChange} />)
    expect(screen.queryByText('クリア')).toBeNull()

    const activeValue: DateRange = {
      dateFrom: new Date(2026, 0, 1),
      dateTo: new Date(2026, 1, 6),
      dateField: 'fileDate',
    }
    rerender(<DateRangeFilter value={activeValue} onChange={onChange} />)
    expect(screen.getByText('クリア')).toBeDefined()
  })

  it('クリアボタンをクリックすると日付がリセットされる', () => {
    const activeValue: DateRange = {
      dateFrom: new Date(2026, 0, 1),
      dateTo: new Date(2026, 1, 6),
      dateField: 'fileDate',
    }
    render(<DateRangeFilter value={activeValue} onChange={onChange} />)
    fireEvent.click(screen.getByText('クリア'))

    expect(onChange).toHaveBeenCalledWith({
      dateFrom: undefined,
      dateTo: undefined,
      dateField: 'fileDate',
    })
  })
})
