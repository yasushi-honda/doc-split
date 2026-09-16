/**
 * `scripts/execute-drive-claim-resync.ts` CLIゲートの統合テスト(Issue #871 恒久対応)
 *
 * `backfill-drive-folder-claim-ttl.integration.test.ts`/`execute-drive-export-repair.
 * integration.test.ts`と同型の`execFileSync`サブプロセス起動パターンを踏襲する。
 *
 * pr-review-toolkit:pr-test-analyzerレビュー指摘対応: 本スクリプトにはCLIレベルの
 * テストが一切存在しなかった(兄弟スクリプトは全て同種のfail-closedゲートをテスト済み)。
 *
 * 対象は「実際にDrive APIへ到達する前に必ず通るfail-closedゲート」のみ(schemaVersion/
 * approval形状検証/planId一致/projectId一致/driveApiVersion一致/--dry-run+--execute
 * 排他)。`execute-drive-export-repair.ts`と異なり本スクリプトは`main()`冒頭で
 * dry-run/executeの区別なく無条件に`getDriveClient()`を呼ぶ設計(TOCTOU再確認のため
 * dry-runでも常にDrive実体を読む必要がある)のため、これらのゲートを1つでも通過すると
 * 実際のGoogle Drive認証情報が必要になる。実データ書込みパス自体は
 * `executeDivergenceResync.integration.test.ts`(fake Drive注入)で別途検証済み。
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
import { DIVERGENCE_PLAN_SCHEMA_VERSION } from './lib/divergenceResolutionPlan';
import type { DivergencePlan, DivergenceApproval } from './lib/divergenceResolutionPlan';

const PROJECT_ID = 'execute-drive-claim-resync-cli-test';
const SCRIPT_PATH = path.join(__dirname, 'execute-drive-claim-resync.ts');

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'execute-drive-claim-resync-test-'));
}

function writeJson(dir: string, name: string, value: unknown): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(value));
  return p;
}

function validPlan(overrides: Partial<DivergencePlan> = {}): DivergencePlan {
  return {
    schemaVersion: DIVERGENCE_PLAN_SCHEMA_VERSION,
    planId: 'plan-1',
    createdAt: new Date().toISOString(),
    environment: PROJECT_ID,
    projectId: PROJECT_ID,
    driveApiVersion: { lockfileHash: 'will-be-overridden', googleapisLockfileVersion: 'will-be-overridden' },
    summary: { totalDivergent: 0, autoResolvable: 0, blocked: 0 },
    operations: [],
    ...overrides,
  };
}

function validApproval(overrides: Partial<DivergenceApproval> = {}): DivergenceApproval {
  return { planId: 'plan-1', approvedOperations: {}, ...overrides };
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

test('--dry-run と --execute の同時指定はexit 1', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan());
  const approvalPath = writeJson(dir, 'approval.json', validApproval());
  const result = runScript(['--plan', planPath, '--approval', approvalPath, '--dry-run', '--execute']);
  assert.equal(result.status, 1);
});

test('approval JSONがオブジェクトでない場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan());
  const approvalPath = writeJson(dir, 'approval.json', '"not-an-object"');
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /approval JSONの検証に失敗しました/);
});

test('approval.planIdが空文字の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan());
  const approvalPath = writeJson(dir, 'approval.json', validApproval({ planId: '' }));
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /planIdは非空文字列/);
});

test('approvedOperationsが配列の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan());
  const approvalPath = writeJson(dir, 'approval.json', {
    planId: 'plan-1',
    approvedOperations: ['op-0001'],
  });
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /approvedOperationsはオブジェクト/);
});

test('approvedOperations[].modeが未知の文字列の場合はexit 2(fall-through防止のCLI側ガード)', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan());
  const approvalPath = writeJson(dir, 'approval.json', {
    planId: 'plan-1',
    approvedOperations: { 'op-0001': { mode: 'typo-mode' } },
  });
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /modeが不正です/);
});

test('approvedOperations[].acknowledgedStrandedFilesが負数の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan());
  const approvalPath = writeJson(dir, 'approval.json', {
    planId: 'plan-1',
    approvedOperations: { 'op-0001': { mode: 'release-claim', acknowledgedStrandedFiles: -1 } },
  });
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /acknowledgedStrandedFilesは0以上の整数/);
});

test('approvedOperations[].acknowledgedStrandedFilesが小数の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan());
  const approvalPath = writeJson(dir, 'approval.json', {
    planId: 'plan-1',
    approvedOperations: { 'op-0001': { mode: 'release-claim', acknowledgedStrandedFiles: 1.5 } },
  });
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /acknowledgedStrandedFilesは0以上の整数/);
});

test('plan.schemaVersionが不一致の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan({ schemaVersion: 'other-version' as never }));
  const approvalPath = writeJson(dir, 'approval.json', validApproval());
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unsupported plan schemaVersion/);
});

test('approval.planIdとplan.planIdが不一致の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan({ planId: 'plan-1' }));
  const approvalPath = writeJson(dir, 'approval.json', validApproval({ planId: 'plan-2' }));
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /approval\.planId.*!==.*plan\.planId/);
});

test('plan.projectIdとFIREBASE_PROJECT_IDが不一致の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(dir, 'plan.json', validPlan({ projectId: 'some-other-project' }));
  const approvalPath = writeJson(dir, 'approval.json', validApproval());
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /plan\.projectId.*!==.*FIREBASE_PROJECT_ID/);
});

test('plan.driveApiVersionが実行時のgoogleapisバージョンと不一致の場合はexit 2', () => {
  const dir = makeTmpDir();
  const planPath = writeJson(
    dir,
    'plan.json',
    validPlan({ driveApiVersion: { lockfileHash: 'deadbeef'.repeat(8), googleapisLockfileVersion: '0.0.0-does-not-exist' } })
  );
  const approvalPath = writeJson(dir, 'approval.json', validApproval());
  const result = runScript(['--plan', planPath, '--approval', approvalPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /googleapisLockfileVersion mismatch|lockfileHash mismatch/);
});
