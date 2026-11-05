import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRate, parseJstDateTime, timeRanges, wilsonInterval } from './rateWindows';

test('parseJstDateTime: JSTの「YYYY-MM-DDTHH:mm」をUTCのミリ秒に変換する', () => {
  assert.equal(parseJstDateTime('2026-11-04T18:30'), Date.parse('2026-11-04T09:30:00Z'));
  assert.equal(parseJstDateTime('2026-11-05T00:00'), Date.parse('2026-11-04T15:00:00Z'));
});

test('parseJstDateTime: 形式違い・存在しない日時・範囲外はnull(黙って別の日時にしない)', () => {
  assert.equal(parseJstDateTime('2026-11-04'), null); // 時刻なし
  assert.equal(parseJstDateTime('2026-11-04 18:30'), null);
  assert.equal(parseJstDateTime('2026-02-30T10:00'), null); // 存在しない日
  assert.equal(parseJstDateTime('2026-13-01T10:00'), null);
  assert.equal(parseJstDateTime('2026-11-04T24:00'), null);
  assert.equal(parseJstDateTime('2026-11-04T18:60'), null);
  assert.equal(parseJstDateTime(undefined), null);
  assert.equal(parseJstDateTime(''), null);
});

test('timeRanges: 開始から終了まで、一定の幅で区切る。最後の区間は終了で切る', () => {
  const H = 3_600_000;
  const r = timeRanges(0, 5 * H, 2 * H);
  assert.deepEqual(r, [
    { startMs: 0, endMs: 2 * H },
    { startMs: 2 * H, endMs: 4 * H },
    { startMs: 4 * H, endMs: 5 * H },
  ]);
});

test('timeRanges: 終了が開始以前・幅が0以下なら空(無限ループにしない)', () => {
  assert.deepEqual(timeRanges(10, 10, 5), []);
  assert.deepEqual(timeRanges(10, 5, 5), []);
  assert.deepEqual(timeRanges(0, 10, 0), []);
  assert.deepEqual(timeRanges(0, 10, -1), []);
  assert.deepEqual(timeRanges(0, 10, Number.NaN), []);
});

test('wilsonInterval: 8/100 の95%信頼区間は、約4.1%〜15.0%', () => {
  const ci = wilsonInterval(8, 100);
  assert.ok(ci);
  assert.ok(Math.abs(ci.lower - 0.0411) < 0.002, `lower=${ci.lower}`);
  assert.ok(Math.abs(ci.upper - 0.15) < 0.002, `upper=${ci.upper}`);
});

test('wilsonInterval: 0件・全件・分母0・不正な値', () => {
  assert.equal(wilsonInterval(0, 0), null);
  assert.equal(wilsonInterval(-1, 10), null);
  assert.equal(wilsonInterval(11, 10), null);
  const zero = wilsonInterval(0, 10);
  assert.ok(zero);
  assert.equal(zero.lower, 0);
  assert.ok(zero.upper > 0);
  const all = wilsonInterval(10, 10);
  assert.ok(all);
  assert.equal(all.upper, 1);
});

test('formatRate: 件数・割合・信頼区間を文字列にする。分母0は"-"', () => {
  assert.equal(formatRate(0, 0), '-');
  assert.match(formatRate(8, 100), /^8\.0% \[4\.1–15\.0\]$/);
  assert.match(formatRate(0, 5), /^0\.0% \[0\.0–\d+\.\d\]$/);
});
