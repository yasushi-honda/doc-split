/**
 * Issue #432 PR-C3c: package-lock.json hash + pdf-lib resolved version 読込 lib。
 *
 * AC-CC1 (Codex Critical 1 plan-side lockfile gate) の中核ロジック:
 *   - classify 側 (T1): plan 生成時に lockfileHash + pdfLibLockfileVersion を記録。
 *   - execute 側 (T2): runtime で同関数を呼び出し、plan 記録と一致しなければ
 *     `exit 2` (gate-rejected、AC-CC1-2)。
 *
 * Codex Q3 反映: destructive migration では package-lock.json 全体の sha256 が安全側。
 * 関係ない dep 更新で reject されるリスクはあるが、classify 再生成で回復可能 (5 分以内)。
 * 部分 subtree hash にすると pdf-lib 推移依存の peer 更新を見逃す silent failure リスク
 * があるため避ける。
 *
 * Codex Important I1 反映: `pdfLibLockfileVersion` は `package.json` の declared
 * version (例: `^1.17.1` や `1.17.1`) ではなく、`package-lock.json` の
 * `packages["node_modules/pdf-lib"].version` (= 実際にインストールされた resolved
 * version) を読む。lockfile からの読込は npm install 後の確定状態を反映するため。
 *
 * 旧 `pdfLibVersion` (PR-C2 AC13 拡張で import 値を使う) は runtime import 値の sanity
 * check として残し、本 lib の `pdfLibLockfileVersion` は別物として並存させる。
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * package-lock.json の packages map の最小型。npm v7+ で導入された lockfile v2/v3 では
 * `packages` フィールドが top-level に存在し、`""` (root) と `"node_modules/<name>"`
 * 形式の key で各 package の resolved metadata を持つ。
 *
 * 本 lib は packages フィールドの存在のみで lockfile v2/v3 両方を受け付ける (v1 のみ
 * reject)。npm v6 以前の lockfile v1 (top-level `dependencies` ネスト形式) はサポート外。
 */
interface PackageLockJson {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string }>;
}

/**
 * lockfile gate 用の snapshot。
 */
export interface LockfileSnapshot {
  /** package-lock.json 全体の sha256 (AC-CC1-1) */
  lockfileHash: string;
  /** package-lock.json packages["node_modules/pdf-lib"].version (Codex Important I1) */
  pdfLibLockfileVersion: string;
}

/**
 * project root を探索する (起点から package-lock.json を含む最初の ancestor)。
 *
 * scripts/ から呼ばれるケース: scripts は root の package-lock.json を使うため、
 * 起点ディレクトリから上に向かって探索する。
 *
 * 注意: monorepo workspace で root と child の lockfile が共存する場合、本関数は
 * 最初に見つかった package-lock.json を返す。本 PR では root の 1 つだけ前提。
 */
function findLockfilePath(startDir: string): string {
  let cur = path.resolve(startDir);
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(cur, 'package-lock.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break; // reached filesystem root
    cur = parent;
  }
  throw new Error(
    `package-lock.json not found in ancestors of ${startDir} (lockfile gate cannot operate)`
  );
}

/**
 * package-lock.json から lockfileHash + pdf-lib resolved version を計算する。
 *
 * @param fromDir - 探索起点ディレクトリ (省略時は `process.cwd()`)。scripts/ から呼ぶ
 *   場合は通常 root を直接渡すか、cwd 起点で OK (npm scripts は root cwd で起動するため)。
 * @returns LockfileSnapshot (lockfileHash + pdfLibLockfileVersion)
 * @throws Error - package-lock.json が見つからない / parse 失敗 / pdf-lib version が
 *   lockfile に存在しない (npm install 未実行 or pdf-lib 削除のサイン)
 */
export function readLockfileSnapshot(fromDir: string = process.cwd()): LockfileSnapshot {
  const lockfilePath = findLockfilePath(fromDir);

  const buffer = fs.readFileSync(lockfilePath);
  const lockfileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  let parsed: PackageLockJson;
  try {
    parsed = JSON.parse(buffer.toString('utf8')) as PackageLockJson;
  } catch (err) {
    throw new Error(
      `package-lock.json parse failed at ${lockfilePath}: ${(err as Error).message}`
    );
  }

  if (!parsed.packages || typeof parsed.packages !== 'object') {
    throw new Error(
      `package-lock.json missing 'packages' field at ${lockfilePath}. ` +
        `lockfile v1 is not supported (only v2/v3). ` +
        `Fix: delete package-lock.json + node_modules and re-run 'npm install' with npm v7+ installed.`
    );
  }

  const pdfLibEntry = parsed.packages['node_modules/pdf-lib'];
  if (!pdfLibEntry || typeof pdfLibEntry.version !== 'string' || pdfLibEntry.version.length === 0) {
    throw new Error(
      `package-lock.json missing 'packages["node_modules/pdf-lib"].version' at ${lockfilePath} (pdf-lib not installed?)`
    );
  }

  return {
    lockfileHash,
    pdfLibLockfileVersion: pdfLibEntry.version,
  };
}

/**
 * plan 記録と runtime snapshot を比較する pure function。
 *
 * @returns 両 field 一致なら `{ ok: true }`、いずれか不一致なら `{ ok: false, reason }`
 */
export function verifyLockfileMatch(
  planRecord: LockfileSnapshot,
  runtimeRecord: LockfileSnapshot
): { ok: true } | { ok: false; reason: string } {
  if (planRecord.lockfileHash !== runtimeRecord.lockfileHash) {
    return {
      ok: false,
      reason: `lockfileHash mismatch (plan=${planRecord.lockfileHash.slice(0, 16)}..., runtime=${runtimeRecord.lockfileHash.slice(0, 16)}...), re-run classify after dependency sync`,
    };
  }
  if (planRecord.pdfLibLockfileVersion !== runtimeRecord.pdfLibLockfileVersion) {
    return {
      ok: false,
      reason: `pdfLibLockfileVersion mismatch (plan=${planRecord.pdfLibLockfileVersion}, runtime=${runtimeRecord.pdfLibLockfileVersion}), re-run classify after pdf-lib version sync`,
    };
  }
  return { ok: true };
}
