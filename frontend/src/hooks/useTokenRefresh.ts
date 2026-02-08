import { useEffect } from 'react'
import { auth } from '@/lib/firebase'

/**
 * バックグラウンド復帰時にFirebase IDトークンを自動リフレッシュするhook
 *
 * モバイルPWAでバックグラウンドに長時間移行すると、IDトークン（1時間有効）が
 * 失効し、Callable Function呼び出し時にunauthenticatedエラーが発生する。
 * visibilitychangeイベントで復帰を検知し、トークンを強制リフレッシュする。
 */
export function useTokenRefresh() {
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && auth.currentUser) {
        try {
          await auth.currentUser.getIdToken(true)
        } catch (e) {
          console.error('Token refresh failed:', e)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
}
