/**
 * documentUtils テスト
 *
 * 顧客名・事業所名の有効性判定 (isValidCustomerSelection / isValidOfficeSelection) は
 * useDocumentEdit.saveChanges で「保存=確定」操作時に確定フラグを立てるか判定するために使用される。
 * Sentinel 値（'未判定'/'不明顧客'/'不明事業所'）を invalid 扱いし、空文字・null・undefined・
 * 空白のみ文字列も invalid とする。
 */

import { describe, it, expect } from 'vitest';
import { isValidCustomerSelection, isValidOfficeSelection } from '../documentUtils';

describe('isValidCustomerSelection', () => {
  describe('invalid 値（フラグを立てない）', () => {
    it.each([
      ['空文字', ''],
      ['空白のみ', '   '],
      ['タブ・改行のみ', '\t\n '],
      ['「未判定」sentinel', '未判定'],
      ['「不明顧客」sentinel', '不明顧客'],
      ['前後空白付き「未判定」', '  未判定  '],
    ])('"%s" は false を返す', (_label, input) => {
      expect(isValidCustomerSelection(input)).toBe(false);
    });

    it('null は false を返す', () => {
      expect(isValidCustomerSelection(null)).toBe(false);
    });

    it('undefined は false を返す', () => {
      expect(isValidCustomerSelection(undefined)).toBe(false);
    });
  });

  describe('valid 値（確定フラグを立てる）', () => {
    it.each([
      ['通常の顧客名', '河野 文江'],
      ['英数字混在', 'Customer A'],
      ['前後空白付き有効値', '  河野 文江  '],
      ['事業所形式の文字列でも顧客名としては有効', 'ケアサポートきらり'],
    ])('"%s" は true を返す', (_label, input) => {
      expect(isValidCustomerSelection(input)).toBe(true);
    });
  });
});

describe('isValidOfficeSelection', () => {
  describe('invalid 値（フラグを立てない）', () => {
    it.each([
      ['空文字', ''],
      ['空白のみ', '   '],
      ['「未判定」sentinel', '未判定'],
      ['「不明事業所」sentinel', '不明事業所'],
      ['前後空白付き「不明事業所」', '  不明事業所  '],
    ])('"%s" は false を返す', (_label, input) => {
      expect(isValidOfficeSelection(input)).toBe(false);
    });

    it('null は false を返す', () => {
      expect(isValidOfficeSelection(null)).toBe(false);
    });

    it('undefined は false を返す', () => {
      expect(isValidOfficeSelection(undefined)).toBe(false);
    });

    it('「不明顧客」は事業所判定では invalid 扱いしない（顧客側 sentinel のため）', () => {
      // 防御的だが、事業所側 sentinel のみが対象であることを明示するためのテスト
      expect(isValidOfficeSelection('不明顧客')).toBe(true);
    });
  });

  describe('valid 値（確定フラグを立てる）', () => {
    it.each([
      ['通常の事業所名', 'ケアサポートきらり'],
      ['法人形式', '株式会社サンプル'],
      ['前後空白付き有効値', '  ケアサポートきらり  '],
    ])('"%s" は true を返す', (_label, input) => {
      expect(isValidOfficeSelection(input)).toBe(true);
    });
  });
});
