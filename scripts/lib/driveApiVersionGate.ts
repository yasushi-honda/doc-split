/**
 * Issue #811 Phase B: package-lock.json から googleapis の resolved version + lockfile
 * 全体hashを読み込むlib(`scripts/lib/lockfileGate.ts`のDrive版)。
 *
 * classify-drive-folder-duplicates.tsがPlan生成時に記録し、execute-drive-folder-merge.ts
 * が起動時に照合する。classify/execute間でgoogleapisのバージョンが変わっていた場合、
 * フォルダ走査・API呼び出しの挙動が変化しうるため、fail-closedで検知する。
 *
 * PDF版(lockfileGate.ts)のpdf-lib gateとの違い: Drive移動処理はpdf-lib版のような
 * バイト再現性の懸念(fingerprint計算結果の版数依存)を持たないため、Drive版は
 * googleapisのversion+lockfile全体hashのみで十分(pdfLibVersion相当の実行時import値
 * 照合は不要)。
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface PackageLockJson {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string }>;
}

export interface DriveApiVersionSnapshot {
  /** package-lock.json 全体のsha256 */
  lockfileHash: string;
  /** package-lock.json packages["node_modules/googleapis"].version */
  googleapisLockfileVersion: string;
}

function findLockfilePath(startDir: string): string {
  let cur = path.resolve(startDir);
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(cur, 'package-lock.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(
    `package-lock.json not found in ancestors of ${startDir} (drive API version gate cannot operate)`
  );
}

export function readDriveApiVersionSnapshot(
  fromDir: string = process.cwd()
): DriveApiVersionSnapshot {
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
      `package-lock.json missing 'packages' field at ${lockfilePath}. lockfile v1 is not supported (only v2/v3).`
    );
  }

  const googleapisEntry = parsed.packages['node_modules/googleapis'];
  if (
    !googleapisEntry ||
    typeof googleapisEntry.version !== 'string' ||
    googleapisEntry.version.length === 0
  ) {
    throw new Error(
      `package-lock.json missing 'packages["node_modules/googleapis"].version' at ${lockfilePath} (googleapis not installed?)`
    );
  }

  return {
    lockfileHash,
    googleapisLockfileVersion: googleapisEntry.version,
  };
}

export function verifyDriveApiVersionMatch(
  planRecord: DriveApiVersionSnapshot,
  runtimeRecord: DriveApiVersionSnapshot
): { ok: true } | { ok: false; reason: string } {
  if (planRecord.lockfileHash !== runtimeRecord.lockfileHash) {
    return {
      ok: false,
      reason: `lockfileHash mismatch (plan=${planRecord.lockfileHash.slice(0, 16)}..., runtime=${runtimeRecord.lockfileHash.slice(0, 16)}...), re-run classify after dependency sync`,
    };
  }
  if (planRecord.googleapisLockfileVersion !== runtimeRecord.googleapisLockfileVersion) {
    return {
      ok: false,
      reason: `googleapisLockfileVersion mismatch (plan=${planRecord.googleapisLockfileVersion}, runtime=${runtimeRecord.googleapisLockfileVersion}), re-run classify after googleapis version sync`,
    };
  }
  return { ok: true };
}
