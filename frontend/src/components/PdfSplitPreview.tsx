/**
 * PDF分割プレビューコンポーネント
 * サムネイル一覧 + 選択ページ拡大表示
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import { PdfPageThumbnail } from './PdfPageThumbnail'
import { Button } from '@/components/ui/button'

// PDF.js worker設定
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

interface PdfSplitPreviewProps {
  fileUrl: string
  totalPages: number
  currentPage: number
  splitPoints: number[]
  onPageSelect: (pageNumber: number) => void
}

// 拡大表示のスケールオプション
const PREVIEW_SCALES = [300, 400, 500]

/**
 * PDF分割用プレビュー
 * - 上部: サムネイル一覧（グリッド表示、分割ポイント赤線付き）
 * - 下部: 選択ページ拡大表示
 */
export function PdfSplitPreview({
  fileUrl,
  totalPages,
  currentPage,
  splitPoints,
  onPageSelect,
}: PdfSplitPreviewProps) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_SCALES[1]!)
  const thumbnailContainerRef = useRef<HTMLDivElement>(null)
  const selectedThumbnailRef = useRef<HTMLDivElement>(null)

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages)
      setIsLoading(false)
    },
    []
  )

  // 選択ページが変わったらサムネイルをスクロール
  useEffect(() => {
    if (selectedThumbnailRef.current && thumbnailContainerRef.current) {
      selectedThumbnailRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      })
    }
  }, [currentPage])

  // 分割ポイントかどうかをチェック
  const hasSplitAfter = (pageNumber: number) => {
    return splitPoints.includes(pageNumber)
  }

  // ズームイン
  const handleZoomIn = () => {
    const currentIndex = PREVIEW_SCALES.indexOf(previewWidth)
    if (currentIndex < PREVIEW_SCALES.length - 1) {
      setPreviewWidth(PREVIEW_SCALES[currentIndex + 1]!)
    }
  }

  // ズームアウト
  const handleZoomOut = () => {
    const currentIndex = PREVIEW_SCALES.indexOf(previewWidth)
    if (currentIndex > 0) {
      setPreviewWidth(PREVIEW_SCALES[currentIndex - 1]!)
    }
  }

  const pages = numPages || totalPages

  return (
    <div className="flex h-full flex-col">
      <Document
        file={fileUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        loading={
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-500">PDFを読み込み中...</span>
          </div>
        }
        error={
          <div className="flex h-full items-center justify-center text-red-500">
            PDFの読み込みに失敗しました
          </div>
        }
      >
        {!isLoading && (
          <>
            {/* サムネイル一覧 */}
            <div className="border-b bg-gray-50 p-2">
              <div className="mb-1 text-xs font-medium text-gray-600">
                ページ一覧（クリックで選択）
              </div>
              <div
                ref={thumbnailContainerRef}
                className="flex gap-2 overflow-x-auto pb-2"
                style={{ maxHeight: '180px' }}
              >
                {Array.from({ length: pages }, (_, i) => i + 1).map((pageNum) => (
                  <div
                    key={pageNum}
                    ref={pageNum === currentPage ? selectedThumbnailRef : null}
                    className="flex-shrink-0"
                  >
                    <PdfPageThumbnail
                      pageNumber={pageNum}
                      isSelected={pageNum === currentPage}
                      hasSplitAfter={hasSplitAfter(pageNum)}
                      onClick={onPageSelect}
                      width={70}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 選択ページ拡大表示 */}
            <div className="flex-1 overflow-auto bg-gray-100 p-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  ページ {currentPage} / {pages}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleZoomOut}
                    disabled={previewWidth === PREVIEW_SCALES[0]}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[50px] text-center text-xs text-gray-500">
                    {previewWidth}px
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleZoomIn}
                    disabled={previewWidth === PREVIEW_SCALES[PREVIEW_SCALES.length - 1]}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex justify-center">
                <div className="rounded bg-white shadow-lg">
                  <Page
                    pageNumber={currentPage}
                    width={previewWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    loading={
                      <div
                        className="flex items-center justify-center bg-white"
                        style={{ width: previewWidth ?? 200, height: (previewWidth ?? 200) * 1.4 }}
                      >
                        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                      </div>
                    }
                  />
                </div>
              </div>

              {/* 分割ポイント表示 */}
              {hasSplitAfter(currentPage) && (
                <div className="mt-3 flex items-center justify-center gap-2 rounded bg-red-50 p-2 text-sm text-red-600">
                  <div className="h-0.5 w-8 bg-red-500" />
                  <span>このページの後で分割</span>
                  <div className="h-0.5 w-8 bg-red-500" />
                </div>
              )}
            </div>
          </>
        )}
      </Document>
    </div>
  )
}
