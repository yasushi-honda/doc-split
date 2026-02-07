import { useState, useEffect } from 'react'
import { WifiOff } from 'lucide-react'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'

export function NetworkStatusBar() {
  const { isOnline } = useNetworkStatus()
  const [showRecovered, setShowRecovered] = useState(false)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true)
    } else if (wasOffline) {
      setShowRecovered(true)
      const timer = setTimeout(() => {
        setShowRecovered(false)
        setWasOffline(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [isOnline, wasOffline])

  if (isOnline && !showRecovered) return null

  return (
    <div
      className={`flex items-center justify-center gap-2 px-4 py-1.5 text-sm font-medium ${
        isOnline
          ? 'bg-green-600 text-white'
          : 'bg-amber-500 text-white'
      }`}
    >
      {isOnline ? (
        'ネットワークが回復しました'
      ) : (
        <>
          <WifiOff className="h-4 w-4" />
          ネットワークに接続されていません — 操作が反映されない場合があります
        </>
      )}
    </div>
  )
}
