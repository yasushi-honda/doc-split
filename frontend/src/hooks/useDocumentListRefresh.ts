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
 *    現在表示中のvariant自身を含め、`documentsInfinite`に影響しうる操作が行われる
 *    たびにdirty化される。解除は対象variantの実際のfetchが成功した時のみ
 *    (`DocumentsPage.tsx`の`refreshDocumentList`参照)。2026-09-08追記
 *    (codex review 3周にわたる指摘): 当初はTanStack Query自体の`isStale`を使い、
 *    さらに「画面表示中のvariantは除外する」最適化を試みたが、いずれも
 *    (1) `setQueriesData`(`updateDocumentInListCache`等が高頻度に使う)が対象variantの
 *    `isInvalidated`を暗黙にクリアする、(2) 除外したアクティブなvariant自身の
 *    メンバーシップ変更(statusフィルタ中の書類のstatusが変わった場合等)を
 *    検知できなくなる、という2つの実害を招いた。「全variant一律dirty化、解除は
 *    確認済み成功のみ」という単純だが安全側に倒したルールに統一した。
 * 2. `useDocumentStats()`（既存の軽量集計、30秒間隔で既に稼働中、フィルタに関わらず
 *    全体件数を見るグローバルな指標）のシグネチャ変化。
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

  const isDirty = useSyncExternalStore(
    subscribeDocumentsInfiniteDirtyStore,
    () => isDocumentsInfiniteVariantDirty(activeQueryKey)
  )

  const baselineRef = useRef<{ signature: string; total: number } | null>(null)
  // ベースライン未設定の間、stats到着時に再計算するためのトリガー
  const [, forceRecompute] = useState(0)

  // 初回のstats到着時にベースラインを確定する。
  // 2026-09-08追記(codex review 3周目 P2指摘の反証的検証で判明): `useDocumentStats()`は
  // 現在のフィルタに関わらず全ステータス横断のグローバル件数を返すため、フィルタ切替時に
  // ベースラインを再計算する必要はない(以前はフィルタ変更のたびにリセットしていたが、
  // これは「フィルタを切り替えて元に戻ると、切替前に検知していた更新シグナルが失われる」
  // 不具合の原因だったため撤去した)。
  useEffect(() => {
    if (baselineRef.current === null && stats) {
      baselineRef.current = { signature: buildStatsSignature(stats) as string, total: stats.total }
      forceRecompute((n) => n + 1)
    }
  }, [stats])

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
