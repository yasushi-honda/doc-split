import { useEffect, useRef, useState } from 'react'
import { useDocumentStats, type DocumentStats } from './useDocuments'

/**
 * 書類一覧(`DocumentsPage.tsx`)の「更新があります」バナー表示要否を判定するフック
 * (2026-09-08、Firestore読み取り過大バグ修正)。
 *
 * `useInfiniteDocuments`の自動再取得を全廃したため、一覧を最新化する手段は
 * 「ミューテーションによるキャッシュ直接パッチ」と「本フックが検知しバナー経由で
 * ユーザーが起動する明示的な1ページ目再取得」の2系統のみになった。
 *
 * 検知シグナルは2種類のORで構成する:
 * 1. `isStale`（呼び出し元が`useInfiniteDocuments`から渡す）: 該当variantが
 *    `invalidateQueries(..., {refetchType:'none'})`でstaleマークされたことを示す。
 *    フィルタを切り替えて以前訪れたvariantに戻った際に、他フィルタ表示中に行われた
 *    更新をこのシグナルで検知できる(`resetDocumentsInfiniteToFirstPage`が非アクティブ
 *    variantをstale化したままにする設計との組み合わせで機能する)。
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
  /** 現在表示中variantの`useInfiniteDocuments`が返す`isStale` */
  isStale: boolean
  /**
   * フィルタの組み合わせを表すキー(例: `JSON.stringify(filters)`)。変化を検知したら
   * ベースラインを現在の統計値へリセットする(フィルタ切替直後に、切替前フィルタとの
   * 差分でバナーが誤発火しないようにするため)。
   */
  filtersKey: string
}

interface UseDocumentListRefreshResult {
  hasUpdates: boolean
  newDocumentCount: number
  message: string
  /** リフレッシュ成功後に呼び出し元が呼ぶ。ベースラインを現在値へ更新する */
  resetBaseline: () => void
}

export function useDocumentListRefresh({
  isStale,
  filtersKey,
}: UseDocumentListRefreshOptions): UseDocumentListRefreshResult {
  const { data: stats } = useDocumentStats()

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
  const hasUpdates = isStale || signatureChanged

  const newDocumentCount =
    baseline !== null && stats ? Math.max(0, stats.total - baseline.total) : 0

  const message =
    newDocumentCount > 0 ? `新しい書類が${newDocumentCount}件あります` : '一覧の内容が更新されています'

  const resetBaseline = () => {
    if (stats) {
      baselineRef.current = { signature: buildStatsSignature(stats) as string, total: stats.total }
    }
  }

  return { hasUpdates, newDocumentCount, message, resetBaseline }
}
