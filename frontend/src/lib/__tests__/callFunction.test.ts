/**
 * getCallableErrorMessage 単体テスト
 *
 * Issue #621: splitPdfの新エラーコード(already-exists/aborted)がFE未対応で
 * 生の英語メッセージ+内部ドキュメントIDがそのままユーザーに露出する問題の修正。
 * BE側のエラーメッセージは 'already-exists' という文字列を含まないため
 * (例: "Document abc123 has already been split (status='split')")、
 * message.includes() 方式では検知できず、FirebaseError.code による判定が必須。
 */

import { describe, it, expect } from 'vitest'
import { getCallableErrorMessage } from '../callFunction'

// firebase/functions の FunctionsError は FirebaseError を継承し
// code: `functions/${FunctionsErrorCodeCore}` を持つ。テストでは最小限のシェイプで模擬する。
function makeFunctionsError(code: string, message: string): Error {
  const err = new Error(message)
  ;(err as Error & { code: string }).code = `functions/${code}`
  return err
}

describe('getCallableErrorMessage - Issue #621 already-exists/aborted', () => {
  it('code=already-exists のとき、内部IDを含まない汎用日本語メッセージを返す', () => {
    const err = makeFunctionsError(
      'already-exists',
      "Document abc123 has already been split (status='split')"
    )

    const message = getCallableErrorMessage(err)

    expect(message).not.toMatch(/abc123/)
    expect(message).not.toMatch(/already-exists|already been split/i)
    expect(message).toContain('既に完了')
  })

  it('code=aborted のとき、内部ドキュメントIDを含まない汎用日本語メッセージを返す', () => {
    const err = makeFunctionsError(
      'aborted',
      'splitPdf aborted: concurrent split detected (parent=abc123 was modified since read, likely split by another request): precondition failed'
    )

    const message = getCallableErrorMessage(err)

    expect(message).not.toMatch(/abc123/)
    expect(message).not.toMatch(/splitPdf aborted|concurrent split detected/i)
    expect(message).toContain('競合')
  })

  it('code情報がなくメッセージ文字列に already-exists/aborted の語が含まれない従来ケースは既存のフォールバックのまま', () => {
    const err = new Error('permission-denied: not in whitelist')
    expect(getCallableErrorMessage(err)).toBe('権限がありません。')
  })

  it('未知のcode/messageはdefaultMessageにフォールバックする', () => {
    const err = makeFunctionsError('unknown', 'something went wrong')
    expect(getCallableErrorMessage(err, 'デフォルトエラー')).toBe('デフォルトエラー')
  })
})
