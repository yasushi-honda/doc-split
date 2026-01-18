/**
 * PDFビューアーコンポーネント
 *
 * 機能:
 * - PDFプレビュー表示
 * - ページナビゲーション
 * - ズーム
 * - 分割候補表示・編集
 * - ページ回転
 */

import { useState, useCallback } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Scissors,
  X,
  Check,
  Plus,
} from 'lucide-react'

// PDF.js worker設定
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

interface SplitSuggestion {
  afterPageNumber: number
  reason: 'new_customer' | 'new_document_type' | 'content_break' | 'manual'
  confidence: number
  newDocumentType: string | null
  newCustomerName: string | null
}

interface PdfViewerProps {
  fileUrl: string
  totalPages: number
  splitSuggestions?: SplitSuggestion[]
  onSplit?: (splitPoints: number[]) => void
  onRotate?: (pageNumber: number, degrees: 90 | 180 | 270) => void
  onClose?: () => void
}

export function PdfViewer({
  fileUrl,
  totalPages,
  splitSuggestions = [],
  onSplit,
  onRotate,
  onClose,
}: PdfViewerProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [splitMode, setSplitMode] = useState(false)
  const [selectedSplitPoints, setSelectedSplitPoints] = useState<number[]>(
    splitSuggestions.map((s) => s.afterPageNumber)
  )

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages)
    },
    []
  )

  const goToPrevPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1))
  }

  const goToNextPage = () => {
    setNumPages((pages) => {
      if (pages) {
        setCurrentPage((prev) => Math.min(pages, prev + 1))
      }
      return pages
    })
  }

  const zoomIn = () => setScale((prev) => Math.min(2.0, prev + 0.1))
  const zoomOut = () => setScale((prev) => Math.max(0.5, prev - 0.1))

  const handleRotate = () => {
    if (onRotate) {
      onRotate(currentPage, 90)
    }
  }

  const toggleSplitPoint = (afterPage: number) => {
    setSelectedSplitPoints((prev) => {
      if (prev.includes(afterPage)) {
        return prev.filter((p) => p !== afterPage)
      } else {
        return [...prev, afterPage].sort((a, b) => a - b)
      }
    })
  }

  const handleExecuteSplit = () => {
    if (onSplit && selectedSplitPoints.length > 0) {
      onSplit(selectedSplitPoints)
    }
  }

  const getSplitSuggestionForPage = (pageNum: number) => {
    return splitSuggestions.find((s) => s.afterPageNumber === pageNum)
  }

  const isSelectedSplitPoint = (pageNum: number) => {
    return selectedSplitPoints.includes(pageNum)
  }

  return (
    <div className="flex h-full flex-col bg-gray-900">
      {/* ツールバー */}
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-2">
        <div className="flex items-center gap-2">
          {/* ページナビゲーション */}
          <button
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
            className="rounded p-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[80px] text-center text-sm text-gray-300">
            {currentPage} / {numPages || totalPages}
          </span>
          <button
            onClick={goToNextPage}
            disabled={currentPage >= (numPages || totalPages)}
            className="rounded p-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="mx-2 h-6 w-px bg-gray-600" />

          {/* ズーム */}
          <button
            onClick={zoomOut}
            className="rounded p-1 text-gray-300 hover:bg-gray-700"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="min-w-[50px] text-center text-sm text-gray-300">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            className="rounded p-1 text-gray-300 hover:bg-gray-700"
          >
            <ZoomIn className="h-5 w-5" />
          </button>

          <div className="mx-2 h-6 w-px bg-gray-600" />

          {/* 回転 */}
          <button
            onClick={handleRotate}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-700"
          >
            <RotateCw className="h-4 w-4" />
            回転
          </button>

          {/* 分割モード切替 */}
          <button
            onClick={() => setSplitMode(!splitMode)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-sm ${
              splitMode
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Scissors className="h-4 w-4" />
            分割
          </button>
        </div>

        <div className="flex items-center gap-2">
          {splitMode && selectedSplitPoints.length > 0 && (
            <button
              onClick={handleExecuteSplit}
              className="flex items-center gap-1 rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700"
            >
              <Check className="h-4 w-4" />
              分割実行 ({selectedSplitPoints.length}箇所)
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-300 hover:bg-gray-700"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* PDF表示エリア */}
      <div className="flex flex-1 overflow-hidden">
        {/* サムネイル一覧（分割モード時） */}
        {splitMode && (
          <div className="w-48 overflow-y-auto border-r border-gray-700 bg-gray-800 p-2">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              ページ一覧
            </h3>
            {Array.from({ length: numPages || totalPages }, (_, i) => i + 1).map(
              (pageNum) => {
                const suggestion = getSplitSuggestionForPage(pageNum)
                const isSelected = isSelectedSplitPoint(pageNum)

                return (
                  <div key={pageNum} className="mb-1">
                    {/* サムネイル */}
                    <button
                      onClick={() => setCurrentPage(pageNum)}
                      className={`relative w-full rounded border-2 p-1 transition-colors ${
                        currentPage === pageNum
                          ? 'border-blue-500 bg-gray-700'
                          : 'border-transparent hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-center justify-center bg-white text-xs text-gray-500">
                        P.{pageNum}
                      </div>
                    </button>

                    {/* 分割位置マーカー */}
                    {pageNum < (numPages || totalPages) && (
                      <div className="relative my-1">
                        <button
                          onClick={() => toggleSplitPoint(pageNum)}
                          className={`flex w-full items-center justify-center gap-1 rounded py-0.5 text-xs ${
                            isSelected
                              ? 'bg-red-600 text-white'
                              : suggestion
                                ? 'bg-yellow-600/50 text-yellow-200 hover:bg-yellow-600'
                                : 'text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                          }`}
                        >
                          {isSelected ? (
                            <>
                              <Scissors className="h-3 w-3" />
                              分割
                            </>
                          ) : suggestion ? (
                            <>
                              <Plus className="h-3 w-3" />
                              {suggestion.reason === 'new_customer'
                                ? '新顧客'
                                : '新書類'}
                            </>
                          ) : (
                            <>
                              <Plus className="h-3 w-3" />
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )
              }
            )}
          </div>
        )}

        {/* メインビューア */}
        <div className="flex flex-1 items-center justify-center overflow-auto bg-gray-900 p-4">
          <Document
            file={fileUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="text-gray-400">PDFを読み込み中...</div>
            }
            error={
              <div className="text-red-400">
                PDFの読み込みに失敗しました
              </div>
            }
          >
            <Page
              pageNumber={currentPage}
              scale={scale}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="shadow-xl"
            />
          </Document>
        </div>

        {/* メタ情報パネル */}
        <div className="w-64 overflow-y-auto border-l border-gray-700 bg-gray-800 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-200">
            ページ情報
          </h3>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-400">ページ:</span>
              <span className="ml-2 text-gray-200">{currentPage}</span>
            </div>

            {/* 分割候補情報 */}
            {getSplitSuggestionForPage(currentPage) && (
              <div className="mt-4 rounded bg-yellow-900/30 p-2">
                <div className="text-xs font-semibold text-yellow-400">
                  分割候補
                </div>
                <div className="mt-1 text-xs text-yellow-200">
                  {getSplitSuggestionForPage(currentPage)?.reason ===
                  'new_customer'
                    ? `新しい顧客: ${getSplitSuggestionForPage(currentPage)?.newCustomerName}`
                    : `新しい書類: ${getSplitSuggestionForPage(currentPage)?.newDocumentType}`}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
