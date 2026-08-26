/**
 * Issue #811 Phase B: execute-drive-folder-merge.ts のトップレベルgate
 * (schemaVersion / Gate1 planId / Gate4-env projectId / driveApiVersionGate) を
 * subprocess経由で検証する。`functions/test/executeCollisionMigrationGate.test.ts`
 * (Issue #432、実装済み)と同じ構成方針。
 *
 * これらのgateはFirebase Admin初期化・Drive API呼び出しより前に評価されるため、
 * 実クレデンシャルなしでspawnSyncのexit codeのみで検証できる。
 *
 * 4回の独立診断(codex)がPDF/Storage版に指摘していた「schemaVersion不一致・
 * precondition driftのunit testが存在しない」という穴を埋める狙いも兼ねる
 * (precondition driftのpure function自体は folderMergePlanTypesV1.test.ts で
 * カバー、本ファイルはtop-level gateのsubprocess exit code検証を担当)。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { readDriveApiVersionSnapshot } from '../../scripts/lib/driveApiVersionGate';
import { FOLDER_MERGE_PLAN_SCHEMA_VERSION } from '../../scripts/lib/folderMergePlanTypes';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const SCRIPT_PATH = path.join(PROJECT_ROOT, 'scripts/execute-drive-folder-merge.ts');

interface PlanFixture {
  schemaVersion?: string;
  planId: string;
  createdAt: string;
  environment: string;
  projectId: string;
  googleapisLockfileVersion?: string;
  lockfileHash?: string;
  canonicalFolderId: string;
  duplicateFolderIds: string[];
  canonicalProvenance: Record<string, unknown>;
  sourceFolderProvenance: unknown[];
  summary: Record<string, unknown>;
  operations: unknown[];
}

const runtimeDriveApiVersion = readDriveApiVersionSnapshot(PROJECT_ROOT);

function makePlan(overrides: Partial<PlanFixture> = {}): PlanFixture {
  return {
    schemaVersion: FOLDER_MERGE_PLAN_SCHEMA_VERSION,
    planId: 'plan-test-' + crypto.randomBytes(2).toString('hex'),
    createdAt: '2026-08-26T00:00:00.000Z',
    environment: 'test-project',
    projectId: 'test-project',
    googleapisLockfileVersion: runtimeDriveApiVersion.googleapisLockfileVersion,
    lockfileHash: runtimeDriveApiVersion.lockfileHash,
    canonicalFolderId: 'canonical-1',
    duplicateFolderIds: ['dup-1'],
    canonicalProvenance: { id: 'canonical-1', name: 'test', parents: [], trashed: false, modifiedTime: '', childCountAtClassify: 0 },
    sourceFolderProvenance: [],
    summary: {},
    operations: [],
    ...overrides,
  };
}

function makeApproval(planId: string): Record<string, unknown> {
  return { planId, approvedOperationIds: [], approvedPaths: [] };
}

function writeTmpJson(obj: unknown, label: string): string {
  const p = path.join(os.tmpdir(), `folder-merge-gate-${label}-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

interface GateResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runExecuteScript(plan: PlanFixture, envOverride: { projectId?: string } = {}): GateResult {
  const planPath = writeTmpJson(plan, 'plan');
  const approvalPath = writeTmpJson(makeApproval(plan.planId), 'approval');
  try {
    const result = spawnSync(
      process.execPath,
      ['--require', 'ts-node/register', SCRIPT_PATH, '--plan', planPath, '--approval', approvalPath],
      {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          FIREBASE_PROJECT_ID: envOverride.projectId ?? plan.projectId,
          TS_NODE_PROJECT: path.join(PROJECT_ROOT, 'scripts/tsconfig.json'),
        },
      }
    );
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } finally {
    for (const p of [planPath, approvalPath]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

describe('execute-drive-folder-merge top-level gates (Issue #811 Phase B)', function () {
  this.timeout(60000);

  it('rejects plan.schemaVersion undefined (pre-v1 plan) → exit 2', () => {
    const plan = makePlan({ schemaVersion: undefined });
    const result = runExecuteScript(plan);
    expect(result.status).to.equal(2);
    expect(result.stderr).to.contain('schemaVersion');
  });

  it('rejects plan.schemaVersion mismatch (架空 folder-merge-plan-v0-FAKE) → exit 2', () => {
    const plan = makePlan({ schemaVersion: 'folder-merge-plan-v0-FAKE' });
    const result = runExecuteScript(plan);
    expect(result.status).to.equal(2);
    expect(result.stderr).to.contain('schemaVersion');
  });

  it('rejects approval.planId mismatch (Gate 1) → exit 2', () => {
    const plan = makePlan();
    const planPath = writeTmpJson(plan, 'plan');
    const approvalPath = writeTmpJson(makeApproval('different-plan-id'), 'approval');
    try {
      const result = spawnSync(
        process.execPath,
        ['--require', 'ts-node/register', SCRIPT_PATH, '--plan', planPath, '--approval', approvalPath],
        {
          encoding: 'utf-8',
          timeout: 30000,
          cwd: PROJECT_ROOT,
          env: {
            ...process.env,
            FIREBASE_PROJECT_ID: plan.projectId,
            TS_NODE_PROJECT: path.join(PROJECT_ROOT, 'scripts/tsconfig.json'),
          },
        }
      );
      expect(result.status).to.equal(2);
      expect(result.stderr).to.contain('planId');
    } finally {
      for (const p of [planPath, approvalPath]) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  });

  it('rejects plan.projectId mismatch against runtime FIREBASE_PROJECT_ID (Gate 4-env) → exit 2', () => {
    const plan = makePlan();
    const result = runExecuteScript(plan, { projectId: 'wrong-runtime-project' });
    expect(result.status).to.equal(2);
    expect(result.stderr).to.contain('plan.projectId');
  });

  it('rejects googleapisLockfileVersion mismatch (driveApiVersionGate) → exit 2', () => {
    const plan = makePlan({ googleapisLockfileVersion: '0.0.0-FAKE' });
    const result = runExecuteScript(plan);
    expect(result.status).to.equal(2);
    expect(result.stderr).to.contain('googleapisLockfileVersion');
  });

  it('rejects lockfileHash mismatch (driveApiVersionGate) → exit 2', () => {
    const plan = makePlan({ lockfileHash: '0'.repeat(64) });
    const result = runExecuteScript(plan);
    expect(result.status).to.equal(2);
    expect(result.stderr).to.contain('lockfileHash');
  });
});
