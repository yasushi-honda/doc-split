/**
 * PDFアップロードのバックグラウンド化ストア(Issue #1031)
 *
 * PdfUploadModal.tsxのローカルstateだったアップロード処理・Firestore onSnapshot購読を
 * モジュールシングルトンのZustandストアへ引き上げ、モーダルの表示/非表示から独立させる。
 * authStore.tsと同じ `create<State>((set, get) => ({...}))` パターン。
 */

import { create } from 'zustand'
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import { callFunction } from '@/lib/callFunction'
import { useAuthStore } from '@/stores/authStore'
import {
  claimFileName,
  releaseRowClaims,
  validateFile,
  readFileAsBase64,
  resolveUploadErrorMessage,
  mapDocumentStatusToStep,
  isActiveStep,
  AUTO_CLOSE_DELAY_MS,
  type ClaimedFileNames,
  type FileUploadItem,
  type UploadResult,
  type TerminalOrProgressStep,
} from '@/lib/pdfUpload'

export const PDF_UPLOAD_TOAST_ID = 'pdf-upload-progress'

interface PdfUploadState {
  files: FileUploadItem[]
  claimedFileNames: ClaimedFileNames
  isAnyUploadInFlight: boolean
  isModalOpen: boolean
  completionCounter: number
  selectError: string | null

  openModal: () => void
  closeModal: () => void
  addFiles: (fileList: FileList | File[]) => void
  uploadAll: () => Promise<void>
  retry: (id: string) => void
  resolveDuplicate: (id: string) => void
  removeFile: (id: string) => void
  reset: () => void
}

// ============================================
// モジュールスコープ(非reactive、Reactの再レンダーを起こさない)
// ============================================

// ログアウト等での「古い結果の破棄」用世代番号。reset()でepoch++し、
// 非同期コールバックの入口(onSnapshot next/error、setTimeout、await復帰後)で
// 捕捉時のepochと現在のepochを照合し、不一致なら状態を一切変更しない。
let epoch = 0
const snapshotUnsubs = new Map<string, Unsubscribe>()
let autoClearTimer: ReturnType<typeof setTimeout> | null = null

function clearAutoClearTimer() {
  if (autoClearTimer !== null) {
    clearTimeout(autoClearTimer)
    autoClearTimer = null
  }
}

function unsubscribeRow(id: string) {
  const unsub = snapshotUnsubs.get(id)
  if (unsub) {
    unsub()
    snapshotUnsubs.delete(id)
  }
}

function unsubscribeAll() {
  for (const unsub of snapshotUnsubs.values()) unsub()
  snapshotUnsubs.clear()
}

export const usePdfUploadStore = create<PdfUploadState>((set, get) => {
  function scheduleAutoClearIfDone() {
    clearAutoClearTimer()
    const { files } = get()
    if (files.length > 0 && files.every((f) => f.step === 'processed')) {
      const myEpoch = epoch
      autoClearTimer = setTimeout(() => {
        autoClearTimer = null
        if (myEpoch !== epoch) return
        set({ isModalOpen: false, files: [], claimedFileNames: new Map(), selectError: null })
      }, AUTO_CLOSE_DELAY_MS)
    }
  }

  function applyTerminalOrProgress(id: string, result: { step: TerminalOrProgressStep; error?: string }) {
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, step: result.step, error: result.error } : f)),
    }))
    if (result.step !== 'processed' && result.step !== 'error') return

    unsubscribeRow(id)
    set((state) => ({ claimedFileNames: releaseRowClaims(state.claimedFileNames, id) }))
    if (result.step === 'processed') {
      set((state) => ({ completionCounter: state.completionCounter + 1 }))
    }
    scheduleAutoClearIfDone()
  }

  function subscribeRow(id: string, documentId: string) {
    // OCRエラー後の再試行でdocumentIdが変わるケースに対応するため、既存行の購読があれば先に解除する
    unsubscribeRow(id)
    const myEpoch = epoch
    const unsubscribe = onSnapshot(
      doc(db, 'documents', documentId),
      (snapshot) => {
        if (myEpoch !== epoch) return
        applyTerminalOrProgress(id, mapDocumentStatusToStep(snapshot.data()))
      },
      (err) => {
        console.error('Snapshot error:', err)
        if (myEpoch !== epoch) return
        applyTerminalOrProgress(id, mapDocumentStatusToStep(undefined))
      }
    )
    snapshotUnsubs.set(id, unsubscribe)
  }

  async function performUpload(
    id: string,
    file: File,
    options?: { confirmDuplicate?: boolean; alternativeFileName?: string }
  ) {
    const myEpoch = epoch
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, step: 'uploading', error: undefined } : f)),
    }))

    try {
      const base64Data = await readFileAsBase64(file)
      if (myEpoch !== epoch) return

      const response = await callFunction<
        { fileName: string; mimeType: string; data: string; confirmDuplicate?: boolean; alternativeFileName?: string },
        UploadResult
      >('uploadPdf', {
        fileName: file.name,
        mimeType: file.type,
        data: base64Data,
        confirmDuplicate: options?.confirmDuplicate,
        alternativeFileName: options?.alternativeFileName,
      }, { timeout: 120_000 })
      if (myEpoch !== epoch) return

      if (response.duplicate && response.suggestedFileName) {
        set((state) => ({
          files: state.files.map((f) => (f.id === id ? {
            ...f,
            step: 'duplicate',
            duplicateInfo: {
              existingFileName: response.existingFileName || file.name,
              suggestedFileName: response.suggestedFileName as string,
            },
          } : f)),
        }))
        return
      }

      if (response.success && response.documentId) {
        set((state) => ({
          files: state.files.map((f) => (f.id === id ? {
            ...f,
            step: 'pending',
            documentId: response.documentId,
            duplicateInfo: undefined,
          } : f)),
        }))
        subscribeRow(id, response.documentId)
        return
      }

      // 想定外レスポンス(duplicateでもdocumentIdでもない成功応答): fail-visibleにerrorへ倒す
      // documentIdが発行されず終端したため、onSnapshot経由の解放が発生しない。ここで明示的に解放する
      set((state) => ({
        files: state.files.map((f) => (f.id === id ? {
          ...f,
          step: 'error',
          error: '予期しない応答が返されました。再試行してください。',
        } : f)),
        claimedFileNames: releaseRowClaims(state.claimedFileNames, id),
      }))
    } catch (err) {
      if (myEpoch !== epoch) return
      console.error('Upload error:', err)
      // callFunction自体が失敗した場合も同様にdocumentIdが発行されないため、ここで明示的に解放する
      set((state) => ({
        files: state.files.map((f) => (f.id === id ? { ...f, step: 'error', error: resolveUploadErrorMessage(err) } : f)),
        claimedFileNames: releaseRowClaims(state.claimedFileNames, id),
      }))
    }
  }

  // 行単位の単独アップロード(再試行・別名で保存)。バッチループの外から呼ぶ想定
  async function uploadOneFile(
    id: string,
    options?: { confirmDuplicate?: boolean; alternativeFileName?: string }
  ) {
    if (get().isAnyUploadInFlight) return
    const item = get().files.find((f) => f.id === id)
    if (!item) return

    const myEpoch = epoch
    set({ isAnyUploadInFlight: true })
    try {
      await performUpload(id, item.file, options)
    } finally {
      if (myEpoch === epoch) set({ isAnyUploadInFlight: false })
    }
  }

  return {
    files: [],
    claimedFileNames: new Map(),
    isAnyUploadInFlight: false,
    isModalOpen: false,
    completionCounter: 0,
    selectError: null,

    openModal: () => set({ isModalOpen: true }),

    closeModal: () => {
      const { files, isAnyUploadInFlight } = get()
      // Empty/Staged(idleのみ)/AllDone(全件processed)のみ即クリア。
      // active行、またはerror/duplicate行(NeedsAttention)が残っている場合はデータを温存する
      // (検証手順(b): 重複を残して閉じても、後で「確認」トースト経由で解決できる必要があるため)
      const hasPersistableData = files.some((f) => isActiveStep(f.step) || f.step === 'error' || f.step === 'duplicate') || isAnyUploadInFlight
      if (!hasPersistableData) {
        clearAutoClearTimer()
        set({ isModalOpen: false, files: [], claimedFileNames: new Map(), selectError: null })
      } else {
        set({ isModalOpen: false })
      }
    },

    addFiles: (fileList) => {
      clearAutoClearTimer()
      const incoming = Array.from(fileList)
      if (incoming.length === 0) return

      const validationErrors: string[] = []
      const newItems: FileUploadItem[] = []
      let nextClaimed = get().claimedFileNames

      for (const file of incoming) {
        const validationError = validateFile(file)
        if (validationError) {
          validationErrors.push(`${file.name}: ${validationError}`)
          continue
        }
        const id = crypto.randomUUID()
        const claimed = claimFileName(nextClaimed, file.name, id)
        if (claimed) {
          nextClaimed = claimed
        }
        newItems.push({ id, file, step: 'idle' })
      }

      set((state) => ({
        files: newItems.length > 0 ? [...state.files, ...newItems] : state.files,
        claimedFileNames: newItems.length > 0 ? nextClaimed : state.claimedFileNames,
        selectError: validationErrors.length > 0 ? validationErrors.join('\n') : null,
      }))
    },

    // バッチ全体の逐次アップロード
    uploadAll: async () => {
      if (get().isAnyUploadInFlight) return
      const targets = get().files.filter((f) => f.step === 'idle').map((f) => ({ id: f.id, file: f.file }))
      if (targets.length === 0) return

      const myEpoch = epoch
      set({ isAnyUploadInFlight: true })
      try {
        for (const target of targets) {
          if (myEpoch !== epoch) break
          await performUpload(target.id, target.file)
        }
      } finally {
        if (myEpoch === epoch) set({ isAnyUploadInFlight: false })
      }
    },

    retry: (id) => {
      void uploadOneFile(id)
    },

    resolveDuplicate: (id) => {
      const item = get().files.find((f) => f.id === id)
      if (!item?.duplicateInfo) return
      const suggested = item.duplicateInfo.suggestedFileName

      set((state) => ({
        claimedFileNames: claimFileName(state.claimedFileNames, suggested, id) ?? state.claimedFileNames,
      }))
      void uploadOneFile(id, { confirmDuplicate: true, alternativeFileName: suggested })
    },

    removeFile: (id) => {
      set((state) => ({
        files: state.files.filter((f) => f.id !== id),
        claimedFileNames: releaseRowClaims(state.claimedFileNames, id),
      }))
    },

    reset: () => {
      epoch += 1
      unsubscribeAll()
      clearAutoClearTimer()
      set({
        files: [],
        claimedFileNames: new Map(),
        isAnyUploadInFlight: false,
        isModalOpen: false,
        selectError: null,
        // completionCounterは意図的にリセットしない(DocumentsPage側が「変化」を検知するための
        // 単調カウンタであり、0に戻すこと自体に意味はない)
      })
      toast.dismiss(PDF_UPLOAD_TOAST_ID)
    },
  }
})

// ログアウト/reset契約(plan-crossreview High#2): 前回uidがdefinedかつ今回uidが異なる場合
// (ログアウト、または別ユーザーへの切替)のみreset()する。authStore.onAuthStateChangedの
// 全経路(signOut・許可ドメイン外拒否・セッション失効)を一箇所で拾うため、モジュールレベルで
// authStoreのvanilla subscribeを1回だけ登録する(Reactコンポーネントのマウント/アンマウントに
// 依存しないため、StrictModeの二重実行の影響を受けない)。
useAuthStore.subscribe((state, prevState) => {
  const prevUid = prevState.user?.uid
  if (prevUid && state.user?.uid !== prevUid) {
    usePdfUploadStore.getState().reset()
  }
})
