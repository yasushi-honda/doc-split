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

test('--execute: 敗者から付け替えられた書類のcareManager/careManagerKeyがcanonical側の値に更新される(code-review指摘対応、2026-07-27)', async () => {
  await seedCustomer('winner', { name: '奥村 志づ子', careManagerName: '佐藤 花子' });
  await seedCustomer('loser', { name: '奥村志づ子', careManagerName: '田端 正樹' });
  await seedDocument('doc-winner-1', {
    customerId: 'winner',
    customerName: '奥村 志づ子',
    careManager: '佐藤 花子',
    careManagerKey: '佐藤 花子',
    ...unrelatedDocFields(),
  });
  // 敗者の書類は元々syncCareManagerトリガーで敗者の担当ケアマネ「田端 正樹」が反映されていた想定。
  await seedDocument('doc-loser-1', {
    customerId: 'loser',
    customerName: '奥村志づ子',
    careManager: '田端 正樹',
    careManagerKey: '田端 正樹',
    ...unrelatedDocFields(),
  });

  runScript(['--execute']);

  const docSnap = await db.doc('documents/doc-loser-1').get();
  const data = docSnap.data();
  assert.equal(data?.customerId, 'winner');
  assert.equal(data?.careManager, '佐藤 花子', '敗者側の古い担当ケアマネではなくcanonical側の値になること');
  assert.equal(data?.careManagerKey, '佐藤 花子');

  // canonical側の書類は変更されない
  const winnerDocSnap = await db.doc('documents/doc-winner-1').get();
  assert.equal(winnerDocSnap.data()?.careManager, '佐藤 花子');
});

test('--execute: canonicalのcareManagerName欠損時、敗者から補完された値が付け替え後の書類のcareManagerにも反映される', async () => {
  await seedCustomer('winner', { name: '奥村 志づ子' }); // careManagerName欠損
  await seedCustomer('loser', { name: '奥村志づ子', careManagerName: '田端 正樹' });
  // winnerの書類数をloserより多くし、書類数ポリシーでwinnerが確実にcanonicalに選ばれるようにする
  await seedDocument('doc-winner-1', { customerId: 'winner', customerName: '奥村 志づ子', ...unrelatedDocFields() });
  await seedDocument('doc-winner-2', { customerId: 'winner', customerName: '奥村 志づ子', ...unrelatedDocFields() });
  await seedDocument('doc-loser-1', {
    customerId: 'loser',
    customerName: '奥村志づ子',
    careManager: '田端 正樹',
    careManagerKey: '田端 正樹',
    ...unrelatedDocFields(),
  });

  runScript(['--execute']);

  const winnerSnap = await db.doc('masters/customers/items/winner').get();
  assert.equal(winnerSnap.data()?.careManagerName, '田端 正樹');

  const docSnap = await db.doc('documents/doc-loser-1').get();
  assert.equal(docSnap.data()?.careManager, '田端 正樹');
  assert.equal(docSnap.data()?.careManagerKey, '田端 正樹');
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

test('--execute: バックアップJSONにPhase3完了後の実際の適用結果(appliedResult/appliedAt)が反映される(code-review 4巡目指摘対応、2026-07-27)', async () => {
  await seedCustomer('winner', { name: '奥村 志づ子' });
  await seedCustomer('loser', { name: '奥村志づ子', careManagerName: '田端 正樹' });
  await seedDocument('doc-winner-1', { customerId: 'winner', customerName: '奥村 志づ子', ...unrelatedDocFields() });
  await seedDocument('doc-winner-2', { customerId: 'winner', customerName: '奥村 志づ子', ...unrelatedDocFields() });
  await seedDocument('doc-loser-1', { customerId: 'loser', customerName: '奥村志づ子', ...unrelatedDocFields() });

  runScript(['--execute']);

  const backup = JSON.parse(readFileSync(backupPath, 'utf-8'));
  assert.ok(backup.appliedAt, 'Phase3完了後にappliedAtが設定される');
  const groupEntry = backup.groups[0];
  assert.deepEqual(groupEntry.appliedResult.confirmedLoserIds, ['loser'], 'レースが発生しない通常経路では敗者は全員confirmedLosersに含まれる');
  assert.deepEqual(groupEntry.appliedResult.skippedLoserIds, []);
  assert.equal(groupEntry.appliedResult.appliedUpdate.careManagerName, '田端 正樹', '実際に適用された内容(confirmedLosersベース)が記録される');
});
