/**
 * contractEnded テスト(Issue #1033)
 */

import { describe, it, expect } from 'vitest';
import {
  buildContractEndedLookup,
  isDocumentHiddenByContractEnd,
  isCustomerGroupHiddenByContractEnd,
  findCustomerForGroupKey,
  buildCustomerNameIndex,
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

  it('isContractEndedフィールド自体が存在しない既存マスターは契約中扱い(pr-review-toolkit指摘、Issue #445/PR-D3と同型の既存データ互換性確認)', () => {
    // Partial<CustomerMaster>からisContractEndedキー自体を省略する(false明示とは区別する)
    const legacyCustomer: CustomerMaster = { id: 'legacy', name: '既存太郎' };
    const lookup = buildContractEndedLookup([legacyCustomer]);
    expect(lookup.endedById.get('legacy')).toBe(false);
    expect(lookup.fullyEndedNameKeys.has('既存太郎')).toBe(false);
    expect(
      isDocumentHiddenByContractEnd({ customerId: 'legacy', verified: true }, lookup, false),
    ).toBe(false);
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

  it('未確認(選択待ち含む)の書類も非表示にする', () => {
    expect(
      isDocumentHiddenByContractEnd({ customerId: 'ended-1', verified: false }, endedLookup, false),
    ).toBe(true);
    expect(
      isDocumentHiddenByContractEnd({ customerId: 'ended-1' }, endedLookup, false),
    ).toBe(true);
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

describe('findCustomerForGroupKey', () => {
  const customers = [
    master({ id: 'a', name: '田中 太郎' }),
    master({ id: 'b', name: '鈴木花子' }),
    master({ id: 'c', name: '鈴木　花子' }),
  ];

  const index = buildCustomerNameIndex(customers);

  it('名前キーが一致する顧客が1人ならその顧客を返す(空白の揺れは吸収)', () => {
    expect(findCustomerForGroupKey('田中太郎', index)?.id).toBe('a');
  });

  it('同姓同名(名前キーが一致する顧客が2人以上)はnull', () => {
    expect(findCustomerForGroupKey('鈴木花子', index)).toBeNull();
  });

  it('マスターに存在しない名前キーはnull', () => {
    expect(findCustomerForGroupKey('不明顧客', index)).toBeNull();
  });

  it('空のキー・customers未読込はnull', () => {
    expect(findCustomerForGroupKey('', index)).toBeNull();
    expect(findCustomerForGroupKey('田中太郎', buildCustomerNameIndex(undefined))).toBeNull();
  });
});

describe('同姓同名で契約中のマスターがあるときの未確定書類(契約終了で隠さない)', () => {
  // 同姓同名2件: 先頭(契約終了)・後(契約中)。OCRは同姓同名があると先頭を自動で入れるが必ず未確定になるため、
  // 契約中の方の書類が、契約終了のマスターに紐づいた未確定書類として一覧から消える事象への対応
  const samenameLookup = buildContractEndedLookup([
    master({ id: 'ended-A', name: '架空花子', isContractEnded: true }),
    master({ id: 'active-A', name: '架空花子', isContractEnded: false }),
    master({ id: 'ended-solo', name: '契約終了のみ次郎', isContractEnded: true }),
  ]);

  it('buildContractEndedLookup: 契約中のマスターが1人でもいる名前キーはactiveNameKeysに含む', () => {
    expect(samenameLookup.activeNameKeys.has('架空花子')).toBe(true);
  });

  it('buildContractEndedLookup: 全員契約終了の名前キーはactiveNameKeysに含まない', () => {
    expect(samenameLookup.activeNameKeys.has('契約終了のみ次郎')).toBe(false);
  });

  it('buildContractEndedLookup: isContractEndedが未設定のマスターは契約中扱いでactiveNameKeysに含む', () => {
    const lookup = buildContractEndedLookup([
      master({ id: 'x', name: '既存三郎', isContractEnded: true }),
      { id: 'y', name: '既存三郎' },
    ]);
    expect(lookup.activeNameKeys.has('既存三郎')).toBe(true);
  });

  it('同姓同名の契約中がいる場合、契約終了マスターに紐づく未確定(customerConfirmed:false)書類は表示する', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: 'ended-A', customerName: '架空花子', customerConfirmed: false },
        samenameLookup,
        false,
      ),
    ).toBe(false);
  });

  it('customerConfirmedが未設定の書類も同条件なら表示する(迷ったら表示)', () => {
    expect(
      isDocumentHiddenByContractEnd({ customerId: 'ended-A', customerName: '架空花子' }, samenameLookup, false),
    ).toBe(false);
  });

  it('doc.customerKeyがあればそれで名前キーを判定する(customerNameが空でも)', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: 'ended-A', customerKey: '架空花子', customerConfirmed: false },
        samenameLookup,
        false,
      ),
    ).toBe(false);
  });

  it('確定済み(customerConfirmed:true)の書類は、契約終了マスターに紐づくなら従来どおり非表示', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: 'ended-A', customerName: '架空花子', customerConfirmed: true },
        samenameLookup,
        false,
      ),
    ).toBe(true);
  });

  it('同姓同名がおらず全員契約終了の名前なら、未確定でも従来どおり非表示', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: 'ended-solo', customerName: '契約終了のみ次郎', customerConfirmed: false },
        samenameLookup,
        false,
      ),
    ).toBe(true);
  });

  it('書類の氏名・customerKeyが無い未確定書類は、判定できないため従来どおり非表示', () => {
    expect(
      isDocumentHiddenByContractEnd({ customerId: 'ended-A', customerConfirmed: false }, samenameLookup, false),
    ).toBe(true);
  });

  it('契約中のマスターに紐づく書類は未確定でも表示(従来どおり)', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: 'active-A', customerName: '架空花子', customerConfirmed: false },
        samenameLookup,
        false,
      ),
    ).toBe(false);
  });

  it('表示トグルONなら確定済みでも表示(従来どおり)', () => {
    expect(
      isDocumentHiddenByContractEnd(
        { customerId: 'ended-A', customerName: '架空花子', customerConfirmed: true },
        samenameLookup,
        true,
      ),
    ).toBe(false);
  });
});
