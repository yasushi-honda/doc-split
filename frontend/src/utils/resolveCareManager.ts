/**
 * 顧客選択時にcareManagerを解決する
 *
 * - 一意にマッチ → そのcareManagerName（未設定なら空文字）
 * - 同名顧客が複数（isDuplicate） → null（補完しない）
 * - マッチなし → null（補完しない）
 */
export function resolveCareManager(
  customerName: string,
  customers: readonly { name: string; careManagerName?: string }[]
): string | null {
  const matched = customers.filter(c => c.name === customerName)
  if (matched.length === 1 && matched[0]) {
    return matched[0].careManagerName ?? ''
  }
  return null
}
