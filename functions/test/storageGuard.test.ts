/**
 * Issue #432 PR-C: scripts/lib/storageGuard.ts pure function テスト
 *
 * evaluatePathSafety: Firestore mock 不要の pure function 部分のみテスト。
 * 統合系 (findDocsReferencingFileUrl / isPathSafeToDeleteAfterExcluding) は
 * dev fixture 経由で動作確認 (T6)。
 */

import { expect } from 'chai';
import { evaluatePathSafety } from '../../scripts/lib/storageGuard';

describe('storageGuard.evaluatePathSafety (Issue #432 PR-C)', () => {
  it('共有 doc なし → safe=true / residual=空', () => {
    const result = evaluatePathSafety([], ['docX']);
    expect(result.safe).to.be.true;
    expect(result.residualDocIds).to.deep.equal([]);
  });

  it('除外 IDs が共有者全員をカバー → safe=true', () => {
    const result = evaluatePathSafety(['doc1', 'doc2'], ['doc1', 'doc2']);
    expect(result.safe).to.be.true;
    expect(result.residualDocIds).to.deep.equal([]);
  });

  it('除外されない共有者が 1 件残る → safe=false / residual=その doc', () => {
    const result = evaluatePathSafety(['doc1', 'doc2', 'doc3'], ['doc1', 'doc2']);
    expect(result.safe).to.be.false;
    expect(result.residualDocIds).to.deep.equal(['doc3']);
  });

  it('除外 IDs に含まれない無関係 doc が複数残存 → safe=false', () => {
    const result = evaluatePathSafety(['a', 'b', 'c'], ['z']);
    expect(result.safe).to.be.false;
    expect(result.residualDocIds.sort()).to.deep.equal(['a', 'b', 'c']);
  });

  it('除外 IDs 空配列 + 共有者あり → safe=false (= 全員残存)', () => {
    const result = evaluatePathSafety(['doc1'], []);
    expect(result.safe).to.be.false;
    expect(result.residualDocIds).to.deep.equal(['doc1']);
  });
});
