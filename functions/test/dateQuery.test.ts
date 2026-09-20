/**
 * dateQuery 単体テスト (Issue #984 段階2a)
 *
 * 検索クエリから日付語を抽出し、documents.fileDate の UTC 範囲 [start, end) に変換する
 * 純粋関数の契約を固定する。
 */

import { expect } from 'chai';
import { extractDateFilters } from '../src/search/dateQuery';

const utc = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);

describe('extractDateFilters (Issue #984 段階2a)', () => {
  describe('日付語の認識と UTC 範囲', () => {
    it('YYYY は当該年の [1/1, 翌年1/1)', () => {
      const r = extractDateFilters('2026');
      expect(r.dateRange).to.deep.equal({ startMs: utc(2026, 1, 1), endMs: utc(2027, 1, 1) });
      expect(r.isEmptyRange).to.equal(false);
      expect(r.remainingQuery).to.equal('');
    });

    it('YYYY年 は YYYY と同じ範囲', () => {
      expect(extractDateFilters('2026年').dateRange).to.deep.equal({
        startMs: utc(2026, 1, 1),
        endMs: utc(2027, 1, 1),
      });
    });

    for (const word of ['2026-09', '2026/09', '2026-9', '2026/9', '2026年9月', '２０２６年９月']) {
      it(`年月 "${word}" は 9 月の範囲`, () => {
        expect(extractDateFilters(word).dateRange).to.deep.equal({
          startMs: utc(2026, 9, 1),
          endMs: utc(2026, 10, 1),
        });
      });
    }

    for (const word of ['2026-09-20', '2026/09/20', '2026-9-20', '2026年9月20日', '２０２６－０９－２０']) {
      it(`年月日 "${word}" は 1 日の範囲`, () => {
        expect(extractDateFilters(word).dateRange).to.deep.equal({
          startMs: utc(2026, 9, 20),
          endMs: utc(2026, 9, 21),
        });
      });
    }

    it('12 月は翌年 1 月 1 日が終端 (年跨ぎ)', () => {
      expect(extractDateFilters('2026-12').dateRange).to.deep.equal({
        startMs: utc(2026, 12, 1),
        endMs: utc(2027, 1, 1),
      });
    });

    it('月末日 (12/31) は翌年 1/1 が終端', () => {
      expect(extractDateFilters('2026-12-31').dateRange).to.deep.equal({
        startMs: utc(2026, 12, 31),
        endMs: utc(2027, 1, 1),
      });
    });

    it('うるう年の 2/29 は認識され、平年の 2/29 は日付語にならない', () => {
      expect(extractDateFilters('2028-02-29').dateRange).to.deep.equal({
        startMs: utc(2028, 2, 29),
        endMs: utc(2028, 3, 1),
      });
      const nonLeap = extractDateFilters('2026-02-29');
      expect(nonLeap.dateRange).to.equal(null);
      expect(nonLeap.remainingQuery).to.equal('2026-02-29');
    });
  });

  describe('日付語にならないもの', () => {
    for (const word of ['2026-13', '2026-00', '2026-09-31', '2026-09-00', '2026-02-30']) {
      it(`不正な月日 "${word}" は日付語にしない (通常の語として残る)`, () => {
        const r = extractDateFilters(word);
        expect(r.dateRange).to.equal(null);
        expect(r.isEmptyRange).to.equal(false);
        expect(r.remainingQuery).to.equal(word);
      });
    }

    for (const word of ['1999', '2100', '1999-09', '2100-01-01', '0000']) {
      it(`2000〜2099 の外 "${word}" は日付語にしない`, () => {
        const r = extractDateFilters(word);
        expect(r.dateRange).to.equal(null);
        expect(r.remainingQuery).to.equal(word);
      });
    }

    for (const word of ['20260920', '12345', '2026abc', 'abc2026', '２０２６年報告', '田中']) {
      it(`日付形でない "${word}" は日付語にしない`, () => {
        const r = extractDateFilters(word);
        expect(r.dateRange).to.equal(null);
        expect(r.remainingQuery).to.equal(word);
      });
    }
  });

  describe('複数語の組み合わせ', () => {
    it('日付語と通常語は分離され、通常語は元の順序で remainingQuery に残る', () => {
      const r = extractDateFilters('田中 2026年9月 訪問看護');
      expect(r.dateRange).to.deep.equal({ startMs: utc(2026, 9, 1), endMs: utc(2026, 10, 1) });
      expect(r.remainingQuery).to.equal('田中 訪問看護');
    });

    it('全角スペース区切りも分離できる', () => {
      const r = extractDateFilters('田中　2026');
      expect(r.dateRange).to.deep.equal({ startMs: utc(2026, 1, 1), endMs: utc(2027, 1, 1) });
      expect(r.remainingQuery).to.equal('田中');
    });

    it('複数の日付語は共通部分 (AND): 年 ∩ 月 = 月', () => {
      const r = extractDateFilters('2026 2026-09');
      expect(r.dateRange).to.deep.equal({ startMs: utc(2026, 9, 1), endMs: utc(2026, 10, 1) });
      expect(r.isEmptyRange).to.equal(false);
    });

    it('複数の日付語は共通部分 (AND): 月 ∩ 日 = 日', () => {
      const r = extractDateFilters('2026-09 2026-09-20');
      expect(r.dateRange).to.deep.equal({ startMs: utc(2026, 9, 20), endMs: utc(2026, 9, 21) });
    });

    it('共通部分が空 (異なる年) は isEmptyRange=true / dateRange=null', () => {
      const r = extractDateFilters('2025 2026');
      expect(r.isEmptyRange).to.equal(true);
      expect(r.dateRange).to.equal(null);
    });

    it('共通部分が空 (同年の別月) も isEmptyRange=true', () => {
      const r = extractDateFilters('2026-08 2026-09');
      expect(r.isEmptyRange).to.equal(true);
    });

    it('境界のみ接する範囲 (8 月と 9 月) は空 ([start,end) の半開区間)', () => {
      expect(extractDateFilters('2026-08 2026-09').isEmptyRange).to.equal(true);
    });

    it('日付語なしのクエリは dateRange=null / isEmptyRange=false / 元のクエリ (語ごと) を保持', () => {
      const r = extractDateFilters('田中 太郎');
      expect(r.dateRange).to.equal(null);
      expect(r.isEmptyRange).to.equal(false);
      expect(r.remainingQuery).to.equal('田中 太郎');
    });

    it('空白のみ・空文字は remainingQuery が空', () => {
      expect(extractDateFilters('   ').remainingQuery).to.equal('');
      expect(extractDateFilters('').remainingQuery).to.equal('');
    });
  });
});
