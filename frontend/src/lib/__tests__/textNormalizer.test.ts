/**
 * textNormalizer テスト(Issue #812)
 *
 * GAIJI_MAP + normalizeGaiji() は frontend/src/lib/textNormalizer.ts から
 * shared/gaijiMap.ts へ移設した。normalizeGaiji/normalizeText/normalizeName の
 * 代表的な入出力が移設前後で変化していないことを確認する
 * (functions側のテストだけではFE側のimport解決・挙動不変は保証されないため)。
 */

import { describe, it, expect } from 'vitest';
import { normalizeGaiji, normalizeText, normalizeName } from '../textNormalizer';

describe('normalizeGaiji', () => {
  it('旧字体を新字体に変換する', () => {
    expect(normalizeGaiji('渡邉花子')).toBe('渡辺花子');
    expect(normalizeGaiji('古澤太郎')).toBe('古沢太郎');
    expect(normalizeGaiji('髙橋')).toBe('高橋');
  });

  it('丸囲み数字を数字に変換する', () => {
    expect(normalizeGaiji('①②③')).toBe('123');
  });

  it('法人記号を括弧付き表記に変換する', () => {
    expect(normalizeGaiji('㈱テスト')).toBe('(株)テスト');
  });

  it('変換対象を含まない文字列はそのまま返す', () => {
    expect(normalizeGaiji('鈴木一郎')).toBe('鈴木一郎');
  });

  it('空文字列は空文字列を返す', () => {
    expect(normalizeGaiji('')).toBe('');
  });
});

describe('normalizeText', () => {
  it('デフォルトオプションでgaiji変換・Unicode正規化・スペース正規化を適用する', () => {
    expect(normalizeText('渡邉　花子')).toBe('渡辺 花子');
  });

  it('gaiji: false を指定すると外字変換をスキップする', () => {
    expect(normalizeText('渡邉花子', { gaiji: false })).toBe('渡邉花子');
  });
});

describe('normalizeName', () => {
  it('外字変換・スペース除去・前後空白除去を適用する(顧客名・事業所名向け)', () => {
    expect(normalizeName('  渡邉　花子  ')).toBe('渡辺 花子');
  });

  it('異体字表記の氏名を新字体に正規化する(登録時の自動変換、症状の入口)', () => {
    expect(normalizeName('渡邉花子')).toBe('渡辺花子');
  });
});
