import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CustomerRecord,
  groupNotationDuplicates,
  findExcludedNotationGroups,
  pickCanonical,
  buildMergedMasterUpdate,
  buildDocumentRepointPayload,
  resolveConfirmedLosers,
} from './notationDuplicateMerge';

function customer(overrides: Partial<CustomerRecord> & { id: string; name: string }): CustomerRecord {
  return {
    furigana: '',
    careManagerName: '',
    notes: '',
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

test('groupNotationDuplicates: 完全一致のペアが1組でも混在するグループは対象外とする(真の同姓同名の別人を誤統合しないため)', () => {
  // personA1/personA2は生名が完全一致(真の同姓同名候補、[A]相当)。personA3は表記ゆれ。
  // 正規化キーは3件とも同一になるが、内部に完全一致サブグループを含むため
  // groupNotationDuplicatesの対象外(evaluator指摘・独立再現済み、2026-07-27)。
  const customers = [
    customer({ id: 'personA1', name: '田中太郎' }),
    customer({ id: 'personA2', name: '田中太郎' }),
    customer({ id: 'personA3', name: '田中 太郎' }),
  ];
  assert.equal(groupNotationDuplicates(customers).length, 0);
});

test('findExcludedNotationGroups: 完全一致サブグループを含む(=手動確認が必要な)グループを検出する', () => {
  const customers = [
    customer({ id: 'personA1', name: '田中太郎' }),
    customer({ id: 'personA2', name: '田中太郎' }),
    customer({ id: 'personA3', name: '田中 太郎' }),
  ];
  const excluded = findExcludedNotationGroups(customers);
  assert.equal(excluded.length, 1);
  assert.deepEqual(
    excluded[0].members.map((c: CustomerRecord) => c.id).sort(),
    ['personA1', 'personA2', 'personA3']
  );
});

test('findExcludedNotationGroups: 通常の表記ゆれグループ(完全一致サブグループなし)は含めない', () => {
  const customers = [customer({ id: 'a', name: '奥村 志づ子' }), customer({ id: 'b', name: '奥村志づ子' })];
  assert.equal(findExcludedNotationGroups(customers).length, 0);
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
  assert.equal(update.notes, undefined);
});

test('buildMergedMasterUpdate: canonicalのnotes欠損時、敗者の値で補完する(区別用補足情報の消失防止)', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子', notes: '' }),
    losers: [customer({ id: 'b', name: '奥村志づ子', notes: '北名古屋在住' })],
  };
  const update = buildMergedMasterUpdate(choice);
  assert.equal(update.notes, '北名古屋在住');
});

test('buildMergedMasterUpdate: canonicalに既にnotesがある場合は上書きしない', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子', notes: '既存の補足' }),
    losers: [customer({ id: 'b', name: '奥村志づ子', notes: '北名古屋在住' })],
  };
  const update = buildMergedMasterUpdate(choice);
  assert.equal(update.notes, undefined);
});

test('buildDocumentRepointPayload: customerId/customerNameの2キーのみを持つペイロードを返す(Partial Update不変、CLAUDE.md MUST)', () => {
  const canonical = customer({ id: 'a', name: '奥村 志づ子' });
  const payload = buildDocumentRepointPayload(canonical);
  assert.deepEqual(Object.keys(payload).sort(), ['customerId', 'customerName']);
  assert.deepEqual(payload, { customerId: 'a', customerName: '奥村 志づ子' });
});

test('resolveConfirmedLosers: 削除直前の再検証で参照書類が0件の敗者のみconfirmedLosersに含める', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子' }),
    losers: [customer({ id: 'b', name: '奥村志づ子' }), customer({ id: 'c', name: 'オクムラ志づ子' })],
  };
  const recheckCounts = new Map([
    ['b', 0],
    ['c', 0],
  ]);
  const result = resolveConfirmedLosers(choice, recheckCounts);
  assert.deepEqual(
    result.confirmedLosers.map((l: CustomerRecord) => l.id),
    ['b', 'c']
  );
  assert.deepEqual(result.skippedLosers, []);
});

test('resolveConfirmedLosers: 再検証で参照書類が残っている敗者はskippedLosersへ回し、confirmedLosersから除外する(code-review指摘対応、2026-07-27)', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子' }),
    losers: [customer({ id: 'b', name: '奥村志づ子' }), customer({ id: 'c', name: 'オクムラ志づ子' })],
  };
  const recheckCounts = new Map([
    ['b', 0],
    ['c', 1], // レースで新規docが検出された想定
  ]);
  const result = resolveConfirmedLosers(choice, recheckCounts);
  assert.deepEqual(
    result.confirmedLosers.map((l: CustomerRecord) => l.id),
    ['b']
  );
  assert.deepEqual(
    result.skippedLosers.map((l: CustomerRecord) => l.id),
    ['c']
  );
});

test('resolveConfirmedLosers: skippedLosersのデータはbuildMergedMasterUpdateの入力に含まれないため、canonicalのaliasesへ混入しない', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子' }),
    losers: [customer({ id: 'b', name: '奥村志づ子' }), customer({ id: 'c', name: 'オクムラ志づ子' })],
  };
  const recheckCounts = new Map([
    ['b', 0],
    ['c', 1],
  ]);
  const { confirmedLosers } = resolveConfirmedLosers(choice, recheckCounts);
  const update = buildMergedMasterUpdate({ canonical: choice.canonical, losers: confirmedLosers });
  assert.deepEqual(update.aliasesToAdd, ['奥村志づ子']);
  assert.ok(!update.aliasesToAdd.includes('オクムラ志づ子'), '削除がスキップされた敗者の生名はaliasesへ追加されない');
});

test('resolveConfirmedLosers: recheckCountsにエントリが無い敗者は0件として扱う(count()クエリ結果が省略されるケースを想定しない安全側デフォルト)', () => {
  const choice = {
    canonical: customer({ id: 'a', name: '奥村 志づ子' }),
    losers: [customer({ id: 'b', name: '奥村志づ子' })],
  };
  const result = resolveConfirmedLosers(choice, new Map());
  assert.deepEqual(
    result.confirmedLosers.map((l: CustomerRecord) => l.id),
    ['b']
  );
});
