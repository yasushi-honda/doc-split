/**
 * `scripts/execute-drive-export-repair.ts` 統合テスト(Firestore emulator)
 *
 * スコープ上の重要な制約: このスクリプトの`--execute`実行経路は`executeDriveExport()`
 * (`functions/src/drive/executeDriveExport.ts`)経由で実Drive API/Storage APIへ到達する。
 * このリポジトリにはDrive/Storage APIのFirestore emulator相当のモック基盤が無く、
 * (`classify-drive-export-drift.ts`と同様に)CLIスクリプトへDrive clientを注入する
 * テスト用の差し替え口も設けていない設計のため、**実際にDriveへ書き込むexecute経路
 * (pre-flightのmodifiedTime検知・claim成功後の成否判定・サーキットブレーカーの実動作・
 * manifestのintent/result行書き出し)はこの統合テストではカバーしない**。これらは
 * `~/.claude/plans/sharded-mapping-squid.md`の「実行順序」節に従い、devリハーサル
 * (`setup-drive-folder-fixture.ts --dev --repair-scenario`で投入したfixtureに対する
 * 実際の`--execute`実行)で実機検証する。
 *
 * 本テストがカバーする範囲: Firestore emulatorのみで検証可能な、書き込み前の全ゲート
 * (schemaVersion/projectId一致・D10 plan鮮度・D7 wouldRestoreFolders承認・
 * --expected-total/--expected-count・--limit・未知フラグ拒否)と、dry-runの対象抽出
 * ロジック(D3、`--dry-run`は一切Driveに触れないため安全に検証できる)。
 * dry-runモードは`getDriveClient()`を呼ばない設計(execute-drive-export-repair.ts本体
 * 参照)なので、STORAGE_BUCKETさえ設定すればFirestore emulatorのみで完結する。
 *
 * `scripts/backfill-drive-export.integration.test.ts`と同型のsubprocess実行パターン
 * (`execFileSync`によるCLI起動)を踏襲する。
 *
 * 実行: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'
 */

import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as admin from 'firebase-admin';
import { DRIFT_PLAN_SCHEMA_VERSION } from './lib/driveExportRepairTargets';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'この統合テストはFirestore emulator経由でのみ実行してください: firebase emulators:exec --only firestore \'cd scripts && npm run test:integration\''
  );
}

const PROJECT_ID = 'execute-drive-export-repair-integration-test';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const SCRIPT_PATH = path.join(__dirname, 'execute-drive-export-repair.ts');
let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'execute-drive-export-repair-test-'));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const snap = await db.collection('documents').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

function basePlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: DRIFT_PLAN_SCHEMA_VERSION,
    planId: 'plan-1',
    projectId: PROJECT_ID,
    generatedAt: new Date().toISOString(),
    scope: { careManager: null, limit: null, storageChecked: true },
    driveSettings: { rootFolderId: 'root-1', template: [], furiganaFallback: null },
    summary: {},
    byCareManager: [],
    wouldRestoreFolders: [],
    targets: [],
    blocked: [],
    ...overrides,
  };
}

function targetEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    docId: 'doc-1',
    careManager: '森 奈穂美',
    customerName: '利用者A',
    category: 'trashed',
    oldDriveFileId: 'f1',
    oldParents: undefined,
    oldFileTrashed: true,
    expectedLeafFolderId: 'leaf-1',
    expectedPathStatus: 'resolved',
    storageObjectExists: true,
    ...overrides,
  };
}

function writePlan(planObj: unknown): string {
  const p = path.join(tmpDir, `plan-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(planObj));
  return p;
}

interface RunResult {
  stdout: string;
  status: number;
}

function runScript(args: string[], opts: { expectNonZeroExit?: boolean } = {}): RunResult {
  try {
    const stdout = execFileSync('npx', ['ts-node', SCRIPT_PATH, ...args], {
      cwd: __dirname,
      env: { ...process.env, FIREBASE_PROJECT_ID: PROJECT_ID, STORAGE_BUCKET: `${PROJECT_ID}.appspot.com` },
      encoding: 'utf-8',
    });
    if (opts.expectNonZeroExit) {
      throw new Error(`終了コード0(成功)だったが非ゼロを期待していた。stdout:\n${stdout}`);
    }
    return { stdout, status: 0 };
  } catch (err) {
    if (opts.expectNonZeroExit) {
      const e = err as { status?: number; stdout?: Buffer | string };
      return { stdout: e.stdout?.toString() ?? '', status: e.status ?? 1 };
    }
    throw err;
  }
}

test('STORAGE_BUCKET未設定はfail-fastでexit 1(dry-runでも要求する)', () => {
  const planPath = writePlan(basePlan());
  const result = (() => {
    try {
      const stdout = execFileSync('npx', ['ts-node', SCRIPT_PATH, '--plan', planPath], {
        cwd: __dirname,
        env: { ...process.env, FIREBASE_PROJECT_ID: PROJECT_ID, STORAGE_BUCKET: '' },
        encoding: 'utf-8',
      });
      return { stdout, status: 0 };
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer | string };
      return { stdout: e.stdout?.toString() ?? '', status: e.status ?? 1 };
    }
  })();
  assert.notEqual(result.status, 0);
});

test('未知の引数はfail-closedで拒否される', () => {
  const planPath = writePlan(basePlan());
  const result = runScript(['--plan', planPath, '--typo-flag'], { expectNonZeroExit: true });
  assert.notEqual(result.status, 0);
});

test('存在しないplanファイルを指定するとexit 1', () => {
  const result = runScript(['--plan', path.join(tmpDir, 'does-not-exist.json')], { expectNonZeroExit: true });
  assert.notEqual(result.status, 0);
});

test('schemaVersion不一致はexit 1', () => {
  const planPath = writePlan(basePlan({ schemaVersion: 'other-version' }));
  const result = runScript(['--plan', planPath], { expectNonZeroExit: true });
  assert.notEqual(result.status, 0);
});

test('projectId不一致はexit 1(誤ったplanの誤適用防止、fail-closed)', () => {
  const planPath = writePlan(basePlan({ projectId: 'some-other-project' }));
  const result = runScript(['--plan', planPath], { expectNonZeroExit: true });
  assert.notEqual(result.status, 0);
});

test('D10: plan鮮度超過は--executeモードでexit 1、--allow-stale-planで突破できる', () => {
  const oldGeneratedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const planPath = writePlan(basePlan({ generatedAt: oldGeneratedAt }));

  const blocked = runScript(['--plan', planPath, '--execute', '--max-plan-age-hours', '24'], {
    expectNonZeroExit: true,
  });
  assert.notEqual(blocked.status, 0);

  const allowed = runScript([
    '--plan',
    planPath,
    '--execute',
    '--max-plan-age-hours',
    '24',
    '--allow-stale-plan',
    '--expected-total',
    '0',
    '--manifest-out',
    path.join(tmpDir, 'manifest-d10.json'),
  ]);
  assert.equal(allowed.status, 0, 'stdout: ' + allowed.stdout);
});

test('D10: dry-runモードでは鮮度ゲートを適用しない(dry-runは書込みが無いため確認目的の閲覧は許容)', () => {
  const oldGeneratedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const planPath = writePlan(basePlan({ generatedAt: oldGeneratedAt }));
  const result = runScript(['--plan', planPath, '--max-plan-age-hours', '24']);
  assert.equal(result.status, 0);
});

test('D7: wouldRestoreFolders非空かつ--executeで--acknowledge-restore-folders未指定はexit 1', () => {
  const planPath = writePlan(
    basePlan({ wouldRestoreFolders: [{ folderId: 'f1', name: '森奈穂美', parentId: 'p1', affectedDocCount: 3 }] })
  );
  const result = runScript(['--plan', planPath, '--execute', '--expected-total', '0'], { expectNonZeroExit: true });
  assert.notEqual(result.status, 0);
});

test('D7: --acknowledge-restore-foldersを指定すれば通過する', () => {
  const planPath = writePlan(
    basePlan({ wouldRestoreFolders: [{ folderId: 'f1', name: '森奈穂美', parentId: 'p1', affectedDocCount: 3 }] })
  );
  const result = runScript([
    '--plan',
    planPath,
    '--execute',
    '--acknowledge-restore-folders',
    '--expected-total',
    '0',
    '--manifest-out',
    path.join(tmpDir, 'manifest-d7.json'),
  ]);
  assert.equal(result.status, 0, 'stdout: ' + result.stdout);
});

test('D7: dry-runモードは--acknowledge-restore-folders無しでも通過する(書込みが無いため)', () => {
  const planPath = writePlan(
    basePlan({ wouldRestoreFolders: [{ folderId: 'f1', name: '森奈穂美', parentId: 'p1', affectedDocCount: 3 }] })
  );
  const result = runScript(['--plan', planPath]);
  assert.equal(result.status, 0);
});

test('D3対象抽出: dry-runの出力にhealthy以外のtargets(trashed/misplaced)とblocked[target-path-not-created]のみが候補として現れる', () => {
  const planPath = writePlan(
    basePlan({
      targets: [
        targetEntry({ docId: 'd-healthy', category: 'healthy' }),
        targetEntry({ docId: 'd-trashed', category: 'trashed' }),
        targetEntry({ docId: 'd-misplaced', category: 'misplaced' }),
        targetEntry({ docId: 'd-ambiguous', expectedPathStatus: 'unresolved-ambiguous' }),
        targetEntry({ docId: 'd-storage-false', storageObjectExists: false }),
        targetEntry({ docId: 'd-storage-null', storageObjectExists: null }),
      ],
      blocked: [
        { docId: 'd-blocked-target', careManager: '森 奈穂美', reason: 'target-path-not-created' },
        { docId: 'd-blocked-other', careManager: '森 奈穂美', reason: 'ambiguous-path' },
      ],
    })
  );
  const result = runScript(['--plan', planPath]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /候補件数\(絞り込み前\): 3件/);
  assert.match(result.stdout, /d-trashed/);
  assert.match(result.stdout, /d-misplaced/);
  assert.match(result.stdout, /d-blocked-target/);
  assert.doesNotMatch(result.stdout, /d-healthy/);
  assert.doesNotMatch(result.stdout, /d-ambiguous/);
  assert.doesNotMatch(result.stdout, /d-storage-false/);
  assert.doesNotMatch(result.stdout, /d-storage-null/);
  assert.doesNotMatch(result.stdout, /d-blocked-other/);
});

test('--expected-total不一致はexit 1(母数の取り違え検知、H5)', () => {
  const planPath = writePlan({ ...basePlan(), targets: [targetEntry({ docId: 'd1' })] });
  const result = runScript(['--plan', planPath, '--expected-total', '99'], { expectNonZeroExit: true });
  assert.notEqual(result.status, 0);
});

test('--expected-count不一致(limit適用後)はexit 1', () => {
  const planPath = writePlan({
    ...basePlan(),
    targets: [targetEntry({ docId: 'd1' }), targetEntry({ docId: 'd2' })],
  });
  const result = runScript(['--plan', planPath, '--limit', '1', '--expected-count', '2'], {
    expectNonZeroExit: true,
  });
  assert.notEqual(result.status, 0);
});

test('--limitは候補件数を先頭N件に制限する(dry-run出力で確認)', () => {
  const planPath = writePlan({
    ...basePlan(),
    targets: [targetEntry({ docId: 'd1' }), targetEntry({ docId: 'd2' }), targetEntry({ docId: 'd3' })],
  });
  const result = runScript(['--plan', planPath, '--limit', '2', '--expected-count', '2']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /実行対象候補件数\(limit適用後\): 2件/);
});

test('dry-runはFirestoreへ一切書き込みを発生させない(D3対象がFirestoreに実在していても)', async () => {
  await db.doc('documents/d1').set({ driveExportStatus: 'exported', driveFileId: 'f1' });
  const planPath = writePlan({ ...basePlan(), targets: [targetEntry({ docId: 'd1' })] });

  runScript(['--plan', planPath]);

  const after = await db.doc('documents/d1').get();
  assert.equal(after.data()?.driveExportStatus, 'exported', 'dry-runではdriveExportStatusが変化しないこと(execute実行への遷移が発生しない)');
});
