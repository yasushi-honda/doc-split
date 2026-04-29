/**
 * normalizeGroupKey テスト
 *
 * backend (functions/src/utils/groupAggregation.ts) の normalizeGroupKey と
 * 同じ入出力期待値を担保することで、書類マスター名と documentGroups.groupKey の
 * 照合精度を保証する。
 */

import { describe, it, expect } from 'vitest';
import { normalizeGroupKey } from '../normalizeGroupKey';

describe('normalizeGroupKey', () => {
  describe('空値・null安全性', () => {
    it('undefined を渡すと空文字列を返す', () => {
      expect(normalizeGroupKey(undefined)).toBe('');
    });

    it('null を渡すと空文字列を返す', () => {
      expect(normalizeGroupKey(null)).toBe('');
    });

    it('空文字列を渡すと空文字列を返す', () => {
      expect(normalizeGroupKey('')).toBe('');
    });
  });

  describe('英大文字→小文字変換', () => {
    it('半角英大文字を小文字化する', () => {
      expect(normalizeGroupKey('Hello')).toBe('hello');
    });

    it('全て大文字でも小文字化する', () => {
      expect(normalizeGroupKey('ABC')).toBe('abc');
    });

    it('既に小文字なら変化しない', () => {
      expect(normalizeGroupKey('hello')).toBe('hello');
    });
  });

  describe('全角→半角変換', () => {
    it('全角英大文字を半角小文字に変換する', () => {
      expect(normalizeGroupKey('ＡＢＣ')).toBe('abc');
    });

    it('全角英小文字を半角小文字に変換する', () => {
      expect(normalizeGroupKey('ａｂｃ')).toBe('abc');
    });

    it('全角数字を半角数字に変換する', () => {
      expect(normalizeGroupKey('０１２')).toBe('012');
    });

    it('全角英数字混在を半角小文字に正規化する', () => {
      expect(normalizeGroupKey('ＡＢＣ１２３')).toBe('abc123');
    });
  });

  describe('空白除去', () => {
    it('前後の半角空白を除去する', () => {
      expect(normalizeGroupKey(' hello ')).toBe('hello');
    });

    it('文字列中間の半角空白を除去する', () => {
      expect(normalizeGroupKey('hello world')).toBe('helloworld');
    });

    it('全角空白(U+3000)を除去する', () => {
      expect(normalizeGroupKey('hello　world')).toBe('helloworld');
    });

    it('タブ・改行を除去する', () => {
      expect(normalizeGroupKey('\thello\n')).toBe('hello');
    });
  });

  describe('日本語処理', () => {
    it('日本語のみの文字列はそのまま', () => {
      expect(normalizeGroupKey('請求書')).toBe('請求書');
    });

    it('日本語+前後空白は trim される', () => {
      expect(normalizeGroupKey(' 請求書 ')).toBe('請求書');
    });

    it('日本語+中間全角空白は除去される', () => {
      expect(normalizeGroupKey('請　求書')).toBe('請求書');
    });

    it('日本語+全角空白+前後空白の組み合わせも正規化', () => {
      expect(normalizeGroupKey(' 請　求書 ')).toBe('請求書');
    });
  });

  describe('複合パターン（実運用想定）', () => {
    it('英大文字+半角空白+全角空白の混在を正規化', () => {
      expect(normalizeGroupKey('A B　C')).toBe('abc');
    });

    it('日本語+英数字混在を正規化', () => {
      expect(normalizeGroupKey('ケアプラン Ａ１')).toBe('ケアプランa1');
    });

    it('OCR 抽出名想定の前後余白+大文字混在', () => {
      expect(normalizeGroupKey('  Document Type   ')).toBe('documenttype');
    });
  });
});
