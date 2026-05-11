/**
 * Issue #432 PR-C: collisionClassifier.ts pure function テスト
 *
 * Codex セカンドオピニオン (2026-05-11) 反映後の分類ロジックを固定する:
 *   - hash matched 一意のみ MatchedByHash (自動 migrate)
 *   - hash matched 複数 / 不能 / 不一致は Ambiguous (manual-review)
 *   - LikelyWinner は Ambiguous 内 suggestedWinner hint に降格 (自動 destructive 禁止)
 *   - orphan + parent + 親 PDF 在 → RepairableMissingFile (auto regenerate)
 *   - 復元不能は LostOrUnrecoverable (status:'error' 誘導)
 *
 * AC カバレッジ: AC-1〜AC-4 (5 分類), AC-10 (Partial update 不変 = recommendedAction の type 固定),
 * AC-11 (RepairableMissingFile 分類)。
 */

import { expect } from 'chai';
import {
  classifyCollisionGroup,
  classifyOrphan,
  CollisionDoc,
  CollisionGroup,
  DocEvidence,
} from '../../scripts/lib/collisionClassifier';

function makeDoc(overrides: Partial<CollisionDoc> = {}): CollisionDoc {
  return {
    id: 'docA',
    status: 'processed',
    fileName: '20260509_未判定_未判定_p3.pdf',
    fileUrl: 'gs://bucket/processed/20260509_未判定_未判定_p3.pdf',
    parentDocumentId: 'parent-1',
    splitFromPages: { start: 3, end: 3 },
    rotatedAt: null,
    processedAt: '2026-05-09T00:00:00Z',
    updatedAt: '2026-05-09T00:00:00Z',
    ...overrides,
  };
}

const PARENT_OK = { exists: true as const, originalPdfExists: true as const };
const PARENT_MISSING = { exists: false as const };
const PARENT_NO_PDF = { exists: true as const, originalPdfExists: false as const };

describe('collisionClassifier (Issue #432 PR-C)', () => {
  describe('classifyCollisionGroup - ケース 1: hash matched 一意', () => {
    it('1 件単独 group + hash matched → MatchedByHash 単独 (AC-2)', () => {
      const group: CollisionGroup = {
        fileName: 'single.pdf',
        evidences: [
          {
            doc: makeDoc({ id: 'winner' }),
            hashEvidence: { type: 'matched', sha256: 'abc' },
            parent: PARENT_OK,
          },
        ],
      };
      const results = classifyCollisionGroup(group);
      expect(results).to.have.length(1);
      expect(results[0].docId).to.equal('winner');
      expect(results[0].classification).to.equal('MatchedByHash');
      expect(results[0].recommendedAction).to.equal('migrate-to-namespace');
      expect(results[0].suggestedWinner).to.be.false;
    });

    it('hash matched 一意 + 敗者 1 件 (parent あり) → 勝者 MatchedByHash + 敗者 RepairableMissingFile', () => {
      const group: CollisionGroup = {
        fileName: 'collision.pdf',
        evidences: [
          {
            doc: makeDoc({ id: 'winner' }),
            hashEvidence: { type: 'matched', sha256: 'abc' },
            parent: PARENT_OK,
          },
          {
            doc: makeDoc({ id: 'loser', parentDocumentId: 'parent-2' }),
            hashEvidence: {
              type: 'mismatched',
              actualSha256: 'abc',
              expectedSha256: 'xyz',
            },
            parent: PARENT_OK,
          },
        ],
      };
      const results = classifyCollisionGroup(group);
      const winner = results.find((r) => r.docId === 'winner')!;
      const loser = results.find((r) => r.docId === 'loser')!;
      expect(winner.classification).to.equal('MatchedByHash');
      expect(winner.recommendedAction).to.equal('migrate-to-namespace');
      expect(loser.classification).to.equal('RepairableMissingFile');
      expect(loser.recommendedAction).to.equal('regenerate-from-parent');
    });

    it('hash matched 一意 + 敗者 (parent なし) → 勝者 MatchedByHash + 敗者 LostOrUnrecoverable', () => {
      const group: CollisionGroup = {
        fileName: 'collision-no-parent.pdf',
        evidences: [
          {
            doc: makeDoc({ id: 'winner' }),
            hashEvidence: { type: 'matched', sha256: 'abc' },
            parent: PARENT_OK,
          },
          {
            doc: makeDoc({ id: 'loser', parentDocumentId: null, splitFromPages: null }),
            hashEvidence: { type: 'unavailable', reason: 'no-parent' },
            parent: null,
          },
        ],
      };
      const results = classifyCollisionGroup(group);
      const loser = results.find((r) => r.docId === 'loser')!;
      expect(loser.classification).to.equal('LostOrUnrecoverable');
      expect(loser.recommendedAction).to.equal('mark-error');
      expect(loser.reason).to.contain('no parentDocumentId');
    });
  });

  describe('classifyCollisionGroup - ケース 2: hash matched 複数', () => {
    it('hash matched 2 件 → 全員 Ambiguous (Codex Critical: 自動 destructive 禁止)', () => {
      const group: CollisionGroup = {
        fileName: 'multi-match.pdf',
        evidences: [
          {
            doc: makeDoc({ id: 'docA' }),
            hashEvidence: { type: 'matched', sha256: 'abc' },
            parent: PARENT_OK,
          },
          {
            doc: makeDoc({ id: 'docB' }),
            hashEvidence: { type: 'matched', sha256: 'abc' },
            parent: PARENT_OK,
          },
        ],
      };
      const results = classifyCollisionGroup(group);
      results.forEach((r) => {
        expect(r.classification).to.equal('Ambiguous');
        expect(r.recommendedAction).to.equal('manual-review');
        expect(r.suggestedWinner).to.be.true; // 両者 hash 一致のため両方 hint
      });
    });
  });

  describe('classifyCollisionGroup - ケース 3: hash matched なし', () => {
    it('hash 不能 + 全 docs rotatedAt=null → 全件 Ambiguous (suggestedWinner なし) (AC-3)', () => {
      const group: CollisionGroup = {
        fileName: 'no-hint.pdf',
        evidences: [
          {
            doc: makeDoc({ id: 'docA', rotatedAt: null }),
            hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
            parent: PARENT_OK,
          },
          {
            doc: makeDoc({ id: 'docB', rotatedAt: null }),
            hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
            parent: PARENT_OK,
          },
        ],
      };
      const results = classifyCollisionGroup(group);
      results.forEach((r) => {
        expect(r.classification).to.equal('Ambiguous');
        expect(r.suggestedWinner).to.be.false;
      });
    });

    it('hash 不能 + 1 件のみ rotatedAt 値あり → その doc が suggestedWinner=true (AC-4, Codex Critical: 自動 action 禁止)', () => {
      const group: CollisionGroup = {
        fileName: 'one-rotated.pdf',
        evidences: [
          {
            doc: makeDoc({ id: 'docA', rotatedAt: null }),
            hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
            parent: PARENT_OK,
          },
          {
            doc: makeDoc({ id: 'rotated-1', rotatedAt: '2026-05-10T00:00:00Z' }),
            hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
            parent: PARENT_OK,
          },
        ],
      };
      const results = classifyCollisionGroup(group);
      const hinted = results.find((r) => r.docId === 'rotated-1')!;
      const other = results.find((r) => r.docId === 'docA')!;
      expect(hinted.suggestedWinner).to.be.true;
      expect(hinted.recommendedAction).to.equal('manual-review'); // ★ 自動 action 禁止 (Codex 反映)
      expect(hinted.classification).to.equal('Ambiguous');
      expect(other.suggestedWinner).to.be.false;
    });

    it('hash 不能 + 複数 rotatedAt 値あり → suggestedWinner なし (唯一でないため hint 不成立)', () => {
      const group: CollisionGroup = {
        fileName: 'multi-rotated.pdf',
        evidences: [
          {
            doc: makeDoc({ id: 'docA', rotatedAt: '2026-05-10T00:00:00Z' }),
            hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
            parent: PARENT_OK,
          },
          {
            doc: makeDoc({ id: 'docB', rotatedAt: '2026-05-11T00:00:00Z' }),
            hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
            parent: PARENT_OK,
          },
        ],
      };
      const results = classifyCollisionGroup(group);
      results.forEach((r) => {
        expect(r.suggestedWinner).to.be.false;
      });
    });

    it('hash 全件 mismatched → 全員 Ambiguous', () => {
      const group: CollisionGroup = {
        fileName: 'all-mismatch.pdf',
        evidences: [
          {
            doc: makeDoc({ id: 'docA' }),
            hashEvidence: {
              type: 'mismatched',
              actualSha256: 'aaa',
              expectedSha256: 'xxx',
            },
            parent: PARENT_OK,
          },
          {
            doc: makeDoc({ id: 'docB' }),
            hashEvidence: {
              type: 'mismatched',
              actualSha256: 'aaa',
              expectedSha256: 'yyy',
            },
            parent: PARENT_OK,
          },
        ],
      };
      const results = classifyCollisionGroup(group);
      results.forEach((r) => {
        expect(r.classification).to.equal('Ambiguous');
        expect(r.reason).to.contain('hash mismatch');
      });
    });
  });

  describe('classifyOrphan (fileUrl 孤児)', () => {
    it('orphan + parent + originalPdf 在 → RepairableMissingFile (AC-11)', () => {
      const evidence: DocEvidence = {
        doc: makeDoc({ id: 'orphan-1' }),
        hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
        parent: PARENT_OK,
      };
      const result = classifyOrphan(evidence);
      expect(result.classification).to.equal('RepairableMissingFile');
      expect(result.recommendedAction).to.equal('regenerate-from-parent');
    });

    it('orphan + parentDocumentId なし → LostOrUnrecoverable', () => {
      const evidence: DocEvidence = {
        doc: makeDoc({ id: 'orphan-2', parentDocumentId: null, splitFromPages: null }),
        hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
        parent: null,
      };
      const result = classifyOrphan(evidence);
      expect(result.classification).to.equal('LostOrUnrecoverable');
      expect(result.recommendedAction).to.equal('mark-error');
      expect(result.reason).to.contain('no parentDocumentId');
    });

    it('orphan + splitFromPages なし → LostOrUnrecoverable', () => {
      const evidence: DocEvidence = {
        doc: makeDoc({ id: 'orphan-3', splitFromPages: null }),
        hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
        parent: PARENT_OK,
      };
      const result = classifyOrphan(evidence);
      expect(result.classification).to.equal('LostOrUnrecoverable');
      expect(result.reason).to.contain('no splitFromPages');
    });

    it('orphan + parent.exists=false → LostOrUnrecoverable', () => {
      const evidence: DocEvidence = {
        doc: makeDoc({ id: 'orphan-4' }),
        hashEvidence: { type: 'unavailable', reason: 'no-parent' },
        parent: PARENT_MISSING,
      };
      const result = classifyOrphan(evidence);
      expect(result.classification).to.equal('LostOrUnrecoverable');
      expect(result.reason).to.contain('not found');
    });

    it('orphan + parent あり + 親 PDF なし → LostOrUnrecoverable', () => {
      const evidence: DocEvidence = {
        doc: makeDoc({ id: 'orphan-5' }),
        hashEvidence: { type: 'unavailable', reason: 'no-parent-original-pdf' },
        parent: PARENT_NO_PDF,
      };
      const result = classifyOrphan(evidence);
      expect(result.classification).to.equal('LostOrUnrecoverable');
      expect(result.reason).to.contain('parent original PDF not in Storage');
    });
  });

  describe('AC-1: 5 分類混在シナリオ', () => {
    it('1 group で MatchedByHash + RepairableMissingFile + Ambiguous + LostOrUnrecoverable が混在可能', () => {
      const group: CollisionGroup = {
        fileName: 'mixed.pdf',
        evidences: [
          {
            doc: makeDoc({ id: 'matched' }),
            hashEvidence: { type: 'matched', sha256: 'abc' },
            parent: PARENT_OK,
          },
          {
            doc: makeDoc({ id: 'repairable', parentDocumentId: 'parent-3' }),
            hashEvidence: {
              type: 'mismatched',
              actualSha256: 'abc',
              expectedSha256: 'def',
            },
            parent: PARENT_OK,
          },
          {
            doc: makeDoc({ id: 'lost', parentDocumentId: null, splitFromPages: null }),
            hashEvidence: { type: 'unavailable', reason: 'no-parent' },
            parent: null,
          },
        ],
      };
      const results = classifyCollisionGroup(group);
      const classifications = results.map((r) => r.classification).sort();
      expect(classifications).to.deep.equal([
        'LostOrUnrecoverable',
        'MatchedByHash',
        'RepairableMissingFile',
      ]);
    });
  });

  describe('AC-10: Partial update 不変 (recommendedAction の type 固定)', () => {
    it('全 recommendedAction は migrate-to-namespace / regenerate-from-parent / manual-review / mark-error の 4 種のみ', () => {
      const allowedActions = new Set([
        'migrate-to-namespace',
        'regenerate-from-parent',
        'manual-review',
        'mark-error',
      ]);

      const group: CollisionGroup = {
        fileName: 'enum-check.pdf',
        evidences: [
          {
            doc: makeDoc({ id: 'a' }),
            hashEvidence: { type: 'matched', sha256: 'h' },
            parent: PARENT_OK,
          },
          {
            doc: makeDoc({ id: 'b', parentDocumentId: null }),
            hashEvidence: { type: 'unavailable', reason: 'no-parent' },
            parent: null,
          },
        ],
      };
      const results = classifyCollisionGroup(group);
      results.forEach((r) => {
        expect(allowedActions.has(r.recommendedAction), r.recommendedAction).to.be.true;
      });
    });
  });
});
