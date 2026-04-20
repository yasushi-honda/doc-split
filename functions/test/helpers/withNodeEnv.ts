/**
 * NODE_ENV を一時的に切り替えて fn を実行し、確実に復元する helper
 * (Issue #306, PR #305 review code-reviewer + codex Low follow-up)
 *
 * 問題:
 * 1. **undefined の文字列化**: 元値 `undefined` の場合 `process.env.NODE_ENV = original` は
 *    `"undefined"` 文字列を代入し、後続 test に leak する。完全復元には
 *    `delete process.env.NODE_ENV` が必要。
 * 2. **並列実行時の race**: Mocha `--parallel` 有効化時、NODE_ENV の toggle は test 間で
 *    interleave する危険あり。本 helper は process global を触るため `--parallel` 非対応。
 *    並列実行を採用する場合は helper 全体を module isolation で囲むか、env-specific
 *    assert を mock 注入に置き換える必要がある。
 */

/**
 * NODE_ENV を value に切替えて fn を同期実行し、finally で元値に復元する。
 *
 * `try/finally` で throw 経路も保護する。original が undefined の場合は `delete` で復元する。
 *
 * @param value - 一時的に設定する NODE_ENV 値 (`'production'` / `'test'` 等)
 * @param fn - 切替中に実行する処理 (戻り値はそのまま返す)
 */
export function withNodeEnv<T>(value: string, fn: () => T): T {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
}

/**
 * `withNodeEnv` の async 版。await 対応。
 */
export async function withNodeEnvAsync<T>(
  value: string,
  fn: () => Promise<T>,
): Promise<T> {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
}
