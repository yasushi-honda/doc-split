/**
 * Google Picker API(gapi + picker module)スクリプトをロードするフック(ADR-0022, Phase 1)
 *
 * `useGisScript`(frontend/src/pages/SettingsPage.tsx)と同型のパターン。
 * `https://apis.google.com/js/api.js`をロード後、`gapi.load('picker', ...)`の完了を待つ。
 */

import { useEffect, useState } from 'react'

export function useGooglePickerScript() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any

    const loadPicker = () => {
      w.gapi.load('picker', { callback: () => setReady(true) })
    }

    if (w.gapi?.load) {
      loadPicker()
      return
    }

    const existing = document.querySelector<HTMLScriptElement>('script[src*="apis.google.com/js/api.js"]')
    if (existing) {
      existing.addEventListener('load', loadPicker)
      return () => existing.removeEventListener('load', loadPicker)
    }

    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.async = true
    script.onload = loadPicker
    document.head.appendChild(script)
  }, [])

  return ready
}
