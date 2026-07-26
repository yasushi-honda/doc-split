/**
 * `scripts/merge-notation-duplicate-masters.ts` 統合テスト(Firestore emulator、2026-07-27)
 *
 * CLAUDE.md MUST「DBにPartial Updateする関数の追加/変更 → テストに『更新対象外
 * フィールドの値が変化しないこと』を含める」への対応。
 * スクリプト本体はCLIエントリポイントのため、`backfill-drive-export.integration.test.ts`と
 * 同じく`execFileSync`によるサブプロセス起動で検証する。
 *
 * 実行: firebase emulators:exec --only firestore 'cd scripts && npm run test:integration'
 */

import assert from 'node:assert/strict';
import { test, before, beforeEach, afterEach } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as admin from 'firebase-admin';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'この統合テストはFirestore emulator経由でのみ実行してください: firebase emulators:exec --only firestore \'cd scripts && npm run test:integration\''
  );
}

const PROJECT_ID = 'merge-notation-duplicate-masters-integration-test';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const SCRIPT_PATH = path.join(__dirname, 'merge-notation-duplicate-masters.ts');

let tmpDir: string;
let backupPath: string;

before(() => {
  // このプロジェクトIDを使う他の統合テストと衝突しないよう、専用IDを使用。
});

beforeEach(async () => {
  const collections = await Promise.all([
    db.collection('masters/customers/items').get(),
    db.collection('documents').get(),
  ]);
  await Promise.all(collections.flatMap((snap) => snap.docs.map((d) => d.ref.delete())));

  tmpDir = mkdtempSync(path.join(tmpdir(), 'merge-notation-test-'));
  backupPath = path.join(tmpDir, 'backup.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

interface RunResult {
  stdout: string;
  status: number;
}

function runScript(args: string[]): RunResult {
  const stdout = execFileSync('npx', ['ts-node', SCRIPT_PATH, ...args, '--backup-out', backupPath], {
    cwd: __dirname,
    env: { ...process.env, FIREBASE_PROJECT_ID: PROJECT_ID },
    encoding: 'utf-8',
  });
  return { stdout, status: 0 };
}

/** 書類の「更新対象外フィールド」に使う固定値セット(CLAUDE.md MUST検証用)。 */
function unrelatedDocFields() {
  return {
    fileId: 'gmail-file-1',
    fileName: 'original.pdf',
    documentType: 'ケアプラン',
    officeName: '事業所A',
    verified: true,
  };
}

async function seedCustomer(id: string, fields: Record<string, unknown>) {
  await db.doc(`masters/customers/items/${id}`).set(fields);
}

async function seedDocument(id: string, fields: Record<string, unknown>) {
  await db.doc(`documents/${id}`).set(fields);
}

test('dry-runは書込みを一切行わない', async () => {
  await seedCustomer('winner', { name: '奥村 志づ子' });
  await seedCustomer('loser', { name: '奥村志づ子' });
  await seedDocument('doc1', { customerId: 'loser', customerName: '奥村志づ子', ...unrelatedDocFields() });

  const result = runScript([]);
  assert.match(result.stdout, /dry-run完了\(書き込みゼロ\)/);

  const loserSnap = await db.doc('masters/customers/items/loser').get();
  assert.ok(loserSnap.exists, 'dry-runでは敗者マスターは削除されない');
  const docSnap = await db.doc('documents/doc1').get();
  assert.equal(docSnap.data()?.customerId, 'loser', 'dry-runでは書類は付け替えられない');
});

test('--execute: 書類が多い方をcanonicalとして残し、書類を付け替え、敗者を削除する', async () => {
  await seedCustomer('winner', { name: '奥村 志づ子', furigana: 'オクムラシヅコ' });
  await seedCustomer('loser', { name: '奥村志づ子' });
  await seedDocument('doc-winner-1', {
    customerId: 'winner',
    customerName: '奥村 志づ子',
    ...unrelatedDocFields(),
  });
  await seedDocument('doc-winner-2', {
    customerId: 'winner',
    customerName: '奥村 志づ子',
    ...unrelatedDocFields(),
  });
  await seedDocument('doc-loser-1', {
    customerId: 'loser',
    customerName: '奥村志づ子',
    ...unrelatedDocFields(),
  });

  runScript(['--execute']);

  const winnerSnap = await db.doc('masters/customers/items/winner').get();
  assert.ok(winnerSnap.exists);
  assert.deepEqual(winnerSnap.data()?.aliases, ['奥村志づ子'], '敗者の生名がaliasesへ追加される');

  const loserSnap = await db.doc('masters/customers/items/loser').get();
  assert.equal(loserSnap.exists, false, '敗者マスターは削除される');

  for (const docId of ['doc-loser-1']) {
    const docSnap = await db.doc(`documents/${docId}`).get();
    const data = docSnap.data();
    assert.equal(data?.customerId, 'winner');
    assert.equal(data?.customerName, '奥村 志づ子');
    // 更新対象外フィールドが変化しないこと(CLAUDE.md MUST)
    const unrelated = unrelatedDocFields();
    for (const [key, value] of Object.entries(unrelated)) {
      assert.deepEqual(data?.[key], value, `更新対象外フィールド ${key} が変化していないこと`);
    }
  }

  const winnerDocSnap = await db.doc('documents/doc-winner-1').get();
  assert.equal(winnerDocSnap.data()?.customerId, 'winner', 'canonical側の書類は変更されない');
});

test('--execute: canonicalのfurigana欠損時のみ敗者の値で補完し、既存値は上書きしない', async () => {
  await seedCustomer('winner', { name: '奥村 志づ子' }); // furigana欠損
  await seedCustomer('loser', { name: '奥村志づ子', furigana: 'オクムラシヅコ' });
  await seedDocument('doc-winner-1', { customerId: 'winner', customerName: '奥村 志づ子', ...unrelatedDocFields() });
  await seedDocument('doc-loser-1', { customerId: 'loser', customerName: '奥村志づ子', ...unrelatedDocFields() });

  runScript(['--execute']);

  const winnerSnap = await db.doc('masters/customers/items/winner').get();
  assert.equal(winnerSnap.data()?.furigana, 'オクムラシヅコ');
});

test('--execute: 完全一致([A]相当)の同姓同名グループは統合しない(守備範囲外)', async () => {
  await seedCustomer('personA', { name: '田中太郎' });
  await seedCustomer('personB', { name: '田中太郎' });
  await seedDocument('doc1', { customerId: 'personA', customerName: '田中太郎', ...unrelatedDocFields() });
  await seedDocument('doc2', { customerId: 'personB', customerName: '田中太郎', ...unrelatedDocFields() });

  const result = runScript(['--execute']);
  assert.match(result.stdout, /対象なし/);

  const personASnap = await db.doc('masters/customers/items/personA').get();
  const personBSnap = await db.doc('masters/customers/items/personB').get();
  assert.ok(personASnap.exists && personBSnap.exists, '完全一致の同姓同名は両方とも残る(統合しない)');
});

test('--execute: 完全一致サブグループを含む3件混在グループは警告表示のうえ誰も統合・削除しない(evaluator指摘対応)', async () => {
  // personA1/personA2は生名が完全一致(真の同姓同名候補)。personA3は表記ゆれ。
  await seedCustomer('personA1', { name: '田中太郎' });
  await seedCustomer('personA2', { name: '田中太郎' });
  await seedCustomer('personA3', { name: '田中 太郎' });
  await seedDocument('doc1', { customerId: 'personA1', customerName: '田中太郎', ...unrelatedDocFields() });
  await seedDocument('doc2', { customerId: 'personA2', customerName: '田中太郎', ...unrelatedDocFields() });
  await seedDocument('doc3', { customerId: 'personA3', customerName: '田中 太郎', ...unrelatedDocFields() });

  const result = runScript(['--execute']);
  assert.match(result.stdout, /完全一致サブグループ.*含むため自動統合の対象外/);
  assert.match(result.stdout, /対象なし/);

  for (const id of ['personA1', 'personA2', 'personA3']) {
    const snap = await db.doc(`masters/customers/items/${id}`).get();
    assert.ok(snap.exists, `${id} は削除されず残る`);
  }
  for (const docId of ['doc1', 'doc2', 'doc3']) {
    const snap = await db.doc(`documents/${docId}`).get();
    assert.equal(snap.data()?.customerId, docId.replace('doc', 'personA'), `${docId} のcustomerIdは変化しない`);
  }
});

test('バックアップJSONに敗者マスターの全フィールドと付け替え対象書類IDが記録される(dry-runでも出力)', async () => {
  await seedCustomer('winner', { name: '奥村 志づ子' });
  await seedCustomer('loser', { name: '奥村志づ子', furigana: 'オクムラシヅコ', notes: '北名古屋在住' });
  await seedDocument('doc-winner-1', { customerId: 'winner', customerName: '奥村 志づ子', ...unrelatedDocFields() });
  await seedDocument('doc-loser-1', { customerId: 'loser', customerName: '奥村志づ子', ...unrelatedDocFields() });

  runScript([]); // dry-run

  assert.ok(existsSync(backupPath), 'dry-runでもバックアップJSONが出力される');
  const backup = JSON.parse(readFileSync(backupPath, 'utf-8'));
  assert.equal(backup.mode, 'dry-run');
  assert.equal(backup.groups.length, 1);
  const loserEntry = backup.groups[0].losers[0];
  assert.equal(loserEntry.master.id, 'loser');
  assert.equal(loserEntry.master.furigana, 'オクムラシヅコ');
  assert.equal(loserEntry.master.notes, '北名古屋在住');
  assert.deepEqual(loserEntry.affectedDocumentIds, ['doc-loser-1']);
});
