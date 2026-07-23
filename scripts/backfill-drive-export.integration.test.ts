/**
 * `scripts/backfill-drive-export.ts` 統合テスト(Firestore emulator、Phase D/E再設計)
 *
 * CLAUDE.md MUST「DBにPartial Updateする関数の追加/変更 → テストに『更新対象外
 * フィールドの値が変化しないこと』を含める」への対応(code-review high指摘#2)。
 * スクリプト本体はCLIエントリポイント(`admin.initializeApp()`をモジュールtop-levelで
 * 呼ぶ・`process.argv`を直接読む・成功/失敗で`process.exit()`する)であり、import経由の
 * unit化は`admin.initializeApp()`の二重初期化やargvの汚染を招くため、実際のCLI利用を
 * そのまま検証できる`execFileSync`によるサブプロセス起動で検証する(手動emulator検証
 * (2026-07-23)で確認した挙動をテストとして固定化)。
 *
 * 実行: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'
 * (scripts/package.json の test:integration。scripts/lib/*.test.ts の高速unitテスト
 * (`npm test`)とは別立てにし、emulator非依存の既存パスを汚さない)
 */

import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as admin from 'firebase-admin';
import { BACKFILL_ERROR_MESSAGE } from './lib/driveExportBackfillHelpers';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'この統合テストはFirestore emulator経由でのみ実行してください: firebase emulators:exec --only firestore \'cd scripts && npm run test:integration\''
  );
}

const PROJECT_ID = 'backfill-drive-export-integration-test';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const SCRIPT_PATH = path.join(__dirname, 'backfill-drive-export.ts');
let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'drive-backfill-test-'));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const snap = await db.collection('documents').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

/**
 * 本番のbackfill候補docと同様、多数の無関係フィールドを持つdocを構築する。
 * `overrides`をgenericにするのは、`Record<string, unknown>`型のまま`{...overrides}`を
 * spreadすると返り値の型からindex signatureが失われ(TypeScriptの既知の挙動)、
 * 呼び出し側で`driveExportStatus`等overridesで渡したキーを後から分割代入できなくなる
 * ため(型エラー)。
 */
function unrelatedFields<T extends Record<string, unknown> = Record<string, never>>(
  overrides: T = {} as T
) {
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
    customerId: 'customer-1',
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

test('backfill本実行: driveExportStatus/driveExportError/updatedAtのみ変化し、他フィールドは一切変化しない(CLAUDE.md MUST)', async () => {
  const original = unrelatedFields();
  await db.doc('documents/doc-partial-update-check').set(original);

  runScript(['--expected-count', '1']);

  const after = await getDoc('doc-partial-update-check');
  assert.equal(after.driveExportStatus, 'error');
  assert.equal(after.driveExportError, BACKFILL_ERROR_MESSAGE);
  assert.notEqual(
    (after.updatedAt as FirebaseFirestore.Timestamp).toMillis(),
    undefined,
    'updatedAtがバックデートされていること'
  );

  const { driveExportStatus, driveExportError, updatedAt, ...unrelatedAfter } = after;
  const unrelatedBefore = { ...original };
  assert.deepEqual(
    unrelatedAfter,
    unrelatedBefore,
    'driveExportStatus/driveExportError/updatedAt以外のフィールドは元の値のまま変化しないこと'
  );
});

test('rollback本実行: driveExportStatus/driveExportErrorのみ削除され、他フィールド(updatedAt含む)は一切変化しない(CLAUDE.md MUST)', async () => {
  const backdatedUpdatedAt = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000);
  const original = unrelatedFields({
    driveExportStatus: 'error',
    driveExportError: BACKFILL_ERROR_MESSAGE,
    updatedAt: backdatedUpdatedAt,
  });
  await db.doc('documents/doc-rollback-partial-update-check').set(original);

  const manifestPath = path.join(tmpDir, 'rollback-manifest.json');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      runId: 'test-run',
      projectId: PROJECT_ID,
      timestamp: new Date().toISOString(),
      docIds: ['doc-rollback-partial-update-check'],
    })
  );

  runScript(['--rollback', manifestPath]);

  const after = await getDoc('doc-rollback-partial-update-check');
  assert.equal(after.driveExportStatus, undefined, 'driveExportStatusはフィールドごと削除されること');
  assert.equal(after.driveExportError, undefined, 'driveExportErrorはフィールドごと削除されること');

  const { driveExportStatus: _s, driveExportError: _e, ...restAfter } = after;
  const { driveExportStatus: _s2, driveExportError: _e2, ...restOriginal } = original;
  assert.deepEqual(
    restAfter,
    restOriginal,
    'driveExportStatus/driveExportError以外(updatedAtのバックデート値含む)は一切変化しないこと'
  );
});

test('--expected-count不一致時は書込みが一切発生しない(誤操作防止、ゼロ書込みの実証)', async () => {
  await db.doc('documents/doc-a').set(unrelatedFields());
  await db.doc('documents/doc-b').set(unrelatedFields());

  const result = runScript(['--expected-count', '3'], { expectNonZeroExit: true });
  assert.notEqual(result.status, 0);

  const a = await getDoc('doc-a');
  const b = await getDoc('doc-b');
  assert.equal(a.driveExportStatus, undefined, 'mismatch時はdoc-aに一切書込みが発生しないこと');
  assert.equal(b.driveExportStatus, undefined, 'mismatch時はdoc-bに一切書込みが発生しないこと');
});

test('--limitは指定件数のみをマークし、残りはfield-absentのまま残す', async () => {
  await db.doc('documents/doc-limit-a').set(unrelatedFields());
  await db.doc('documents/doc-limit-b').set(unrelatedFields());

  runScript(['--limit', '1', '--expected-count', '1']);

  const a = await getDoc('doc-limit-a');
  const b = await getDoc('doc-limit-b');
  const markedCount = [a, b].filter((d) => d.driveExportStatus === 'error').length;
  const absentCount = [a, b].filter((d) => d.driveExportStatus === undefined).length;
  assert.equal(markedCount, 1, '--limit 1により1件だけマークされること');
  assert.equal(absentCount, 1, '残り1件はfield-absentのまま残ること');
});

test('値が省略された--limitはエラー終了し、無制限に全件処理されない(code-review high指摘#1回帰テスト)', async () => {
  await db.doc('documents/doc-dangling-a').set(unrelatedFields());
  await db.doc('documents/doc-dangling-b').set(unrelatedFields());

  // --limitの値が省略され、次のトークンが別のフラグ(--dry-run)になっているケース
  const result = runScript(['--limit', '--dry-run'], { expectNonZeroExit: true });
  assert.notEqual(result.status, 0, '値省略時はエラー終了すること(サイレントに無制限扱いにならない)');

  const a = await getDoc('doc-dangling-a');
  const b = await getDoc('doc-dangling-b');
  assert.equal(a.driveExportStatus, undefined);
  assert.equal(b.driveExportStatus, undefined);
});

test('dry-runは書込みを一切発生させない', async () => {
  await db.doc('documents/doc-dry-run').set(unrelatedFields());

  runScript(['--dry-run']);

  const after = await getDoc('doc-dry-run');
  assert.equal(after.driveExportStatus, undefined);
});
