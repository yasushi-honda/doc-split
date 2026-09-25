/**
 * 一括確認済み(DocumentsPage.tsxのhandleBulkVerify)の結果からトーストの種別・文言を
 * 決定する純粋関数(Issue #1042)。
 *
 * DocumentsPage.tsxはFirestore/react-query等の重い依存を大量に抱えるため、判定ロジックを
 * ここへ抽出することで、コンポーネント全体をマウントせずに分岐条件を単体テストできる
 * (shared/confirmOnVerify.tsの確定判定と同じ「決定ロジックを純粋関数に切り出す」方針)。
 */

import { CONFIRM_ON_VERIFY_SKIPPED_REASON_MESSAGE } from '../../../shared/confirmOnVerify'

export interface BulkVerifyToastOutcome {
  type: 'success' | 'warning' | 'error'
  message: string
}

export interface DecideBulkVerifyToastParams {
  totalCount: number
  succeededCount: number
  failedCount: number
  confirmedCount: number
  /** fetchFreshCustomerIdentityLookup()自体が失敗し、バッチ全体で確定判定をスキップした場合true */
  identityLookupFailed: boolean
}

export function decideBulkVerifyToast(params: DecideBulkVerifyToastParams): BulkVerifyToastOutcome {
  const { totalCount, succeededCount, failedCount, confirmedCount, identityLookupFailed } = params

  if (failedCount > 0) {
    const base = `一括確認が一部失敗しました（${succeededCount}/${totalCount}件完了）`
    // codex review指摘(P2): 失敗があった場合、handleBulkVerify側は失敗した書類のみを選択に
    // 残す(成功した書類は選択解除される)ため、この後さらにidentityLookupFailedの警告を
    // 省略すると、成功したが確定処理はスキップされた書類を選び直して再実行する手段が
    // なくなる。部分失敗と確定スキップ両方の情報を1つのメッセージに含める。
    return {
      type: 'error',
      message: identityLookupFailed
        ? `${base}。成功した${succeededCount}件も、${CONFIRM_ON_VERIFY_SKIPPED_REASON_MESSAGE}`
        : base,
    }
  }

  if (identityLookupFailed) {
    return {
      type: 'warning',
      // pr-review-toolkit:code-reviewer指摘: 以前は共通文言自体に「確認済みにしましたが、」
      // を含めていたため、ここで前置きすると「確認済みにしました」が二重に出ていた。
      // 共通文言は理由部分のみとし、前置きは呼び出し元(件数の有無で文言が異なる)で組み立てる。
      message: `${succeededCount}件を確認済みにしましたが、${CONFIRM_ON_VERIFY_SKIPPED_REASON_MESSAGE}`,
    }
  }

  return {
    type: 'success',
    message:
      confirmedCount > 0
        ? `${succeededCount}件を確認済みにしました（うち${confirmedCount}件は顧客/事業所も確定しました）`
        : `${succeededCount}件を確認済みにしました`,
  }
}

export interface DecidePostWriteSyncFailureToastParams {
  totalCount: number
  succeededCount: number
  failedCount: number
}

/**
 * handleBulkVerifyのPhase-B(Firestore書込み後のキャッシュ補正・トースト表示)自体が
 * 例外を投げた場合のフォールバックトーストを決定する純粋関数(Issue #1042、
 * pr-review-toolkit:silent-failure-hunter指摘CRITICAL-2対応)。
 *
 * Phase-A(Firestore書込み)は既に完了しているため「一括確認に失敗しました」は誤りだが、
 * Phase-Aの時点で一部書類の書込み自体が失敗していた場合(failedCount>0)は、その事実を
 * 「画面表示の更新に失敗しました」という後始末失敗のメッセージだけに埋もれさせず、
 * 実際に書込みが失敗した件数も明示する(失敗情報を握り潰さない)。
 */
export function decidePostWriteSyncFailureToast(
  params: DecidePostWriteSyncFailureToastParams
): BulkVerifyToastOutcome {
  const { totalCount, succeededCount, failedCount } = params

  if (failedCount > 0) {
    return {
      type: 'error',
      message: `一括確認が一部失敗しました（${succeededCount}/${totalCount}件完了）。画面表示の更新にも失敗したため、最新の状態を確認してください`,
    }
  }

  return {
    type: 'warning',
    message: '確認済みに更新しましたが、画面表示の更新に失敗しました。再読み込みしてください',
  }
}
