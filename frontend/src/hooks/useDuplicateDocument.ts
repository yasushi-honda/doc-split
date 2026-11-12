/**
 * 複数名FAXの手動複製 mutation (ADR-0032)
 *
 * Callable `duplicateDocumentForCustomers` を呼び、成功後に一覧・グループ表示のキャッシュを
 * 更新する。リクエスト/レスポンス型は BE と共有(shared/types.ts)。
 */

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { callFunction, getCallableErrorCode } from '@/lib/callFunction'
import { invalidateGroupQueries, markDocumentsInfiniteStale } from './useDocuments'
import type { DuplicateDocumentRequest, DuplicateDocumentResponse } from '@shared/types'

async function duplicateDocument(request: DuplicateDocumentRequest): Promise<DuplicateDocumentResponse> {
  // BE の timeoutSeconds(120)に合わせる。同じ入力の再実行は何度でも安全(冪等)なので、
  // callFunction の自動リトライ(通信断・タイムアウト時の1回)もそのまま有効にしてよい
  return callFunction<DuplicateDocumentRequest, DuplicateDocumentResponse>(
    'duplicateDocumentForCustomers',
    request,
    { timeout: 125_000 }
  )
}

function invalidateDuplicateQueries(queryClient: QueryClient): void {
  // 一覧(documentsInfinite)は即時の全ページ再取得を避け、stale化+バナー経由に委ねる
  // (usePdfSplit.ts invalidateSplitQueries と同じ方針。Firestore読み取り過大バグの再発防止)
  markDocumentsInfiniteStale(queryClient)
  // 元の書類に distributionId が付くため、詳細も更新する
  queryClient.invalidateQueries({ queryKey: ['document'] })
  // 詳細画面の「同一FAXをN名に配信」の人数。staleTime(30秒)内は再取得されないため、
  // 既存グループへ追加した後も古い人数が残らないよう無効化する(codex review P3)
  queryClient.invalidateQueries({ queryKey: ['distributionSiblingCount'] })
  // 利用者別・担当CM別のグループ表示に新しい書類が現れる
  invalidateGroupQueries(queryClient)
}

/**
 * commit 済みなのに応答が失われうるエラー(タイムアウト・通信断・Firestoreの競合リトライ切れ)。
 * サーバー側の状態が変わっている可能性があるため、画面を最新化する。この Callable 自身は aborted を
 * 返さない(競合リトライが尽きると internal になる)が、他の onCall と同じ分類で含める。
 * 判定が明確な拒否(failed-precondition・invalid-argument・not-found 等)では状態は変わっていない。
 */
const POSSIBLY_APPLIED_ERROR_CODES: ReadonlySet<string> = new Set(['aborted', 'internal', 'deadline-exceeded'])

export function useDuplicateDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: duplicateDocument,
    onSuccess: () => invalidateDuplicateQueries(queryClient),
    onError: (err) => {
      const code = getCallableErrorCode(err)
      if (code !== undefined && POSSIBLY_APPLIED_ERROR_CODES.has(code)) {
        invalidateDuplicateQueries(queryClient)
      }
    },
  })
}
