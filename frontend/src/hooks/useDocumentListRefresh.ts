import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useDocumentStats,
  documentsInfiniteQueryKey,
  isDocumentsInfiniteVariantDirty,
  subscribeDocumentsInfiniteDirtyStore,
  type DocumentStats,
  type DocumentFilters,
} from './useDocuments'

/**
 * 書類一覧(`DocumentsPage.tsx`)の「更新があります」バナー表示要否を判定するフック
 * (2026-09-08、Firestore読み取り過大バグ修正)。
 *
 * `useInfiniteDocuments`の自動再取得を全廃したため、一覧を最新化する手段は
 * 「ミューテーションによるキャッシュ直接パッチ」と「本フックが検知しバナー経由で
 * ユーザーが起動する明示的な1ページ目再取得」の2系統のみになった。
 *
 * 検知シグナルは2種類のORで構成する:
 * 1. `isDocumentsInfiniteVariantDirty`(useDocuments.tsの独立トラッキング):
 *    フィルタを切り替えて以前訪れたvariantに戻った際に、他フィルタ表示中に行われた
 *    更新を検知する。2026-09-08追記(codex review P1指摘): 当初はTanStack Query
 *    自体の`isStale`を使っていたが、`setQueriesData`(`updateDocumentInListCache`等が
 *    高頻度に使う)が対象variantの`isInvalidated`を暗黙にクリアしてしまうため
 *    (実機検証で確認)、フィルタ切替検知の永続シグナルとしては信頼できないと判明。
 *    TanStackの内部状態から独立したトラッキングに置き換えた。
 * 2. `useDocumentStats()`（既存の軽量集計、30秒間隔で既に稼働中）のシグネチャ変化。
 *
 * 既知の限界: 件数が変わらない編集(他ユーザーによる顧客名修正等)は検知できない。
 * バナー文言は「処理状況・件数の変化」に限定し、「すべての更新」を保証する表現には
 * しない。
 */

function buildStatsSignature(stats: DocumentStats | undefined): string | null {
  if (!stats) return null
  return `${stats.pending}-${stats.processing}-${stats.processed}-${stats.error}-${stats.split}`
}

interface UseDocumentListRefreshOptions {
  /** 現在表示中variantのフィルタ設定(activeQueryKeyの組み立て・フィルタ変更検知の両方に使う) */
  filters: DocumentFilters
  pageSize: number
}

interface UseDocumentListRefreshResult {
  hasUpdates: boolean
  newDocumentCount: number
  message: string
  /**
   * リフレッシュ成功後に呼び出し元が呼ぶ。ベースラインを現在値へ更新し、
   * アクティブなvariantのdirtyフラグを解除する。
   *
   * 2026-09-08追記(codex review P2指摘): `useDocumentStats()`の`stats`(Reactの
   * レンダー状態)をそのまま閉包で使うと、呼び出し時点で該当queryの再取得が
   * まだ完了していない場合に古い値でベースラインを確定してしまい、直後の
   * stats反映でバナーが誤って再表示されうる。`queryClient.getQueryData()`で
   * キャッシュを直接読み、呼び出し時点の最新値を使う(呼び出し元は
   * `queryClient.refetchQueries({queryKey:['documentStats']})`を先にawaitして
   * キャッシュを確定させておくこと)。
   */
  resetBaseline: () => void
}

export function useDocumentListRefresh({
  filters,
  pageSize,
}: UseDocumentListRefreshOptions): UseDocumentListRefreshResult {
  const queryClient = useQueryClient()
  const { data: stats } = useDocumentStats()

  const activeQueryKey = documentsInfiniteQueryKey(filters, pageSize)
  const filtersKey = JSON.stringify(activeQueryKey)

  const isDirty = useSyncExternalStore(
    subscribeDocumentsInfiniteDirtyStore,
    () => isDocumentsInfiniteVariantDirty(activeQueryKey)
  )

  const baselineRef = useRef<{ signature: string; total: number } | null>(null)
  const prevFiltersKeyRef = useRef<string>(filtersKey)
  // ベースライン未設定 / フィルタ変化を検知した瞬間に再計算するためのトリガー
  const [, forceRecompute] = useState(0)

  // 初回のstats到着時にベースラインを確定する
  useEffect(() => {
    if (baselineRef.current === null && stats) {
      baselineRef.current = { signature: buildStatsSignature(stats) as string, total: stats.total }
      forceRecompute((n) => n + 1)
    }
  }, [stats])

  // フィルタ変更を検知したらベースラインをリセットする
  useEffect(() => {
    if (prevFiltersKeyRef.current !== filtersKey) {
      prevFiltersKeyRef.current = filtersKey
      if (stats) {
        baselineRef.current = { signature: buildStatsSignature(stats) as string, total: stats.total }
        forceRecompute((n) => n + 1)
      }
    }
  }, [filtersKey, stats])

  const currentSignature = buildStatsSignature(stats)
  const baseline = baselineRef.current

  const signatureChanged =
    baseline !== null && currentSignature !== null && currentSignature !== baseline.signature
  const hasUpdates = isDirty || signatureChanged

  const newDocumentCount =
    baseline !== null && stats ? Math.max(0, stats.total - baseline.total) : 0

  const message =
    newDocumentCount > 0 ? `新しい書類が${newDocumentCount}件あります` : '一覧の内容が更新されています'

  const resetBaseline = () => {
    // codex review P2指摘反映: Reactのレンダー状態(stats)ではなくqueryClientの
    // キャッシュを直接読む(呼び出し元が事前にrefetchQueriesをawait済みである前提)
    const latest = queryClient.getQueryData<DocumentStats>(['documentStats']) ?? stats
    if (latest) {
      baselineRef.current = { signature: buildStatsSignature(latest) as string, total: latest.total }
    }
  }

  return { hasUpdates, newDocumentCount, message, resetBaseline }
}
