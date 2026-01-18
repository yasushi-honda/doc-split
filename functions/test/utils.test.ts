/**
 * ユーティリティ関数のテスト
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

// テスト対象のユーティリティ関数をインポート
import {
  similarityScore,
  levenshteinDistance,
  normalizeText,
  findBestMatch,
  extractCustomerName,
  extractDate,
} from '../src/utils/similarity';

describe('Similarity Utilities', () => {
  describe('levenshteinDistance', () => {
    it('同じ文字列は距離0', () => {
      expect(levenshteinDistance('test', 'test')).to.equal(0);
    });

    it('空文字列との距離は長さと等しい', () => {
      expect(levenshteinDistance('hello', '')).to.equal(5);
      expect(levenshteinDistance('', 'world')).to.equal(5);
    });

    it('1文字違いは距離1', () => {
      expect(levenshteinDistance('test', 'tent')).to.equal(1);
    });

    it('日本語も正しく計算', () => {
      expect(levenshteinDistance('山田太郎', '山田次郎')).to.equal(1);
    });
  });

  describe('similarityScore', () => {
    it('完全一致の場合は100%', () => {
      const result = similarityScore('山田太郎', '山田太郎');
      expect(result).to.equal(100);
    });

    it('完全不一致の場合は0%に近い', () => {
      const result = similarityScore('あいうえお', 'かきくけこ');
      expect(result).to.be.lessThan(50);
    });

    it('部分一致の場合は中間値', () => {
      const result = similarityScore('山田太郎', '山田次郎');
      expect(result).to.be.greaterThan(50);
      expect(result).to.be.lessThan(100);
    });

    it('空文字列同士は100%（完全一致扱い）', () => {
      const result = similarityScore('', '');
      // 実装では a === b で100を返す（空文字列も一致）
      expect(result).to.equal(100);
    });

    it('片方が空文字列の場合は0%', () => {
      const result = similarityScore('テスト', '');
      expect(result).to.equal(0);
    });

    it('類似度75%: 鈴木一郎 vs 鈴木二郎', () => {
      const result = similarityScore('鈴木一郎', '鈴木二郎');
      expect(result).to.equal(75); // 4文字中1文字違い
    });
  });

  describe('normalizeText', () => {
    it('空白を除去', () => {
      expect(normalizeText('山田 太郎')).to.equal('山田太郎');
    });

    it('全角スペースを除去', () => {
      expect(normalizeText('山田　太郎')).to.equal('山田太郎');
    });

    it('中黒を除去', () => {
      expect(normalizeText('山田・太郎')).to.equal('山田太郎');
    });

    it('小文字に変換', () => {
      expect(normalizeText('TEST')).to.equal('test');
    });
  });

  describe('findBestMatch', () => {
    const candidates = ['山田太郎', '山田次郎', '鈴木花子', '佐藤一郎'];

    it('完全一致を検出', () => {
      const result = findBestMatch('利用者名: 山田太郎 様', candidates);
      expect(result.value).to.equal('山田太郎');
      expect(result.matchType).to.equal('exact');
      expect(result.score).to.equal(100);
    });

    it('候補がない場合はnone', () => {
      const result = findBestMatch('田中花子', candidates, 70);
      expect(result.matchType).to.equal('none');
    });

    it('空テキストはnone', () => {
      const result = findBestMatch('', candidates);
      expect(result.matchType).to.equal('none');
    });

    it('閾値以下はマッチしない', () => {
      const result = findBestMatch('xxx', candidates, 90);
      expect(result.matchType).to.equal('none');
    });
  });

  describe('extractCustomerName', () => {
    const customers = [
      { name: '山田太郎', isDuplicate: false },
      { name: '鈴木一郎', isDuplicate: true },
      { name: '鈴木次郎', isDuplicate: true },
    ];

    it('顧客名を抽出', () => {
      const result = extractCustomerName('利用者: 山田太郎', customers);
      expect(result.customerName).to.equal('山田太郎');
      expect(result.isDuplicate).to.equal(false);
    });

    it('同姓同名フラグを検出', () => {
      const result = extractCustomerName('鈴木一郎様', customers);
      expect(result.customerName).to.equal('鈴木一郎');
      expect(result.isDuplicate).to.equal(true);
    });

    it('見つからない場合はnull', () => {
      const result = extractCustomerName('佐藤花子', customers);
      expect(result.customerName).to.equal(null);
    });
  });

  describe('extractDate', () => {
    it('西暦形式を抽出', () => {
      const result = extractDate('発行日: 2024年3月15日');
      expect(result).to.not.be.null;
      expect(result!.getFullYear()).to.equal(2024);
      expect(result!.getMonth()).to.equal(2); // 0-indexed
      expect(result!.getDate()).to.equal(15);
    });

    it('令和形式を抽出', () => {
      const result = extractDate('作成日 令和6年1月20日');
      expect(result).to.not.be.null;
      expect(result!.getFullYear()).to.equal(2024); // 令和6年 = 2024年
      expect(result!.getMonth()).to.equal(0);
      expect(result!.getDate()).to.equal(20);
    });

    it('平成形式を抽出', () => {
      const result = extractDate('平成30年12月1日');
      expect(result).to.not.be.null;
      expect(result!.getFullYear()).to.equal(2018); // 平成30年 = 2018年
    });

    it('R形式（令和略記）を抽出', () => {
      const result = extractDate('R6.3.15');
      expect(result).to.not.be.null;
      expect(result!.getFullYear()).to.equal(2024);
    });

    it('マーカー指定で周辺を検索', () => {
      const text = '書類番号: 12345 発行日: 2024年5月10日 有効期限: 2025年5月9日';
      const result = extractDate(text, '発行日');
      expect(result).to.not.be.null;
      expect(result!.getFullYear()).to.equal(2024);
      expect(result!.getMonth()).to.equal(4); // 5月
    });

    it('日付がない場合はnull', () => {
      const result = extractDate('日付情報なし');
      expect(result).to.be.null;
    });
  });
});
