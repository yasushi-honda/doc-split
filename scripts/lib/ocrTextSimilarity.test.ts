import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { charSimilarity, normalizeForCompare } from './ocrTextSimilarity';

describe('normalizeForCompare', () => {
  it('空白・改行・全角空白を除去する(OCRの改行位置の揺れを比較から外す)', () => {
    assert.equal(normalizeForCompare('ケア プラン\n利用者　田中'), 'ケアプラン利用者田中');
  });

  it('空文字は空文字のまま', () => {
    assert.equal(normalizeForCompare(''), '');
  });
});

describe('charSimilarity', () => {
  it('完全一致は1', () => {
    assert.equal(charSimilarity('ケアプラン', 'ケアプラン'), 1);
  });

  it('改行・空白の違いだけなら1', () => {
    assert.equal(charSimilarity('ケア\nプラン', 'ケア プラン'), 1);
  });

  it('1文字置換は 1 - 1/長さ', () => {
    assert.equal(charSimilarity('abcd', 'abxd'), 0.75);
  });

  it('1文字欠落・1文字挿入もレーベンシュタイン距離1として扱う', () => {
    assert.equal(charSimilarity('abcd', 'abd'), 0.75);
    assert.equal(charSimilarity('abcd', 'abcxd'), 1 - 1 / 5);
  });

  it('全く異なる同じ長さの文字列は0', () => {
    assert.equal(charSimilarity('abcd', 'wxyz'), 0);
  });

  it('実際のテキストが空(OCRが何も読めない)なら0', () => {
    assert.equal(charSimilarity('ケアプラン', ''), 0);
  });

  it('期待も実際も空なら1(比較対象なし=一致)', () => {
    assert.equal(charSimilarity('', ''), 1);
  });

  it('期待が空で実際に文字があれば0', () => {
    assert.equal(charSimilarity('', 'abc'), 0);
  });

  it('結果は0〜1の範囲に収まる(距離が長い側の長さを超えない)', () => {
    const s = charSimilarity('a', 'xyzxyzxyz');
    assert.ok(s >= 0 && s <= 1);
  });

  it('旧字体と新字体は別の文字として扱う(読み取り精度の劣化として検出する)', () => {
    assert.ok(charSimilarity('齋藤', '斎藤') < 1);
  });
});
