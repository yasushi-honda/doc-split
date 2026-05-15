/**
 * Issue #445 PR-D4 S1-5: Phase D docVerifier unit test (Codex Critical 1/2 反映).
 *
 * Stage 1: observed field 単位検証 (factory 再 invoke なし)
 * Stage 2: sha256 deterministic 確認 (Stage 1 pass のみ)
 *
 * verify 観点:
 * - verified ケース (provenance 10 fields 一致 + Stage 1 pass + Stage 2 sha256 一致)
 * - provenance mismatch (sourceSha256 不一致 / derivedSha256 不一致 / createdAt 不一致)
 * - backfill-field mismatch (method 違反 / confidence 不正型 / evidence.* 不正値)
 * - sha256 mismatch (Stage 2 で hash 不一致)
 * - missing-expected (Phase B index に docId 不在)
 * - BF10: provenance.createdAt vs document.createdAt 比較
 */

import { expect } from 'chai';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyDoc, type ObservedDocState } from '../../scripts/pr-d4-backfill/phase-d/docVerifier';
import { sha256ProvenanceBackfill } from '../../scripts/pr-d4-backfill/phase-c/batchWriter';
import { createBackfillProvenance } from '../src/pdf/provenance';
import type { PhaseBRevalidatedCandidate } from '../../scripts/pr-d4-backfill/types';

// Test fixtures
const BACKFILL_SCRIPT_VERSION = 'pr-d4-v1.0';
const SHA_PARENT = 'a'.repeat(64);
const SHA_CHILD = 'b'.repeat(64);

function makeExpectedCandidate(docId: string): PhaseBRevalidatedCandidate {
  return {
    docId,
    category: 'MatchedByHash',
    computedConfidence: 'derived-bytes-verified',
    computedProvenance: {
      sourceGeneration: '1700000001',
      sourceMetageneration: '1',
      sourceSha256: SHA_PARENT,
      sourcePath: 'sources/parent.pdf',
      sourceBucket: 'doc-split-dev-data',
      derivedObjectPath: `processed/${docId}/${docId}.pdf`,
      derivedGeneration: '1700000002',
      derivedMetageneration: '1',
      derivedSha256: SHA_CHILD,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    evidence: {
      parentExists: true,
      parentSha256MatchedAtBackfill: true,
      childSha256ComputedAtBackfill: true,
    },
  };
}

function makeObservedAligned(docId: string, expected: PhaseBRevalidatedCandidate): {
  observed: ObservedDocState;
  expectedSha256: string;
} {
  const splitCreatedAt = Timestamp.fromDate(new Date(expected.computedProvenance.createdAt));
  const backfilledAt = Timestamp.fromDate(new Date('2026-05-15T10:00:00.000Z'));
  const built = createBackfillProvenance({
    provenanceFields: {
      sourceGeneration: expected.computedProvenance.sourceGeneration,
      sourceMetageneration: expected.computedProvenance.sourceMetageneration,
      sourceSha256: expected.computedProvenance.sourceSha256,
      sourcePath: expected.computedProvenance.sourcePath,
      sourceBucket: expected.computedProvenance.sourceBucket,
      derivedObjectPath: expected.computedProvenance.derivedObjectPath,
      derivedGeneration: expected.computedProvenance.derivedGeneration,
      derivedMetageneration: expected.computedProvenance.derivedMetageneration,
      derivedSha256: expected.computedProvenance.derivedSha256,
      createdAt: splitCreatedAt,
    },
    confidence: 'derived-bytes-verified',
    classifierCategory: 'MatchedByHash',
    evidence: {
      parentExists: true,
      parentSha256MatchedAtBackfill: true,
      childSha256ComputedAtBackfill: true,
    },
    backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
    backfilledAt,
  });
  const expectedSha256 = sha256ProvenanceBackfill(built.provenanceBackfill);
  return {
    observed: {
      docId,
      documentCreatedAt: splitCreatedAt,
      provenance: built.provenance,
      provenanceBackfill: built.provenanceBackfill,
      provenanceBackfillRaw: built.provenanceBackfill,
    },
    expectedSha256,
  };
}

describe('verifyDoc - Phase D Stage 1 + Stage 2 (Codex Critical 1/2 反映)', () => {
  describe('verified ケース', () => {
    it('provenance 10 fields 一致 + Stage 1 pass + Stage 2 sha256 一致 → kind=verified', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('verified');
      if (result.kind === 'verified') {
        expect(result.provenanceFieldsConsistent).to.be.true;
        expect(result.provenanceBackfillSha256Match).to.be.true;
        expect(result.observedConfidence).to.equal('derived-bytes-verified');
        expect(result.createdAtConsistent).to.be.true;
      }
    });
  });

  describe('missing-expected ケース', () => {
    it('Phase B index に docId 不在 → mismatchType="missing-expected"', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: undefined,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
      if (result.kind === 'mismatch') {
        expect(result.mismatches[0].mismatchType).to.equal('missing-expected');
        expect(result.mismatches[0].field).to.equal('__phaseBIndex');
      }
    });
  });

  describe('provenance-field mismatch ケース (Critical 1 反映)', () => {
    it('observed.provenance.sourceSha256 不一致 → mismatchType="provenance-field" + field="sourceSha256"', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      // observed の sourceSha256 を別値に書換 (drift simulation)
      observed.provenance!.sourceSha256 = 'c'.repeat(64);
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
      if (result.kind === 'mismatch') {
        const sourceSha = result.mismatches.find((m) => m.field === 'sourceSha256');
        expect(sourceSha).to.not.be.undefined;
        expect(sourceSha!.mismatchType).to.equal('provenance-field');
        expect(sourceSha!.observed).to.equal('c'.repeat(64));
        expect(sourceSha!.expected).to.equal(SHA_PARENT);
      }
    });

    it('observed.provenance.derivedSha256 不一致 → field="derivedSha256"', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      observed.provenance!.derivedSha256 = 'd'.repeat(64);
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
      if (result.kind === 'mismatch') {
        const derivedSha = result.mismatches.find((m) => m.field === 'derivedSha256');
        expect(derivedSha).to.not.be.undefined;
      }
    });

    it('observed.provenance.createdAt が Timestamp でない → mismatch', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      (observed.provenance as unknown as Record<string, unknown>).createdAt = 'not-a-timestamp';
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
    });

    it('observed.provenance null → field="provenance" mismatch', () => {
      const expected = makeExpectedCandidate('doc1');
      const observed: ObservedDocState = {
        docId: 'doc1',
        documentCreatedAt: Timestamp.now(),
        provenance: null,
        provenanceBackfill: null,
        provenanceBackfillRaw: undefined,
      };
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: 'a'.repeat(64),
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
      if (result.kind === 'mismatch') {
        expect(result.mismatches[0].field).to.equal('provenance');
      }
    });
  });

  describe('backfill-field mismatch ケース (Critical 2 反映 Stage 1)', () => {
    it('provenanceBackfill.method !== "legacy-observed" → mismatchType="backfill-field"', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      (observed.provenanceBackfillRaw as Record<string, unknown>).method = 'future-method';
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
      if (result.kind === 'mismatch') {
        const methodMismatch = result.mismatches.find((m) => m.field === 'provenanceBackfill.method');
        expect(methodMismatch).to.not.be.undefined;
        expect(methodMismatch!.mismatchType).to.equal('backfill-field');
        expect(methodMismatch!.observed).to.equal('future-method');
      }
    });

    it('provenanceBackfill.confidence が unknown 値 → mismatch', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      (observed.provenanceBackfillRaw as Record<string, unknown>).confidence = 'mystery';
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
      if (result.kind === 'mismatch') {
        const confMismatch = result.mismatches.find((m) => m.field === 'provenanceBackfill.confidence');
        expect(confMismatch).to.not.be.undefined;
      }
    });

    it('provenanceBackfill.backfilledAt が Timestamp でない → mismatch', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      (observed.provenanceBackfillRaw as Record<string, unknown>).backfilledAt = 'not-a-timestamp';
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
      if (result.kind === 'mismatch') {
        const backfilledAtMismatch = result.mismatches.find(
          (m) => m.field === 'provenanceBackfill.backfilledAt'
        );
        expect(backfilledAtMismatch).to.not.be.undefined;
      }
    });

    it('provenanceBackfill.evidence.parentExists が boolean でない → mismatch', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      const evidence = (observed.provenanceBackfillRaw as Record<string, unknown>).evidence as Record<
        string,
        unknown
      >;
      evidence.parentExists = 'yes';
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
    });

    it('parentSha256MatchedAtBackfill が `boolean | null` 以外 → mismatch (Codex 8th Important 2)', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      const evidence = (observed.provenanceBackfillRaw as Record<string, unknown>).evidence as Record<
        string,
        unknown
      >;
      evidence.parentSha256MatchedAtBackfill = 'maybe';
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
    });

    it('parentSha256MatchedAtBackfill が null → Stage 1 pass (一般 validator は null 許容)', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed } = makeObservedAligned('doc1', expected);
      // null を入れて Stage 1 で fail しないことを確認
      // (child-snapshot-only 経路で null が正当値、Codex 8th Important 2)
      const evidence = (observed.provenanceBackfillRaw as Record<string, unknown>).evidence as Record<
        string,
        unknown
      >;
      evidence.parentSha256MatchedAtBackfill = null;
      // confidence も child-snapshot-only に合わせる
      (observed.provenanceBackfillRaw as Record<string, unknown>).confidence = 'child-snapshot-only';
      // sha256 は別計算
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: 'unrelated',  // Stage 2 sha256 mismatch 想定
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      // Stage 1 は pass (mismatch type が 'backfill-field' でなく 'sha256' で出る)
      if (result.kind === 'mismatch') {
        const stage1Fail = result.mismatches.find((m) => m.mismatchType === 'backfill-field');
        expect(stage1Fail, 'Stage 1 should pass when parentSha256MatchedAtBackfill is null').to.be
          .undefined;
      }
    });
  });

  describe('sha256 mismatch ケース (Stage 2)', () => {
    it('Phase C expectedSha256 と Stage 2 sha256 不一致 → mismatchType="sha256"', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed } = makeObservedAligned('doc1', expected);
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: 'f'.repeat(64),  // 全く別の hash
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
      if (result.kind === 'mismatch') {
        const shaMismatch = result.mismatches.find((m) => m.mismatchType === 'sha256');
        expect(shaMismatch).to.not.be.undefined;
        expect(shaMismatch!.field).to.equal('provenanceBackfill.sha256');
        expect(shaMismatch!.expected).to.equal('f'.repeat(64));
      }
    });
  });

  describe('BF10: provenance.createdAt vs document.createdAt 検証', () => {
    it('document.createdAt と provenance.createdAt 一致 → createdAtConsistent=true', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('verified');
      if (result.kind === 'verified') {
        expect(result.createdAtConsistent).to.be.true;
        expect(result.createdAtMismatch).to.be.null;
      }
    });

    it('document.createdAt と provenance.createdAt 不一致 → createdAtConsistent=false + createdAtMismatch あり', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      observed.documentCreatedAt = Timestamp.fromDate(new Date('2030-01-01T00:00:00.000Z'));
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('verified');
      if (result.kind === 'verified') {
        expect(result.createdAtConsistent).to.be.false;
        expect(result.createdAtMismatch).to.not.be.null;
        expect(result.createdAtMismatch!.field).to.match(/createdAt/);
      }
    });

    it('document.createdAt が null → createdAtConsistent=false + createdAtMismatch あり', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      observed.documentCreatedAt = null;
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      if (result.kind === 'verified') {
        expect(result.createdAtConsistent).to.be.false;
        expect(result.createdAtMismatch).to.not.be.null;
      }
    });
  });

  describe('provenanceBackfillRaw が null / undefined / array (Stage 1 防御)', () => {
    it('provenanceBackfillRaw === null → mismatchType="backfill-field"', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      observed.provenanceBackfillRaw = null;
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
      if (result.kind === 'mismatch') {
        const fieldMismatch = result.mismatches.find((m) => m.field === 'provenanceBackfill');
        expect(fieldMismatch).to.not.be.undefined;
        expect(fieldMismatch!.observed).to.be.null;
      }
    });

    it('provenanceBackfillRaw === array → reject', () => {
      const expected = makeExpectedCandidate('doc1');
      const { observed, expectedSha256 } = makeObservedAligned('doc1', expected);
      observed.provenanceBackfillRaw = [{ confidence: 'derived-bytes-verified' }];
      const result = verifyDoc({
        observed,
        expectedFromPhaseB: expected,
        expectedSha256FromPhaseC: expectedSha256,
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      });
      expect(result.kind).to.equal('mismatch');
    });
  });
});
