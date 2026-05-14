/**
 * Issue #445 PR-D4 S1-2: category-classifier-adapter.ts pure function テスト。
 *
 * Phase A は **構造分類** のみ (hash 計算は Phase B 担当)。
 * doc の親存在 + 子オブジェクト存在 + splitFromPages 存在 を見て 5 分類を予測する:
 *
 * | 構造的状態                                  | category               |
 * |--------------------------------------------|------------------------|
 * | parentDocumentId 不在 or splitFromPages 不在 | NeedsManualReview      |
 * | child 存在 + parent + 元 PDF 存在            | MatchedByHash (予測)   |
 * | child 不在 + parent + 元 PDF 存在            | RepairableMissingFile  |
 * | child 存在 + parent 不在 or 元 PDF 不在       | Ambiguous              |
 * | child 不在 + parent 不在 or 元 PDF 不在       | LostOrUnrecoverable    |
 */

import { expect } from 'chai';
import {
  classifyForPhaseA,
  type PhaseADocSnapshot,
} from '../../scripts/pr-d4-backfill/phase-a/categoryClassifier';

function makeSnapshot(overrides: Partial<PhaseADocSnapshot> = {}): PhaseADocSnapshot {
  return {
    docId: 'doc-x',
    parentDocumentId: 'parent-x',
    splitFromPages: { start: 1, end: 1 },
    childObjectExists: true,
    parent: { exists: true, originalPdfExists: true },
    ...overrides,
  };
}

describe('classifyForPhaseA (PR-D4 S1-2 5-category predictor)', () => {
  describe('NeedsManualReview: structural data 不足', () => {
    it('parentDocumentId 不在 → NeedsManualReview', () => {
      const result = classifyForPhaseA(
        makeSnapshot({ parentDocumentId: null })
      );
      expect(result.category).to.equal('NeedsManualReview');
      expect(result.reason).to.include('parentDocumentId');
    });

    it('splitFromPages 不在 → NeedsManualReview', () => {
      const result = classifyForPhaseA(
        makeSnapshot({ splitFromPages: null })
      );
      expect(result.category).to.equal('NeedsManualReview');
      expect(result.reason).to.include('splitFromPages');
    });

    it('parentDocumentId 不在 + splitFromPages 不在 → NeedsManualReview (両方原因)', () => {
      const result = classifyForPhaseA(
        makeSnapshot({ parentDocumentId: null, splitFromPages: null })
      );
      expect(result.category).to.equal('NeedsManualReview');
    });
  });

  describe('MatchedByHash 予測: 全構造要件揃い', () => {
    it('child 存在 + parent 存在 + 元 PDF 存在 → MatchedByHash (Phase B が verify する)', () => {
      const result = classifyForPhaseA(makeSnapshot());
      expect(result.category).to.equal('MatchedByHash');
      expect(result.reason).to.include('Phase B');
    });
  });

  describe('RepairableMissingFile: child orphan + parent OK', () => {
    it('child 不在 + parent 存在 + 元 PDF 存在 → RepairableMissingFile', () => {
      const result = classifyForPhaseA(
        makeSnapshot({ childObjectExists: false })
      );
      expect(result.category).to.equal('RepairableMissingFile');
      expect(result.reason).to.match(/orphan|regenerate/i);
    });
  });

  describe('Ambiguous: child 存在 + parent 状態不完全 (verify 不能)', () => {
    it('child 存在 + parent doc 不在 → Ambiguous', () => {
      const result = classifyForPhaseA(
        makeSnapshot({ parent: { exists: false } })
      );
      expect(result.category).to.equal('Ambiguous');
      expect(result.reason).to.match(/parent/i);
    });

    it('child 存在 + parent doc 存在だが 元 PDF 不在 → Ambiguous', () => {
      const result = classifyForPhaseA(
        makeSnapshot({ parent: { exists: true, originalPdfExists: false } })
      );
      expect(result.category).to.equal('Ambiguous');
      expect(result.reason).to.match(/original.*pdf/i);
    });
  });

  describe('LostOrUnrecoverable: child 不在 + parent 状態不完全 (regenerate 不能)', () => {
    it('child 不在 + parent doc 不在 → LostOrUnrecoverable', () => {
      const result = classifyForPhaseA(
        makeSnapshot({ childObjectExists: false, parent: { exists: false } })
      );
      expect(result.category).to.equal('LostOrUnrecoverable');
    });

    it('child 不在 + parent doc 存在だが 元 PDF 不在 → LostOrUnrecoverable', () => {
      const result = classifyForPhaseA(
        makeSnapshot({
          childObjectExists: false,
          parent: { exists: true, originalPdfExists: false },
        })
      );
      expect(result.category).to.equal('LostOrUnrecoverable');
    });
  });

  describe('reason に分類根拠を含む (operator 監査用)', () => {
    it('MatchedByHash 予測の reason は "structural" + "Phase B" の言及を含む', () => {
      const result = classifyForPhaseA(makeSnapshot());
      expect(result.reason).to.match(/structural|Phase B/i);
    });

    it('NeedsManualReview の reason は不足 field 名を含む', () => {
      const result = classifyForPhaseA(makeSnapshot({ splitFromPages: null }));
      expect(result.reason).to.include('splitFromPages');
    });
  });

  describe('parent field の null と { exists: false } 区別', () => {
    it('parentDocumentId null + parent null → NeedsManualReview (parent 取得自体不能)', () => {
      const result = classifyForPhaseA(
        makeSnapshot({ parentDocumentId: null, parent: null })
      );
      expect(result.category).to.equal('NeedsManualReview');
    });

    it('parentDocumentId あり + parent null は不正状態 → defensive に NeedsManualReview', () => {
      const result = classifyForPhaseA(makeSnapshot({ parent: null }));
      // parent 取得未実施 = caller bug 扱い、安全側で manual review に倒す
      expect(result.category).to.equal('NeedsManualReview');
    });
  });
});
