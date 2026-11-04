import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  jstDateKey,
  pageBand,
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

test('summarizeUndetermined: 出力に書類名・利用者名・本文を含む経路がない(入力型が数値・真偽・種別のみ)', () => {
  const s = summarizeUndetermined([doc()]);
  const json = JSON.stringify(s);
  assert.ok(!/fileName|customerName|ocrResult|officeName/.test(json));
});
