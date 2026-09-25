/**
 * 一括確認済み(DocumentsPage.tsxのhandleBulkVerify)の結果からトーストの種別・文言を
 * 決定する純粋関数(Issue #1042)。
 *
 * DocumentsPage.tsxはFirestore/react-query等の重い依存を大量に抱えるため、判定ロジックを
 * ここへ抽出することで、コンポーネント全体をマウントせずに分岐条件を単体テストできる
 * (shared/confirmOnVerify.tsの確定判定と同じ「決定ロジックを純粋関数に切り出す」方針)。
 */

import { CONFIRM_ON_VERIFY_SKIPPED_WARNING_MESSAGE } from '../../../shared/confirmOnVerify'

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
    return {
      type: 'error',
      message: `一括確認が一部失敗しました（${succeededCount}/${totalCount}件完了）`,
    }
  }

  if (identityLookupFailed) {
    return {
      type: 'warning',
      message: `${succeededCount}件を確認済みにしました。${CONFIRM_ON_VERIFY_SKIPPED_WARNING_MESSAGE}`,
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
