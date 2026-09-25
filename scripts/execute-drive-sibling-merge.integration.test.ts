/**
 * `scripts/execute-drive-sibling-merge.ts` CLIゲートの統合テスト(Issue #1039恒久対応)
 *
 * `execute-drive-claim-resync.integration.test.ts`と同型の`execFileSync`サブプロセス
 * 起動パターンを踏襲する。対象は「実際にDrive APIへ到達する前に必ず通るfail-closed
 * ゲート」のみ(schemaVersion/planId一致/projectId一致/driveApiVersion一致)。
 * 本スクリプトにはapproval JSON形状の厳格バリデーションが無い(既存の欠落、
 * `/plan-crossreview`でスコープ外と確認済み)ためそのテストは対象外。
 * 実データ書込みパス自体は`executeSiblingMerge.integration.test.ts`(fake Drive注入)で
 * 別途検証済み。
 *
 * 実行: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'
 * (本ファイル自体はFirestoreへアクセスする前に全ゲートでexitするためemulator不要だが、
 * 他の統合テストと同じコマンドから実行される前提でヘッダーコメントの慣習に合わせる)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION } from './lib/siblingDuplicatePlanTypes';
import type { SiblingDuplicatePlan, SiblingDuplicateApproval } from './lib/siblingDuplicatePlanTypes';

const PROJECT_ID = 'execute-drive-sibling-merge-cli-test';
const SCRIPT_PATH = path.join(__dirname, 'execute-drive-sibling-merge.ts');

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'execute-drive-sibling-merge-test-'));
}

function writeJson(dir: string, name: string, value: unknown): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(value));
  return p;
}

function validPlan(overrides: Partial<SiblingDuplicatePlan> = {}): SiblingDuplicatePlan {
  return {
    schemaVersion: SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION,
    planId: 'plan-1',
    createdAt: new Date().toISOString(),
    environment: PROJECT_ID,
    projectId: PROJECT_ID,
    rootFolderId: 'root',
    googleapisLockfileVersion: 'will-be-overridden',
    lockfileHash: 'will-be-overridden',
    summary: { scannedFolderCount: 0, groupCount: 0, byAction: { merge: 0, 'manual-review': 0 } },
    groups: [],
    ...overrides,
  };
}

function validApproval(overrides: Partial<SiblingDuplicateApproval> = {}): SiblingDuplicateApproval {
  return { planId: 'plan-1', approvedGroupIds: [], ...overrides };
}

function runScript(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync('npx', ['ts-node', SCRIPT_PATH, ...args], {
      cwd: __dirname,
      env: { ...process.env, FIREBASE_PROJECT_ID: PROJECT_ID },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '', status: e.status ?? 1 };
  }
}

test('--plan と --approval が無ければexit 1', () => {
  const result = runScript([]);
  assert.equal(result.status, 1);
});

test('plan.schemaVersionが不一致の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan({ schemaVersion: 'other-version' as never }));
  const approvalPath = writeJson(dir, 'approval.json', validApproval());
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /schemaVersion不一致/);
});

test('approval.planIdとplan.planIdが不一致の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan({ planId: 'plan-1' }));
  const approvalPath = writeJson(dir, 'approval.json', validApproval({ planId: 'plan-2' }));
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /approval\.planId.*plan\.planId.*一致しません/);
});

test('plan.projectIdとFIREBASE_PROJECT_IDが不一致の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan({ projectId: 'some-other-project' }));
  const approvalPath = writeJson(dir, 'approval.json', validApproval());
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /plan\.projectId.*FIREBASE_PROJECT_ID/);
});

test('plan.googleapisLockfileVersion/lockfileHashが実行時のgoogleapisバージョンと不一致の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(
    dir,
    'plan.json',
    validPlan({ lockfileHash: 'deadbeef'.repeat(8), googleapisLockfileVersion: '0.0.0-does-not-exist' })
  );
  const approvalPath = writeJson(dir, 'approval.json', validApproval());
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /googleapisLockfileVersion mismatch|lockfileHash mismatch/);
});
