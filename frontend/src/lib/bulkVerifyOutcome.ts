/**
 * 一括確認済み(DocumentsPage.tsxのhandleBulkVerify)の文書ごとの判定・集計ロジックを
 * テスト可能な純粋関数へ切り出したもの(Issue #1044、PR #1041のpr-test-analyzer指摘対応)。
 *
 * DocumentsPage.tsxはFirestore/react-query等の重い依存を大量に抱えるため、
 * outcomes(各文書のトランザクション結果)からの集計・選択保持方針の決定ロジックを
 * ここへ抽出することで、コンポーネント全体をマウントせずに分岐条件を単体テストできる
 * (decideBulkVerifyToast(bulkVerifyToast.ts)と同じ「決定ロジックを純粋関数に切り出す」方針)。
 */

import type { ConfirmOnVerifyDecisions } from '../../../shared/confirmOnVerify'

export interface BulkVerifyDocOutcome {
  docId: string
  status: 'ok' | 'error'
  decisions: ConfirmOnVerifyDecisions | null
  /**
   * 成功した書類がトランザクション内で読み込んだ最新状態の時点で、既に顧客/事業所とも
   * 確定済みだったか。identityLookupFailed時の警告要否判定に使う(既に両方確定済みなら
   * 確定判定がスキップされても実害がない)。
   */
  alreadyFullyConfirmed: boolean
}

export type BulkVerifySelectionAfterSuccess = 'clear' | 'keep-failed-only' | 'keep-all'
export type BulkVerifySelectionAfterPostWriteFailure = 'keep-failed-only' | 'keep-all'

export interface BulkVerifyOutcomeSummary {
  succeeded: BulkVerifyDocOutcome[]
  failed: BulkVerifyDocOutcome[]
  confirmedCount: number
  /**
   * fetchFreshCustomerIdentityLookup()自体が失敗し、かつ成功した書類のうち少なくとも
   * 1件は実際に確定できたはず(=両方確定済みではなかった)場合のみtrue。
   */
  identityLookupWarningNeeded: boolean
  /** Firestore書込み(Phase-A)成功後、キャッシュ補正・トースト表示(Phase-B)まで成功した場合の選択保持方針 */
  selectionAfterSuccess: BulkVerifySelectionAfterSuccess
  /** Phase-B(キャッシュ補正・トースト表示)自体が例外を投げた場合の選択保持方針 */
  selectionAfterPostWriteFailure: BulkVerifySelectionAfterPostWriteFailure
}

/**
 * runWithConcurrency完了後のoutcomesから、succeeded/failed分割・確定件数・
 * identityLookup失敗時の警告要否・選択保持方針をまとめて決定する。
 *
 * @param identityLookupFailed fetchFreshCustomerIdentityLookup()自体が失敗したか
 */
export function summarizeBulkVerifyOutcomes(
  outcomes: BulkVerifyDocOutcome[],
  identityLookupFailed: boolean
): BulkVerifyOutcomeSummary {
  const succeeded = outcomes.filter((o) => o.status === 'ok')
  const failed = outcomes.filter((o) => o.status === 'error')

  // codex review 3巡目指摘: identityLookupFailedが真でも、成功した書類が全て既に
  // 両方確定済み(alreadyFullyConfirmed)なら実際には確定できたはずのものは何もなく、
  // 警告は不要(単体トグルの「既に両方確定済みなら警告不要」と同じ判定に揃える)。
  const identityLookupWarningNeeded = identityLookupFailed && succeeded.some((o) => !o.alreadyFullyConfirmed)

  const confirmedCount = succeeded.filter(
    (o) => o.decisions?.customer.action === 'confirm' || o.decisions?.office.action === 'confirm'
  ).length

  // codexレビュー指摘(P2・4巡目・5巡目): identityLookupWarningNeededの場合、確定処理が
  // スキップされた書類(成功した書類も含む)を再実行できるよう選択を丸ごと維持する。
  // 部分失敗時に成功した書類だけ選択解除すると、それらも確認済みになり「未確認のみ表示」
  // フィルタで一覧から消えるため、再実行のための再選択ができなくなる。
  const selectionAfterSuccess: BulkVerifySelectionAfterSuccess = identityLookupWarningNeeded
    ? 'keep-all'
    : failed.length > 0
      ? 'keep-failed-only'
      : 'clear'

  // Phase-B自体が失敗した場合は、identityLookupWarningNeededでない限り成功した書類の
  // 選択解除を試みず、失敗した書類のみへ絞る(Phase-Bの失敗はキャッシュ補正・トースト
  // 表示という表示上の後始末に過ぎず、Firestore書込みは既に成功しているため)。
  const selectionAfterPostWriteFailure: BulkVerifySelectionAfterPostWriteFailure =
    failed.length > 0 && !identityLookupWarningNeeded ? 'keep-failed-only' : 'keep-all'

  return {
    succeeded,
    failed,
    confirmedCount,
    identityLookupWarningNeeded,
    selectionAfterSuccess,
    selectionAfterPostWriteFailure,
  }
}

/**
 * 並行数を制限しつつ配列の各要素を非同期処理する(Issue #1034 一括確認済み用)。
 * `items.length`件のFirestoreトランザクションを無制限に同時発行しないための簡易プール。
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++
      results[current] = await fn(items[current] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
