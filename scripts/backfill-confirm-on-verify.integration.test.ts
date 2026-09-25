/**
 * `scripts/backfill-confirm-on-verify.ts` 統合テスト(Firestore emulator、Issue #1034/#1043)
 *
 * pr-review-toolkit(pr-test-analyzer)指摘: このスクリプトの実際の安全機構(--rollback時の
 * fail-closedゲート、customerConfirmed/officeConfirmedの型契約違反データの除外、Partial
 * Updateの不変性)は`scripts/lib/confirmOnVerifyBackfillHelpers.test.ts`の純粋関数unit test
 * だけではカバーされておらず、CLIエントリポイント自体を検証する統合テストが存在しなかった
 * (兄弟スクリプト`backfill-drive-export.ts`には同種の統合テストが既にある)。同じ
 * `execFileSync`によるサブプロセス起動パターンでこのギャップを埋める。
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
import { MASTER_PATHS } from '../functions/src/utils/masterPaths';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'この統合テストはFirestore emulator経由でのみ実行してください: firebase emulators:exec --only firestore \'cd scripts && npm run test:integration\''
  );
}

const PROJECT_ID = 'backfill-confirm-on-verify-integration-test';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const SCRIPT_PATH = path.join(__dirname, 'backfill-confirm-on-verify.ts');
let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'confirm-on-verify-backfill-test-'));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const [docsSnap, mastersSnap] = await Promise.all([
    db.collection('documents').get(),
    db.collection(MASTER_PATHS.customers).get(),
  ]);
  await Promise.all([...docsSnap.docs, ...mastersSnap.docs].map((d) => d.ref.delete()));
});

/** backfill-drive-export.integration.test.tsのunrelatedFields()と同型。 */
function unrelatedFields<T extends Record<string, unknown> = Record<string, never>>(overrides: T = {} as T) {
  return {
    fileId: 'gmail-file-1',
    fileName: 'original.pdf',
    mimeType: 'application/pdf',
    documentType: 'ケアプラン',
    customerName: '鈴木花子',
    officeName: '事業所A',
    fileUrl: 'gs://test-bucket/original/test.pdf',
    fileDate: admin.firestore.Timestamp.fromDate(new Date(2026, 0, 1)),
    isDuplicateCustomer: false,
    totalPages: 3,
    targetPageNumber: 2,
    status: 'processed',
    careManager: '田中太郎',
    verified: true,
    ...overrides,
  };
}

interface RunResult {
  stdout: string;
  status: number;
}

function runScript(args: string[], opts: { expectNonZeroExit?: boolean } = {}): RunResult {
  try {
    const stdout = execFileSync('npx', ['ts-node', SCRIPT_PATH, ...args], {
      cwd: __dirname,
      env: { ...process.env, FIREBASE_PROJECT_ID: PROJECT_ID },
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

async function getDoc(docId: string): Promise<Record<string, unknown>> {
  const snap = await db.doc(`documents/${docId}`).get();
  assert.ok(snap.exists, `${docId} が存在すること`);
  return snap.data()!;
}

test('backfill本実行: customerConfirmed/officeConfirmedのみ変化し、他フィールドは一切変化しない(CLAUDE.md MUST)', async () => {
  const original = unrelatedFields();
  await db.doc('documents/doc-partial-update-check').set(original);

  runScript(['--expected-count', '1']);

  const after = await getDoc('doc-partial-update-check');
  assert.equal(after.customerConfirmed, true);
  assert.equal(after.officeConfirmed, true);

  const { customerConfirmed, officeConfirmed, needsManualCustomerSelection, ...unrelatedAfter } = after;
  const unrelatedBefore = { ...original };
  assert.deepEqual(
    unrelatedAfter,
    unrelatedBefore,
    'customerConfirmed/officeConfirmed/needsManualCustomerSelection以外のフィールドは元の値のまま変化しないこと'
  );
});

test('rollback本実行: backfillで確定した値が元(フィールド不在)へ正しく戻り、他フィールドは一切変化しない', async () => {
  const original = unrelatedFields();
  await db.doc('documents/doc-rollback-roundtrip').set(original);

  const manifestPath = path.join(tmpDir, 'roundtrip-manifest.json');
  runScript(['--expected-count', '1', '--manifest-out', manifestPath]);

  const afterBackfill = await getDoc('doc-rollback-roundtrip');
  assert.equal(afterBackfill.customerConfirmed, true);
  assert.equal(afterBackfill.officeConfirmed, true);

  runScript(['--rollback', manifestPath]);

  const afterRollback = await getDoc('doc-rollback-roundtrip');
  assert.equal(afterRollback.customerConfirmed, undefined, 'customerConfirmedはフィールドごと削除されること');
  assert.equal(afterRollback.officeConfirmed, undefined, 'officeConfirmedはフィールドごと削除されること');
  assert.deepEqual(afterRollback, original, 'rollback後は完全に元のドキュメントへ戻ること');
});

test('--rollback: 構造不正なmanifestは書込みを一切行わずexit(1)する(fail-closed、pr-test-analyzer指摘の最重要ギャップ)', async () => {
  const original = unrelatedFields();
  await db.doc('documents/doc-fail-closed-check').set(original);

  const manifestPath = path.join(tmpDir, 'corrupted-manifest.json');
  // 手編集を模した構造不正: customer.confirmedCustomerがbooleanでない(判別子として無効)。
  writeFileSync(
    manifestPath,
    JSON.stringify({
      runId: 'corrupted-run',
      projectId: PROJECT_ID,
      timestamp: new Date().toISOString(),
      entries: [
        {
          docId: 'doc-fail-closed-check',
          customer: { confirmedCustomer: 'yes' },
          office: { confirmedOffice: false },
          backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
        },
      ],
      fieldTypeAnomalies: [],
    })
  );

  const result = runScript(['--rollback', manifestPath], { expectNonZeroExit: true });
  assert.notEqual(result.status, 0, '構造不正なmanifestはexit(1)すること');

  const after = await getDoc('doc-fail-closed-check');
  assert.deepEqual(after, original, '構造不正なmanifestを渡した場合、対象ドキュメントは一切変化しないこと(ゼロ書込みの実証)');
});

test('想定外の型(customerConfirmedがboolean以外)を持つ文書はbackfill対象から除外され、一切書込まれない', async () => {
  // 契約違反データ(null等)を模した文書。customerNameは有効なのでdecisions.customer.action==='confirm'
  // になるが、customerConfirmed自体がboolean|フィールド不在の契約に違反しているため除外される想定。
  const original = unrelatedFields({ customerConfirmed: null });
  await db.doc('documents/doc-field-type-anomaly').set(original);

  runScript(['--expected-count', '0']);

  const after = await getDoc('doc-field-type-anomaly');
  assert.deepEqual(after, original, '型契約違反の文書は対象から除外され、一切書込まれないこと');
});

test('--expected-count不一致時は書込みが一切発生しない(誤操作防止、ゼロ書込みの実証)', async () => {
  await db.doc('documents/doc-a').set(unrelatedFields());
  await db.doc('documents/doc-b').set(unrelatedFields());

  const result = runScript(['--expected-count', '5'], { expectNonZeroExit: true });
  assert.notEqual(result.status, 0);

  const a = await getDoc('doc-a');
  const b = await getDoc('doc-b');
  assert.equal(a.customerConfirmed, undefined, 'mismatch時はdoc-aに一切書込みが発生しないこと');
  assert.equal(b.customerConfirmed, undefined, 'mismatch時はdoc-bに一切書込みが発生しないこと');
});

test('dry-runは書込みを一切発生させない', async () => {
  const original = unrelatedFields();
  await db.doc('documents/doc-dry-run').set(original);

  runScript(['--dry-run']);

  const after = await getDoc('doc-dry-run');
  assert.deepEqual(after, original);
});
