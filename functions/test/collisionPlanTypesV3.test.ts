/**
 * Issue #432 PR-C3c: collision plan v3 schema + provenance/lockfile pure function の単体テスト。
 *
 * 対象は scripts/lib/ の以下 pure function:
 *  - collisionPlanTypes: verifyActionProvenanceInvariant / verifyProvenanceCompleteness /
 *    computeSourceManifestHash
 *  - parentPdfProvenance: verifyParentPdfProvenanceMatch (I/O を伴う
 *    computeParentPdfProvenance は dev リハーサル integration test で)
 *  - lockfileGate: verifyLockfileMatch (I/O を伴う readLockfileSnapshot は dev リハーサルで)
 *
 * 各 AC との対応:
 *  - AC-INVARIANT (AC18-1, Codex Critical C2): verifyActionProvenanceInvariant 4 action × 2 値
 *  - AC18-1 (provenance completeness): verifyProvenanceCompleteness 6 fields ×
 *    null / empty 各パターン
 *  - AC18-2 (runtime 親 PDF 照合): verifyParentPdfProvenanceMatch 6 fields いずれかの mismatch
 *  - AC-CC1-2 (lockfile gate): verifyLockfileMatch lockfileHash / pdfLibLockfileVersion mismatch
 *  - AC-SURVEY-MANIFEST-1 (deterministic hash): computeSourceManifestHash の安定 sort + 同値性
 */

import { expect } from 'chai';
import {
  COLLISION_PLAN_SCHEMA_VERSION,
  PROVENANCE_REQUIRED_BY_ACTION,
  computeSourceManifestHash,
  verifyActionProvenanceInvariant,
  verifyProvenanceCompleteness,
  type ParentPdfProvenance,
  type SourceManifestEntry,
} from '../../scripts/lib/collisionPlanTypes';
import { verifyParentPdfProvenanceMatch } from '../../scripts/lib/parentPdfProvenance';
import { verifyLockfileMatch } from '../../scripts/lib/lockfileGate';

describe('collision plan v3 schema constants', () => {
  it('COLLISION_PLAN_SCHEMA_VERSION is literal "collision-plan-v3"', () => {
    expect(COLLISION_PLAN_SCHEMA_VERSION).to.equal('collision-plan-v3');
  });

  it('PROVENANCE_REQUIRED_BY_ACTION maps 4 actions to expected booleans', () => {
    expect(PROVENANCE_REQUIRED_BY_ACTION['regenerate-from-parent']).to.equal(true);
    expect(PROVENANCE_REQUIRED_BY_ACTION['migrate-to-namespace']).to.equal(false);
    expect(PROVENANCE_REQUIRED_BY_ACTION['manual-review']).to.equal(false);
    expect(PROVENANCE_REQUIRED_BY_ACTION['mark-error']).to.equal(false);
  });
});

describe('verifyActionProvenanceInvariant (AC-INVARIANT / AC18-1)', () => {
  // Codex Critical C2 反映: plan 改竄で「regenerate-from-parent + provenanceRequired:false」を
  // 作っても execute Gate 8 で reject されることをロジックレベルで保証する。
  const validCombinations: Array<[Parameters<typeof verifyActionProvenanceInvariant>[0], boolean]> = [
    ['regenerate-from-parent', true],
    ['migrate-to-namespace', false],
    ['manual-review', false],
    ['mark-error', false],
  ];
  const invalidCombinations: Array<[Parameters<typeof verifyActionProvenanceInvariant>[0], boolean]> = [
    ['regenerate-from-parent', false], // bypass attempt
    ['migrate-to-namespace', true],
    ['manual-review', true],
    ['mark-error', true],
  ];

  for (const [action, provenanceRequired] of validCombinations) {
    it(`accepts valid combo (action=${action}, provenanceRequired=${provenanceRequired})`, () => {
      const result = verifyActionProvenanceInvariant(action, provenanceRequired);
      expect(result.ok).to.equal(true);
    });
  }

  for (const [action, provenanceRequired] of invalidCombinations) {
    it(`rejects invalid combo (action=${action}, provenanceRequired=${provenanceRequired})`, () => {
      const result = verifyActionProvenanceInvariant(action, provenanceRequired);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.reason).to.include('schema invariant violated');
        expect(result.reason).to.include(action);
      }
    });
  }
});

describe('verifyProvenanceCompleteness (AC18-1)', () => {
  const validProvenance: ParentPdfProvenance = {
    sourceBucket: 'docsplit-dev.firebasestorage.app',
    sourcePath: 'original/parent-doc-1/parent.pdf',
    sourceGeneration: '1234567890123456',
    sourceMetageneration: '1',
    sourceSha256: 'a'.repeat(64),
    derivedObjectPath: 'processed/child-doc-1/p1-2.pdf',
  };

  it('accepts complete 6-field provenance', () => {
    const result = verifyProvenanceCompleteness(validProvenance);
    expect(result.ok).to.equal(true);
  });

  it('rejects null provenance', () => {
    const result = verifyProvenanceCompleteness(null);
    expect(result.ok).to.equal(false);
    if (!result.ok) expect(result.reason).to.include('null or undefined');
  });

  const fields: Array<keyof ParentPdfProvenance> = [
    'sourceBucket',
    'sourcePath',
    'sourceGeneration',
    'sourceMetageneration',
    'sourceSha256',
    'derivedObjectPath',
  ];
  for (const field of fields) {
    it(`rejects when ${field} is empty string`, () => {
      const tampered: ParentPdfProvenance = { ...validProvenance, [field]: '' };
      const result = verifyProvenanceCompleteness(tampered);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.reason).to.include(field);
        expect(result.reason).to.include('empty-string');
      }
    });
  }
});

describe('verifyParentPdfProvenanceMatch (AC18-2)', () => {
  const planRecord: ParentPdfProvenance = {
    sourceBucket: 'docsplit-dev.firebasestorage.app',
    sourcePath: 'original/parent/p.pdf',
    sourceGeneration: '111',
    sourceMetageneration: '1',
    sourceSha256: 'b'.repeat(64),
    derivedObjectPath: 'processed/child/p.pdf',
  };

  it('accepts when all 6 fields match', () => {
    const result = verifyParentPdfProvenanceMatch(planRecord, { ...planRecord });
    expect(result.ok).to.equal(true);
  });

  const fields: Array<keyof ParentPdfProvenance> = [
    'sourceBucket',
    'sourcePath',
    'sourceGeneration',
    'sourceMetageneration',
    'sourceSha256',
    'derivedObjectPath',
  ];
  for (const field of fields) {
    it(`rejects when ${field} mismatches (parent PDF changed since classify)`, () => {
      const tampered: ParentPdfProvenance = { ...planRecord, [field]: 'changed-value' };
      const result = verifyParentPdfProvenanceMatch(planRecord, tampered);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.reason).to.include(field);
        expect(result.reason).to.include('mismatch');
      }
    });
  }
});

describe('verifyLockfileMatch (AC-CC1-2)', () => {
  const planRecord = {
    lockfileHash: 'c'.repeat(64),
    pdfLibLockfileVersion: '1.17.1',
  };

  it('accepts when both fields match', () => {
    const result = verifyLockfileMatch(planRecord, { ...planRecord });
    expect(result.ok).to.equal(true);
  });

  it('rejects when lockfileHash mismatches', () => {
    const runtime = { ...planRecord, lockfileHash: 'd'.repeat(64) };
    const result = verifyLockfileMatch(planRecord, runtime);
    expect(result.ok).to.equal(false);
    if (!result.ok) expect(result.reason).to.include('lockfileHash mismatch');
  });

  it('rejects when pdfLibLockfileVersion mismatches', () => {
    const runtime = { ...planRecord, pdfLibLockfileVersion: '2.0.0' };
    const result = verifyLockfileMatch(planRecord, runtime);
    expect(result.ok).to.equal(false);
    if (!result.ok) expect(result.reason).to.include('pdfLibLockfileVersion mismatch');
  });
});

describe('computeSourceManifestHash (AC-SURVEY-MANIFEST-1)', () => {
  const entry = (objectName: string, sha: string): SourceManifestEntry => ({
    bucket: 'docsplit-dev',
    prefix: 'processed/',
    objectName,
    generation: '1',
    metageneration: '1',
    size: '12345',
    sha256: sha,
  });

  it('produces deterministic hash for same entry set in different orders', () => {
    const set1 = [entry('a.pdf', 'a'.repeat(64)), entry('b.pdf', 'b'.repeat(64))];
    const set2 = [entry('b.pdf', 'b'.repeat(64)), entry('a.pdf', 'a'.repeat(64))];
    expect(computeSourceManifestHash(set1)).to.equal(computeSourceManifestHash(set2));
  });

  it('produces different hash when content differs', () => {
    const set1 = [entry('a.pdf', 'a'.repeat(64))];
    const set2 = [entry('a.pdf', 'X'.repeat(64))];
    expect(computeSourceManifestHash(set1)).to.not.equal(computeSourceManifestHash(set2));
  });

  it('produces different hash when entry set differs', () => {
    const set1 = [entry('a.pdf', 'a'.repeat(64))];
    const set2 = [entry('a.pdf', 'a'.repeat(64)), entry('b.pdf', 'b'.repeat(64))];
    expect(computeSourceManifestHash(set1)).to.not.equal(computeSourceManifestHash(set2));
  });

  it('returns 64-character hex sha256', () => {
    const hash = computeSourceManifestHash([entry('x.pdf', '0'.repeat(64))]);
    expect(hash).to.match(/^[0-9a-f]{64}$/);
  });

  it('handles empty entry list deterministically', () => {
    const hash = computeSourceManifestHash([]);
    expect(hash).to.match(/^[0-9a-f]{64}$/);
    // empty payload sha256 (確認: crypto.createHash('sha256').update('', 'utf8').digest('hex'))
    expect(hash).to.equal(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});
