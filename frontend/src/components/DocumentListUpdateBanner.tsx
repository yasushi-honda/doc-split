import { Loader2, RefreshCw } from 'lucide-react'

interface DocumentListUpdateBannerProps {
  hasUpdates: boolean
  message: string
  isRefreshing: boolean
  onRefresh: () => void
}

/**
 * 書類一覧の「更新があります」バナー(2026-09-08、Firestore読み取り過大バグ修正)。
 * `NetworkStatusBar.tsx`/`SearchBar.tsx`の既存バナーパターン(amber系配色、
 * `role="status"`、更新なしは`null`を返す)を踏襲する。
 *
 * 一覧を自動では絶対に再取得しない方針の裏返しとして、ユーザーがこのバナーの
 * 「最新に更新」ボタンを押した時だけ明示的に1ページ目を再取得する。
 */
export function DocumentListUpdateBanner({
  hasUpdates,
  message,
  isRefreshing,
  onRefresh,
}: DocumentListUpdateBannerProps) {
  if (!hasUpdates) return null

  return (
    <div
      role="status"
      className="sticky top-0 z-10 flex items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRefreshing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        最新に更新
      </button>
    </div>
  )
}
