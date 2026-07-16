/**
 * faxDuplication テスト(kanameone現場要件「複数顧客FAX複製機能」、GOAL.md D3/D4/D5)
 *
 * planFaxDuplication/buildFaxDuplicationMemberOverrideは共にFirestore/Storage副作用を
 * 持たない純粋関数のため、splitDocumentBuilder.test.ts/ocrUpdatePayloadBuilder.test.tsと
 * 同じ規約でユニットテストする(emulator不要)。
 */

import { expect } from 'chai';
import {
  planFaxDuplication,
  buildFaxDuplicationMemberOverride,
  type FaxDuplicationAssignment,
} from '../src/ocr/faxDuplication';
import type { CustomerCandidate } from '../src/utils/extractors';

function candidate(overrides: Partial<CustomerCandidate> & { id: string; name: string }): CustomerCandidate {
  return {
    score: 100,
    matchType: 'exact',
    isDuplicate: false,
    ...overrides,
  };
}

describe('planFaxDuplication (D3: 複製トリガー条件)', () => {
  it('flag OFFの場合、exact候補が2件以上あってもshouldDuplicate: falseを返す(reason: flagDisabled)', () => {
    const result = planFaxDuplication({
      flagEnabled: false,
      alreadyDistributed: false,
      alreadyConfirmedOrVerified: false,
      candidates: [candidate({ id: 'c1', name: '田中太郎' }), candidate({ id: 'c2', name: '田中花子' })],
    });
    expect(result.shouldDuplicate).to.equal(false);
    expect(result.assignments).to.deep.equal([]);
    expect(result.reason).to.equal('flagDisabled');
  });

  it('既にdistributionIdを持つdoc(alreadyDistributed: true)は再複製しない(AC-c、reason: alreadyDistributed)', () => {
    const result = planFaxDuplication({
      flagEnabled: true,
      alreadyDistributed: true,
      alreadyConfirmedOrVerified: false,
      candidates: [candidate({ id: 'c1', name: '田中太郎' }), candidate({ id: 'c2', name: '田中花子' })],
    });
    expect(result.shouldDuplicate).to.equal(false);
    expect(result.reason).to.equal('alreadyDistributed');
  });

  it('customerConfirmed/verifiedのいずれかが既にtrueのdocは複製しない(code-review high指摘: 人間の確定済み割当を保護、reason: alreadyConfirmedOrVerified)', () => {
    const result = planFaxDuplication({
      flagEnabled: true,
      alreadyDistributed: false,
      alreadyConfirmedOrVerified: true,
      candidates: [candidate({ id: 'c1', name: '田中太郎' }), candidate({ id: 'c2', name: '田中花子' })],
    });
    expect(result.shouldDuplicate).to.equal(false);
    expect(result.assignments).to.deep.equal([]);
    expect(result.reason).to.equal('alreadyConfirmedOrVerified');
  });

  it('exact&&非isDuplicateの候補が1件のみの場合は複製しない(reason: insufficientExactCandidates)', () => {
    const result = planFaxDuplication({
      flagEnabled: true,
      alreadyDistributed: false,
      alreadyConfirmedOrVerified: false,
      candidates: [candidate({ id: 'c1', name: '田中太郎' })],
    });
    expect(result.shouldDuplicate).to.equal(false);
    expect(result.assignments).to.deep.equal([]);
    expect(result.reason).to.equal('insufficientExactCandidates');
  });

  it('候補が0件の場合は複製しない', () => {
    const result = planFaxDuplication({
      flagEnabled: true,
      alreadyDistributed: false,
      alreadyConfirmedOrVerified: false,
      candidates: [],
    });
    expect(result.shouldDuplicate).to.equal(false);
    expect(result.reason).to.equal('insufficientExactCandidates');
  });

  it('exact&&非isDuplicateの候補が2件以上 → shouldDuplicate: trueで両方に割当を返す', () => {
    const result = planFaxDuplication({
      flagEnabled: true,
      alreadyDistributed: false,
      alreadyConfirmedOrVerified: false,
      candidates: [
        candidate({ id: 'c1', name: '田中太郎', careManagerName: '五十嵐恵' }),
        candidate({ id: 'c2', name: '田中花子' }),
      ],
    });
    expect(result.shouldDuplicate).to.equal(true);
    expect(result.reason).to.equal('exactCandidatesDistributed');
    expect(result.assignments).to.deep.equal([
      { customerId: 'c1', customerName: '田中太郎', careManagerName: '五十嵐恵' },
      { customerId: 'c2', customerName: '田中花子', careManagerName: null },
    ]);
  });

  it('exact&&非isDuplicateの候補が3件(GOAL.md現場要件の実例: 利用者3名記載FAX) → 3件全員に割当を返す', () => {
    const result = planFaxDuplication({
      flagEnabled: true,
      alreadyDistributed: false,
      alreadyConfirmedOrVerified: false,
      candidates: [
        candidate({ id: 'c1', name: '田中太郎' }),
        candidate({ id: 'c2', name: '田中花子' }),
        candidate({ id: 'c3', name: '田中一郎' }),
      ],
    });
    expect(result.shouldDuplicate).to.equal(true);
    expect(result.assignments).to.have.lengthOf(3);
    expect(result.assignments.map((a) => a.customerId)).to.deep.equal(['c1', 'c2', 'c3']);
  });

  it('matchType!==exactの候補(fuzzy/partial)は複製対象に含めない(偽陽性リスク対策)', () => {
    const result = planFaxDuplication({
      flagEnabled: true,
      alreadyDistributed: false,
      alreadyConfirmedOrVerified: false,
      candidates: [
        candidate({ id: 'c1', name: '田中太郎', matchType: 'exact' }),
        candidate({ id: 'c2', name: '田中花子', matchType: 'fuzzy' }),
        candidate({ id: 'c3', name: '田中一郎', matchType: 'partial' }),
      ],
    });
    expect(result.shouldDuplicate).to.equal(false);
    expect(result.reason).to.equal('insufficientExactCandidates');
  });

  it('isDuplicate: trueの候補(同姓同名フラグ)は複製対象に含めない', () => {
    const result = planFaxDuplication({
      flagEnabled: true,
      alreadyDistributed: false,
      alreadyConfirmedOrVerified: false,
      candidates: [
        candidate({ id: 'c1', name: '田中太郎', isDuplicate: false }),
        candidate({ id: 'c2', name: '田中太郎', isDuplicate: true }),
      ],
    });
    expect(result.shouldDuplicate).to.equal(false);
    expect(result.reason).to.equal('insufficientExactCandidates');
  });

  it('同一customerIdが複数回出現しても重複排除される(1件として扱う)', () => {
    const result = planFaxDuplication({
      flagEnabled: true,
      alreadyDistributed: false,
      alreadyConfirmedOrVerified: false,
      candidates: [
        candidate({ id: 'c1', name: '田中太郎' }),
        candidate({ id: 'c1', name: '田中太郎' }),
        candidate({ id: 'c2', name: '田中花子' }),
      ],
    });
    expect(result.shouldDuplicate).to.equal(true);
    expect(result.assignments).to.have.lengthOf(2);
    expect(result.assignments.map((a) => a.customerId)).to.deep.equal(['c1', 'c2']);
  });

  it('consideredCandidatesに判定対象の全候補(観測用ログ材料)が含まれる', () => {
    const result = planFaxDuplication({
      flagEnabled: true,
      alreadyDistributed: false,
      alreadyConfirmedOrVerified: false,
      candidates: [
        candidate({ id: 'c1', name: '田中太郎', score: 100 }),
        candidate({ id: 'c2', name: '田中花子', score: 95, matchType: 'fuzzy' }),
      ],
    });
    expect(result.consideredCandidates).to.deep.equal([
      { customerId: 'c1', matchType: 'exact', score: 100, isDuplicate: false },
      { customerId: 'c2', matchType: 'fuzzy', score: 95, isDuplicate: false },
    ]);
  });
});

describe('buildFaxDuplicationMemberOverride (D4/D5)', () => {
  const assignment: FaxDuplicationAssignment = {
    customerId: 'cust_tanaka',
    customerName: '田中太郎',
    careManagerName: '五十嵐恵',
  };

  it('customerId/customerName/careManagerが割当内容で上書きされる', () => {
    const result = buildFaxDuplicationMemberOverride(assignment, 'dist_1');
    expect(result.customerId).to.equal('cust_tanaka');
    expect(result.customerName).to.equal('田中太郎');
    expect(result.careManager).to.equal('五十嵐恵');
  });

  it('customerConfirmed:true, confirmedBy:null, verified:falseが設定される(D5)', () => {
    const result = buildFaxDuplicationMemberOverride(assignment, 'dist_1');
    expect(result.customerConfirmed).to.equal(true);
    expect(result.confirmedBy).to.equal(null);
    expect(result.confirmedAt).to.equal(null);
    expect(result.verified).to.equal(false);
    expect(result.verifiedBy).to.equal(null);
    expect(result.verifiedAt).to.equal(null);
  });

  it('isDuplicateCustomer/needsManualCustomerSelectionは常にfalse(自動配信のため手動選択不要)', () => {
    const result = buildFaxDuplicationMemberOverride(assignment, 'dist_1');
    expect(result.isDuplicateCustomer).to.equal(false);
    expect(result.needsManualCustomerSelection).to.equal(false);
  });

  it('distributionIdは渡された値(元docのid)がそのまま設定される', () => {
    const result = buildFaxDuplicationMemberOverride(assignment, 'original_doc_id');
    expect(result.distributionId).to.equal('original_doc_id');
  });

  it('careManagerNameがnullの場合、careManagerもnullになる', () => {
    const result = buildFaxDuplicationMemberOverride({ ...assignment, careManagerName: null }, 'dist_1');
    expect(result.careManager).to.equal(null);
  });
});
