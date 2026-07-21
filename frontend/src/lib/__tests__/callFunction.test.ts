/**
 * getCallableErrorMessage 単体テスト
 *
 * Issue #621: splitPdfの新エラーコード(already-exists/aborted)がFE未対応で
 * 生の英語メッセージ+内部ドキュメントIDがそのままユーザーに露出する問題の修正。
 * BE側のエラーメッセージは 'already-exists' という文字列を含まないため
 * (例: "Document abc123 has already been split (status='split')")、
 * message.includes() 方式では検知できず、FirebaseError.code による判定が必須。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// firebase/functions の FunctionsError は FirebaseError を継承し
// code: `functions/${FunctionsErrorCodeCore}` を持つ。テストでは最小限のシェイプで模擬する。
function makeFunctionsError(code: string, message: string): Error {
  const err = new Error(message)
  ;(err as Error & { code: string }).code = `functions/${code}`
  return err
}

const mockCallableImpl = vi.fn()
vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallableImpl,
}))

const mockGetIdToken = vi.fn().mockResolvedValue('new-token')
vi.mock('../firebase', () => ({
  functions: {},
  auth: { currentUser: { getIdToken: (...args: unknown[]) => mockGetIdToken(...args) } },
}))

import { getCallableErrorMessage, callFunction } from '../callFunction'

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

  it('code=failed-preconditionのとき、BEが投げた日本語メッセージをそのまま返す(defaultMessageに丸めない)', () => {
    const err = makeFunctionsError(
      'failed-precondition',
      'リトライ対象外です(ドキュメントが存在しないか、エラー状態ではありません)'
    )
    expect(getCallableErrorMessage(err, 'デフォルトエラー')).toBe(
      'リトライ対象外です(ドキュメントが存在しないか、エラー状態ではありません)'
    )
  })

  it('code=failed-preconditionの別メッセージ(Feature Flag OFF)もそのまま返す', () => {
    const err = makeFunctionsError('failed-precondition', 'Google Drive連携機能が無効です')
    expect(getCallableErrorMessage(err)).toBe('Google Drive連携機能が無効です')
  })
})

describe('callFunction - リトライ動作 (silent-failure-hunterレビュー指摘)', () => {
  beforeEach(() => {
    mockCallableImpl.mockReset()
    mockGetIdToken.mockClear()
    mockGetIdToken.mockResolvedValue('new-token')
  })

  it('リトライ対象コード(unauthenticated)で失敗後、リトライも別コードで失敗した場合はリトライ後の実際のエラーをthrowする（旧実装は元のerrを握りつぶしていた）', async () => {
    const firstErr = makeFunctionsError('unauthenticated', 'token expired')
    const retryErr = makeFunctionsError('already-exists', 'Document abc123 has already been split')
    mockCallableImpl
      .mockRejectedValueOnce(firstErr)
      .mockRejectedValueOnce(retryErr)

    await expect(callFunction('splitPdf', {})).rejects.toBe(retryErr)
    expect(mockGetIdToken).toHaveBeenCalledWith(true)
    expect(mockCallableImpl).toHaveBeenCalledTimes(2)
  })

  it('リトライ対象でないコード(invalid-argument)はトークンリフレッシュせず即座に元のエラーをthrowする', async () => {
    const err = makeFunctionsError('invalid-argument', 'bad input')
    mockCallableImpl.mockRejectedValueOnce(err)

    await expect(callFunction('splitPdf', {})).rejects.toBe(err)
    expect(mockGetIdToken).not.toHaveBeenCalled()
    expect(mockCallableImpl).toHaveBeenCalledTimes(1)
  })

  it('リトライが成功した場合は成功データを返す', async () => {
    const err = makeFunctionsError('deadline-exceeded', 'timeout')
    mockCallableImpl
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ data: { success: true } })

    await expect(callFunction('splitPdf', {})).resolves.toEqual({ success: true })
    expect(mockCallableImpl).toHaveBeenCalledTimes(2)
  })
})
