/**
 * decideBulkVerifyToast 単体テスト(Issue #1042)
 *
 * 背景: 一括確認済み(handleBulkVerify)は、fetchFreshCustomerIdentityLookup()(顧客マスター
 * のfail-closed取得)が失敗すると確定判定(customerConfirmed/officeConfirmed)をバッチ全体で
 * スキップし、verifiedのみ更新する。従来はこの場合もトーストが「N件を確認済みにしました」の
 * 成功文言のみで、確定処理がスキップされたことにユーザーが一切気付けなかった。
 */

import { describe, it, expect } from 'vitest'
import { decideBulkVerifyToast, decidePostWriteSyncFailureToast } from '../bulkVerifyToast'

describe('decideBulkVerifyToast', () => {
  it('失敗が1件でもあり、identityLookup取得は成功していれば通常の部分失敗メッセージを返す', () => {
    const outcome = decideBulkVerifyToast({
      totalCount: 10,
      succeededCount: 8,
      failedCount: 2,
      confirmedCount: 3,
      identityLookupFailed: false,
    })

    expect(outcome).toEqual({
      type: 'error',
      message: '一括確認が一部失敗しました（8/10件完了）',
    })
  })

  // codex review指摘(P2、2026-09-25): 失敗時はhandleBulkVerify側が失敗した書類のみを
  // 選択に残す(成功した書類は選択解除される)ため、ここで確定スキップの警告を省略すると、
  // 成功したが確定処理はスキップされた書類を選び直して再実行する手段がなくなる。
  it('失敗が1件でもあり、かつidentityLookup取得も失敗していれば、部分失敗と確定スキップ両方の情報を含むerrorトーストを返す(Issue #1042 codex review追加指摘)', () => {
    const outcome = decideBulkVerifyToast({
      totalCount: 10,
      succeededCount: 8,
      failedCount: 2,
      confirmedCount: 0,
      identityLookupFailed: true,
    })

    expect(outcome.type).toBe('error')
    expect(outcome.message).toContain('一括確認が一部失敗しました（8/10件完了）')
    expect(outcome.message).toContain('確定処理はスキップされました')
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

  // pr-review-toolkit:code-reviewer指摘: 以前は共通文言自体に「確認済みにしましたが、」を
  // 含めていたため、件数付きの前置きと結合すると「確認済みにしました」が二重に出ていた。
  it('全件成功だがidentityLookup取得が失敗した場合のメッセージは「確認済みにしました」を二重に含まない', () => {
    const outcome = decideBulkVerifyToast({
      totalCount: 5,
      succeededCount: 5,
      failedCount: 0,
      confirmedCount: 0,
      identityLookupFailed: true,
    })

    const occurrences = outcome.message.split('確認済みにしました').length - 1
    expect(occurrences).toBe(1)
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

// pr-review-toolkit:silent-failure-hunterレビュー指摘(CRITICAL-2): handleBulkVerifyの
// Phase-B(キャッシュ補正・トースト表示)自体が例外を投げた場合、以前は固定の「更新しました」
// 文言のみを返し、Phase-Aで既に判明している一部書込み失敗の情報を握り潰していた。
describe('decidePostWriteSyncFailureToast', () => {
  it('Phase-Aで書込み失敗もidentityLookup失敗もなければ、表示更新失敗のみを伝えるwarningを返す', () => {
    const outcome = decidePostWriteSyncFailureToast({
      totalCount: 5,
      succeededCount: 5,
      failedCount: 0,
      identityLookupFailed: false,
    })

    expect(outcome).toEqual({
      type: 'warning',
      message: '確認済みに更新しましたが、画面表示の更新に失敗しました。再読み込みしてください',
    })
  })

  it('Phase-Aで一部書込みが失敗していた場合、その件数を含むerrorを返す(失敗情報を握り潰さない)', () => {
    const outcome = decidePostWriteSyncFailureToast({
      totalCount: 10,
      succeededCount: 7,
      failedCount: 3,
      identityLookupFailed: false,
    })

    expect(outcome.type).toBe('error')
    expect(outcome.message).toContain('一括確認が一部失敗しました（7/10件完了）')
  })

  // codex review 2巡目指摘(P2): 表示更新失敗のフォールバックがidentityLookupFailedを
  // 無視すると、再読み込みしても確定処理は再実行されないのに、ユーザーは「画面表示の
  // 更新に失敗しました」だけを見て確定処理スキップの事実に気付けない。
  it('書込みは全件成功したがidentityLookup取得は失敗していた場合、確定スキップの警告も含める(codex review 2巡目指摘)', () => {
    const outcome = decidePostWriteSyncFailureToast({
      totalCount: 5,
      succeededCount: 5,
      failedCount: 0,
      identityLookupFailed: true,
    })

    expect(outcome.type).toBe('warning')
    expect(outcome.message).toContain('画面表示の更新に失敗しました')
    expect(outcome.message).toContain('確定処理はスキップされました')
  })

  it('一部書込み失敗かつidentityLookup取得も失敗していた場合、両方の情報を含むerrorを返す', () => {
    const outcome = decidePostWriteSyncFailureToast({
      totalCount: 10,
      succeededCount: 7,
      failedCount: 3,
      identityLookupFailed: true,
    })

    expect(outcome.type).toBe('error')
    expect(outcome.message).toContain('一括確認が一部失敗しました（7/10件完了）')
    expect(outcome.message).toContain('確定処理はスキップされました')
  })
})
