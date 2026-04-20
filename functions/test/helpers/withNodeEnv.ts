/**
 * NODE_ENV を一時的に切り替えて fn を実行し、確実に復元する helper
 * (Issue #306, PR #305 review code-reviewer + codex Low follow-up)
 *
 * 問題:
 * 1. **undefined の文字列化**: 元値 `undefined` の場合 `process.env.NODE_ENV = original` は
 *    `"undefined"` 文字列を代入し、後続 test に leak する。完全復元には
 *    `delete process.env.NODE_ENV` が必要。
 * 2. **並行実行時の race**: 同一プロセス内で別 test が NODE_ENV を参照/変更する場合、
 *    process global への代入が interleave する。本 helper は process.env を直接触るため
 *    同期/直列実行専用。Mocha `--parallel` は worker process を spawn するため本 helper は
 *    worker 内では安全だが、同一 worker の他 test と並行する構成 (非 Mocha runner 等) は非対応。
 */

/**
 * NODE_ENV として受け入れる literal 値 (Issue #315 提案 #3)。
 *
 * `(string & {})` escape hatch は敢えて採用せず strict union に留め、typo (`'prdouction'` 等) を
 * 型レベルで完全拒否する。新しい値が必要になった場合のみ本 union を拡張する。
 */
export type NodeEnvValue = 'production' | 'test' | 'development';

/**
 * NODE_ENV を value に切替えて fn を同期実行し、finally で元値に復元する。
 *
 * `try/finally` で throw 経路も保護する。original が undefined の場合は `delete` で復元する。
 *
 * @param value - 一時的に設定する NODE_ENV 値 (`NodeEnvValue`)
 * @param fn - 切替中に実行する処理 (戻り値はそのまま返す)
 */
export function withNodeEnv<T>(value: NodeEnvValue, fn: () => T): T {
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
  value: NodeEnvValue,
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
