/**
 * 期間指定フィルターコンポーネント
 *
 * プリセット（今月/今年/過去3ヶ月）+ カスタム日付入力
 * 日付種別（書類日付/登録日）の切替対応
 */

import { useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'

// ============================================
// 型定義
// ============================================

export type DateField = 'fileDate' | 'processedAt'
export type DatePreset = 'thisMonth' | 'thisYear' | 'last3Months' | 'custom' | null

export interface DateRange {
  dateFrom: Date | undefined
  dateTo: Date | undefined
  dateField: DateField
}

interface DateRangeFilterProps {
  value: DateRange
  onChange: (range: DateRange) => void
}

// ============================================
// プリセット計算
// ============================================

function getPresetRange(preset: DatePreset): { dateFrom: Date | undefined; dateTo: Date | undefined } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  switch (preset) {
    case 'thisMonth': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      return { dateFrom: from, dateTo: today }
    }
    case 'thisYear': {
      const from = new Date(now.getFullYear(), 0, 1)
      return { dateFrom: from, dateTo: today }
    }
    case 'last3Months': {
      const from = new Date(now.getFullYear(), now.getMonth() - 3, 1)
      return { dateFrom: from, dateTo: today }
    }
    default:
      return { dateFrom: undefined, dateTo: undefined }
  }
}

// Date → input[type=date] の value 形式
function toDateInputValue(date: Date | undefined): string {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// input[type=date] の value → Date
function fromDateInputValue(value: string): Date | undefined {
  if (!value) return undefined
  const parts = value.split('-').map(Number)
  return new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1)
}

// ============================================
// プリセット判定（現在の値がどのプリセットに該当するか）
// ============================================

function detectPreset(dateFrom: Date | undefined, dateTo: Date | undefined): DatePreset {
  if (!dateFrom && !dateTo) return null

  const presets: DatePreset[] = ['thisMonth', 'thisYear', 'last3Months']
  for (const preset of presets) {
    const range = getPresetRange(preset)
    if (
      range.dateFrom &&
      dateFrom &&
      range.dateFrom.getTime() === dateFrom.getTime() &&
      range.dateTo &&
      dateTo &&
      range.dateTo.getFullYear() === dateTo.getFullYear() &&
      range.dateTo.getMonth() === dateTo.getMonth() &&
      range.dateTo.getDate() === dateTo.getDate()
    ) {
      return preset
    }
  }
  return 'custom'
}

// ============================================
// メインコンポーネント
// ============================================

const PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'thisMonth', label: '今月' },
  { value: 'thisYear', label: '今年' },
  { value: 'last3Months', label: '過去3ヶ月' },
  { value: 'custom', label: 'カスタム' },
]

const DATE_FIELD_OPTIONS: { value: DateField; label: string }[] = [
  { value: 'fileDate', label: '書類日付' },
  { value: 'processedAt', label: '登録日' },
]

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const activePreset = useMemo(
    () => detectPreset(value.dateFrom, value.dateTo),
    [value.dateFrom, value.dateTo]
  )
  const [showCustom, setShowCustom] = useState(activePreset === 'custom')

  const handlePresetClick = useCallback(
    (preset: DatePreset) => {
      if (preset === activePreset) {
        // 同じプリセットをもう一度押したらクリア
        setShowCustom(false)
        onChange({ dateFrom: undefined, dateTo: undefined, dateField: value.dateField })
        return
      }

      if (preset === 'custom') {
        setShowCustom(true)
        return
      }

      setShowCustom(false)
      const range = getPresetRange(preset)
      onChange({ ...range, dateField: value.dateField })
    },
    [activePreset, value.dateField, onChange]
  )

  const handleDateFieldChange = useCallback(
    (field: DateField) => {
      onChange({ ...value, dateField: field })
    },
    [value, onChange]
  )

  const handleCustomDateChange = useCallback(
    (key: 'dateFrom' | 'dateTo', inputValue: string) => {
      const date = key === 'dateTo' && inputValue
        ? (() => {
            const d = fromDateInputValue(inputValue)
            if (d) d.setHours(23, 59, 59)
            return d
          })()
        : fromDateInputValue(inputValue)
      onChange({ ...value, [key]: date })
    },
    [value, onChange]
  )

  const handleClear = useCallback(() => {
    setShowCustom(false)
    onChange({ dateFrom: undefined, dateTo: undefined, dateField: value.dateField })
  }, [value.dateField, onChange])

  const isActive = value.dateFrom || value.dateTo

  return (
    <div className="space-y-2">
      {/* 日付種別の切替 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 shrink-0">対象:</span>
        <div className="flex gap-1">
          {DATE_FIELD_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={value.dateField === opt.value ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => handleDateFieldChange(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* プリセットボタン */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 shrink-0">期間:</span>
        <div className="flex gap-1 flex-wrap">
          {PRESET_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={
                opt.value === 'custom'
                  ? (showCustom || activePreset === 'custom') ? 'default' : 'outline'
                  : activePreset === opt.value ? 'default' : 'outline'
              }
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => handlePresetClick(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
          {isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2 text-gray-500"
              onClick={handleClear}
            >
              クリア
            </Button>
          )}
        </div>
      </div>

      {/* カスタム日付入力 */}
      {(showCustom || activePreset === 'custom') && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={toDateInputValue(value.dateFrom)}
            onChange={(e) => handleCustomDateChange('dateFrom', e.target.value)}
            className="h-8 rounded-md border border-gray-300 px-2 text-xs"
          />
          <span className="text-xs text-gray-500">〜</span>
          <input
            type="date"
            value={toDateInputValue(value.dateTo)}
            onChange={(e) => handleCustomDateChange('dateTo', e.target.value)}
            className="h-8 rounded-md border border-gray-300 px-2 text-xs"
          />
        </div>
      )}
    </div>
  )
}
