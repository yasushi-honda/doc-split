/**
 * decideBulkVerifyToast 単体テスト(Issue #1042)
 *
 * 背景: 一括確認済み(handleBulkVerify)は、fetchFreshCustomerIdentityLookup()(顧客マスター
 * のfail-closed取得)が失敗すると確定判定(customerConfirmed/officeConfirmed)をバッチ全体で
 * スキップし、verifiedのみ更新する。従来はこの場合もトーストが「N件を確認済みにしました」の
 * 成功文言のみで、確定処理がスキップされたことにユーザーが一切気付けなかった。
 */

import { describe, it, expect } from 'vitest'
import { decideBulkVerifyToast } from '../bulkVerifyToast'

describe('decideBulkVerifyToast', () => {
  it('失敗が1件でもあれば、確定判定の成否に関わらずerrorトーストを返す', () => {
    const outcome = decideBulkVerifyToast({
      totalCount: 10,
      succeededCount: 8,
      failedCount: 2,
      confirmedCount: 3,
      identityLookupFailed: true,
    })

    expect(outcome).toEqual({
      type: 'error',
      message: '一括確認が一部失敗しました（8/10件完了）',
    })
  })

  it('全件成功かつidentityLookup取得も成功、確定件数ありならconfirmedCountを含む成功トースト', () => {
    const outcome = decideBulkVerifyToast({
      totalCount: 5,
      succeededCount: 5,
      failedCount: 0,
      confirmedCount: 3,
      identityLookupFailed: false,
    })

    expect(outcome).toEqual({
      type: 'success',
      message: '5件を確認済みにしました（うち3件は顧客/事業所も確定しました）',
    })
  })

  it('全件成功かつ確定件数0件なら、確定件数の言及がない成功トースト', () => {
    const outcome = decideBulkVerifyToast({
      totalCount: 5,
      succeededCount: 5,
      failedCount: 0,
      confirmedCount: 0,
      identityLookupFailed: false,
    })

    expect(outcome).toEqual({
      type: 'success',
      message: '5件を確認済みにしました',
    })
  })

  it('全件成功だがidentityLookup取得が失敗していた場合、確定処理スキップを明示するwarningトースト(Issue #1042本体)', () => {
    const outcome = decideBulkVerifyToast({
      totalCount: 5,
      succeededCount: 5,
      failedCount: 0,
      confirmedCount: 0,
      identityLookupFailed: true,
    })

    expect(outcome.type).toBe('warning')
    expect(outcome.message).toContain('5件を確認済みにしました')
    expect(outcome.message).toContain('確定処理はスキップされました')
  })

  it('failedCount>0が最優先(identityLookupFailed:trueでもerrorを返す)', () => {
    const outcome = decideBulkVerifyToast({
      totalCount: 3,
      succeededCount: 1,
      failedCount: 2,
      confirmedCount: 0,
      identityLookupFailed: true,
    })

    expect(outcome.type).toBe('error')
  })
})
