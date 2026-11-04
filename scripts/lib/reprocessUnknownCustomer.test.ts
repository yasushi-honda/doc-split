import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  exitCodeFor,
  isReprocessEligible,
  selectReprocessTargets,
  summarizeTransitions,
  type AfterState,
  type BeforeState,
  type TargetCandidate,
} from './reprocessUnknownCustomer';

const SINCE = Date.parse('2026-10-31T15:00:00Z'); // JST 2026-11-01 0時
const IN = SINCE + 3_600_000;

function cand(id: string, o: Partial<TargetCandidate> = {}): TargetCandidate {
  return { id, status: 'processed', verified: false, processedAtMs: IN, customerUnknown: true, ...o };
}

test('selectReprocessTargets: 窓の内側・processed・確認なし・利用者不明だけを選ぶ', () => {
  const ids = selectReprocessTargets(
    [
      cand('ok'),
      cand('verified', { verified: true }),
      cand('split', { status: 'split' }),
      cand('pending', { status: 'pending' }),
      cand('error', { status: 'error' }),
      cand('known', { customerUnknown: false }),
      cand('old', { processedAtMs: SINCE - 1 }),
      cand('nodate', { processedAtMs: null }),
    ],
    SINCE,
  );
  assert.deepEqual(ids, ['ok']);
});

test('selectReprocessTargets: 境界(窓の開始ちょうど)を含み、1ms前は含まない', () => {
  const ids = selectReprocessTargets([cand('edge', { processedAtMs: SINCE }), cand('before', { processedAtMs: SINCE - 1 })], SINCE);
  assert.deepEqual(ids, ['edge']);
});

test('selectReprocessTargets: 処理日時の昇順(同時刻はID順)で並べ、limitで先頭から切る', () => {
  const docs = [cand('c', { processedAtMs: IN + 2 }), cand('b', { processedAtMs: IN }), cand('a', { processedAtMs: IN })];
  assert.deepEqual(selectReprocessTargets(docs, SINCE), ['a', 'b', 'c']);
  assert.deepEqual(selectReprocessTargets(docs, SINCE, 2), ['a', 'b']);
});

test('selectReprocessTargets: limitが0以下・NaNなら全件(誤って0件にしない)', () => {
  const docs = [cand('a'), cand('b')];
  assert.deepEqual(selectReprocessTargets(docs, SINCE, 0), ['a', 'b']);
  assert.deepEqual(selectReprocessTargets(docs, SINCE, Number.NaN), ['a', 'b']);
});

const B = (docTypeBucket: BeforeState['docTypeBucket']): BeforeState => ({ docTypeBucket });
const A = (o: Partial<AfterState> = {}): AfterState => ({ status: 'processed', customerUnknown: true, docTypeBucket: 'undetermined', ...o });

test('summarizeTransitions: 利用者・書類種別の改善/変化なし/悪化を数える', () => {
  const before = new Map<string, BeforeState>([
    ['a', B('undetermined')],
    ['b', B('undetermined')],
    ['c', B('other')],
    ['d', B('undetermined')],
  ]);
  const after = new Map<string, AfterState>([
    ['a', A({ customerUnknown: false, docTypeBucket: 'other' })], // 両方改善
    ['b', A()], // 変化なし
    ['c', A({ customerUnknown: false, docTypeBucket: 'other' })], // 利用者のみ改善(元から書類種別は判定済み)
    ['d', A({ status: 'error' })], // エラー
  ]);
  const s = summarizeTransitions(before, after);
  assert.equal(s.total, 4);
  assert.equal(s.customerResolved, 2);
  assert.equal(s.docTypeResolved, 1);
  assert.equal(s.unchanged, 1);
  assert.equal(s.error, 1);
  assert.equal(s.notFinished, 0);
  assert.equal(s.missing, 0);
});

test('summarizeTransitions: 合計は、改善・変化なし・エラー・未完了・欠損・悪化の分類の和と一致する', () => {
  const before = new Map<string, BeforeState>([
    ['a', B('undetermined')],
    ['b', B('other')],
    ['c', B('undetermined')],
    ['d', B('undetermined')],
    ['e', B('undetermined')],
  ]);
  const after = new Map<string, AfterState>([
    ['a', A({ customerUnknown: false })],
    ['b', A({ docTypeBucket: 'undetermined' })], // 書類種別が判定済み→未判定(悪化)
    ['c', A({ status: 'processing' })],
    ['d', A({ status: 'pending' })],
    // eは欠損
  ]);
  const s = summarizeTransitions(before, after);
  assert.equal(s.total, 5);
  assert.equal(s.worsened, 1);
  assert.equal(s.notFinished, 2);
  assert.equal(s.missing, 1);
  assert.equal(s.improved + s.unchanged + s.error + s.notFinished + s.missing + s.worsened, s.total);
});

test('summarizeTransitions: 出力のキーは固定語彙と件数だけ(IDを含まない)', () => {
  const before = new Map<string, BeforeState>([['SECRET-ID-123', B('undetermined')]]);
  const after = new Map<string, AfterState>([['SECRET-ID-123', A()]]);
  assert.ok(!JSON.stringify(summarizeTransitions(before, after)).includes('SECRET'));
});

test('summarizeTransitions: 対象が0件でも崩れない', () => {
  const s = summarizeTransitions(new Map(), new Map());
  assert.equal(s.total, 0);
  assert.equal(s.improved, 0);
});

test('isReprocessEligible: processed・確認なし・利用者不明のときだけ真(トランザクション内の再確認に使う)', () => {
  assert.equal(isReprocessEligible({ status: 'processed', verified: false, customerUnknown: true }), true);
  assert.equal(isReprocessEligible({ status: 'processed', verified: true, customerUnknown: true }), false); // 取得後に確認済みになった
  assert.equal(isReprocessEligible({ status: 'processed', verified: false, customerUnknown: false }), false); // 取得後に利用者が確定した
  assert.equal(isReprocessEligible({ status: 'pending', verified: false, customerUnknown: true }), false);
  assert.equal(isReprocessEligible({ status: 'error', verified: false, customerUnknown: true }), false);
});

test('summarizeTransitions: 再処理したIDだけを渡せば、スキップした書類は集計に入らない', () => {
  const all = new Map<string, BeforeState>([
    ['reset', B('undetermined')],
    ['skipped', B('undetermined')],
  ]);
  const resetOnly = new Map([...all].filter(([id]) => id === 'reset'));
  const after = new Map<string, AfterState>([
    ['reset', A({ customerUnknown: false })],
    ['skipped', A({ customerUnknown: false })], // 触っていないのに、別の理由で変わった
  ]);
  const s = summarizeTransitions(resetOnly, after);
  assert.equal(s.total, 1);
  assert.equal(s.improved, 1);
});

const CLEAN = { total: 3, notFinished: 0, error: 0, missing: 0, customerResolved: 0, docTypeResolved: 0, improved: 0, unchanged: 3, worsened: 0 };

test('exitCodeFor: すべて完了していれば0', () => {
  assert.equal(exitCodeFor(CLEAN, 0), 0);
});

test('exitCodeFor: 未完了が残れば2(部分的な結果を、成功と誤読させない)', () => {
  assert.equal(exitCodeFor({ ...CLEAN, notFinished: 1 }, 0), 2);
});

test('exitCodeFor: リセットの失敗・処理エラー・見つからない書類があれば1', () => {
  assert.equal(exitCodeFor(CLEAN, 1), 1);
  assert.equal(exitCodeFor({ ...CLEAN, error: 1 }, 0), 1);
  assert.equal(exitCodeFor({ ...CLEAN, missing: 1 }, 0), 1);
});

test('exitCodeFor: 未完了と他の問題が重なれば2(未完了を優先して知らせる)', () => {
  assert.equal(exitCodeFor({ ...CLEAN, notFinished: 1, error: 1 }, 1), 2);
});
