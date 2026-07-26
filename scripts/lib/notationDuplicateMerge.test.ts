import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CustomerRecord,
  groupNotationDuplicates,
  pickCanonical,
  buildMergedMasterUpdate,
  buildDocumentRepointPayload,
} from './notationDuplicateMerge';

function customer(overrides: Partial<CustomerRecord> & { id: string; name: string }): CustomerRecord {
  return {
    furigana: '',
    careManagerName: '',
    aliases: [],
    isDuplicate: false,
    ...overrides,
  };
}

test('groupNotationDuplicates: スペース有無のみが異なる2件を1グループとして検出する', () => {
  const customers = [customer({ id: 'a', name: '奥村 志づ子' }), customer({ id: 'b', name: '奥村志づ子' })];
  const groups = groupNotationDuplicates(customers);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].members.map((c: CustomerRecord) => c.id).sort(),
    ['a', 'b']
  );
});

test('groupNotationDuplicates: 完全一致(同姓同名)は対象外とする([A]相当、本関数の守備範囲外)', () => {
  const customers = [customer({ id: 'a', name: '田中太郎' }), customer({ id: 'b', name: '田中太郎' })];
  assert.equal(groupNotationDuplicates(customers).length, 0);
});

test('groupNotationDuplicates: 全く異なる名前は対象外とする', () => {
  const customers = [customer({ id: 'a', name: '田中太郎' }), customer({ id: 'b', name: '鈴木花子' })];
  assert.equal(groupNotationDuplicates(customers).length, 0);
});

test('groupNotationDuplicates: 全角スペース・半角スペース・中黒混在の3件を1グループとして検出する', () => {
  const customers = [
    customer({ id: 'a', name: '山田　太郎' }),
    customer({ id: 'b', name: '山田 太郎' }),
    customer({ id: 'c', name: '山田・太郎' }),
  ];
  const groups = groupNotationDuplicates(customers);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 3);
});

test('pickCanonical: 紐づく書類数が多い方を正式表記(canonical)として選ぶ', () => {
  const group = {
    members: [customer({ id: 'a', name: '奥村 志づ子' }), customer({ id: 'b', name: '奥村志づ子' })],
  };
  const counts = new Map([
    ['a', 5],
    ['b', 1],
  ]);
  const choice = pickCanonical(group, counts);
  assert.equal(choice.canonical.id, 'a');
  assert.deepEqual(
    choice.losers.map((c: CustomerRecord) => c.id),
    ['b']
  );
});

test('pickCanonical: 書類数が同数の場合はスペースを含む表記を優先する', () => {
  const group = {
    members: [customer({ id: 'a', name: '奥村志づ子' }), customer({ id: 'b', name: '奥村 志づ子' })],
  };
  const counts = new Map([
    ['a', 0],
    ['b', 0],
  ]);
  const choice = pickCanonical(group, counts);
  assert.equal(choice.canonical.id, 'b');
});

test('pickCanonical: documentCountsにエントリが無いメンバーは0件として扱う', () => {
  const group = {
    members: [customer({ id: 'a', name: '奥村 志づ子' }), customer({ id: 'b', name: '奥村志づ子' })],
  };
  const counts = new Map([['a', 3]]); // bは未登録=0件
  const choice = pickCanonical(group, counts);
  assert.equal(choice.canonical.id, 'a');
});

test('buildMergedMasterUpdate: 敗者の生名をaliasesへ追加する(canonical自身の名前は除外)', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子', aliases: ['既存表記'] }),
    losers: [customer({ id: 'b', name: '奥村志づ子' })],
  };
  const update = buildMergedMasterUpdate(choice);
  assert.deepEqual(update.aliasesToAdd, ['奥村志づ子']);
});

test('buildMergedMasterUpdate: canonicalのaliasesに既に含まれる敗者名は重複追加しない', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子', aliases: ['奥村志づ子'] }),
    losers: [customer({ id: 'b', name: '奥村志づ子' })],
  };
  const update = buildMergedMasterUpdate(choice);
  assert.deepEqual(update.aliasesToAdd, []);
});

test('buildMergedMasterUpdate: canonicalのfurigana欠損時、敗者のfuriganaで補完する', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子', furigana: '' }),
    losers: [customer({ id: 'b', name: '奥村志づ子', furigana: 'オクムラシヅコ' })],
  };
  const update = buildMergedMasterUpdate(choice);
  assert.equal(update.furigana, 'オクムラシヅコ');
});

test('buildMergedMasterUpdate: canonicalに既にfuriganaがある場合は上書きしない', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子', furigana: 'オクムラシズコ' }),
    losers: [customer({ id: 'b', name: '奥村志づ子', furigana: 'オクムラシヅコ' })],
  };
  const update = buildMergedMasterUpdate(choice);
  assert.equal(update.furigana, undefined);
});

test('buildMergedMasterUpdate: canonicalのcareManagerName欠損時、敗者の値で補完する', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子', careManagerName: '' }),
    losers: [customer({ id: 'b', name: '奥村志づ子', careManagerName: '田端 正樹' })],
  };
  const update = buildMergedMasterUpdate(choice);
  assert.equal(update.careManagerName, '田端 正樹');
});

test('buildMergedMasterUpdate: 双方に値が無いフィールドはundefinedのまま返す(不要なフィールド追加をしない)', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子' }),
    losers: [customer({ id: 'b', name: '奥村志づ子' })],
  };
  const update = buildMergedMasterUpdate(choice);
  assert.equal(update.furigana, undefined);
  assert.equal(update.careManagerName, undefined);
});

test('buildDocumentRepointPayload: customerId/customerNameの2キーのみを持つペイロードを返す(Partial Update不変、CLAUDE.md MUST)', () => {
  const canonical = customer({ id: 'a', name: '奥村 志づ子' });
  const payload = buildDocumentRepointPayload(canonical);
  assert.deepEqual(Object.keys(payload).sort(), ['customerId', 'customerName']);
  assert.deepEqual(payload, { customerId: 'a', customerName: '奥村 志づ子' });
});
