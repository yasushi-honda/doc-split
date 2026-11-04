import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isCustomerUnknown,
  jstDateKey,
  jstDayRanges,
  normalizeMimeType,
  pageBand,
  parseSinceArg,
  reprocessTargetIds,
  summarizeUndetermined,
  type UndeterminedDocInput,
} from './undeterminedSummary';

function doc(overrides: Partial<UndeterminedDocInput> = {}): UndeterminedDocInput {
  return {
    processedAtMs: Date.parse('2026-11-02T03:00:00Z'), // JST 2026-11-02 12:00
    verified: false,
    customerUnknown: true,
    totalPages: 2,
    mimeType: 'application/pdf',
    hasDistributionId: false,
    ...overrides,
  };
}

test('jstDateKey: JSTの日付境界(UTC 14:59:59は当日、15:00:00は翌日)', () => {
  assert.equal(jstDateKey(Date.parse('2026-11-01T14:59:59Z')), '2026-11-01');
  assert.equal(jstDateKey(Date.parse('2026-11-01T15:00:00Z')), '2026-11-02');
  assert.equal(jstDateKey(Date.parse('2026-10-31T15:00:00Z')), '2026-11-01');
});

test('jstDateKey: 月末→月初・年またぎ', () => {
  assert.equal(jstDateKey(Date.parse('2026-12-31T15:00:00Z')), '2027-01-01');
});

test('pageBand: 境界値(1/2/20/21/50/51ページ)と異常値', () => {
  assert.equal(pageBand(1), '1');
  assert.equal(pageBand(2), '2-20');
  assert.equal(pageBand(20), '2-20');
  assert.equal(pageBand(21), '21-50');
  assert.equal(pageBand(50), '21-50');
  assert.equal(pageBand(51), '51+');
  assert.equal(pageBand(0), 'unknown');
  assert.equal(pageBand(null), 'unknown');
  assert.equal(pageBand(Number.NaN), 'unknown');
});

test('summarizeUndetermined: 空入力はすべて0', () => {
  const s = summarizeUndetermined([]);
  assert.equal(s.total, 0);
  assert.equal(s.unverified, 0);
  assert.equal(s.reprocessTargets, 0);
  assert.deepEqual(s.byDay, {});
});

test('summarizeUndetermined: 確認済み・利用者判定済みは再処理対象に数えない', () => {
  const s = summarizeUndetermined([
    doc(), // 対象(未確認・利用者不明)
    doc({ verified: true }), // 確認済み: 対象外
    doc({ customerUnknown: false }), // 利用者は判定済み: 対象外
    doc({ verified: true, customerUnknown: false }),
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.verified, 2);
  assert.equal(s.unverified, 2);
  assert.equal(s.reprocessTargets, 1);
});

test('summarizeUndetermined: 日別・ページ数帯・MIME・複製の集計と、processedAt欠損はunknown日に入る', () => {
  const s = summarizeUndetermined([
    doc({ totalPages: 2 }),
    doc({ totalPages: 30, mimeType: 'image/jpeg' }),
    doc({ processedAtMs: Date.parse('2026-11-03T03:00:00Z'), hasDistributionId: true }),
    doc({ processedAtMs: null, totalPages: null, mimeType: null }),
  ]);
  assert.deepEqual(s.byDay['2026-11-02'], { total: 2, reprocessTargets: 2 });
  assert.deepEqual(s.byDay['2026-11-03'], { total: 1, reprocessTargets: 1 });
  assert.deepEqual(s.byDay['unknown'], { total: 1, reprocessTargets: 1 });
  assert.equal(s.pagesBand['2-20'], 2);
  assert.equal(s.pagesBand['21-50'], 1);
  assert.equal(s.pagesBand['unknown'], 1);
  assert.equal(s.mimeTypes['application/pdf'], 2);
  assert.equal(s.mimeTypes['image/jpeg'], 1);
  assert.equal(s.mimeTypes['unknown'], 1);
  assert.equal(s.withDistributionId, 1);
});

test('summarizeUndetermined: 確認済み×利用者不明の4通りを個別に集計し、日別と合計が一致する(表駆動)', () => {
  const cases: Array<[boolean, boolean, number]> = [
    [false, true, 1], // 未確認・利用者不明: 対象
    [true, true, 0],
    [false, false, 0],
    [true, false, 0],
  ];
  for (const [verified, customerUnknown, expected] of cases) {
    const s = summarizeUndetermined([doc({ verified, customerUnknown })]);
    assert.equal(s.reprocessTargets, expected, `verified=${verified} customerUnknown=${customerUnknown}`);
    assert.equal(s.byDay['2026-11-02'].reprocessTargets, expected, '日別の対象件数が合計と一致すること');
  }
});

test('summarizeUndetermined: UTC 14:59:59 と 15:00:00 の2件が、JSTの別の日に入る', () => {
  const s = summarizeUndetermined([
    doc({ processedAtMs: Date.parse('2026-11-01T14:59:59Z') }),
    doc({ processedAtMs: Date.parse('2026-11-01T15:00:00Z') }),
  ]);
  assert.equal(s.byDay['2026-11-01'].total, 1);
  assert.equal(s.byDay['2026-11-02'].total, 1);
});

test('summarizeUndetermined: 空入力は全体が空構造(deepEqual)', () => {
  assert.deepEqual(summarizeUndetermined([]), {
    total: 0,
    verified: 0,
    unverified: 0,
    reprocessTargets: 0,
    withDistributionId: 0,
    byDay: {},
    pagesBand: {},
    mimeTypes: {},
  });
});

test('normalizeMimeType: 許可リスト内は正規化し、それ以外は other、欠損はunknown', () => {
  assert.equal(normalizeMimeType('application/pdf'), 'application/pdf');
  assert.equal(normalizeMimeType('APPLICATION/PDF'), 'application/pdf');
  assert.equal(normalizeMimeType('image/jpeg; charset=binary'), 'image/jpeg');
  assert.equal(normalizeMimeType('image/png'), 'image/png');
  assert.equal(normalizeMimeType('image/tiff'), 'image/tiff');
  assert.equal(normalizeMimeType(null), 'unknown');
  assert.equal(normalizeMimeType(''), 'unknown');
  assert.equal(normalizeMimeType('application/x-unknown'), 'other');
});

test('normalizeMimeType: 個人名などの自由文字列は、そのまま出力されず other にまとめる(PII漏洩防止)', () => {
  assert.equal(normalizeMimeType('田中太郎'), 'other');
  assert.equal(normalizeMimeType('application/田中太郎'), 'other');
  assert.equal(normalizeMimeType('image/山田花子-契約書'), 'other');
});

test('summarizeUndetermined: 出力の全キーが日付・固定語彙のみで、自由文字列(PII)を含まない', () => {
  const s = summarizeUndetermined([
    doc({ mimeType: '田中太郎' }),
    doc({ mimeType: 'application/pdf' }),
    doc({ mimeType: null }),
  ]);
  const allowedMime = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff', 'image/gif', 'other', 'unknown']);
  for (const k of Object.keys(s.mimeTypes)) assert.ok(allowedMime.has(k), `想定外のMIMEキー: ${k}`);
  for (const k of Object.keys(s.byDay)) assert.match(k, /^(\d{4}-\d{2}-\d{2}|unknown)$/);
  for (const k of Object.keys(s.pagesBand)) assert.match(k, /^(1|2-20|21-50|51\+|unknown)$/);
  assert.ok(!JSON.stringify(s).includes('田中'));
});

test('isCustomerUnknown: 共有のsentinel(未判定・不明顧客)・空・欠損は不明、通常の名前は判定済み', () => {
  assert.equal(isCustomerUnknown('不明顧客'), true);
  assert.equal(isCustomerUnknown('未判定'), true);
  assert.equal(isCustomerUnknown(''), true);
  assert.equal(isCustomerUnknown(undefined), true);
  assert.equal(isCustomerUnknown(null), true);
  assert.equal(isCustomerUnknown(123), true); // 文字列でなければ不明扱い
  assert.equal(isCustomerUnknown('山田 太郎'), false);
});

test('parseSinceArg: 正しいJST日付はJST 0時のエポックmsに変換する', () => {
  assert.equal(parseSinceArg('2026-11-01'), Date.parse('2026-10-31T15:00:00Z'));
});

test('parseSinceArg: 欠落・形式違い・存在しない日付・別フラグは null(2月30日の繰り上がりも拒否)', () => {
  assert.equal(parseSinceArg(undefined), null);
  assert.equal(parseSinceArg('--foo'), null);
  assert.equal(parseSinceArg('2026/11/01'), null);
  assert.equal(parseSinceArg('2026-13-01'), null);
  assert.equal(parseSinceArg('2026-02-30'), null);
  assert.equal(parseSinceArg('2026-11-31'), null);
  assert.equal(parseSinceArg('2028-02-29'), Date.parse('2028-02-28T15:00:00Z')); // うるう日は有効
});

test('jstDayRanges: 日ごとの[開始, 終了)を、JSTの暦日キーと対応づけて返す', () => {
  const since = Date.parse('2026-10-31T15:00:00Z'); // 2026-11-01 JST 0時
  const now = Date.parse('2026-11-03T03:00:00Z'); // 2026-11-03 JST 12時
  const r = jstDayRanges(since, now);
  assert.deepEqual(r.map((x) => x.day), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(r[0].endMs - r[0].startMs, 24 * 60 * 60 * 1000);
  assert.equal(r[1].startMs, r[0].endMs);
});

test('jstDayRanges: nowがちょうど日の0時なら、その日(空)も1個含む。未来のsinceは空', () => {
  const since = Date.parse('2026-10-31T15:00:00Z');
  assert.equal(jstDayRanges(since, since).length, 1);
  assert.deepEqual(jstDayRanges(since, since - 1), []);
});

test('reprocessTargetIds: 未確認かつ利用者不明の書類IDだけを返す(確認済み・利用者判定済みは除く)', () => {
  const ids = reprocessTargetIds([
    { id: 'aaa111', input: doc() },
    { id: 'bbb222', input: doc({ verified: true }) },
    { id: 'ccc333', input: doc({ customerUnknown: false }) },
    { id: 'ddd444', input: doc() },
  ]);
  assert.deepEqual(ids, ['aaa111', 'ddd444']);
});

test('reprocessTargetIds: ID文字列の形式が英数字・_・-以外(想定外の文字)なら出力しない(公開ログ保護)', () => {
  const ids = reprocessTargetIds([
    { id: 'ok_ID-1', input: doc() },
    { id: '田中太郎', input: doc() },
    { id: 'has space', input: doc() },
    { id: '', input: doc() },
  ]);
  assert.deepEqual(ids, ['ok_ID-1']);
});

test('reprocessTargetIds: 空入力は空配列、並びは入力順(再現性)', () => {
  assert.deepEqual(reprocessTargetIds([]), []);
  assert.deepEqual(
    reprocessTargetIds([
      { id: 'z9', input: doc() },
      { id: 'a1', input: doc() },
    ]),
    ['z9', 'a1'],
  );
});
