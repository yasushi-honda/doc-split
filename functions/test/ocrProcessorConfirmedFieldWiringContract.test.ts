/**
 * ocrProcessor.ts の confirmed保護マージ配線契約テスト (Issue #526 D2)
 *
 * `applyConfirmedFieldProtection()` に渡す `ConfirmedProtectionSnapshot` は
 * `freshData`(`FirebaseFirestore.DocumentData`、実質 `{[field: string]: any}`)から
 * フィールド名を手動で写経する。tscはこのマッピングのtypo(例:
 * `customerConfirmed: freshData.customerConfirm`)を検知できず、常に`undefined`
 * (=保護無効)として黙って動作してしまう。本テストはこの配線をソース文字列レベルで
 * lock-inする(docs/context/test-strategy.md §2.1 のgrep-based契約パターン踏襲、
 * `ocrProcessorAggregateCallerContract.test.ts`が同種の前例)。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('ocrProcessor confirmedFieldMerge wiring contract (Issue #526)', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/ocr/ocrProcessor.ts'),
    'utf-8'
  );

  const EXPECTED_FIELD_MAPPINGS = [
    'customerConfirmed: freshData.customerConfirmed',
    'officeConfirmed: freshData.officeConfirmed',
    'documentTypeConfirmed: freshData.documentTypeConfirmed',
    'customerName: freshData.customerName',
    'customerId: freshData.customerId',
    'careManager: freshData.careManager',
    'isDuplicateCustomer: freshData.isDuplicateCustomer',
    'needsManualCustomerSelection: freshData.needsManualCustomerSelection',
    'confirmedBy: freshData.confirmedBy',
    'confirmedAt: freshData.confirmedAt',
    'officeName: freshData.officeName',
    'officeId: freshData.officeId',
    'officeConfirmedBy: freshData.officeConfirmedBy',
    'officeConfirmedAt: freshData.officeConfirmedAt',
    'documentType: freshData.documentType',
    'category: freshData.category',
  ];

  for (const mapping of EXPECTED_FIELD_MAPPINGS) {
    it(`applyConfirmedFieldProtection呼出が \`${mapping}\` を含む`, () => {
      expect(source).to.include(mapping);
    });
  }

  it('applyConfirmedFieldProtection呼出はdb.runTransaction()内に存在する(stale snapshot対策)', () => {
    const transactionIndex = source.indexOf('db.runTransaction(');
    const callIndex = source.indexOf('applyConfirmedFieldProtection(');
    expect(transactionIndex).to.be.greaterThan(-1);
    expect(callIndex).to.be.greaterThan(-1);
    expect(callIndex).to.be.greaterThan(transactionIndex);
  });

  it('freshDataはtx.get(docRef)の結果から取得される(呼出時docDataではない)', () => {
    expect(source).to.match(/const freshSnap = await tx\.get\(docRef\)/);
    expect(source).to.match(/const freshData = freshSnap\.data\(\)/);
  });
});
