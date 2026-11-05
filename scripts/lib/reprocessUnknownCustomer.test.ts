import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  estimatedDelayMinutes,
  exitCodeFor,
  ocrEngineBucket,
  fitsInWaitWindow,
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
  return { id, status: 'processed', verified: false, processedAtMs: IN, customerUnknown: true, docTypeBucket: 'undetermined', ...o };
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

const B = (docTypeBucket: BeforeState['docTypeBucket'], customerUnknown = true): BeforeState => ({ docTypeBucket, customerUnknown });
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
  assert.equal(isReprocessEligible({ status: 'processed', verified: false, customerUnknown: true, docTypeBucket: 'other' }), true);
  assert.equal(isReprocessEligible({ status: 'processed', verified: true, customerUnknown: true, docTypeBucket: 'other' }), false); // 取得後に確認済みになった
  assert.equal(isReprocessEligible({ status: 'processed', verified: false, customerUnknown: false, docTypeBucket: 'other' }), false); // 取得後に利用者が確定した
  assert.equal(isReprocessEligible({ status: 'pending', verified: false, customerUnknown: true, docTypeBucket: 'other' }), false);
  assert.equal(isReprocessEligible({ status: 'error', verified: false, customerUnknown: true, docTypeBucket: 'other' }), false);
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

const CLEAN = { total: 3, notFinished: 0, error: 0, missing: 0, customerResolved: 0, customerLost: 0, docTypeResolved: 0, improved: 0, unchanged: 3, worsened: 0 };

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

test('fitsInWaitWindow: 実測の処理能力(1分1.5件)で、待機時間内に終わる件数なら真', () => {
  // 40分 × 1.5件/分 = 60件(実測: 75件のうち67件が40分、47件が約25分 = 1.7〜1.9件/分)
  assert.equal(fitsInWaitWindow(60, 40), true);
  assert.equal(fitsInWaitWindow(61, 40), false);
  assert.equal(fitsInWaitWindow(75, 40), false); // 10月分75件は、40分の待機では終わらなかった実績どおり拒否
  assert.equal(fitsInWaitWindow(75, 60), true); // 60分なら通る(90件まで)
  assert.equal(fitsInWaitWindow(0, 40), true);
});

test('estimatedDelayMinutes: 件数を実測の処理能力で割った、新着の遅れの見込み(分、切り上げ)', () => {
  assert.equal(estimatedDelayMinutes(75), 50);
  assert.equal(estimatedDelayMinutes(47), 32);
  assert.equal(estimatedDelayMinutes(1), 1);
  assert.equal(estimatedDelayMinutes(0), 0);
});

test('fitsInWaitWindow: 待機時間が不正(0以下・NaN)なら偽(誤って通さない)', () => {
  assert.equal(fitsInWaitWindow(1, 0), false);
  assert.equal(fitsInWaitWindow(1, Number.NaN), false);
});

test('selectReprocessTargets(undetermined): 書類種別が未判定・processed・確認なしを選ぶ。利用者が確定済みの書類も含む', () => {
  const ids = selectReprocessTargets(
    [
      cand('known-undet', { customerUnknown: false }), // 利用者は確定済み・未判定 → 対象
      cand('unknown-undet'), // 利用者不明・未判定 → 対象
      cand('known-other', { customerUnknown: false, docTypeBucket: 'other' }), // 判定済み → 対象外
      cand('verified', { verified: true, customerUnknown: false }), // 確認済み → 対象外
      cand('split', { status: 'split', customerUnknown: false }),
      cand('old', { processedAtMs: SINCE - 1, customerUnknown: false }),
    ],
    SINCE,
    undefined,
    'undetermined',
  );
  assert.deepEqual(ids, ['known-undet', 'unknown-undet']);
});

test('selectReprocessTargets(既定=unknown-customer): 書類種別が判定済みでも利用者不明なら対象(従来どおり)', () => {
  const ids = selectReprocessTargets([cand('a', { docTypeBucket: 'other' }), cand('b', { customerUnknown: false })], SINCE);
  assert.deepEqual(ids, ['a']);
});

test('isReprocessEligible(undetermined): トランザクション内の再確認で、判定済みになった書類は偽', () => {
  const base = { status: 'processed', verified: false, customerUnknown: false };
  assert.equal(isReprocessEligible({ ...base, docTypeBucket: 'undetermined' }, 'undetermined'), true);
  assert.equal(isReprocessEligible({ ...base, docTypeBucket: 'other' }, 'undetermined'), false);
  assert.equal(isReprocessEligible({ ...base, docTypeBucket: 'undetermined', verified: true }, 'undetermined'), false);
});

test('summarizeTransitions: 再処理前から利用者が確定済みの書類は「利用者が不明でなくなった」に数えない', () => {
  const before = new Map<string, BeforeState>([
    ['known', B('undetermined', false)], // 利用者は元から確定
    ['unknown', B('undetermined', true)],
  ]);
  const after = new Map<string, AfterState>([
    ['known', A({ customerUnknown: false })], // 未判定のまま、利用者も確定のまま → 変化なし
    ['unknown', A({ customerUnknown: false })], // 利用者が不明でなくなった
  ]);
  const s = summarizeTransitions(before, after);
  assert.equal(s.customerResolved, 1);
  assert.equal(s.improved, 1);
  assert.equal(s.unchanged, 1);
});

test('summarizeTransitions: 元は利用者が確定済みだった書類が、再処理で不明に戻ったら customerLost に数える', () => {
  const before = new Map<string, BeforeState>([
    ['lost', B('undetermined', false)],
    ['lost-and-typed', B('undetermined', false)],
    ['kept', B('undetermined', false)],
  ]);
  const after = new Map<string, AfterState>([
    ['lost', A({ customerUnknown: true })], // 利用者を失った(書類種別は未判定のまま)
    ['lost-and-typed', A({ customerUnknown: true, docTypeBucket: 'other' })], // 書類種別は判定できたが、利用者を失った
    ['kept', A({ customerUnknown: false })],
  ]);
  const s = summarizeTransitions(before, after);
  assert.equal(s.customerLost, 2);
  assert.equal(s.improved, 1); // lost-and-typed は書類種別が解消(improved)。利用者を失った点は customerLost で別に見える
  assert.equal(s.unchanged, 2);
});

test('exitCodeFor: 利用者を失った書類があれば1(副作用を、緑のジョブに埋もれさせない)', () => {
  assert.equal(exitCodeFor({ ...CLEAN, customerLost: 1 }, 0), 1);
});

test('selectReprocessTargets: untilMs(排他的な上限)を超える処理日時は除く。上限ちょうどは含まない', () => {
  const UNTIL = IN + 10_000;
  const docs = [cand('in', { processedAtMs: IN }), cand('edge', { processedAtMs: UNTIL }), cand('after', { processedAtMs: UNTIL + 1 })];
  assert.deepEqual(selectReprocessTargets(docs, SINCE, undefined, 'unknown-customer', UNTIL), ['in']);
  assert.deepEqual(selectReprocessTargets(docs, SINCE, undefined, 'unknown-customer'), ['in', 'edge', 'after']); // 上限なしは従来どおり
});

test('selectReprocessTargets: untilMs と limit は併用でき、窓で絞ってから先頭limit件を取る', () => {
  const docs = [cand('a', { processedAtMs: IN }), cand('b', { processedAtMs: IN + 1 }), cand('c', { processedAtMs: IN + 2 })];
  assert.deepEqual(selectReprocessTargets(docs, SINCE, 1, 'unknown-customer', IN + 2), ['a']);
});

test('ocrEngineBucket: 処理に使った仕組みを、固定語彙(paddle/gemini/other/unknown)に丸める(自由文字列を出さない)', () => {
  assert.equal(ocrEngineBucket('PP-OCRv6_medium'), 'paddle');
  assert.equal(ocrEngineBucket('gemini-2.5-flash'), 'gemini');
  assert.equal(ocrEngineBucket('Gemini-3.5'), 'gemini');
  assert.equal(ocrEngineBucket('something-secret-name'), 'other');
  assert.equal(ocrEngineBucket(undefined), 'unknown');
  assert.equal(ocrEngineBucket(null), 'unknown');
  assert.equal(ocrEngineBucket(''), 'unknown');
  assert.equal(ocrEngineBucket(42), 'unknown');
});

test("ocrEngineBucket: OCRを実行しなかった書類が持つ文字列 'unknown' は、other ではなく unknown に数える", () => {
  assert.equal(ocrEngineBucket('unknown'), 'unknown');
  assert.equal(ocrEngineBucket(' unknown '), 'unknown');
});
