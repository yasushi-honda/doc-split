/**
 * あかさたなフィルターバー
 *
 * 顧客別グループビューで、ふりがなの行で絞り込むフィルターUI
 */

import { KANA_ROWS, type KanaRow } from '@/lib/kanaUtils';
import { cn } from '@/lib/utils';

interface KanaFilterBarProps {
  selected: KanaRow | null;
  onSelect: (row: KanaRow | null) => void;
  disabled?: boolean;
}

export function KanaFilterBar({ selected, onSelect, disabled = false }: KanaFilterBarProps) {
  return (
    <div className={cn(
      'flex gap-1 overflow-x-auto pb-1 -mx-1 px-1',
      disabled && 'opacity-50 pointer-events-none'
    )}>
      {/* 全ボタン */}
      <button
        data-active={selected === null ? 'true' : 'false'}
        disabled={disabled}
        className={cn(
          'flex-shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          selected === null
            ? 'bg-gray-800 text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        )}
        onClick={() => onSelect(null)}
      >
        全
      </button>

      {/* あかさたな行ボタン */}
      {KANA_ROWS.map((row) => (
        <button
          key={row}
          data-active={selected === row ? 'true' : 'false'}
          disabled={disabled}
          className={cn(
            'flex-shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            selected === row
              ? 'bg-gray-800 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
          onClick={() => onSelect(selected === row ? null : row)}
        >
          {row}
        </button>
      ))}
    </div>
  );
}
