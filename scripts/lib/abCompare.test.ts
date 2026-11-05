import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cellOf,
  isDetermined,
  japaneseRatio,
  japaneseRatioBand,
  summarizePairs,
  type PairRow,
} from './abCompare';

test('isDetermined: null・空・未判定・空白のみは判定できていない', () => {
  assert.equal(isDetermined('サービス提供票'), true);
  assert.equal(isDetermined(null), false);
  assert.equal(isDetermined(undefined), false);
  assert.equal(isDetermined(''), false);
  assert.equal(isDetermined('  '), false);
  assert.equal(isDetermined('未判定'), false);
});

test('cellOf: 補正なし/ありの判定結果を4区分に分ける', () => {
  assert.equal(cellOf(true, true), 'both');
  assert.equal(cellOf(false, true), 'onOnly');
  assert.equal(cellOf(true, false), 'offOnly');
  assert.equal(cellOf(false, false), 'neither');
});

test('japaneseRatio: 空白を除いた文字のうち、かな・漢字の割合(境界と異常値)', () => {
  assert.equal(japaneseRatio(''), 0);
  assert.equal(japaneseRatio('   \n '), 0);
  assert.equal(japaneseRatio('あいう'), 1);
  assert.equal(japaneseRatio('abc'), 0);
  assert.equal(japaneseRatio('あa'), 0.5);
  assert.equal(japaneseRatio('漢 字'), 1);
});

test('japaneseRatioBand: 固定の帯に丸める(境界値)', () => {
  assert.equal(japaneseRatioBand(0), '<10%');
  assert.equal(japaneseRatioBand(0.0999), '<10%');
  assert.equal(japaneseRatioBand(0.1), '10-29%');
  assert.equal(japaneseRatioBand(0.2999), '10-29%');
  assert.equal(japaneseRatioBand(0.3), '30-59%');
  assert.equal(japaneseRatioBand(0.5999), '30-59%');
  assert.equal(japaneseRatioBand(0.6), '60%+');
  assert.equal(japaneseRatioBand(1), '60%+');
  assert.equal(japaneseRatioBand(Number.NaN), 'unknown');
});

const row = (p: Partial<PairRow>): PairRow => ({
  off1: false,
  off2: false,
  on: false,
  offJpRatio: 0,
  onJpRatio: 0,
  ...p,
});

test('summarizePairs: 空配列はすべて0', () => {
  const s = summarizePairs([]);
  assert.equal(s.total, 0);
  assert.equal(s.both, 0);
  assert.equal(s.onOnly, 0);
  assert.equal(s.offOnly, 0);
  assert.equal(s.neither, 0);
  assert.equal(s.noiseDisagree, 0);
});

test('summarizePairs: 4区分と、補正なし2回の不一致(ゆらぎ)を数える', () => {
  const rows: PairRow[] = [
    row({ off1: true, off2: true, on: true }), // both
    row({ off1: false, off2: false, on: true }), // onOnly
    row({ off1: true, off2: true, on: false }), // offOnly
    row({ off1: false, off2: false, on: false }), // neither
    row({ off1: false, off2: true, on: true }), // off1基準=false → onOnly、ゆらぎ1
  ];
  const s = summarizePairs(rows);
  assert.equal(s.total, 5);
  assert.equal(s.both, 1);
  assert.equal(s.onOnly, 2);
  assert.equal(s.offOnly, 1);
  assert.equal(s.neither, 1);
  assert.equal(s.noiseDisagree, 1);
});

test('summarizePairs: 補正なしの日本語比率の帯と、補正ありの帯を別々に集計する', () => {
  const rows: PairRow[] = [
    row({ offJpRatio: 0.05, onJpRatio: 0.7 }),
    row({ offJpRatio: 0.05, onJpRatio: 0.7 }),
    row({ offJpRatio: 0.4, onJpRatio: 0.4 }),
  ];
  const s = summarizePairs(rows);
  assert.deepEqual(s.offJpBands, { '<10%': 2, '30-59%': 1 });
  assert.deepEqual(s.onJpBands, { '60%+': 2, '30-59%': 1 });
});

test('summarizePairs: 合計は4区分の和と一致する', () => {
  const rows: PairRow[] = [
    row({ off1: true, on: true }),
    row({ off1: true, on: false }),
    row({ off1: false, on: true }),
    row({ off1: false, on: false }),
    row({ off1: false, on: false }),
  ];
  const s = summarizePairs(rows);
  assert.equal(s.both + s.onOnly + s.offOnly + s.neither, s.total);
});
