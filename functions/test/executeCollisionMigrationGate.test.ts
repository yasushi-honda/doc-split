/**
 * Issue #432 PR-C2: execute-collision-migration.ts の AC13 gate
 * (hashAlgorithm + pdfLibVersion) を subprocess 経由で検証する。
 *
 * pr-test-analyzer (PR #441 review) Critical C2 反映:
 *   AC13 gate は本 migration の silent-breakage 防止の最重要 gate (PR-C1 plan を新
 *   コードで黙って実行する / pdf-lib upgrade 後に古い plan を実行する を防ぐ)。
 *   gate ロジック自体を unit test しないと、エンジニアリング変更で gate が壊れたとき
 *   CI が検知できない。
 *
 * 検証戦略:
 *   - 一時 plan.json を作って `npx ts-node scripts/execute-collision-migration.ts ...`
 *     を spawnSync で起動する
 *   - `process.exit(2)` (gate reject) になるパターン:
 *     - hashAlgorithm undefined (PR-C1 plan)
 *     - hashAlgorithm が無効
 *     - pdfLibVersion 不一致
 *   - `process.exit(2)` 以外になるパターンは現状 setup なしでは到達しないので skip
 *
 * 注意: ts-node 起動コストが大きいので test 数を絞り timeout を 20s に設定。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { PDFDocument } from 'pdf-lib';

// pdf-lib version を runtime で取得。ESM mode の test loader でも動作させるため、
// __dirname / require / package.json import attribute すべて使わず、pdf-lib の
// PDFDocument prototype 由来情報や、相対パス無しで cwd ベースの fs アクセスを行う。
// (cwd は mocha 起動 dir = functions/、よって 1 階層上の node_modules を見る)
function readPdfLibVersion(): string {
  const candidates = [
    'node_modules/pdf-lib/package.json',
    '../node_modules/pdf-lib/package.json',
  ];
  for (const rel of candidates) {
    try {
      const json = JSON.parse(fs.readFileSync(rel, 'utf-8')) as {
        version: string;
      };
      return json.version;
    } catch {
      // try next
    }
  }
  throw new Error('pdf-lib/package.json not found via cwd-relative paths');
}
const pdfLibVersion: string = readPdfLibVersion();
// PDFDocument を 1 度参照することで pdf-lib resolve 失敗時の early failure を担保
void PDFDocument;

// __dirname を回避 (mocha + ts-node が ESM mode で動くケース対策)。
// cwd は mocha 起動 dir (= functions/)、よって project root は ../ 相対。
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  'scripts/execute-collision-migration.ts'
);

interface PlanFixture {
  planId: string;
  createdAt: string;
  environment: string;
  projectId: string;
  bucket: string;
  prefix: string;
  hashAlgorithm?: string;
  pdfLibVersion?: string;
  summary: Record<string, unknown>;
  operations: unknown[];
}

function makePlan(overrides: Partial<PlanFixture> = {}): PlanFixture {
  return {
    planId: 'plan-test-' + crypto.randomBytes(2).toString('hex'),
    createdAt: '2026-05-12T00:00:00.000Z',
    environment: 'test',
    projectId: 'test-project',
    bucket: 'test-bucket',
    prefix: 'processed/',
    // PR-C3b: HASH_ALGORITHM が v2 に bump されたため、現行コード合致 plan を v2 で発行。
    // 旧 v1 plan の reject は別 test ('pdf-page-visual-v0-FAKE' literal) で検証する。
    hashAlgorithm: 'pdf-page-visual-v2',
    pdfLibVersion,
    summary: {},
    operations: [],
    ...overrides,
  };
}

function makeApproval(planId: string): Record<string, unknown> {
  return {
    planId,
    approvedOperationIds: [],
    approvedPaths: [],
  };
}

function writeTmpJson(obj: unknown, label: string): string {
  const p = path.join(
    os.tmpdir(),
    `gate-${label}-${crypto.randomBytes(4).toString('hex')}.json`
  );
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

interface GateResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * execute-collision-migration.ts を ts-node 経由で spawnSync 実行し、
 * gate の reject (exit 2) または通過 (それ以外) を判定する。
 */
function runExecuteScript(
  plan: PlanFixture,
  envOverride: { projectId?: string; bucket?: string } = {}
): GateResult {
  const planPath = writeTmpJson(plan, 'plan');
  const approvalPath = writeTmpJson(makeApproval(plan.planId), 'approval');
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--require',
        'ts-node/register',
        SCRIPT_PATH,
        '--plan',
        planPath,
        '--approval',
        approvalPath,
      ],
      {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          // 既定では plan と一致させ、特定 gate を検証するときだけ envOverride で
          // 意図的に不一致を作る
          FIREBASE_PROJECT_ID: envOverride.projectId ?? plan.projectId,
          STORAGE_BUCKET: envOverride.bucket ?? plan.bucket,
          // 子 ts-node に scripts/tsconfig.json を使わせる
          // (resolveJsonModule: true が必要 for pdf-lib/package.json import)
          TS_NODE_PROJECT: path.join(PROJECT_ROOT, 'scripts/tsconfig.json'),
        },
      }
    );
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
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

describe('execute-collision-migration AC13 gate (Issue #432 PR-C2, pr-test-analyzer C2 反映)', function () {
  this.timeout(60000);

  it('Critical: plan.hashAlgorithm が undefined (PR-C1 旧 plan) → exit 2', () => {
    const plan = makePlan({ hashAlgorithm: undefined });
    const result = runExecuteScript(plan);
    expect(result.status).to.equal(2);
    expect(result.stderr).to.match(/plan\.hashAlgorithm.*missing|hashAlgorithm/);
  });

  it('Critical: plan.hashAlgorithm が現行 HASH_ALGORITHM と不一致 (架空 v0-FAKE) → exit 2', () => {
    const plan = makePlan({ hashAlgorithm: 'pdf-page-visual-v0-FAKE' });
    const result = runExecuteScript(plan);
    expect(result.status).to.equal(2);
    expect(result.stderr).to.contain('hashAlgorithm');
  });

  it('Critical: plan.hashAlgorithm が "pdf-page-visual-v1" (旧 v1 plan) → exit 2', () => {
    // silent-failure-hunter MEDIUM-3 反映: PR-C3b で HASH_ALGORITHM を v2 に bump した後、
    // session60/61 で生成済の v1 plan が execute 経路に流れた場合に reject されること
    // を実際の v1 literal で assert する。架空 v0-FAKE では「v1 が migration tolerance
    // で silently 通る」回帰を検知できない。
    const plan = makePlan({ hashAlgorithm: 'pdf-page-visual-v1' });
    const result = runExecuteScript(plan);
    expect(result.status).to.equal(2);
    expect(result.stderr).to.contain('hashAlgorithm');
  });

  it('Critical: plan.pdfLibVersion が undefined → exit 2', () => {
    const plan = makePlan({ pdfLibVersion: undefined });
    const result = runExecuteScript(plan);
    expect(result.status).to.equal(2);
    expect(result.stderr).to.contain('pdfLibVersion');
  });

  it('Critical: plan.pdfLibVersion が runtime version と不一致 → exit 2', () => {
    const plan = makePlan({ pdfLibVersion: '0.0.0-FAKE' });
    const result = runExecuteScript(plan);
    expect(result.status).to.equal(2);
    expect(result.stderr).to.contain('pdfLibVersion');
  });

  it('Important: plan.projectId が runtime FIREBASE_PROJECT_ID と不一致 → exit 2 (Gate 4)', () => {
    const plan = makePlan(); // plan.projectId = 'test-project'
    // env を意図的に別 project に設定 (本番取り違え再現)
    const result = runExecuteScript(plan, { projectId: 'wrong-runtime-project' });
    expect(result.status).to.equal(2);
    expect(result.stderr).to.contain('plan.projectId');
  });
});
