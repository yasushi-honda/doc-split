/**
 * shared/multiCustomerDetection.ts テスト(kanameone現場要件、PR-A「複数人記載FAX:
 * 複製廃止→検出バッジへの置換」、2026-08-30)
 *
 * `selectDistinctExactCandidates`/`isMultiCustomerDetected`は純粋関数のため、
 * faxDuplication.test.tsと同じ規約でユニットテストする(emulator不要)。
 *
 * parity テストは「検出基準は複製発火条件(functions/src/ocr/faxDuplication.ts の
 * planFaxDuplication)と厳密に同一である」という本機能の中核要件そのものを表明する:
 * 同一の候補集合に対して、常に
 *   planFaxDuplication(...).shouldDuplicate === isMultiCustomerDetected(distinct ids)
 * が成立することを既存フィクスチャ全パターンで検証する。
 */

import { expect } from 'chai';
import {
  selectDistinctExactCandidates,
  selectDistinctExactCustomerIds,
  isMultiCustomerDetected,
  buildMultiCustomerDetectionFields,
  MULTI_CUSTOMER_MIN_COUNT,
  type MultiCustomerCandidateLike,
} from '../../shared/multiCustomerDetection';
import { planFaxDuplication } from '../src/ocr/faxDuplication';
import type { CustomerCandidate } from '../src/utils/extractors';

function candidate(overrides: Partial<CustomerCandidate> & { id: string; name: string }): CustomerCandidate {
  return {
    score: 100,
    matchType: 'exact',
    isDuplicate: false,
    ...overrides,
  };
}

function toLike(c: CustomerCandidate): MultiCustomerCandidateLike {
  return {
    customerId: c.id,
    customerName: c.name,
    score: c.score,
    matchType: c.matchType,
    isDuplicate: c.isDuplicate,
  };
}

/** planFaxDuplication と同一の候補集合を渡し、shouldDuplicate との parity を検証するヘルパー。 */
function expectParity(candidates: CustomerCandidate[], sameNameCollisionNames: ReadonlySet<string>): void {
  const plan = planFaxDuplication({
    flagEnabled: true,
    alreadyDistributed: false,
    alreadyConfirmedOrVerified: false,
    candidates,
    sameNameCollisionNames,
  });
  const distinctIds = selectDistinctExactCustomerIds(candidates.map(toLike), sameNameCollisionNames);
  expect(isMultiCustomerDetected(distinctIds)).to.equal(
    plan.shouldDuplicate,
    `検出結果(${isMultiCustomerDetected(distinctIds)})と複製発火判定(${plan.shouldDuplicate})が一致しない`
  );
}

describe('MULTI_CUSTOMER_MIN_COUNT', () => {
  it('しきい値は2である', () => {
    expect(MULTI_CUSTOMER_MIN_COUNT).to.equal(2);
  });
});

describe('selectDistinctExactCandidates', () => {
  it('exact && 非isDuplicate && 非同名衝突の候補をscore降順・customerId重複排除して返す', () => {
    const candidates: MultiCustomerCandidateLike[] = [
      { customerId: 'c1', customerName: '田中太郎', score: 60, matchType: 'exact', isDuplicate: false },
      { customerId: 'c2', customerName: '田中花子', score: 90, matchType: 'exact', isDuplicate: false },
    ];
    const result = selectDistinctExactCandidates(candidates, new Set());
    expect(result.map((c) => c.customerId)).to.deep.equal(['c2', 'c1']);
  });

  it('matchTypeがexact以外の候補は除外する', () => {
    const candidates: MultiCustomerCandidateLike[] = [
      { customerId: 'c1', customerName: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false },
      { customerId: 'c2', customerName: '田中花子', score: 95, matchType: 'fuzzy', isDuplicate: false },
    ];
    expect(selectDistinctExactCandidates(candidates, new Set()).map((c) => c.customerId)).to.deep.equal(['c1']);
  });

  it('isDuplicate:trueの候補は除外する', () => {
    const candidates: MultiCustomerCandidateLike[] = [
      { customerId: 'c1', customerName: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false },
      { customerId: 'c2', customerName: '田中太郎', score: 100, matchType: 'exact', isDuplicate: true },
    ];
    expect(selectDistinctExactCandidates(candidates, new Set()).map((c) => c.customerId)).to.deep.equal(['c1']);
  });

  it('sameNameCollisionNamesに含まれる名前(trim済み照合)の候補は除外する', () => {
    const candidates: MultiCustomerCandidateLike[] = [
      { customerId: 'c1', customerName: ' 田中太郎 ', score: 100, matchType: 'exact', isDuplicate: false },
      { customerId: 'c2', customerName: '田中花子', score: 95, matchType: 'exact', isDuplicate: false },
    ];
    expect(
      selectDistinctExactCandidates(candidates, new Set(['田中太郎'])).map((c) => c.customerId)
    ).to.deep.equal(['c2']);
  });

  it('customerIdがnullの候補は除外する(FE型はnullを許すため)', () => {
    const candidates: MultiCustomerCandidateLike[] = [
      { customerId: null, customerName: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false },
      { customerId: 'c2', customerName: '田中花子', score: 95, matchType: 'exact', isDuplicate: false },
    ];
    expect(selectDistinctExactCandidates(candidates, new Set()).map((c) => c.customerId)).to.deep.equal(['c2']);
  });

  it('ジェネリックのため余剰フィールド(careManagerName等)を保持したまま返す', () => {
    const candidates = [
      { customerId: 'c1', customerName: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false, careManagerName: '五十嵐恵' },
    ];
    const result = selectDistinctExactCandidates(candidates, new Set());
    expect(result[0]?.careManagerName).to.equal('五十嵐恵');
  });
});

describe('isMultiCustomerDetected', () => {
  it('distinct候補が2件以上でtrue', () => {
    expect(isMultiCustomerDetected(['c1', 'c2'])).to.equal(true);
  });
  it('distinct候補が1件以下でfalse', () => {
    expect(isMultiCustomerDetected(['c1'])).to.equal(false);
    expect(isMultiCustomerDetected([])).to.equal(false);
  });
});

describe('buildMultiCustomerDetectionFields', () => {
  const candidates: MultiCustomerCandidateLike[] = [
    { customerId: 'c1', customerName: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false },
    { customerId: 'c2', customerName: '田中花子', score: 98, matchType: 'exact', isDuplicate: false },
  ];

  it('enabled:falseの場合、空オブジェクトを返す(キー自体を書き込まない設計)', () => {
    const result = buildMultiCustomerDetectionFields(candidates, new Set(), false);
    expect(result).to.deep.equal({});
    expect('multiCustomerDetected' in result).to.equal(false);
    expect('multiCustomerCount' in result).to.equal(false);
  });

  it('enabled:trueかつ2件検出時、multiCustomerDetected:true・multiCustomerCount:2を返す', () => {
    const result = buildMultiCustomerDetectionFields(candidates, new Set(), true);
    expect(result).to.deep.equal({ multiCustomerDetected: true, multiCustomerCount: 2 });
  });

  it('enabled:trueかつ1件のみ検出時、multiCustomerDetected:false・multiCustomerCount:1を返す(非検出時も明示的にfalseを書く)', () => {
    const result = buildMultiCustomerDetectionFields([candidates[0]!], new Set(), true);
    expect(result).to.deep.equal({ multiCustomerDetected: false, multiCustomerCount: 1 });
  });
});

describe('parity: 検出基準は複製発火条件(planFaxDuplication)と厳密に同一である', () => {
  it('パターン1: exact候補2件 → 両方とも検出/複製発火が一致してtrue', () => {
    expectParity(
      [candidate({ id: 'c1', name: '田中太郎' }), candidate({ id: 'c2', name: '田中花子' })],
      new Set()
    );
  });

  it('パターン2: exact1件 + fuzzy複数件 → 検出/複製発火が一致してfalse(fuzzyは対象外)', () => {
    expectParity(
      [
        candidate({ id: 'c1', name: '田中太郎', matchType: 'exact' }),
        candidate({ id: 'c2', name: '田中花子', matchType: 'fuzzy' }),
        candidate({ id: 'c3', name: '田中一郎', matchType: 'partial' }),
      ],
      new Set()
    );
  });

  it('パターン3: isDuplicate混在 → 検出/複製発火が一致してfalse', () => {
    expectParity(
      [
        candidate({ id: 'c1', name: '田中太郎', isDuplicate: false }),
        candidate({ id: 'c2', name: '田中太郎', isDuplicate: true }),
      ],
      new Set()
    );
  });

  it('パターン4: 同姓同名衝突により除外 → 検出/複製発火が一致してfalse', () => {
    expectParity(
      [
        candidate({ id: 'c1', name: '田中太郎', isDuplicate: false }),
        candidate({ id: 'c2', name: '田中花子', isDuplicate: false }),
      ],
      new Set(['田中太郎'])
    );
  });

  it('パターン5: 同一customerIdが複数回出現 → 重複排除後1件のみとなり検出/複製発火が一致してfalse', () => {
    expectParity(
      [
        candidate({ id: 'c1', name: '田中太郎' }),
        candidate({ id: 'c1', name: '田中太郎' }),
      ],
      new Set()
    );
  });

  it('パターン6: 候補が空配列 → 検出/複製発火が一致してfalse', () => {
    expectParity([], new Set());
  });
});
