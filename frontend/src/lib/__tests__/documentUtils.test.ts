/**
 * documentUtils テスト
 *
 * 顧客名・事業所名の有効性判定 (isValidCustomerSelection / isValidOfficeSelection) は
 * useDocumentEdit.saveChanges で「保存=確定」操作時に確定フラグを立てるか判定するために使用される。
 * Sentinel 値（'未判定'/'不明顧客'/'不明事業所'）を invalid 扱いし、空文字・null・undefined・
 * 空白のみ文字列も invalid とする。
 */

import { describe, it, expect } from 'vitest';
import {
  isValidCustomerSelection,
  isValidOfficeSelection,
  isValidDocumentTypeSelection,
  applySegmentFieldEdit,
  buildSegmentConfirmedFlags,
} from '../documentUtils';

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

describe('isValidDocumentTypeSelection', () => {
  describe('invalid 値（フラグを立てない）', () => {
    it.each([
      ['空文字', ''],
      ['空白のみ', '   '],
      ['「未判定」sentinel', '未判定'],
      ['前後空白付き「未判定」', '  未判定  '],
    ])('"%s" は false を返す', (_label, input) => {
      expect(isValidDocumentTypeSelection(input)).toBe(false);
    });

    it('null は false を返す', () => {
      expect(isValidDocumentTypeSelection(null)).toBe(false);
    });

    it('undefined は false を返す', () => {
      expect(isValidDocumentTypeSelection(undefined)).toBe(false);
    });
  });

  describe('valid 値（確定フラグを立てる）', () => {
    it.each([
      ['通常の書類種別', '介護保険被保険者証'],
      ['前後空白付き有効値', '  介護保険被保険者証  '],
    ])('"%s" は true を返す', (_label, input) => {
      expect(isValidDocumentTypeSelection(input)).toBe(true);
    });
  });
});

describe('applySegmentFieldEdit', () => {
  // Issue #538: MasterSelectField.onChange(value, item) の item を無視すると、
  // 名前を変更してもcustomerId/officeIdが古いまま残り、誤った顧客/事業所に
  // 紐付けられる不整合バグが起きる。名前フィールド編集時は対応するIDを
  // 明示的に同期させる（itemがあれば採用、なければnullでクリア）。

  it('customerNameをitem付きで編集 → customerIdがitem.idに更新される', () => {
    const existing = { customerName: '田中太郎', customerId: 'cust_tanaka' };
    const result = applySegmentFieldEdit(existing, 'customerName', '佐藤花子', {
      id: 'cust_sato',
    });
    expect(result.customerName).toBe('佐藤花子');
    expect(result.customerId).toBe('cust_sato');
  });

  it('customerNameをitemなしで編集（マスタ不一致） → customerIdはnullにクリアされる（古いIDが残らない）', () => {
    const existing = { customerName: '田中太郎', customerId: 'cust_tanaka' };
    const result = applySegmentFieldEdit(existing, 'customerName', '未判定');
    expect(result.customerName).toBe('未判定');
    expect(result.customerId).toBeNull();
  });

  it('officeNameをitem付きで編集 → officeIdがitem.idに更新される', () => {
    const existing = { officeName: '旧事業所', officeId: 'office_old' };
    const result = applySegmentFieldEdit(existing, 'officeName', '新事業所', {
      id: 'office_new',
    });
    expect(result.officeName).toBe('新事業所');
    expect(result.officeId).toBe('office_new');
  });

  it('officeNameをitemなしで編集 → officeIdはnullにクリアされる', () => {
    const existing = { officeName: '旧事業所', officeId: 'office_old' };
    const result = applySegmentFieldEdit(existing, 'officeName', '未判定');
    expect(result.officeId).toBeNull();
  });

  it('documentType編集はID系フィールドに影響しない', () => {
    const existing = { customerName: '田中太郎', customerId: 'cust_tanaka', documentType: '請求書' };
    const result = applySegmentFieldEdit(existing, 'documentType', '実績');
    expect(result.documentType).toBe('実績');
    expect(result.customerId).toBe('cust_tanaka'); // 無関係なフィールドは変化しない
  });

  it('既存のexistingオブジェクトを変更しない（イミュータブル）', () => {
    const existing = { customerName: '田中太郎', customerId: 'cust_tanaka' };
    applySegmentFieldEdit(existing, 'customerName', '佐藤花子', { id: 'cust_sato' });
    expect(existing.customerName).toBe('田中太郎');
    expect(existing.customerId).toBe('cust_tanaka');
  });
});

describe('buildSegmentConfirmedFlags', () => {
  // Issue #526: 分割画面の最終値からconfirmedフラグを算出する。
  // サーバー側でID有無から推測しない設計のため、値の妥当性（sentinel判定）のみで決定する。

  it('全フィールドが有効値 → 全フラグtrue', () => {
    const flags = buildSegmentConfirmedFlags({
      customerName: '田中太郎',
      officeName: 'ケアサポートきらり',
      documentType: '介護保険被保険者証',
    });
    expect(flags).toEqual({
      customerConfirmed: true,
      officeConfirmed: true,
      documentTypeConfirmed: true,
    });
  });

  it('全フィールドが「未判定」→ 全フラグfalse', () => {
    const flags = buildSegmentConfirmedFlags({
      customerName: '未判定',
      officeName: '未判定',
      documentType: '未判定',
    });
    expect(flags).toEqual({
      customerConfirmed: false,
      officeConfirmed: false,
      documentTypeConfirmed: false,
    });
  });

  it('一部のみ有効値 → 該当フラグのみtrue', () => {
    const flags = buildSegmentConfirmedFlags({
      customerName: '田中太郎',
      officeName: '未判定',
      documentType: '未判定',
    });
    expect(flags).toEqual({
      customerConfirmed: true,
      officeConfirmed: false,
      documentTypeConfirmed: false,
    });
  });
});
