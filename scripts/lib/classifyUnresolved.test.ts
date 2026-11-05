import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  candidateCountBand,
  confidenceBand,
  matchTypeBucket,
  pagesBand,
  summarizeFeatures,
  textLengthBand,
  type FeatureRow,
} from './classifyUnresolved';

test('pagesBand: ページ数を固定の帯に丸める(境界値と異常値)', () => {
  assert.equal(pagesBand(1), '1');
  assert.equal(pagesBand(2), '2-3');
  assert.equal(pagesBand(3), '2-3');
  assert.equal(pagesBand(4), '4-9');
  assert.equal(pagesBand(9), '4-9');
  assert.equal(pagesBand(10), '10+');
  assert.equal(pagesBand(0), 'unknown');
  assert.equal(pagesBand(-1), 'unknown');
  assert.equal(pagesBand(Number.NaN), 'unknown');
  assert.equal(pagesBand(undefined), 'unknown');
  assert.equal(pagesBand('3'), 'unknown');
});

test('textLengthBand: 認識テキストの長さを帯に丸める。外部保存(ocrResultUrl)と欠損を区別する', () => {
  assert.equal(textLengthBand('', false), '0');
  assert.equal(textLengthBand('a'.repeat(1), false), '1-49');
  assert.equal(textLengthBand('a'.repeat(49), false), '1-49');
  assert.equal(textLengthBand('a'.repeat(50), false), '50-199');
  assert.equal(textLengthBand('a'.repeat(199), false), '50-199');
  assert.equal(textLengthBand('a'.repeat(200), false), '200-999');
  assert.equal(textLengthBand('a'.repeat(999), false), '200-999');
  assert.equal(textLengthBand('a'.repeat(1000), false), '1000+');
  assert.equal(textLengthBand(undefined, true), 'external');
  assert.equal(textLengthBand(undefined, false), 'missing');
  assert.equal(textLengthBand(42, false), 'missing');
});

test('confidenceBand: 信頼度(0-100)を帯に丸める。範囲外・欠損は none', () => {
  assert.equal(confidenceBand(0), '0-39');
  assert.equal(confidenceBand(39), '0-39');
  assert.equal(confidenceBand(40), '40-69');
  assert.equal(confidenceBand(69), '40-69');
  assert.equal(confidenceBand(70), '70-89');
  assert.equal(confidenceBand(89), '70-89');
  assert.equal(confidenceBand(90), '90+');
  assert.equal(confidenceBand(100), '90+');
  assert.equal(confidenceBand(101), 'none');
  assert.equal(confidenceBand(-1), 'none');
  assert.equal(confidenceBand(undefined), 'none');
  assert.equal(confidenceBand(Number.NaN), 'none');
});

test('matchTypeBucket: 一致の種類を固定語彙に丸める(自由文字列を出さない)', () => {
  assert.equal(matchTypeBucket('exact'), 'exact');
  assert.equal(matchTypeBucket('partial'), 'partial');
  assert.equal(matchTypeBucket('fuzzy'), 'fuzzy');
  assert.equal(matchTypeBucket('none'), 'none');
  assert.equal(matchTypeBucket('山田太郎'), 'other'); // 自由文字列は other
  assert.equal(matchTypeBucket(undefined), 'missing');
  assert.equal(matchTypeBucket(''), 'missing');
});

test('candidateCountBand: 候補件数を帯に丸める', () => {
  assert.equal(candidateCountBand(undefined), 'missing');
  assert.equal(candidateCountBand(0), '0');
  assert.equal(candidateCountBand(1), '1');
  assert.equal(candidateCountBand(2), '2-4');
  assert.equal(candidateCountBand(4), '2-4');
  assert.equal(candidateCountBand(5), '5+');
});

const row = (o: Partial<FeatureRow> = {}): FeatureRow => ({
  pages: '1',
  textLength: '0',
  docTypeConfidence: 'none',
  docTypeMatch: 'none',
  customerConfidence: 'none',
  customerMatch: 'none',
  customerCandidates: '0',
  engine: 'paddle',
  ...o,
});

test('summarizeFeatures: 特徴ごとに、帯ごとの件数を数える。合計は行数に一致する', () => {
  const s = summarizeFeatures([row({ textLength: '0' }), row({ textLength: '0' }), row({ textLength: '200-999', pages: '2-3' })]);
  assert.deepEqual(s.textLength, { '0': 2, '200-999': 1 });
  assert.deepEqual(s.pages, { '1': 2, '2-3': 1 });
  for (const k of Object.keys(s) as Array<keyof typeof s>) {
    assert.equal(Object.values(s[k]).reduce((a: number, b: number) => a + b, 0), 3);
  }
});

test('summarizeFeatures: 0件でも崩れない', () => {
  const s = summarizeFeatures([]);
  assert.deepEqual(s.pages, {});
});
