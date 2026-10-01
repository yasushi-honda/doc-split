/**
 * `scripts/backfill-customer-id-link.ts` 統合テスト(Firestore emulator)
 *
 * `backfill-confirm-on-verify.integration.test.ts`と同じ別プロセス起動方式で、CLIの安全機構
 * (dry-run・件数ガード・部分更新・precondition・冪等・rollback・PII)を検証する。
 *
 * 実行: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'
 */

import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as admin from 'firebase-admin';
import { MASTER_PATHS } from '../functions/src/utils/masterPaths';
import { precheckCustomerIdentity } from '../shared/customerIdentity';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "この統合テストはFirestore emulator経由でのみ実行してください: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'"
  );
}

const PROJECT_ID = 'backfill-customer-id-link-integration-test';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const SCRIPT_PATH = path.join(__dirname, 'backfill-customer-id-link.ts');
let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'customer-id-link-test-'));
});
after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const [docsSnap, mastersSnap] = await Promise.all([db.collection('documents').get(), db.collection(MASTER_PATHS.customers).get()]);
  await Promise.all([...docsSnap.docs, ...mastersSnap.docs].map((d) => d.ref.delete()));
  await db.doc(`${MASTER_PATHS.customers}/m-yamada`).set({ name: '山田太郎', furigana: 'ヤマダタロウ' });
  await db.doc(`${MASTER_PATHS.customers}/m-sato-1`).set({ name: '佐藤花子', furigana: 'サトウハナコ' });
  await db.doc(`${MASTER_PATHS.customers}/m-sato-2`).set({ name: '佐藤花子', furigana: 'サトウハナコ' });
});

/** 紐づけ補完で変わってはいけない無関係フィールドを一通り持つ書類。 */
function baseDoc(overrides: Record<string, unknown> = {}) {
  return {
    fileId: 'gmail-file-1',
    fileName: 'original.pdf',
    mimeType: 'application/pdf',
    documentType: 'ケアプラン',
    customerName: '山田太郎',
    customerKey: '山田太郎',
    officeName: '事業所A',
    fileUrl: 'gs://test-bucket/original/test.pdf',
    fileDate: admin.firestore.Timestamp.fromDate(new Date(2026, 0, 1)),
    status: 'processed',
    careManager: '田中太郎',
    careManagerKey: '田中太郎',
    updatedAt: admin.firestore.Timestamp.fromDate(new Date(2026, 3, 1)),
    verified: true,
    customerConfirmed: true,
    needsManualCustomerSelection: false,
    driveExportStatus: 'error',
    driveExportError: 'フリガナが未設定のため利用者フォルダ名を解決できません: <名前>',
    ...overrides,
  };
}

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

function runScript(args: string[], opts: { expectNonZeroExit?: boolean } = {}): RunResult {
  try {
    const stdout = execFileSync('npx', ['ts-node', SCRIPT_PATH, ...args], {
      cwd: __dirname,
      env: { ...process.env, FIREBASE_PROJECT_ID: PROJECT_ID },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (opts.expectNonZeroExit) throw new Error(`終了コード0だったが非ゼロを期待していた。stdout:\n${stdout}`);
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    if (opts.expectNonZeroExit) {
      const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      return { stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '', status: e.status ?? 1 };
    }
    throw err;
  }
}

async function getDoc(id: string): Promise<Record<string, unknown>> {
  const snap = await db.doc(`documents/${id}`).get();
  assert.ok(snap.exists, `${id} が存在すること`);
  return snap.data()!;
}

const manifestPath = () => path.join(tmpDir, `manifest-${Math.random().toString(36).slice(2)}.json`);

test('本実行: customerIdだけが入り、他のフィールド(updatedAt・customerName・確定フラグ含む)は一切変化しない(CLAUDE.md MUST)', async () => {
  const original = baseDoc();
  await db.doc('documents/doc-absent').set(original);
  const beforeSnap = await db.doc('documents/doc-absent').get();

  runScript(['--expected-count', '1', '--manifest-out', manifestPath()]);

  const after = await getDoc('doc-absent');
  assert.equal(after.customerId, 'm-yamada');
  const { customerId, ...rest } = after;
  assert.deepEqual(rest, original, 'customerId以外のフィールドは元の値のまま(updatedAtも不変)');
  const afterSnap = await db.doc('documents/doc-absent').get();
  assert.ok(afterSnap.updateTime!.toMillis() >= beforeSnap.updateTime!.toMillis());
});

test('customerIdが無い・空文字・存在しないマスターを指す書類を、同名1件のマスターへ紐づける', async () => {
  await db.doc('documents/d-absent').set(baseDoc());
  await db.doc('documents/d-empty').set(baseDoc({ customerId: '' }));
  await db.doc('documents/d-dangling').set(baseDoc({ customerId: 'm-deleted' }));
  await db.doc('documents/d-valid').set(baseDoc({ customerId: 'm-yamada' }));

  runScript(['--expected-count', '3', '--manifest-out', manifestPath()]);

  for (const id of ['d-absent', 'd-empty', 'd-dangling', 'd-valid']) assert.equal((await getDoc(id)).customerId, 'm-yamada', id);
});

test('対象外(同姓同名・同名なし・未確認・顧客名無効)は書き換えない。manifestに理由別のdocIdだけ出力する', async () => {
  await db.doc('documents/d-ambiguous').set(baseDoc({ customerName: '佐藤花子' }));
  await db.doc('documents/d-nomaster').set(baseDoc({ customerName: '存在しない人' }));
  await db.doc('documents/d-unconfirmed').set(baseDoc({ customerConfirmed: false }));
  await db.doc('documents/d-sentinel').set(baseDoc({ customerName: '未判定' }));
  await db.doc('documents/d-target').set(baseDoc());
  const out = manifestPath();

  runScript(['--manifest-out', out]);

  for (const id of ['d-ambiguous', 'd-nomaster', 'd-unconfirmed', 'd-sentinel']) {
    assert.equal((await getDoc(id)).customerId, undefined, `${id}は書き換わらない`);
  }
  const manifest = JSON.parse(readFileSync(out, 'utf-8'));
  assert.deepEqual(manifest.skipped['ambiguous-same-name'], ['d-ambiguous']);
  assert.deepEqual(manifest.skipped['no-master'], ['d-nomaster']);
  assert.deepEqual(manifest.skipped['not-confirmed'], ['d-unconfirmed']);
  assert.deepEqual(manifest.skipped['invalid-name'], ['d-sentinel']);
  // PII: manifestに顧客名・ファイル名を含めない
  const text = readFileSync(out, 'utf-8');
  for (const word of ['山田太郎', '佐藤花子', '存在しない人', 'original.pdf']) assert.equal(text.includes(word), false, `${word}が含まれている`);
});

test('dry-run: 書込みゼロ(manifestのみ出力)', async () => {
  await db.doc('documents/d-dry').set(baseDoc());
  const out = manifestPath();
  const r = runScript(['--dry-run', '--manifest-out', out]);
  assert.match(r.stdout, /DRY RUN/);
  assert.equal((await getDoc('d-dry')).customerId, undefined);
  const manifest = JSON.parse(readFileSync(out, 'utf-8'));
  assert.equal(manifest.dryRun, true);
  assert.equal(manifest.entries.length, 0);
  // 紐づけ予定の一覧(承認者が「どの書類をどのマスターへ」を事前に確認できる)。名前は含まない
  assert.deepEqual(manifest.planned, [{ docId: 'd-dry', masterId: 'm-yamada', customerIdBefore: { state: 'absent' } }]);
});

test('--expected-count不一致: 書込みゼロで非ゼロ終了', async () => {
  await db.doc('documents/d-count').set(baseDoc());
  const r = runScript(['--expected-count', '2'], { expectNonZeroExit: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /expected-count 不一致/);
  assert.equal((await getDoc('d-count')).customerId, undefined);
});

test('--limit: 先頭(documentId順)からN件だけ紐づける', async () => {
  await db.doc('documents/d-1').set(baseDoc());
  await db.doc('documents/d-2').set(baseDoc());
  runScript(['--limit', '1', '--expected-count', '1']);
  assert.equal((await getDoc('d-1')).customerId, 'm-yamada');
  assert.equal((await getDoc('d-2')).customerId, undefined);
});

test('冪等: 2回目の実行は対象0件で何も書かない', async () => {
  await db.doc('documents/d-idem').set(baseDoc());
  runScript(['--expected-count', '1']);
  const first = await db.doc('documents/d-idem').get();
  const r = runScript(['--expected-count', '0']);
  assert.match(r.stdout, /紐づけ対象: 0件/);
  const second = await db.doc('documents/d-idem').get();
  assert.equal(second.updateTime!.isEqual(first.updateTime!), true, '2回目で書込みがない(updateTimeが同じ)');
});

test('紐づけ後の書類は、エクスポート側の顧客確認(precheckCustomerIdentity)でconfirmedになり、マスターからフリガナが引ける', async () => {
  await db.doc('documents/d-export').set(baseDoc({ customerName: '  山田太郎 ' }));
  runScript(['--expected-count', '1']);
  const doc = await getDoc('d-export');
  const master = (await db.doc(`${MASTER_PATHS.customers}/${doc.customerId as string}`).get()).data()!;
  assert.equal(master.furigana, 'ヤマダタロウ');
  assert.equal(precheckCustomerIdentity({ customerName: doc.customerName as string, customerConfirmed: true }, { customerMasterName: master.name }).outcome, 'confirmed');
});

test('rollback: absentはフィールド削除・空文字は空文字・danglingは元のIDへ戻り、他フィールドは不変', async () => {
  const original = baseDoc();
  await db.doc('documents/r-absent').set(original);
  await db.doc('documents/r-empty').set(baseDoc({ customerId: '' }));
  await db.doc('documents/r-dangling').set(baseDoc({ customerId: 'm-deleted' }));
  const out = manifestPath();
  runScript(['--expected-count', '3', '--manifest-out', out]);

  runScript(['--rollback', out]);

  const a = await getDoc('r-absent');
  assert.equal('customerId' in a, false, 'absentはフィールドごと削除される');
  assert.deepEqual(a, original, 'rollback後は元のドキュメントと完全一致');
  assert.equal((await getDoc('r-empty')).customerId, '');
  assert.equal((await getDoc('r-dangling')).customerId, 'm-deleted');
});

test('rollback: backfill後に別の書込みがあった書類は戻さない', async () => {
  await db.doc('documents/r-progressed').set(baseDoc());
  const out = manifestPath();
  runScript(['--expected-count', '1', '--manifest-out', out]);
  await db.doc('documents/r-progressed').update({ customerId: 'm-sato-1' }); // 人が後から別のマスターへ変更

  const r = runScript(['--rollback', out]);
  assert.match(r.stdout, /以降に変更あり1件/);
  assert.equal((await getDoc('r-progressed')).customerId, 'm-sato-1');
});

test('rollback: 不正なmanifest・別プロジェクトのmanifestは書込みゼロで非ゼロ終了', async () => {
  await db.doc('documents/r-bad').set(baseDoc());
  const bad = manifestPath();
  writeFileSync(bad, JSON.stringify({ schemaVersion: 1, runId: 'x', entries: 'oops' }));
  const r1 = runScript(['--rollback', bad], { expectNonZeroExit: true });
  assert.match(r1.stderr, /manifestの構造が不正/);

  const other = manifestPath();
  const out = manifestPath();
  runScript(['--expected-count', '1', '--manifest-out', out]);
  const m = JSON.parse(readFileSync(out, 'utf-8'));
  m.projectId = 'other-project';
  writeFileSync(other, JSON.stringify(m));
  const r2 = runScript(['--rollback', other], { expectNonZeroExit: true });
  assert.match(r2.stderr, /projectId.*一致しません/);
  assert.equal((await getDoc('r-bad')).customerId, 'm-yamada', '別プロジェクトのmanifestでは戻されない');
});

// ---------------------------------------------------------------- 安全分岐の追加テスト(pr-test-analyzer指摘)

test('rollback --dry-run: 書込みゼロ(戻し対象件数だけ表示)', async () => {
  await db.doc('documents/r-dry').set(baseDoc());
  const out = manifestPath();
  runScript(['--expected-count', '1', '--manifest-out', out]);
  const r = runScript(['--rollback', out, '--dry-run']);
  assert.match(r.stdout, /DRY RUN: 戻し対象1件/);
  assert.equal((await getDoc('r-dry')).customerId, 'm-yamada', 'dry-runでは戻らない');
});

test('rollback: manifest記載の書類が削除済みでも、他の書類は戻り、不在の書類はスキップして完走する', async () => {
  await db.doc('documents/r-gone').set(baseDoc());
  await db.doc('documents/r-kept').set(baseDoc());
  const out = manifestPath();
  runScript(['--expected-count', '2', '--manifest-out', out]);
  await db.doc('documents/r-gone').delete();
  const r = runScript(['--rollback', out]);
  assert.match(r.stdout, /doc不在1件/);
  assert.equal('customerId' in (await getDoc('r-kept')), false);
});

test('ページング: 200件を超える書類(複数ページ)も取りこぼさず全件紐づける', async () => {
  const total = 205;
  for (let start = 0; start < total; start += 100) {
    const batch = db.batch();
    for (let i = start; i < Math.min(start + 100, total); i++) {
      batch.set(db.doc(`documents/p-${String(i).padStart(4, '0')}`), baseDoc());
    }
    await batch.commit();
  }
  runScript(['--expected-count', String(total)]);
  const snap = await db.collection('documents').get();
  assert.equal(snap.docs.filter((d) => d.data().customerId === 'm-yamada').length, total);
});

test('--expected-count 0: 対象が1件以上あれば書込みゼロで中断する(truthy判定に退行しない)', async () => {
  await db.doc('documents/z-1').set(baseDoc());
  const r = runScript(['--expected-count', '0'], { expectNonZeroExit: true });
  assert.match(r.stderr, /expected-count 不一致/);
  assert.equal((await getDoc('z-1')).customerId, undefined);
});

test('--limit 0: 0件だけ紐づける(何も書かない)', async () => {
  await db.doc('documents/z-2').set(baseDoc());
  runScript(['--limit', '0', '--expected-count', '0']);
  assert.equal((await getDoc('z-2')).customerId, undefined);
});

test('--dry-runでも--expected-countの不一致は書込みゼロで非ゼロ終了(照合は書込み前)', async () => {
  await db.doc('documents/z-3').set(baseDoc());
  const r = runScript(['--dry-run', '--expected-count', '5'], { expectNonZeroExit: true });
  assert.match(r.stderr, /expected-count 不一致/);
});

test('customerIdが文字列以外(数値)の書類は型異常として触らず、manifestのinvalid-field-typeに記録する', async () => {
  await db.doc('documents/t-num').set(baseDoc({ customerId: 123 }));
  const out = manifestPath();
  runScript(['--manifest-out', out, '--expected-count', '0']);
  assert.equal((await getDoc('t-num')).customerId, 123);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf-8')).skipped['invalid-field-type'], ['t-num']);
});

test('manifest: 完走した本実行は aborted:false、planned と entries が一致する', async () => {
  await db.doc('documents/m-1').set(baseDoc());
  await db.doc('documents/m-2').set(baseDoc({ customerId: '' }));
  const out = manifestPath();
  runScript(['--expected-count', '2', '--manifest-out', out]);
  const m = JSON.parse(readFileSync(out, 'utf-8'));
  assert.equal(m.aborted, false);
  assert.equal(m.dryRun, false);
  assert.deepEqual(m.planned.map((p: { docId: string }) => p.docId), m.entries.map((e: { docId: string }) => e.docId));
});

test('--limit: 対象がN件に達した時点で走査を打ち切り、manifestにscanIncomplete:trueを記録する', async () => {
  for (const id of ['l-1', 'l-2', 'l-3']) await db.doc(`documents/${id}`).set(baseDoc());
  const out = manifestPath();
  runScript(['--limit', '1', '--expected-count', '1', '--manifest-out', out]);
  const m = JSON.parse(readFileSync(out, 'utf-8'));
  assert.equal(m.scanIncomplete, true);
  assert.equal(m.totalScanned, 1, '1件目で対象数に達したため、残りは読まない');
});

test('--limitが対象数に達しない場合は全件走査し、scanIncomplete:falseのまま', async () => {
  await db.doc('documents/l-only').set(baseDoc());
  const out = manifestPath();
  runScript(['--limit', '5', '--expected-count', '1', '--manifest-out', out]);
  assert.equal(JSON.parse(readFileSync(out, 'utf-8')).scanIncomplete, false);
});
