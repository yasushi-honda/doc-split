/**
 * displayFileName backfill の差分判定 (#358)
 *
 * scripts と functions の両方から参照されるため shared/ に配置。
 * Firestore / Admin SDK 非依存の純粋関数。
 */

/**
 * backfill 差分判定の 3 状態:
 *   - 'noop':   旧値と新値が一致 (書き込み不要)
 *   - 'set':    旧値が未設定 (新規 SET、--force なしでも実施)
 *   - 'change': 旧値あり かつ 新値と不一致 (--force で shared サニタイズ等により書き換わるケース)
 *
 * `'change'` は operator が書き換え前後の値を把握する必要があるため、scripts/backfill-display-filename.ts
 * で CHANGE ログを出し、ローカル `totalChanged` カウンタを経由して `_migrations.display_filename_backfill.changedCount`
 * Firestore ドキュメントに永続化する (silent 書き換え防止)。
 */
export type DisplayFileNameChange = 'noop' | 'set' | 'change';

/**
 * backfill 時の oldDisplayFileName と新生成 displayFileName を比較し、
 * 書き込みアクション種別を返す純粋関数。
 *
 * inline 判定 (Boolean(old) && old !== new) はカウンタ漏れ・状態分岐誤りの silent bug 温床。
 * 純粋関数 + test lock-in で drift を防ぐ。
 *
 * @param oldDisplayFileName Firestore ドキュメントの既存 displayFileName。未設定時は
 *                           null/undefined/空文字が渡る可能性 (すべて `'set'` に分類)。
 * @param newDisplayFileName 新たに生成された displayFileName。**非空文字列** (callsite で
 *                           `generateDisplayFileName` の null 返しは事前に skip 済み前提)。
 *                           空文字が渡ると `oldDisplayFileName === ''` ケースで誤って 'noop' と
 *                           判定されるが、実運用パスでは到達不能。
 * @returns 'set' | 'change' | 'noop'
 */
export function detectDisplayFileNameChange(
  oldDisplayFileName: string | null | undefined,
  newDisplayFileName: string
): DisplayFileNameChange {
  if (!oldDisplayFileName) return 'set';
  if (oldDisplayFileName === newDisplayFileName) return 'noop';
  return 'change';
}
