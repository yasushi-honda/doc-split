/**
 * `scripts/lib/customerIdLinkBackfillHelpers.ts` の単体テスト(node:test、emulator不要)
 *
 * 実行: cd scripts && npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCustomerIdLinkManifest,
  buildMasterIndex,
  classifyCustomerIdLink,
  computeCustomerIdRollbackInstruction,
  isRollbackEligibleByUpdateTime,
  isValidCustomerIdLinkManifest,
  type CustomerIdLinkManifestEntry,
  type MasterIndex,
} from './customerIdLinkBackfillHelpers';
import { precheckCustomerIdentity } from '../../shared/customerIdentity';

const masters = [
  { id: 'm-yamada', name: '山田太郎' },
  { id: 'm-sato-1', name: '佐藤花子' },
  { id: 'm-sato-2', name: '佐藤花子' }, // 完全一致の同名
  { id: 'm-suzuki-a', name: '鈴木 一郎' }, // 空白違いの同姓同名
  { id: 'm-suzuki-b', name: '鈴木一郎' },
  { id: 'm-tanaka', name: '田中次郎' },
];

function index(): MasterIndex {
  return buildMasterIndex(masters);
}

function doc(overrides: Record<string, unknown> = {}) {
  return { verified: true, customerConfirmed: true, customerName: '山田太郎', ...overrides };
}

// ---------------------------------------------------------------- 紐づけ対象(link)

test('customerIdが無い・空文字・存在しないマスターを指す、確認済み書類は、同名1件のマスターへ紐づける', () => {
  assert.deepEqual(classifyCustomerIdLink(doc(), index()), {
    kind: 'link',
    masterId: 'm-yamada',
    before: { state: 'absent' },
  });
  assert.deepEqual(classifyCustomerIdLink(doc({ customerId: '' }), index()), {
    kind: 'link',
    masterId: 'm-yamada',
    before: { state: 'empty' },
  });
  assert.deepEqual(classifyCustomerIdLink(doc({ customerId: null }), index()), {
    kind: 'link',
    masterId: 'm-yamada',
    before: { state: 'null' },
  });
  assert.deepEqual(classifyCustomerIdLink(doc({ customerId: 'm-deleted' }), index()), {
    kind: 'link',
    masterId: 'm-yamada',
    before: { state: 'dangling', id: 'm-deleted' },
  });
});

test('顧客名の前後空白はtrimして照合する(エクスポートの乖離チェックと同じ)', () => {
  const r = classifyCustomerIdLink(doc({ customerName: '  山田太郎 ' }), index());
  assert.equal(r.kind, 'link');
});

// ---------------------------------------------------------------- 対象外

test('既に有効なマスターを指している書類は対象外(not-applicable)', () => {
  assert.deepEqual(classifyCustomerIdLink(doc({ customerId: 'm-tanaka' }), index()), { kind: 'not-applicable' });
});

test('確認済みでない書類は紐づけない(not-confirmed)', () => {
  for (const o of [{ verified: false }, { verified: undefined }, { customerConfirmed: false }, { customerConfirmed: undefined }]) {
    assert.deepEqual(classifyCustomerIdLink(doc(o), index()), { kind: 'skip', reason: 'not-confirmed' }, JSON.stringify(o));
  }
});

test('顧客名が無効(空・空白のみ・sentinel・非文字列)は紐づけない(invalid-name)', () => {
  for (const name of ['', '   ', '未判定', '不明顧客', undefined, null, 123]) {
    assert.deepEqual(classifyCustomerIdLink(doc({ customerName: name }), index()), { kind: 'skip', reason: 'invalid-name' }, String(name));
  }
});

test('同名マスターが2件以上(完全一致の同姓同名)は自動で紐づけない(ambiguous-same-name)', () => {
  assert.deepEqual(classifyCustomerIdLink(doc({ customerName: '佐藤花子' }), index()), {
    kind: 'skip',
    reason: 'ambiguous-same-name',
  });
});

test('空白違いの同姓同名も、完全一致が1件でも自動で紐づけない(ambiguous-same-name)', () => {
  for (const name of ['鈴木 一郎', '鈴木一郎']) {
    assert.deepEqual(classifyCustomerIdLink(doc({ customerName: name }), index()), { kind: 'skip', reason: 'ambiguous-same-name' }, name);
  }
});

test('同名マスターが無い場合は紐づけない(no-master)。全半角・空白違い・別表記は一致扱いにしない', () => {
  for (const name of ['存在しない人', '山田 太郎', '山田太郎さん']) {
    assert.deepEqual(classifyCustomerIdLink(doc({ customerName: name }), index()), { kind: 'skip', reason: 'no-master' }, name);
  }
});

test('customerIdが文字列以外(数値など)の書類は型異常として対象外(invalid-field-type)', () => {
  assert.deepEqual(classifyCustomerIdLink(doc({ customerId: 123 }), index()), { kind: 'skip', reason: 'invalid-field-type' });
  assert.deepEqual(classifyCustomerIdLink(doc({ customerId: { a: 1 } }), index()), { kind: 'skip', reason: 'invalid-field-type' });
});

test('マスターのnameが文字列でない/前後空白付きの場合も例外にならない', () => {
  const idx = buildMasterIndex([
    { id: 'a', name: undefined },
    { id: 'b', name: ' 山田太郎 ' }, // 前後空白付き: 生の完全一致では一致しない
  ]);
  assert.deepEqual(classifyCustomerIdLink(doc(), idx), { kind: 'skip', reason: 'no-master' });
});

// ---------------------------------------------------------------- 紐づけ後にエクスポートが顧客未確定へ落ちない

test('紐づけ後の書類は、エクスポート側の確認(precheckCustomerIdentity)でconfirmedになる', () => {
  const d = doc({ customerName: '  山田太郎 ' });
  const r = classifyCustomerIdLink(d, index());
  assert.equal(r.kind, 'link');
  const masterName = masters.find((m) => m.id === (r as { masterId: string }).masterId)!.name;
  // エクスポートは紐づけ先マスターのnameを取得して渡す(書類のcustomerNameはtrimのみ、マスター名は生で比較)
  const pre = precheckCustomerIdentity(d, { customerMasterName: masterName });
  assert.equal(pre.outcome, 'confirmed');
});

// ---------------------------------------------------------------- manifest / rollback

const entry = (over: Partial<CustomerIdLinkManifestEntry> = {}): CustomerIdLinkManifestEntry => ({
  docId: 'doc-1',
  customerIdBefore: { state: 'absent' },
  customerIdAfter: 'm-yamada',
  backfillUpdateTime: { seconds: 100, nanoseconds: 5 },
  ...over,
});

function manifest(entries = [entry()]) {
  return buildCustomerIdLinkManifest({
    runId: 'run-1',
    projectId: 'proj',
    timestamp: '2026-10-01T00:00:00.000Z',
    entries,
    skipped: { 'not-confirmed': [], 'invalid-name': ['d2'], 'ambiguous-same-name': ['d3'], 'no-master': ['d4'], 'invalid-field-type': [] },
    totalScanned: 10,
    scanIncomplete: false,
    dryRun: false,
    aborted: false,
    planned: entries.map((e) => ({ docId: e.docId, masterId: e.customerIdAfter, customerIdBefore: e.customerIdBefore })),
  });
}

test('manifestはJSON往復後も有効', () => {
  assert.equal(isValidCustomerIdLinkManifest(JSON.parse(JSON.stringify(manifest()))), true);
});

test('manifestの検証: 欠落・型不一致・想定外キー・重複docId・不正なbefore/docIdを拒否する', () => {
  const good = JSON.parse(JSON.stringify(manifest()));
  const mutate = (fn: (m: any) => void) => {
    const m = JSON.parse(JSON.stringify(good));
    fn(m);
    return m;
  };
  const bads = [
    null,
    'x',
    mutate((m) => (m.schemaVersion = 2)),
    mutate((m) => delete m.runId),
    mutate((m) => (m.entries = 'x')),
    mutate((m) => (m.extra = 1)),
    mutate((m) => (m.entries[0].extra = 1)),
    mutate((m) => (m.entries[0].docId = '')),
    mutate((m) => (m.entries[0].docId = 'a/b')),
    mutate((m) => (m.entries[0].customerIdAfter = '')),
    mutate((m) => (m.entries[0].customerIdBefore = { state: 'other' })),
    mutate((m) => (m.entries[0].customerIdBefore = { state: 'dangling' })),
    mutate((m) => (m.entries[0].customerIdBefore = { state: 'null', id: 'x' })),
    mutate((m) => (m.entries[0].customerIdBefore = { state: 'absent', id: 'x' })),
    mutate((m) => (m.entries[0].backfillUpdateTime = { seconds: 1 })),
    mutate((m) => m.entries.push(JSON.parse(JSON.stringify(m.entries[0])))),
    mutate((m) => (m.skipped['no-master'] = 'x')),
    mutate((m) => (m.skipped.unknown = [])),
    mutate((m) => (m.totalScanned = -1)),
    mutate((m) => delete m.aborted),
    mutate((m) => (m.planned = 'x')),
    mutate((m) => (m.planned[0].extra = 1)),
    mutate((m) => (m.planned[0].masterId = '')),
  ];
  for (const [i, b] of bads.entries()) assert.equal(isValidCustomerIdLinkManifest(b), false, `bad#${i}`);
});

test('rollback指示: absentはdelete、空文字は空文字へ、danglingは元のIDへ戻す', () => {
  assert.deepEqual(computeCustomerIdRollbackInstruction(entry()), { action: 'delete' });
  assert.deepEqual(computeCustomerIdRollbackInstruction(entry({ customerIdBefore: { state: 'null' } })), { action: 'set', value: null });
  assert.deepEqual(computeCustomerIdRollbackInstruction(entry({ customerIdBefore: { state: 'empty' } })), { action: 'set', value: '' });
  assert.deepEqual(computeCustomerIdRollbackInstruction(entry({ customerIdBefore: { state: 'dangling', id: 'm-old' } })), {
    action: 'set',
    value: 'm-old',
  });
});

test('rollback対象はupdateTimeが秒・ナノ秒とも完全一致する書類だけ', () => {
  const e = entry();
  assert.equal(isRollbackEligibleByUpdateTime(e, { seconds: 100, nanoseconds: 5 }), true);
  assert.equal(isRollbackEligibleByUpdateTime(e, { seconds: 100, nanoseconds: 6 }), false);
  assert.equal(isRollbackEligibleByUpdateTime(e, { seconds: 101, nanoseconds: 5 }), false);
});

// ---------------------------------------------------------------- executeLinks(書込みの安全分岐)

import { executeLinks, type LinkWriteTarget } from './customerIdLinkBackfillHelpers';

const target = (id: string, masterId = 'm-1'): LinkWriteTarget => ({ id, masterId, before: { state: 'absent' } });
const wt = { seconds: 10, nanoseconds: 1 };
const code9 = () => Object.assign(new Error('FAILED_PRECONDITION'), { code: 9 });

test('executeLinks: 全件成功すると、書込み順にentriesへ記録する', async () => {
  const entries: CustomerIdLinkManifestEntry[] = [];
  const r = await executeLinks([target('a'), target('b', 'm-2')], async () => wt, entries);
  assert.deepEqual(r, { written: 2, skippedPrecondition: 0, skippedNotFound: 0 });
  assert.deepEqual(entries.map((e) => [e.docId, e.customerIdAfter]), [['a', 'm-1'], ['b', 'm-2']]);
});

test('executeLinks: precondition不一致(code 9)はその書類だけスキップして続行し、entriesに記録しない', async () => {
  const entries: CustomerIdLinkManifestEntry[] = [];
  const skipped: string[] = [];
  const r = await executeLinks(
    [target('a'), target('b'), target('c')],
    async (t) => {
      if (t.id === 'b') throw code9();
      return wt;
    },
    entries,
    { onSkip: (id, reason) => skipped.push(`${id}:${reason}`) }
  );
  assert.deepEqual(r, { written: 2, skippedPrecondition: 1, skippedNotFound: 0 });
  assert.deepEqual(entries.map((e) => e.docId), ['a', 'c']);
  assert.deepEqual(skipped, ['b:precondition']);
});

test('executeLinks: code 9以外のエラーは再throwし、それまでの書込み記録はentriesに残る(途中停止でもrollbackの入力が失われない)', async () => {
  const entries: CustomerIdLinkManifestEntry[] = [];
  await assert.rejects(
    () =>
      executeLinks(
        [target('a'), target('b'), target('c')],
        async (t) => {
          if (t.id === 'b') throw Object.assign(new Error('UNAVAILABLE'), { code: 14 });
          return wt;
        },
        entries
      ),
    /UNAVAILABLE/
  );
  assert.deepEqual(entries.map((e) => e.docId), ['a'], '失敗の前に書いた1件は記録され、以降は書かれない');
});

test('executeLinks: codeを持たないエラーも握りつぶさず再throwする', async () => {
  await assert.rejects(() => executeLinks([target('a')], async () => { throw new Error('boom'); }, []), /boom/);
});

test('executeLinks: 書込み時点で書類が削除済み(code 5)でも全体を止めず、その書類だけスキップして続行する', async () => {
  const entries: CustomerIdLinkManifestEntry[] = [];
  const skipped: string[] = [];
  const r = await executeLinks(
    [target('a'), target('b'), target('c')],
    async (t) => {
      if (t.id === 'b') throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
      return wt;
    },
    entries,
    { onSkip: (id, reason) => skipped.push(`${id}:${reason}`) }
  );
  assert.deepEqual(r, { written: 2, skippedPrecondition: 0, skippedNotFound: 1 });
  assert.deepEqual(skipped, ['b:not-found']);
  assert.deepEqual(entries.map((e) => e.docId), ['a', 'c']);
});

test('executeLinks: 書込み1件ごとにonEntryが呼ばれる(manifestの逐次保存)。途中で例外停止しても、呼ばれた分は保存済み', async () => {
  const saved: string[] = [];
  await assert.rejects(() =>
    executeLinks(
      [target('a'), target('b'), target('c')],
      async (t) => {
        if (t.id === 'c') throw new Error('boom');
        return wt;
      },
      [],
      { onEntry: (e) => saved.push(e.docId) }
    )
  );
  assert.deepEqual(saved, ['a', 'b']);
});

test('NFKC正規化で同一になる別表記のマスター(半角カナ・濁点分解)が並存する場合も、自動では紐づけない(ambiguous-same-name)', () => {
  const idx = buildMasterIndex([
    { id: 'm1', name: 'ｶﾄｳ花子' }, // 半角カナ
    { id: 'm2', name: 'カトウ花子' },
  ]);
  assert.deepEqual(classifyCustomerIdLink(doc({ customerName: 'カトウ花子' }), idx), { kind: 'skip', reason: 'ambiguous-same-name' });
  const nfd = buildMasterIndex([
    { id: 'm1', name: 'ガ田花子'.normalize('NFD') },
    { id: 'm2', name: 'ガ田花子'.normalize('NFC') },
  ]);
  assert.deepEqual(classifyCustomerIdLink(doc({ customerName: 'ガ田花子'.normalize('NFC') }), nfd), { kind: 'skip', reason: 'ambiguous-same-name' });
});

test('buildMasterIndex: nameが文字列でないマスターの件数を数える', () => {
  assert.equal(buildMasterIndex([{ id: 'a', name: undefined }, { id: 'b', name: 5 }, { id: 'c', name: '山田太郎' }]).nonStringNameCount, 2);
});

// ---------------------------------------------------------------- マスター再検証(findDriftedTargets)・フリガナ確認

import { findDriftedTargets } from './customerIdLinkBackfillHelpers';

test('findDriftedTargets: マスターが変化していなければ空', () => {
  const targets = [{ masterId: 'm-yamada', data: doc() }];
  assert.deepEqual(findDriftedTargets(targets, index()), []);
});

test('findDriftedTargets: 紐づけ先マスターが削除された/改名された/同名が追加された対象を検出する(書込み前に中断する根拠)', () => {
  const t = { masterId: 'm-yamada', data: doc() };
  assert.equal(findDriftedTargets([t], buildMasterIndex(masters.filter((m) => m.id !== 'm-yamada'))).length, 1, '削除');
  assert.equal(findDriftedTargets([t], buildMasterIndex(masters.map((m) => (m.id === 'm-yamada' ? { ...m, name: '山田 太郎' } : m)))).length, 1, '改名');
  assert.equal(findDriftedTargets([t], buildMasterIndex([...masters, { id: 'm-yamada-2', name: '山田太郎' }])).length, 1, '同名追加');
  assert.equal(findDriftedTargets([t], buildMasterIndex([...masters, { id: 'm-yamada-3', name: '山田 太郎' }])).length, 1, '空白違いの同名追加');
});

test('findDriftedTargets: 別のマスターに付け替わる場合(旧マスター削除+同名の別マスターのみ残る)も検出する', () => {
  const t = { masterId: 'm-yamada', data: doc() };
  const fresh = buildMasterIndex([{ id: 'm-new', name: '山田太郎' }]);
  assert.equal(findDriftedTargets([t], fresh).length, 1);
});

test('buildMasterIndex: furiganaが無い/空/空白のみのマスターIDを数える', () => {
  const idx = buildMasterIndex([
    { id: 'a', name: 'A', furigana: 'エー' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C', furigana: '' },
    { id: 'd', name: 'D', furigana: '  ' },
    { id: 'e', name: 'E', furigana: 5 },
  ]);
  assert.deepEqual([...idx.idsWithoutFurigana].sort(), ['b', 'c', 'd', 'e']);
});
