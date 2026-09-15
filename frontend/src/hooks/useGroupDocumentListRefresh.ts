import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useGroupStats,
  groupDocumentsQueryKey,
  isGroupDocumentsVariantDirty,
  subscribeGroupDocumentsDirtyStore,
  type GroupStats,
  type GroupType,
} from './useDocumentGroups'

/**
 * グループ詳細一覧(`GroupDocumentList.tsx`)の「更新があります」バナー表示要否を
 * 判定するフック(2026-09-15、Issue #891修正、`useDocumentListRefresh`のgroupDocuments版)。
 *
 * 検知シグナルは2種類のORで構成する(`useDocumentListRefresh`と同じ設計):
 * 1. `isGroupDocumentsVariantDirty`: このセッション内でgroupDocumentsに影響しうる
 *    操作(編集・reprocess・削除・PDF分割・一括操作)が行われた直後に即座に立つ。
 * 2. `useGroupStats(groupType)`のシグネチャ変化(30秒ポーリング): 上記1の
 *    invalidateGroupQueries呼び出しを経由しない変更(=OCR等の非同期完了で
 *    ユーザーが既にバナーを1度解消した後に実データが変わるケース)を検知するために
 *    必須(plan-crossreview codex pass2で判明: dirtyフラグ単独では非同期完了後の
 *    再更新を検知できず、リストが恒久的に古くなりうる)。
 *
 * 既知の限界: `groupStats`は`groupType`全体の集計であり、開いている特定グループ
 * 以外の変更でもバナーが出うる。件数が変わらない編集は検知できない
 * (`useDocumentListRefresh`と同じ限界)。
 */

function buildGroupStatsSignature(stats: GroupStats | undefined): string | null {
  if (!stats) return null
  return `${stats.totalGroups}-${stats.totalDocuments}`
}

interface UseGroupDocumentListRefreshOptions {
  groupType: GroupType
  groupKey: string
  pageSize: number
}

interface UseGroupDocumentListRefreshResult {
  hasUpdates: boolean
  message: string
  /**
   * stats側のベースラインのみを更新する(dirtyフラグの解除は含まない)。
   * `useDocumentListRefresh`と同じ責務分離: dirtyフラグの解除は呼び出し元が
   * 対象variantのfetch成功を確認してから`clearGroupDocumentsVariantDirty`を
   * 個別に呼ぶこと。
   */
  resetBaseline: () => void
}

export function useGroupDocumentListRefresh({
  groupType,
  groupKey,
  pageSize,
}: UseGroupDocumentListRefreshOptions): UseGroupDocumentListRefreshResult {
  const queryClient = useQueryClient()
  const { data: stats } = useGroupStats(groupType)

  const activeQueryKey = groupDocumentsQueryKey(groupType, groupKey, pageSize)

  const isDirty = useSyncExternalStore(
    subscribeGroupDocumentsDirtyStore,
    () => isGroupDocumentsVariantDirty(activeQueryKey)
  )

  const baselineRef = useRef<string | null>(null)
  // ベースライン未設定の間、stats到着時に再計算するためのトリガー
  const [, forceRecompute] = useState(0)

  useEffect(() => {
    if (baselineRef.current === null && stats) {
      baselineRef.current = buildGroupStatsSignature(stats)
      forceRecompute((n) => n + 1)
    }
  }, [stats])

  const currentSignature = buildGroupStatsSignature(stats)
  const baseline = baselineRef.current

  const signatureChanged =
    baseline !== null && currentSignature !== null && currentSignature !== baseline
  const hasUpdates = isDirty || signatureChanged

  const message = '一覧の内容が更新されています'

  const resetBaseline = () => {
    const latest = queryClient.getQueryData<GroupStats>(['groupStats', groupType]) ?? stats
    if (latest) {
      baselineRef.current = buildGroupStatsSignature(latest)
    }
  }

  return { hasUpdates, message, resetBaseline }
}
