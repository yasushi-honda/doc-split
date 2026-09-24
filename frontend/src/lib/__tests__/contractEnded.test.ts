/**
 * contractEnded テスト(Issue #1033)
 */

import { describe, it, expect } from 'vitest';
import {
  buildContractEndedLookup,
  isDocumentHiddenByContractEnd,
  isCustomerGroupHiddenByContractEnd,
} from '../contractEnded';
import type { CustomerMaster } from '@shared/types';

function master(overrides: Partial<CustomerMaster> & { id: string; name: string }): CustomerMaster {
  return overrides;
}

describe('buildContractEndedLookup', () => {
  it('undefinedを渡すとisReady: falseを返す', () => {
    const lookup = buildContractEndedLookup(undefined);
    expect(lookup.isReady).toBe(false);
  });

  it('customersが空配列でもisReady: trueを返す', () => {
    const lookup = buildContractEndedLookup([]);
    expect(lookup.isReady).toBe(true);
  });

  it('同じ名前キーのマスターが全員契約終了ならfullyEndedNameKeysに含む', () => {
    const lookup = buildContractEndedLookup([
      master({ id: 'a', name: '田中太郎', isContractEnded: true }),
    ]);
    expect(lookup.fullyEndedNameKeys.has('田中太郎')).toBe(true);
  });

  it('同じ名前キーで1人でも契約中ならfullyEndedNameKeysに含まない(同姓同名)', () => {
    const lookup = buildContractEndedLookup([
      master({ id: 'a', name: '田中太郎', isContractEnded: true }),
      master({ id: 'b', name: '田中太郎', isContractEnded: false }),
    ]);
    expect(lookup.fullyEndedNameKeys.has('田中太郎')).toBe(false);
  });
});

describe('isDocumentHiddenByContractEnd', () => {
  const endedLookup = buildContractEndedLookup([
    master({ id: 'ended-1', name: '契約終了太郎', isContractEnded: true }),
    master({ id: 'active-1', name: '契約中太郎', isContractEnded: false }),
  ]);

  it('customerIdが契約終了マスターを指し確認済みなら非表示', () => {
    expect(
      isDocumentHiddenByContractEnd({ customerId: 'ended-1', verified: true }, endedLookup, false),
    ).toBe(true);
  });

  it('customerIdが契約終了マスターを指していてもcustomerNameが違っても非表示(名前照合なし)', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: 'ended-1', customerName: '別の名前', verified: true },
        endedLookup,
        false,
      ),
    ).toBe(true);
  });

  it('未確認の書類は非表示にしない', () => {
    expect(
      isDocumentHiddenByContractEnd({ customerId: 'ended-1', verified: false }, endedLookup, false),
    ).toBe(false);
  });

  it('customerIdが契約中マスターを指すなら表示', () => {
    expect(
      isDocumentHiddenByContractEnd({ customerId: 'active-1', verified: true }, endedLookup, false),
    ).toBe(false);
  });

  it('customerId無し・名前が全員契約終了の名前キーに一致するなら非表示', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: null, customerName: '契約終了太郎', verified: true },
        endedLookup,
        false,
      ),
    ).toBe(true);
  });

  it('customerIdが空文字でも名前フォールバックを使う', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: '', customerName: '契約終了太郎', verified: true },
        endedLookup,
        false,
      ),
    ).toBe(true);
  });

  it('customerIdが削除済みマスターを指す(lookupに無い)場合は名前フォールバックを使う', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: 'deleted-id', customerName: '契約終了太郎', verified: true },
        endedLookup,
        false,
      ),
    ).toBe(true);
  });

  it('同姓同名で契約中が1人でもいれば名前フォールバックでは非表示にしない', () => {
    const mixedLookup = buildContractEndedLookup([
      master({ id: 'e1', name: '鈴木花子', isContractEnded: true }),
      master({ id: 'e2', name: '鈴木花子', isContractEnded: false }),
    ]);
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: null, customerName: '鈴木花子', verified: true },
        mixedLookup,
        false,
      ),
    ).toBe(false);
  });

  it('customerName未設定・空文字は表示', () => {
    expect(
      isDocumentHiddenByContractEnd({ customerId: null, customerName: '', verified: true }, endedLookup, false),
    ).toBe(false);
  });

  it('doc.customerKeyがあればそれを優先して名前フォールバックに使う', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: null, customerKey: '契約終了太郎', verified: true },
        endedLookup,
        false,
      ),
    ).toBe(true);
  });

  it('マスター読み込み中(isReady: false)は表示', () => {
    const loadingLookup = buildContractEndedLookup(undefined);
    expect(
      isDocumentHiddenByContractEnd({ customerId: 'ended-1', verified: true }, loadingLookup, false),
    ).toBe(false);
  });

  it('showContractEnded: trueなら常に表示', () => {
    expect(
      isDocumentHiddenByContractEnd({ customerId: 'ended-1', verified: true }, endedLookup, true),
    ).toBe(false);
  });
});

describe('isCustomerGroupHiddenByContractEnd', () => {
  const lookup = buildContractEndedLookup([
    master({ id: 'ended-1', name: '契約終了太郎', isContractEnded: true }),
    master({ id: 'e1', name: '鈴木花子', isContractEnded: true }),
    master({ id: 'e2', name: '鈴木花子', isContractEnded: false }),
  ]);

  it('全員契約終了の名前キーは非表示', () => {
    expect(isCustomerGroupHiddenByContractEnd('契約終了太郎', lookup, false)).toBe(true);
  });

  it('同姓同名の混在は表示', () => {
    expect(isCustomerGroupHiddenByContractEnd('鈴木花子', lookup, false)).toBe(false);
  });

  it('マスターに無い名前キー(不明顧客等)は表示', () => {
    expect(isCustomerGroupHiddenByContractEnd('不明顧客', lookup, false)).toBe(false);
  });

  it('showContractEnded: trueなら常に表示', () => {
    expect(isCustomerGroupHiddenByContractEnd('契約終了太郎', lookup, true)).toBe(false);
  });
});
