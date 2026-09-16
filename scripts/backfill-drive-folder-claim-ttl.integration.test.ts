/**
 * `scripts/backfill-drive-folder-claim-ttl.ts` 統合テスト(Firestore emulator、Issue #871 恒久対応)
 *
 * `backfill-drive-export.integration.test.ts`と同型のパターン(CLIエントリポイントを
 * `execFileSync`でサブプロセス起動して検証)を踏襲する。
 *
 * 実行: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'
 */

import assert from 'node:assert/strict';
import { test, before, beforeEach } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as admin from 'firebase-admin';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'この統合テストはFirestore emulator経由でのみ実行してください: firebase emulators:exec --only firestore \'cd scripts && npm run test:integration\''
  );
}

const PROJECT_ID = 'backfill-drive-folder-claim-ttl-integration-test';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const SCRIPT_PATH = path.join(__dirname, 'backfill-drive-folder-claim-ttl.ts');

before(() => {
  // no-op: 各testはbeforeEachでcollectionをクリーンにする
});

beforeEach(async () => {
  const snap = await db.collection('driveFolderLocks').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

function runScript(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('npx', ['ts-node', SCRIPT_PATH, ...args], {
      cwd: __dirname,
      env: { ...process.env, FIREBASE_PROJECT_ID: PROJECT_ID },
      encoding: 'utf-8',
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string };
    return { stdout: e.stdout?.toString() ?? '', status: e.status ?? 1 };
  }
}

async function getClaim(docId: string): Promise<Record<string, unknown>> {
  const snap = await db.doc(`driveFolderLocks/${docId}`).get();
  assert.ok(snap.exists, `${docId} が存在すること`);
  return snap.data()!;
}

test('dry-run(既定): expireAtを持つdivergent claimを検出するが書込みは行わない', async () => {
  await db.doc('driveFolderLocks/claim-a').set({
    state: 'divergent',
    folderId: 'folder-a',
    attempt: null,
    divergentReason: 'parents-mismatch',
    parentId: 'parent-a',
    name: '対象太郎',
    expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 1000),
  });

  const result = runScript([]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /expireAtを持つもの1件/);
  assert.match(result.stdout, /DRY-RUN/);
  const after = await getClaim('claim-a');
  assert.notEqual(after.expireAt, undefined, 'dry-runでは書込みが行われないこと');
});

test('--execute: expireAtを持つdivergent claimのexpireAtのみ削除し、他フィールドは不変', async () => {
  await db.doc('driveFolderLocks/claim-b').set({
    state: 'divergent',
    folderId: 'folder-b',
    attempt: null,
    divergentReason: 'name-mismatch',
    divergentAtMs: 123,
    parentId: 'parent-b',
    name: '対象花子',
    expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 1000),
  });

  const result = runScript(['--execute']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /migrated=1 skippedDrift=0/);
  assert.match(result.stdout, /検証OK/);
  const after = await getClaim('claim-b');
  assert.equal(after.expireAt, undefined);
  assert.equal(after.state, 'divergent');
  assert.equal(after.folderId, 'folder-b');
  assert.equal(after.divergentReason, 'name-mismatch');
  assert.equal(after.divergentAtMs, 123);
  assert.equal(after.parentId, 'parent-b');
  assert.equal(after.name, '対象花子');
});

test('--execute: expireAtを持たないdivergent claim・resolved claimは対象外', async () => {
  await db.doc('driveFolderLocks/claim-c').set({
    state: 'divergent',
    folderId: 'folder-c',
    attempt: null,
    divergentReason: 'parents-mismatch',
    parentId: 'parent-c',
    name: '対象済み次郎',
  });
  await db.doc('driveFolderLocks/claim-d').set({
    state: 'resolved',
    folderId: 'folder-d',
    attempt: null,
    parentId: 'parent-d',
    name: '無関係三郎',
    expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 1000),
  });

  const result = runScript(['--execute']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /expireAtを持つもの0件/);
  assert.match(result.stdout, /migrated=0 skippedDrift=0/);
  const resolvedAfter = await getClaim('claim-d');
  assert.notEqual(resolvedAfter.expireAt, undefined, 'resolved claimのexpireAtには触れない');
});

test('--dry-run と --execute の同時指定はエラー終了する', () => {
  const result = runScript(['--dry-run', '--execute']);
  assert.equal(result.status, 1);
});

test('未知の引数はエラー終了する', () => {
  const result = runScript(['--bogus']);
  assert.equal(result.status, 1);
});
