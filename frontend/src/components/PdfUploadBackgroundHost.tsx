/**
 * PDFアップロードのバックグラウンド進捗をトースト通知するホストコンポーネント(Issue #1031)
 *
 * usePdfUploadStoreの状態からderiveUploadToast()でトースト仕様を導出し、sonnerへ反映する。
 * 画面には何も描画しない。reset()の発火(ログアウト連動)はpdfUploadStore.ts側が
 * authStoreを直接監視して行うため、ここでは担当しない。
 */

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { usePdfUploadStore, PDF_UPLOAD_TOAST_ID } from '@/stores/pdfUploadStore'
import { summarizeUploads, deriveUploadToast, type UploadToastSpec } from '@/lib/pdfUpload'

function toastSpecKey(spec: UploadToastSpec | null): string {
  if (!spec) return 'none'
  if (spec.kind === 'dismiss' || spec.kind === 'loading' || spec.kind === 'success') {
    return `${spec.kind}:${'message' in spec ? spec.message : ''}`
  }
  return `${spec.kind}:${spec.message}:${spec.actionLabel}`
}

export function PdfUploadBackgroundHost() {
  const files = usePdfUploadStore((s) => s.files)
  const isAnyUploadInFlight = usePdfUploadStore((s) => s.isAnyUploadInFlight)
  const isModalOpen = usePdfUploadStore((s) => s.isModalOpen)
  const openModal = usePdfUploadStore((s) => s.openModal)

  // ストアのstate tick毎にtoast.*を再呼出ししないよう、直前に反映したトースト内容を保持する
  // (plan-crossreview Medium#9)
  const lastSpecKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const summary = summarizeUploads(files, isAnyUploadInFlight)
    const spec = deriveUploadToast(summary, isModalOpen)
    const key = toastSpecKey(spec)
    if (key === lastSpecKeyRef.current) return
    lastSpecKeyRef.current = key

    if (!spec || spec.kind === 'dismiss') {
      toast.dismiss(PDF_UPLOAD_TOAST_ID)
      return
    }
    if (spec.kind === 'loading') {
      toast.loading(spec.message, { id: PDF_UPLOAD_TOAST_ID })
      return
    }
    if (spec.kind === 'success') {
      toast.success(spec.message, { id: PDF_UPLOAD_TOAST_ID })
      return
    }
    toast.error(spec.message, {
      id: PDF_UPLOAD_TOAST_ID,
      action: { label: spec.actionLabel, onClick: openModal },
    })
  }, [files, isAnyUploadInFlight, isModalOpen, openModal])

  return null
}
