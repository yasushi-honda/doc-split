/**
 * Issue #445 PR-D4 S1-5: Phase D artifactWriter unit test (BF22 + CAS update + status file).
 *
 * - writePhaseDChunk: 1 chunk 書込、sha256 計算、docCount は verifiedDocs + fieldsMismatchDocs 合計
 * - finalizePhaseDArtifact:
 *   - main artifact 書込 (manifestUpdateStatus: 'pending' 含む)
 *   - manifest CAS update (ifGenerationMatch=manifestGeneration)
 *   - CAS 失敗時 manifestUpdateStatus: 'failed' + status file 書込 (Codex 8th Important 3)
 *   - 成功時 manifestUpdateStatus: 'ok' + status file 書込
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import {
  writePhaseDChunk,
  finalizePhaseDArtifact,
  type ArtifactStorageWriter,
} from '../../scripts/pr-d4-backfill/phase-d/artifactWriter';
import type {
  BackfillManifest,
  PhaseDFieldMismatchDoc,
  PhaseDVerifiedDoc,
  PhaseDVerifyChunk,
  PhaseDVerifySummary,
  PhaseDFinalizeStatus,
} from '../../scripts/pr-d4-backfill/types';

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

class FakeWriter implements ArtifactStorageWriter {
  private store = new Map<string, { content: string; generation: number }>();
  private nextGen = 100;
  /** Set path to fail CAS at */
  failCASPath: string | null = null;

  async writeJson(
    path: string,
    content: string,
    precondition?: { ifGenerationMatch: number }
  ): Promise<void> {
    if (this.failCASPath === path && precondition && precondition.ifGenerationMatch > 0) {
      const err = new Error('412 PreconditionFailed (simulated)');
      (err as Error & { code?: number }).code = 412;
      throw err;
    }
    const ifGenMatch = precondition?.ifGenerationMatch;
    if (ifGenMatch !== undefined) {
      const existing = this.store.get(path);
      if (ifGenMatch === 0 && existing) {
        const err = new Error('412 PreconditionFailed: already exists');
        (err as Error & { code?: number }).code = 412;
        throw err;
      }
      if (ifGenMatch > 0) {
        if (!existing || existing.generation !== ifGenMatch) {
          const err = new Error(`412 PreconditionFailed: gen mismatch`);
          (err as Error & { code?: number }).code = 412;
          throw err;
        }
      }
    }
    this.store.set(path, { content, generation: this.nextGen++ });
  }

  seed(path: string, content: string, gen: number): void {
    this.store.set(path, { content, generation: gen });
    if (this.nextGen <= gen) this.nextGen = gen + 1;
  }

  get(path: string): { content: string; generation: number } | undefined {
    return this.store.get(path);
  }
}

const BUCKET = 'docsplit-dev-pr-d4-artifacts';
const RUN_ID = '20260515T040000Z-dev-pr-d4-v1';
const MANIFEST_PATH = `gs://${BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/manifest.json`;

describe('Phase D artifactWriter', () => {
  describe('writePhaseDChunk', () => {
    it('chunk 書込 + sha256 + docCount = verifiedDocs + fieldsMismatchDocs 合計', async () => {
      const writer = new FakeWriter();
      const verifiedDocs: PhaseDVerifiedDoc[] = [
        {
          docId: 'doc1',
          provenanceFieldsConsistent: true,
          provenanceBackfillSha256Match: true,
          observedConfidence: 'derived-bytes-verified',
          observedCreatedAt: '2026-05-13T10:00:00.000Z',
        },
      ];
      const mismatches: PhaseDFieldMismatchDoc[] = [
        {
          docId: 'doc2',
          mismatchType: 'provenance-field',
          field: 'sourceSha256',
          observed: 'wrong',
          expected: 'right',
        },
        {
          docId: 'doc3',
          mismatchType: 'sha256',
          field: 'provenanceBackfill.sha256',
          observed: 'sha-a',
          expected: 'sha-b',
        },
      ];
      const pointer = await writePhaseDChunk(
        {
          bucketName: BUCKET,
          runId: RUN_ID,
          chunkIndex: 0,
          verifiedDocs,
          fieldsMismatchDocs: mismatches,
          mismatchedDocIds: ['doc2', 'doc3'],
        },
        writer
      );
      // docCount = verifiedDocs (1) + mismatchedDocIds.length (2) = 3 (doc 単位、Codex 9th C3)
      expect(pointer.docCount).to.equal(3);
      expect(pointer.path).to.match(/phase-d-verify-summary-chunk-0\.json$/);
      const written = writer.get(pointer.path);
      expect(written).to.not.be.undefined;
      expect(pointer.sha256).to.equal(sha256Hex(written!.content));
      const parsed = JSON.parse(written!.content) as PhaseDVerifyChunk;
      expect(parsed.verifiedDocs).to.have.length(1);
      expect(parsed.fieldsMismatchDocs).to.have.length(2);
    });
  });

  describe('finalizePhaseDArtifact', () => {
    function makeBaseInput(writer: FakeWriter) {
      const manifest: BackfillManifest = {
        schemaVersion: 'pr-d4-v1.0',
        runId: RUN_ID,
        env: 'dev',
        phaseA: { mainArtifact: { path: 'a', sha256: 's' }, chunks: [] },
        phaseB: { mainArtifact: { path: 'b', sha256: 's' }, chunks: [] },
        phaseC: { mainArtifact: { path: 'c', sha256: 's' }, chunks: [] },
      };
      writer.seed(MANIFEST_PATH, JSON.stringify(manifest), 500);
      return {
        bucketName: BUCKET,
        runId: RUN_ID,
        env: 'dev' as const,
        verifyStartedAt: '2026-05-15T03:00:00.000Z',
        verifyCompletedAt: '2026-05-15T03:30:00.000Z',
        phaseAArtifactRef: 'a',
        phaseBArtifactRef: 'b',
        phaseCArtifactRef: 'c',
        phaseCManifestSha256: 's',
        candidatesIn: 3,
        verifiedDocs: 3,
        fieldsConsistent: 3,
        fieldsMismatch: [] as PhaseDFieldMismatchDoc[],
        mismatchedDocCount: 0,
        createdAtConsistent: 3,
        createdAtMismatch: [] as PhaseDFieldMismatchDoc[],
        confidenceDistribution: {
          'derived-bytes-verified': 3,
          'child-snapshot-only': 0,
          'metadata-only': 0,
        },
        provenanceBackfillNullCount: 0,
        provenanceBackfillAbsentCount: 0,
        rotateGateTest: null,
        coverageRatio: {
          backfillAttemptCoverage: {
            denominator: 3,
            derivedBytesVerified: 1.0,
            childSnapshotOnly: 0,
            metadataOnly: 0,
            preconditionFailed: 0,
            immutableSkipped: 0,
          },
          estateRotateReadyCoverage: {
            denominator: 100,
            verifiedExisting: 0.5,
            backfilledDerivedBytesVerified: 0.03,
            rotateReadyTotal: 0.53,
            notRotateReady: 0.47,
          },
        },
        phaseACountReadOnly: {
          totalDocs: 100,
          alreadyBackfilled: 0,
          verifiedExistingProvenance: 50,
          categoryDistribution: {
            MatchedByHash: 50,
            RepairableMissingFile: 0,
            Ambiguous: 0,
            LostOrUnrecoverable: 0,
            NeedsManualReview: 0,
          },
        },
        chunks: [],
        existingManifest: manifest,
        manifestGeneration: 500,
      };
    }

    it('CAS update 成功 → manifestUpdateStatus="ok" + main artifact に "pending" 残る', async () => {
      const writer = new FakeWriter();
      const result = await finalizePhaseDArtifact(makeBaseInput(writer), writer);
      expect(result.manifestUpdateStatus).to.equal('ok');

      const mainWritten = writer.get(result.mainArtifactPath);
      expect(mainWritten).to.not.be.undefined;
      const parsed = JSON.parse(mainWritten!.content) as PhaseDVerifySummary;
      // Codex 8th Important 3: main は常に 'pending' で書込 (overwrite 回避)
      expect(parsed.manifestUpdateStatus).to.equal('pending');
      expect(parsed.phase).to.equal('D');
      expect(parsed.candidatesIn).to.equal(3);

      const statusWritten = writer.get(result.finalizeStatusPath);
      expect(statusWritten).to.not.be.undefined;
      const status = JSON.parse(statusWritten!.content) as PhaseDFinalizeStatus;
      expect(status.manifestUpdateStatus).to.equal('ok');
      expect(status.remediation).to.be.undefined;
    });

    it('CAS update 失敗 → manifestUpdateStatus="failed" + status file に remediation 記録', async () => {
      const writer = new FakeWriter();
      writer.failCASPath = MANIFEST_PATH;
      const result = await finalizePhaseDArtifact(makeBaseInput(writer), writer);
      expect(result.manifestUpdateStatus).to.equal('failed');

      const statusWritten = writer.get(result.finalizeStatusPath);
      expect(statusWritten).to.not.be.undefined;
      const status = JSON.parse(statusWritten!.content) as PhaseDFinalizeStatus;
      expect(status.manifestUpdateStatus).to.equal('failed');
      expect(status.remediation).to.match(/CAS failed/i);
      expect(status.remediation).to.match(/re-run Phase D/i);
    });
  });
});
