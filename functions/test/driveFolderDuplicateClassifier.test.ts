/**
 * Issue #811 Phase B: folderDuplicateClassifier.ts pure function テスト
 * (`functions/test/collisionClassifier.test.ts`と同じ構成方針)。
 *
 * 「hint出しても自動action禁止」原則: 曖昧・不能・競合・担当替え・複数親・shortcutは
 * 全てmanual-reviewに倒し、move-to-canonicalは安全に確信できる場合のみ選ぶことを固定する。
 */

import { expect } from 'chai';
import { classifyDuplicateFile, type FileEvidence } from '../../scripts/lib/folderDuplicateClassifier';

function baseEvidence(overrides: Partial<FileEvidence> = {}): FileEvidence {
  return {
    driveFileId: 'file-1',
    name: 'test.pdf',
    mimeType: 'application/pdf',
    parents: ['parent-1'],
    trashed: false,
    docSplitDocId: 'doc-1',
    firestoreDoc: { docId: 'doc-1', careManagerName: '森 奈穂美' },
    targetCareManagerName: '森 奈穂美',
    destinationConflict: false,
    ...overrides,
  };
}

describe('classifyDuplicateFile', () => {
  it('confirms move-to-canonical when all conditions are safe', () => {
    const result = classifyDuplicateFile(baseEvidence());
    expect(result.classification).to.equal('ConfirmedMatch');
    expect(result.recommendedAction).to.equal('move-to-canonical');
  });

  it('routes shortcuts to manual-review', () => {
    const result = classifyDuplicateFile(
      baseEvidence({ mimeType: 'application/vnd.google-apps.shortcut' })
    );
    expect(result.classification).to.equal('ManualReviewRequired');
    expect(result.recommendedAction).to.equal('manual-review');
    expect(result.reason).to.match(/shortcut/);
  });

  it('routes multi-parent files to manual-review', () => {
    const result = classifyDuplicateFile(baseEvidence({ parents: ['parent-1', 'parent-2'] }));
    expect(result.recommendedAction).to.equal('manual-review');
    expect(result.reason).to.match(/multi-parent/);
  });

  it('routes files with zero parents to manual-review', () => {
    const result = classifyDuplicateFile(baseEvidence({ parents: [] }));
    expect(result.recommendedAction).to.equal('manual-review');
    expect(result.reason).to.match(/multi-parent/);
  });

  it('routes unlinked files (no docSplitDocId) to manual-review', () => {
    const result = classifyDuplicateFile(baseEvidence({ docSplitDocId: null }));
    expect(result.recommendedAction).to.equal('manual-review');
    expect(result.reason).to.match(/unlinked/);
  });

  it('routes files whose docSplitDocId does not resolve in Firestore to manual-review', () => {
    const result = classifyDuplicateFile(baseEvidence({ firestoreDoc: null }));
    expect(result.recommendedAction).to.equal('manual-review');
    expect(result.reason).to.match(/unresolvable/);
  });

  it('routes reassigned care manager (current != target) to manual-review, never automatic', () => {
    const result = classifyDuplicateFile(
      baseEvidence({ firestoreDoc: { docId: 'doc-1', careManagerName: '別 担当者' } })
    );
    expect(result.classification).to.equal('ManualReviewRequired');
    expect(result.recommendedAction).to.equal('manual-review');
    expect(result.reason).to.match(/reassigned/);
  });

  it('routes destination conflicts to manual-review', () => {
    const result = classifyDuplicateFile(baseEvidence({ destinationConflict: true }));
    expect(result.recommendedAction).to.equal('manual-review');
    expect(result.reason).to.match(/conflict/);
  });

  it('never returns move-to-canonical for ManualReviewRequired classification (defense-in-depth precondition)', () => {
    const cases: Partial<FileEvidence>[] = [
      { mimeType: 'application/vnd.google-apps.shortcut' },
      { parents: ['a', 'b'] },
      { docSplitDocId: null },
      { firestoreDoc: null },
      { firestoreDoc: { docId: 'doc-1', careManagerName: '別 担当者' } },
      { destinationConflict: true },
    ];
    for (const override of cases) {
      const result = classifyDuplicateFile(baseEvidence(override));
      if (result.classification === 'ManualReviewRequired') {
        expect(result.recommendedAction).to.equal('manual-review');
      }
    }
  });
});
