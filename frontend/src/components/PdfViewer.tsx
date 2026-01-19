/**
 * PDFビューアーコンポーネント
 *
 * 機能:
 * - PDFプレビュー表示
 * - ページナビゲーション
 * - ズーム（スケール値で直接管理）
 * - ページ回転（表示のみ、90度単位）
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize,
} from 'lucide-react'

// PDF.js worker設定
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

interface PdfViewerProps {
  fileUrl: string
  totalPages: number
}

// スケール値（パーセント表示用）
const SCALE_OPTIONS = [50, 75, 100, 125, 150, 200]

export function PdfViewer({ fileUrl, totalPages }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)

  // PDFページの元サイズ
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)

  // ズームモード: 'fit' または スケール値（パーセント）
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit')

  // コンテナサイズ
  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 })

  // コンテナサイズの監視
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateSize = () => {
      const rect = container.getBoundingClientRect()
      // パディング分を引く（モバイル: p-2 = 8px × 2、PC: p-4 = 16px × 2）
      const padding = window.innerWidth < 640 ? 16 : 32
      setContainerSize({
        width: rect.width - padding,
        height: rect.height - padding,
      })
    }

    updateSize()

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [])

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages)
    },
    []
  )

  // ページ読み込み成功時に元サイズを取得
  // 注意: page.width/heightはスケール適用済み、originalWidth/Heightが元サイズ
  const onPageLoadSuccess = useCallback(
    (page: { originalWidth: number; originalHeight: number }) => {
      setPageSize({ width: page.originalWidth, height: page.originalHeight })
    },
    []
  )

  const goToPrevPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1))
  }

  const goToNextPage = () => {
    const pages = numPages || totalPages
    setCurrentPage((prev) => Math.min(pages, prev + 1))
  }

  const zoomIn = () => {
    if (zoomMode === 'fit') {
      // フィットから次のスケールへ
      const currentScale = calculateFitScale()
      const nextIndex = SCALE_OPTIONS.findIndex((s) => s > currentScale * 100)
      setZoomMode(nextIndex >= 0 ? SCALE_OPTIONS[nextIndex] : SCALE_OPTIONS[SCALE_OPTIONS.length - 1])
    } else {
      const currentIndex = SCALE_OPTIONS.indexOf(zoomMode)
      if (currentIndex < SCALE_OPTIONS.length - 1) {
        setZoomMode(SCALE_OPTIONS[currentIndex + 1])
      }
    }
  }

  const zoomOut = () => {
    if (zoomMode === 'fit') {
      // フィットから前のスケールへ
      const currentScale = calculateFitScale()
      const prevIndex = SCALE_OPTIONS.findLastIndex((s) => s < currentScale * 100)
      setZoomMode(prevIndex >= 0 ? SCALE_OPTIONS[prevIndex] : SCALE_OPTIONS[0])
    } else {
      const currentIndex = SCALE_OPTIONS.indexOf(zoomMode)
      if (currentIndex > 0) {
        setZoomMode(SCALE_OPTIONS[currentIndex - 1])
      }
    }
  }

  const resetToFit = () => {
    setZoomMode('fit')
  }

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360)
  }

  // フィットスケールを計算（幅にフィット）
  const calculateFitScale = useCallback(() => {
    if (!pageSize) return 1

    // 回転時は幅と高さを入れ替え
    const isRotated = rotation === 90 || rotation === 270
    const pageWidth = isRotated ? pageSize.height : pageSize.width

    // 幅にフィット（モバイルでも横幅いっぱいに表示）
    return containerSize.width / pageWidth
  }, [pageSize, containerSize, rotation])

  // 実際の表示幅を計算
  const getDisplayWidth = useCallback(() => {
    if (!pageSize) return containerSize.width

    if (zoomMode === 'fit') {
      const fitScale = calculateFitScale()
      // 回転時は元のページ幅に対してスケールを適用
      const isRotated = rotation === 90 || rotation === 270
      const pageWidth = isRotated ? pageSize.height : pageSize.width
      return Math.round(pageWidth * fitScale)
    } else {
      // スケール値を直接適用
      const isRotated = rotation === 90 || rotation === 270
      const pageWidth = isRotated ? pageSize.height : pageSize.width
      return Math.round(pageWidth * (zoomMode / 100))
    }
  }, [pageSize, zoomMode, calculateFitScale, rotation, containerSize.width])

  // 表示用のズーム率テキスト
  const getZoomText = () => {
    if (zoomMode === 'fit') {
      return 'フィット'
    }
    return `${zoomMode}%`
  }

  // ズームイン可能かどうか
  const canZoomIn = zoomMode === 'fit'
    ? calculateFitScale() * 100 < SCALE_OPTIONS[SCALE_OPTIONS.length - 1]
    : SCALE_OPTIONS.indexOf(zoomMode) < SCALE_OPTIONS.length - 1

  // ズームアウト可能かどうか
  const canZoomOut = zoomMode === 'fit'
    ? calculateFitScale() * 100 > SCALE_OPTIONS[0]
    : SCALE_OPTIONS.indexOf(zoomMode) > 0

  return (
    <div className="flex h-full flex-col bg-gray-900">
      {/* ツールバー */}
      <div className="flex items-center justify-center border-b border-gray-700 bg-gray-800 px-2 py-2 sm:px-4">
        <div className="flex items-center gap-1 sm:gap-2">
          {/* ページナビゲーション */}
          <button
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
            className="rounded p-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[60px] text-center text-sm text-gray-300 sm:min-w-[80px]">
            {currentPage} / {numPages || totalPages}
          </span>
          <button
            onClick={goToNextPage}
            disabled={currentPage >= (numPages || totalPages)}
            className="rounded p-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="mx-1 h-6 w-px bg-gray-600 sm:mx-2" />

          {/* ズーム */}
          <button
            onClick={zoomOut}
            disabled={!canZoomOut}
            className="rounded p-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="hidden min-w-[50px] text-center text-sm text-gray-300 sm:inline">
            {getZoomText()}
          </span>
          <button
            onClick={zoomIn}
            disabled={!canZoomIn}
            className="rounded p-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            <ZoomIn className="h-5 w-5" />
          </button>

          {/* フィットボタン */}
          <button
            onClick={resetToFit}
            className={`rounded p-1 ${
              zoomMode === 'fit'
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-700'
            }`}
            title="フィットに戻す"
          >
            <Maximize className="h-5 w-5" />
          </button>

          <div className="mx-1 h-6 w-px bg-gray-600 sm:mx-2" />

          {/* 回転 */}
          <button
            onClick={handleRotate}
            className="flex items-center gap-1 rounded p-1 text-gray-300 hover:bg-gray-700 sm:px-2"
            title="90度回転"
          >
            <RotateCw className="h-4 w-4" />
            <span className="hidden sm:inline">回転</span>
            {rotation > 0 && (
              <span className="text-xs text-gray-400">({rotation}°)</span>
            )}
          </button>
        </div>
      </div>

      {/* PDF表示エリア */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-900 p-2 sm:p-4"
      >
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex h-64 items-center justify-center text-gray-400">
              PDFを読み込み中...
            </div>
          }
          error={
            <div className="flex h-64 items-center justify-center text-red-400">
              PDFの読み込みに失敗しました
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            width={getDisplayWidth()}
            rotate={rotation}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            className="shadow-xl"
            onLoadSuccess={onPageLoadSuccess}
            loading={
              <div className="flex h-64 w-full items-center justify-center bg-white text-gray-400">
                ページを読み込み中...
              </div>
            }
          />
        </Document>
      </div>
    </div>
  )
}
