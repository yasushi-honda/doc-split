/**
 * httpsCallable 共通ヘルパー
 *
 * モバイルバックグラウンド復帰時の一時的エラーに対して
 * トークンリフレッシュ + 1回自動リトライを行う。
 *
 * リトライ対象:
 * - unauthenticated: トークン失効
 * - deadline-exceeded: タイムアウト
 * - internal: ネットワーク切断
 */

import { httpsCallable } from 'firebase/functions'
import { functions, auth } from './firebase'

/** リトライ対象のエラーかどうか判定 */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  return msg.includes('unauthenticated') ||
    msg.includes('deadline-exceeded') ||
    msg.includes('internal')
}

/**
 * Cloud Function を呼び出す（自動リトライ付き）
 *
 * @param name - Cloud Function名
 * @param data - リクエストデータ
 * @param options.timeout - クライアント側タイムアウト（ms）。Cloud Functions側と合わせること。
 */
export async function callFunction<TReq, TRes>(
  name: string,
  data: TReq,
  options?: { timeout?: number }
): Promise<TRes> {
  const callable = httpsCallable<TReq, TRes>(
    functions,
    name,
    { timeout: options?.timeout ?? 70_000 }
  )

  try {
    const result = await callable(data)
    return result.data
  } catch (err) {
    if (isRetryableError(err) && auth.currentUser) {
      try {
        await auth.currentUser.getIdToken(true)
        const result = await callable(data)
        return result.data
      } catch {
        // リトライも失敗 → 元のエラーをthrow
      }
    }
    throw err
  }
}

/**
 * Cloud Functions callable のエラーコードを取得する（`functions/${code}` prefixを除去）。
 * BE側のエラーメッセージ文字列自体にコード名が含まれるとは限らないため
 * (例: splitPdfのalready-exists/abortedは内部docId混じりの説明文のみ)、
 * メッセージのパターンマッチではなく FirebaseError.code を正としてハンドリングする。
 */
export function getCallableErrorCode(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined
  const code = (err as Error & { code?: unknown }).code
  return typeof code === 'string' ? code.replace(/^functions\//, '') : undefined
}

/** よくあるエラーをユーザー向けメッセージに変換 */
export function getCallableErrorMessage(err: unknown, defaultMessage = '処理に失敗しました'): string {
  if (!(err instanceof Error)) return defaultMessage
  const code = getCallableErrorCode(err)
  if (code === 'already-exists') return 'この操作は既に完了しています。画面を更新して最新の状態をご確認ください。'
  if (code === 'aborted') return '別の操作と競合したため処理を中断しました。時間をおいて再度お試しください。'
  const msg = err.message
  if (code === 'unauthenticated' || msg.includes('unauthenticated')) return 'ログインセッションが切れました。ページを再読み込みしてください。'
  if (code === 'deadline-exceeded' || code === 'internal' || msg.includes('deadline-exceeded') || msg.includes('internal')) return '通信エラーが発生しました。電波状況を確認して再度お試しください。'
  if (code === 'permission-denied' || msg.includes('permission-denied') || msg.includes('not in whitelist')) return '権限がありません。'
  return defaultMessage
}
