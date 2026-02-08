import { useState, useRef, useCallback, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

const THRESHOLD = 80

/**
 * モバイル向けPull-to-Refreshコンポーネント
 *
 * 画面最上部でタッチを下方向にドラッグするとリロードインジケーターを表示し、
 * しきい値を超えてリリースするとページをフルリロードする。
 * children全体をラップして使用する。
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isPulling, setIsPulling] = useState(false)
  const startY = useRef(0)
  const pulling = useRef(false)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY
      pulling.current = true
    }
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current) return
    const delta = e.touches[0].clientY - startY.current
    if (delta > 0) {
      // 抵抗感: 実際のドラッグ距離の40%だけ移動
      setPullDistance(Math.min(delta * 0.4, THRESHOLD * 1.5))
      setIsPulling(true)
    } else {
      setPullDistance(0)
      setIsPulling(false)
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (isPulling && pullDistance >= THRESHOLD) {
      window.location.reload()
      return
    }
    setPullDistance(0)
    setIsPulling(false)
    pulling.current = false
  }, [isPulling, pullDistance])

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: true })
    document.addEventListener('touchend', handleTouchEnd)
    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  return (
    <>
      {isPulling && (
        <div
          className="flex items-center justify-center overflow-hidden bg-gray-100 transition-[height] duration-100"
          style={{ height: pullDistance }}
        >
          <RefreshCw
            className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${
              pullDistance >= THRESHOLD ? 'text-blue-500 rotate-180' : ''
            }`}
          />
        </div>
      )}
      {children}
    </>
  )
}
