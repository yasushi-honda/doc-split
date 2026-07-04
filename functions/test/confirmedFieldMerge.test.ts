/**
 * confirmedFieldMerge.ts のテスト (Issue #526 D2)
 */

import { expect } from 'chai';
import {
  applyConfirmedFieldProtection,
  type ConfirmedProtectableFields,
  type ConfirmedProtectionSnapshot,
} from '../src/ocr/confirmedFieldMerge';

function makeProposed(
  overrides: Partial<ConfirmedProtectableFields> = {}
): ConfirmedProtectableFields {
  return {
    customerConfirmed: false,
    customerName: 'OCR顧客',
    customerId: 'ocr-cust-id',
    careManager: 'OCRケアマネ',
    isDuplicateCustomer: true,
    needsManualCustomerSelection: true,
    confirmedBy: null,
    confirmedAt: null,
    officeConfirmed: false,
    officeName: 'OCR事業所',
    officeId: 'ocr-office-id',
    officeConfirmedBy: null,
    officeConfirmedAt: null,
    documentTypeConfirmed: false,
    documentType: 'OCR書類種別',
    category: 'ocr-category',
    ...overrides,
  };
}

describe('applyConfirmedFieldProtection', () => {
  it('全フィールドがconfirmed=falseの場合、proposedの値がそのまま使われる(既存挙動不変)', () => {
    const proposed = makeProposed();
    const current: ConfirmedProtectionSnapshot = {
      customerConfirmed: false,
      officeConfirmed: false,
      documentTypeConfirmed: false,
    };
    const merged = applyConfirmedFieldProtection(proposed, current);
    expect(merged).to.deep.equal(proposed);
  });

  it('confirmedフラグが全てundefinedの場合も、proposedの値がそのまま使われる', () => {
    const proposed = makeProposed();
    const merged = applyConfirmedFieldProtection(proposed, {});
    expect(merged).to.deep.equal(proposed);
  });

  it('customerConfirmed=trueの場合、フラグ自体・顧客関連フィールド・確定者情報がcurrentの値で保護される', () => {
    const proposed = makeProposed({ customerConfirmed: true });
    const fixedTimestamp = { seconds: 1234567890, nanoseconds: 0 };
    const current: ConfirmedProtectionSnapshot = {
      customerConfirmed: true,
      customerName: '確定顧客',
      customerId: 'confirmed-cust-id',
      careManager: '確定ケアマネ',
      isDuplicateCustomer: false,
      needsManualCustomerSelection: false,
      confirmedBy: 'user-uid-123',
      confirmedAt: fixedTimestamp,
    };
    const merged = applyConfirmedFieldProtection(proposed, current);

    expect(merged.customerConfirmed).to.equal(true);
    expect(merged.customerName).to.equal('確定顧客');
    expect(merged.customerId).to.equal('confirmed-cust-id');
    expect(merged.careManager).to.equal('確定ケアマネ');
    expect(merged.isDuplicateCustomer).to.equal(false);
    expect(merged.needsManualCustomerSelection).to.equal(false);
    expect(merged.confirmedBy).to.equal('user-uid-123');
    expect(merged.confirmedAt).to.deep.equal(fixedTimestamp);
    // 事業所・書類種別はOCR提案のまま(保護対象外)
    expect(merged.officeName).to.equal('OCR事業所');
    expect(merged.documentType).to.equal('OCR書類種別');
  });

  it('customerConfirmed=trueの場合、OCR自身のcustomerConfirmed=falseガイドを上書きして常にtrueを維持する', () => {
    // フレッシュなOCR抽出結果は候補が曖昧で needsManualSelection=true → customerConfirmed=false と
    // 自己判定するケース。既に確定済みのユーザー確定状態が、この自己判定で後退してはならない。
    const proposed = makeProposed({ customerConfirmed: false });
    const current: ConfirmedProtectionSnapshot = {
      customerConfirmed: true,
      customerName: '確定顧客',
    };
    const merged = applyConfirmedFieldProtection(proposed, current);
    expect(merged.customerConfirmed).to.equal(true);
  });

  it('officeConfirmed=trueの場合、フラグ自体・事業所関連フィールド・確定者情報がcurrentの値で保護される', () => {
    const proposed = makeProposed({ officeConfirmed: true });
    const current: ConfirmedProtectionSnapshot = {
      officeConfirmed: true,
      officeName: '確定事業所',
      officeId: 'confirmed-office-id',
      officeConfirmedBy: 'user-uid-456',
      officeConfirmedAt: { seconds: 1111111111, nanoseconds: 0 },
    };
    const merged = applyConfirmedFieldProtection(proposed, current);

    expect(merged.officeConfirmed).to.equal(true);
    expect(merged.officeName).to.equal('確定事業所');
    expect(merged.officeId).to.equal('confirmed-office-id');
    expect(merged.officeConfirmedBy).to.equal('user-uid-456');
    expect(merged.officeConfirmedAt).to.deep.equal({ seconds: 1111111111, nanoseconds: 0 });
    // 顧客・書類種別はOCR提案のまま
    expect(merged.customerName).to.equal('OCR顧客');
    expect(merged.documentType).to.equal('OCR書類種別');
  });

  it('documentTypeConfirmed=trueの場合、フラグ自体・documentType/categoryのみcurrentの値で保護される(By/Atは持たない)', () => {
    const proposed = makeProposed({ documentTypeConfirmed: true });
    const current: ConfirmedProtectionSnapshot = {
      documentTypeConfirmed: true,
      documentType: '確定書類種別',
      category: 'confirmed-category',
    };
    const merged = applyConfirmedFieldProtection(proposed, current);

    expect(merged.documentTypeConfirmed).to.equal(true);
    expect(merged.documentType).to.equal('確定書類種別');
    expect(merged.category).to.equal('confirmed-category');
    // 顧客・事業所はOCR提案のまま
    expect(merged.customerName).to.equal('OCR顧客');
    expect(merged.officeName).to.equal('OCR事業所');
  });

  it('3フィールド全てconfirmed=trueの場合、全グループが独立して保護される', () => {
    const proposed = makeProposed({
      customerConfirmed: true,
      officeConfirmed: true,
      documentTypeConfirmed: true,
    });
    const current: ConfirmedProtectionSnapshot = {
      customerConfirmed: true,
      officeConfirmed: true,
      documentTypeConfirmed: true,
      customerName: '確定顧客',
      customerId: 'confirmed-cust-id',
      careManager: '確定ケアマネ',
      isDuplicateCustomer: false,
      needsManualCustomerSelection: false,
      confirmedBy: 'user-uid',
      confirmedAt: { seconds: 1, nanoseconds: 0 },
      officeName: '確定事業所',
      officeId: 'confirmed-office-id',
      officeConfirmedBy: 'user-uid',
      officeConfirmedAt: { seconds: 2, nanoseconds: 0 },
      documentType: '確定書類種別',
      category: 'confirmed-category',
    };
    const merged = applyConfirmedFieldProtection(proposed, current);

    expect(merged.customerConfirmed).to.equal(true);
    expect(merged.officeConfirmed).to.equal(true);
    expect(merged.documentTypeConfirmed).to.equal(true);
    expect(merged.customerName).to.equal('確定顧客');
    expect(merged.officeName).to.equal('確定事業所');
    expect(merged.documentType).to.equal('確定書類種別');
  });

  it('customerConfirmed=trueだがcurrent.customerIdがundefinedの場合、nullにフォールバックする(OCR値を継承しない)', () => {
    const proposed = makeProposed({
      customerConfirmed: true,
      customerId: 'ocr-cust-id-should-not-leak',
    });
    const current: ConfirmedProtectionSnapshot = {
      customerConfirmed: true,
      customerName: '確定顧客',
      // customerId未設定
    };
    const merged = applyConfirmedFieldProtection(proposed, current);

    expect(merged.customerName).to.equal('確定顧客');
    expect(merged.customerId).to.equal(null);
  });

  it('customerConfirmed=trueだがcurrent.confirmedBy/confirmedAtがundefinedの場合、nullにフォールバックする', () => {
    const proposed = makeProposed({ customerConfirmed: true, confirmedBy: 'stale-uid' });
    const current: ConfirmedProtectionSnapshot = {
      customerConfirmed: true,
      customerName: '確定顧客',
      // confirmedBy/confirmedAt未設定
    };
    const merged = applyConfirmedFieldProtection(proposed, current);
    expect(merged.confirmedBy).to.equal(null);
    expect(merged.confirmedAt).to.equal(null);
  });

  it('customerConfirmed=trueだがcurrent.customerNameがundefinedの場合、proposedのcustomerNameにフォールバックする', () => {
    const proposed = makeProposed({
      customerConfirmed: true,
      customerName: 'フォールバック顧客名',
    });
    const current: ConfirmedProtectionSnapshot = {
      customerConfirmed: true,
      // customerName未設定
    };
    const merged = applyConfirmedFieldProtection(proposed, current);
    expect(merged.customerName).to.equal('フォールバック顧客名');
  });

  it('proposedオブジェクトを破壊的に変更しない(イミュータブル)', () => {
    const proposed = makeProposed();
    const proposedSnapshot = { ...proposed };
    applyConfirmedFieldProtection(proposed, { customerConfirmed: true, customerName: '確定顧客' });
    expect(proposed).to.deep.equal(proposedSnapshot);
  });

  it('proposedに保護対象外の余剰フィールドが含まれていても、そのまま保持される', () => {
    const proposed = {
      ...makeProposed(),
      customerCandidates: [{ customerId: 'x', customerName: 'y' }],
      extractionScores: { documentType: 90, customerName: 80, officeName: 70, date: 60 },
    };
    const merged = applyConfirmedFieldProtection(proposed, {
      customerConfirmed: true,
      customerName: '確定顧客',
    });
    expect(merged.customerCandidates).to.deep.equal(proposed.customerCandidates);
    expect(merged.extractionScores).to.deep.equal(proposed.extractionScores);
  });
});
