/**
 * PDFページサムネイルコンポーネント
 * PDF分割モーダルで使用するサムネイル表示
 */

import { useState, memo } from 'react'
import { Page } from 'react-pdf'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PdfPageThumbnailProps {
  pageNumber: number
  isSelected?: boolean
  hasSplitAfter?: boolean
  onClick?: (pageNumber: number) => void
  width?: number
}

/**
 * PDFページのサムネイル表示
 * - 選択状態: 青い枠線
 * - 分割ポイント: 下部に赤い線
 */
export const PdfPageThumbnail = memo(function PdfPageThumbnail({
  pageNumber,
  isSelected = false,
  hasSplitAfter = false,
  onClick,
  width = 80,
}: PdfPageThumbnailProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  const handleClick = () => {
    onClick?.(pageNumber)
  }

  return (
    <div className="flex flex-col items-center">
      {/* サムネイル */}
      <div
        onClick={handleClick}
        className={cn(
          'relative cursor-pointer rounded border-2 bg-white transition-all hover:shadow-md',
          isSelected
            ? 'border-blue-500 shadow-md ring-2 ring-blue-200'
            : 'border-gray-200 hover:border-gray-300'
        )}
      >
        {/* ローディング表示 */}
        {isLoading && !hasError && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-gray-50"
            style={{ width, height: width * 1.4 }}
          >
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          </div>
        )}

        {/* エラー表示 */}
        {hasError && (
          <div
            className="flex items-center justify-center bg-gray-100 text-xs text-gray-400"
            style={{ width, height: width * 1.4 }}
          >
            読込失敗
          </div>
        )}

        {/* PDFページ */}
        <Page
          pageNumber={pageNumber}
          width={width}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          onLoadSuccess={() => setIsLoading(false)}
          onLoadError={() => {
            setIsLoading(false)
            setHasError(true)
          }}
          className={cn(isLoading && 'invisible')}
        />

        {/* ページ番号バッジ */}
        <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
          {pageNumber}
        </div>
      </div>

      {/* 分割ポイント（赤線） */}
      {hasSplitAfter && (
        <div className="mt-1 flex w-full items-center gap-1">
          <div className="h-0.5 flex-1 bg-red-500" />
          <span className="text-[10px] font-medium text-red-500">分割</span>
          <div className="h-0.5 flex-1 bg-red-500" />
        </div>
      )}
    </div>
  )
})
