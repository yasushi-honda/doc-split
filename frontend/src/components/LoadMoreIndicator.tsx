import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

interface LoadMoreIndicatorProps {
  hasNextPage: boolean | undefined
  isFetchingNextPage: boolean
  className?: string
}

/**
 * 無限スクロール用のローディングインジケーター
 * IntersectionObserver のターゲット要素を兼ねる
 */
export const LoadMoreIndicator = forwardRef<HTMLDivElement, LoadMoreIndicatorProps>(
  ({ hasNextPage, isFetchingNextPage, className = '' }, ref) => {
    if (!hasNextPage) return null

    return (
      <div
        ref={ref}
        className={`flex items-center justify-center py-4 ${className}`}
      >
        {isFetchingNextPage && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-500">読み込み中...</span>
          </>
        )}
      </div>
    )
  },
)

LoadMoreIndicator.displayName = 'LoadMoreIndicator'
