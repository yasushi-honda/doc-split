/**
 * Issue #445 PR-D4 S1-5: Phase D artifactReader unit test (BF22 + manifest chain authority).
 *
 * - readPhaseCArtifactFromManifest: manifest 経由 chain authority (phaseA/B/C ref を取得)
 * - readPhaseBCandidatesIndex: Phase B chunks streaming → in-memory Map 構築
 * - readPhaseACountReadOnly: Phase A summary から count 抽出
 *
 * Phase D は同 runId 強制ではなく Phase C manifest authority を採用 (Codex 8th 回答 5)。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import type { ArtifactStorageReader } from '../../scripts/pr-d4-backfill/phase-b/artifactReader';
import {
  readPhaseACountReadOnly,
  readPhaseBCandidatesIndex,
  readPhaseCArtifactFromManifest,
  ArtifactIntegrityError,
} from '../../scripts/pr-d4-backfill/phase-d/artifactReader';
import type {
  BackfillManifest,
  PhaseAClassifySummary,
  PhaseBRevalidatedCandidate,
  PhaseBRevalidatedChunk,
  PhaseBRevalidationSummary,
  PhaseCBackfillChunk,
  PhaseCBackfillSummary,
  PhaseCWrittenDoc,
} from '../../scripts/pr-d4-backfill/types';

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

const RUN_ID = '20260515T030000Z-dev-pr-d4-v1';
const BUCKET = 'docsplit-dev-pr-d4-artifacts';
const MANIFEST_PATH = `gs://${BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/manifest.json`;

class FakeReader implements ArtifactStorageReader {
  private store = new Map<string, { content: string; generation: number }>();
  private nextGen = 100;
  seed(path: string, content: string): number {
    const generation = this.nextGen++;
    this.store.set(path, { content, generation });
    return generation;
  }
  async readJson(path: string): Promise<{ content: string; generation: number }> {
    const obj = this.store.get(path);
    if (!obj) throw new Error(`fake reader: object not found: ${path}`);
    return obj;
  }
}

describe('Phase D artifactReader (manifest chain authority、BF22 streaming)', () => {
  describe('readPhaseCArtifactFromManifest', () => {
    it('manifest 経由で phaseA/B/C 全 ref を取得 + writtenDocs streaming', async () => {
      const reader = new FakeReader();
      const phaseAMain: PhaseAClassifySummary = {
        phase: 'A',
        schemaVersion: 'pr-d4-v1.0',
        scriptVersion: 'pr-d4-v1.0',
        env: 'dev',
        runId: RUN_ID,
        snapshotStartedAt: '2026-05-15T00:00:00.000Z',
        snapshotCompletedAt: '2026-05-15T00:01:00.000Z',
        bucketLocation: 'asia-northeast1',
        cloudRunJobLocation: 'asia-northeast1',
        egressFreeAssertion: true,
        totalDocs: 100,
        categoryDistribution: {
          MatchedByHash: 50,
          RepairableMissingFile: 0,
          Ambiguous: 0,
          LostOrUnrecoverable: 0,
          NeedsManualReview: 0,
        },
        alreadyBackfilled: 0,
        verifiedExistingProvenance: 30,
        chunks: [],
      };
      const phaseAPath = `gs://${BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-a.json`;
      reader.seed(phaseAPath, JSON.stringify(phaseAMain));

      const phaseBMain: PhaseBRevalidationSummary = {
        phase: 'B',
        schemaVersion: 'pr-d4-v1.0',
        scriptVersion: 'pr-d4-v1.0',
        env: 'dev',
        runId: RUN_ID,
        phaseAArtifactRef: phaseAPath,
        phaseAManifestSha256: 'phaseA-sha',
        revalidationStartedAt: '2026-05-15T01:00:00.000Z',
        revalidationCompletedAt: '2026-05-15T01:30:00.000Z',
        candidatesIn: 2,
        candidatesOut: 2,
        driftSkipped: { firestoreUpdateTimeChanged: 0, childGenerationChanged: 0, parentGenerationChanged: 0 },
        verifyFailedMatchedByHash: 0,
        skippedNonMatchedByHash: 0,
        chunks: [],
      };
      const phaseBPath = `gs://${BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-b.json`;
      reader.seed(phaseBPath, JSON.stringify(phaseBMain));

      const writtenDocs: PhaseCWrittenDoc[] = [
        {
          docId: 'doc1',
          writeStatus: 'ok',
          newProvenanceBackfillSha256: 'sha-doc1',
          lastUpdateTimeAfter: '2026-05-15T02:30:01.000Z',
        },
        {
          docId: 'doc2',
          writeStatus: 'ok',
          newProvenanceBackfillSha256: 'sha-doc2',
          lastUpdateTimeAfter: '2026-05-15T02:30:02.000Z',
        },
      ];
      const phaseCChunk: PhaseCBackfillChunk = {
        schemaVersion: 'pr-d4-v1.0',
        chunkIndex: 0,
        writtenDocs,
        preconditionFailedDocs: [],
        immutableSkippedDocs: [],
        unprocessableDocs: [],
        outOfScopeDocs: [],
      };
      const phaseCChunkContent = JSON.stringify(phaseCChunk);
      const phaseCChunkPath = `gs://${BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-c-chunk-0.json`;
      reader.seed(phaseCChunkPath, phaseCChunkContent);

      const phaseCMain: PhaseCBackfillSummary = {
        phase: 'C',
        schemaVersion: 'pr-d4-v1.0',
        scriptVersion: 'pr-d4-v1.0',
        env: 'dev',
        runId: RUN_ID,
        phaseBArtifactRef: phaseBPath,
        phaseBManifestSha256: 'phaseB-sha',
        backfillStartedAt: '2026-05-15T02:00:00.000Z',
        backfillCompletedAt: '2026-05-15T02:30:00.000Z',
        candidatesIn: 2,
        writtenDocs: 2,
        preconditionFailedDocs: 0,
        skippedImmutable: 0,
        unprocessableDocs: 0,
        outOfScopeDocs: 0,
        lockAcquiredGeneration: '999',
        lockReleasedAt: '2026-05-15T02:30:01.000Z',
        rateLimiterConfig: { tokensPerSecond: 100, burstCapacity: 100 },
        chunks: [
          { path: phaseCChunkPath, sha256: sha256Hex(phaseCChunkContent), docCount: 2 },
        ],
      };
      const phaseCMainContent = JSON.stringify(phaseCMain);
      const phaseCPath = `gs://${BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-c-main.json`;
      reader.seed(phaseCPath, phaseCMainContent);

      const manifest: BackfillManifest = {
        schemaVersion: 'pr-d4-v1.0',
        runId: RUN_ID,
        env: 'dev',
        phaseA: { mainArtifact: { path: phaseAPath, sha256: 'phaseA-sha' }, chunks: [] },
        phaseB: { mainArtifact: { path: phaseBPath, sha256: 'phaseB-sha' }, chunks: [] },
        phaseC: {
          mainArtifact: { path: phaseCPath, sha256: sha256Hex(phaseCMainContent) },
          chunks: phaseCMain.chunks,
        },
      };
      const manifestGen = reader.seed(MANIFEST_PATH, JSON.stringify(manifest));

      const stream = await readPhaseCArtifactFromManifest({
        manifestPath: MANIFEST_PATH,
        reader,
      });

      expect(stream.phaseAArtifactRef).to.equal(phaseAPath);
      expect(stream.phaseBArtifactRef).to.equal(phaseBPath);
      expect(stream.phaseCArtifactRef).to.equal(phaseCPath);
      expect(stream.writtenDocsIn).to.equal(2);
      expect(stream.manifestGeneration).to.equal(manifestGen);

      const collected: PhaseCWrittenDoc[] = [];
      for await (const doc of stream.writtenDocs()) {
        collected.push(doc);
      }
      expect(collected).to.have.length(2);
      expect(collected[0].docId).to.equal('doc1');
      expect(collected[1].docId).to.equal('doc2');
    });

    it('manifest.phaseC absent → throw', async () => {
      const reader = new FakeReader();
      const manifest: BackfillManifest = {
        schemaVersion: 'pr-d4-v1.0',
        runId: RUN_ID,
        env: 'dev',
        phaseA: { mainArtifact: { path: 'a', sha256: 's' }, chunks: [] },
      };
      reader.seed(MANIFEST_PATH, JSON.stringify(manifest));
      try {
        await readPhaseCArtifactFromManifest({ manifestPath: MANIFEST_PATH, reader });
        expect.fail('should throw');
      } catch (err) {
        expect((err as Error).message).to.match(/phaseC section absent/);
      }
    });

    it('main artifact sha256 mismatch → ArtifactIntegrityError', async () => {
      const reader = new FakeReader();
      const phaseAPath = 'phaseA';
      const phaseBPath = 'phaseB';
      const phaseCPath = 'phaseC';
      reader.seed(phaseAPath, '{}');
      reader.seed(phaseBPath, '{}');
      reader.seed(phaseCPath, JSON.stringify({ phase: 'C', chunks: [] }));
      const manifest: BackfillManifest = {
        schemaVersion: 'pr-d4-v1.0',
        runId: RUN_ID,
        env: 'dev',
        phaseA: { mainArtifact: { path: phaseAPath, sha256: 's' }, chunks: [] },
        phaseB: { mainArtifact: { path: phaseBPath, sha256: 's' }, chunks: [] },
        phaseC: { mainArtifact: { path: phaseCPath, sha256: 'wrong-sha' }, chunks: [] },
      };
      reader.seed(MANIFEST_PATH, JSON.stringify(manifest));
      try {
        await readPhaseCArtifactFromManifest({ manifestPath: MANIFEST_PATH, reader });
        expect.fail('should throw');
      } catch (err) {
        expect(err).to.be.instanceOf(ArtifactIntegrityError);
      }
    });
  });

  describe('readPhaseBCandidatesIndex', () => {
    it('全 chunks を docId 単位 Map に集約 + sha256 verify', async () => {
      const reader = new FakeReader();
      const cand1: PhaseBRevalidatedCandidate = {
        docId: 'doc1',
        category: 'MatchedByHash',
        computedConfidence: 'derived-bytes-verified',
        computedProvenance: {
          sourceGeneration: '100',
          sourceMetageneration: '1',
          sourceSha256: 'a'.repeat(64),
          sourcePath: 'parent.pdf',
          sourceBucket: 'bucket',
          derivedObjectPath: 'processed/doc1/doc1.pdf',
          derivedGeneration: '200',
          derivedMetageneration: '1',
          derivedSha256: 'b'.repeat(64),
          createdAt: '2026-05-13T10:00:00.000Z',
        },
        evidence: {
          parentExists: true,
          parentSha256MatchedAtBackfill: true,
          childSha256ComputedAtBackfill: true,
        },
      };
      const chunk: PhaseBRevalidatedChunk = {
        schemaVersion: 'pr-d4-v1.0',
        chunkIndex: 0,
        revalidated: [cand1],
      };
      const chunkContent = JSON.stringify(chunk);
      const chunkPath = `gs://${BUCKET}/phaseB-chunk-0.json`;
      reader.seed(chunkPath, chunkContent);

      const phaseBMain: PhaseBRevalidationSummary = {
        phase: 'B',
        schemaVersion: 'pr-d4-v1.0',
        scriptVersion: 'pr-d4-v1.0',
        env: 'dev',
        runId: RUN_ID,
        phaseAArtifactRef: 'phaseA',
        phaseAManifestSha256: 's',
        revalidationStartedAt: 'a',
        revalidationCompletedAt: 'b',
        candidatesIn: 1,
        candidatesOut: 1,
        driftSkipped: { firestoreUpdateTimeChanged: 0, childGenerationChanged: 0, parentGenerationChanged: 0 },
        verifyFailedMatchedByHash: 0,
        skippedNonMatchedByHash: 0,
        chunks: [{ path: chunkPath, sha256: sha256Hex(chunkContent), docCount: 1 }],
      };
      const phaseBPath = `gs://${BUCKET}/phaseB-main.json`;
      reader.seed(phaseBPath, JSON.stringify(phaseBMain));

      const index = await readPhaseBCandidatesIndex(phaseBPath, sha256Hex(JSON.stringify(phaseBMain)), reader);
      expect(index.size).to.equal(1);
      expect(index.get('doc1')).to.not.be.undefined;
      expect(index.get('doc1')!.computedConfidence).to.equal('derived-bytes-verified');
    });
  });

  describe('readPhaseACountReadOnly', () => {
    it('Phase A summary から totalDocs / alreadyBackfilled / verifiedExistingProvenance / categoryDistribution 抽出', async () => {
      const reader = new FakeReader();
      const phaseAMain: PhaseAClassifySummary = {
        phase: 'A',
        schemaVersion: 'pr-d4-v1.0',
        scriptVersion: 'pr-d4-v1.0',
        env: 'dev',
        runId: RUN_ID,
        snapshotStartedAt: 'a',
        snapshotCompletedAt: 'b',
        bucketLocation: 'asia-northeast1',
        cloudRunJobLocation: 'asia-northeast1',
        egressFreeAssertion: true,
        totalDocs: 5725,
        categoryDistribution: {
          MatchedByHash: 4500,
          RepairableMissingFile: 4,
          Ambiguous: 135,
          LostOrUnrecoverable: 86,
          NeedsManualReview: 0,
        },
        alreadyBackfilled: 0,
        verifiedExistingProvenance: 1000,
        chunks: [],
      };
      const path = 'phaseA-main';
      const phaseAContent = JSON.stringify(phaseAMain);
      reader.seed(path, phaseAContent);
      const count = await readPhaseACountReadOnly(path, sha256Hex(phaseAContent), reader);
      expect(count.totalDocs).to.equal(5725);
      expect(count.verifiedExistingProvenance).to.equal(1000);
      expect(count.categoryDistribution.MatchedByHash).to.equal(4500);
      expect(count.categoryDistribution.Ambiguous).to.equal(135);
    });
  });
});
