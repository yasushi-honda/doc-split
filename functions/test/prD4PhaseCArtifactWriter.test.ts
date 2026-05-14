/**
 * Issue #445 PR-D4 S1-4: Phase C artifactWriter (BF22) テスト.
 *
 * chunk 書込 (≤1000 docs/chunk) + main artifact + manifest CAS update の挙動検証。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import {
  finalizePhaseCArtifact,
  writePhaseCChunk,
  type ArtifactStorageWriter,
} from '../../scripts/pr-d4-backfill/phase-c/artifactWriter';
import type {
  BackfillManifest,
  PhaseCBackfillChunk,
  PhaseCBackfillSummary,
  PhaseCImmutableSkippedDoc,
  PhaseCPreconditionFailedDoc,
  PhaseCWrittenDoc,
} from '../../scripts/pr-d4-backfill/types';

interface WrittenObject {
  path: string;
  content: string;
  precondition?: { ifGenerationMatch: number };
}

class FakeArtifactWriter implements ArtifactStorageWriter {
  public objects: WrittenObject[] = [];
  async writeJson(
    objectPath: string,
    content: string,
    precondition?: { ifGenerationMatch: number }
  ): Promise<void> {
    this.objects.push({ path: objectPath, content, precondition });
  }
}

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

const RUN_ID = '20260515T000000Z-dev-pr-d4-v1';
const BUCKET = 'docsplit-dev-pr-d4-artifacts';

describe('Phase C artifactWriter (PR-D4 S1-4 BF22)', () => {
  describe('writePhaseCChunk', () => {
    it('chunk 構造を schemaVersion + chunkIndex 付きで JSON 化し sha256 / docCount 返却', async () => {
      const writer = new FakeArtifactWriter();
      const writtenDocs: PhaseCWrittenDoc[] = [
        {
          docId: 'd1',
          writeStatus: 'ok',
          newProvenanceBackfillSha256: 'a'.repeat(64),
          lastUpdateTimeAfter: '2026-05-15T01:00:00.000Z',
        },
      ];
      const preconditionFailedDocs: PhaseCPreconditionFailedDoc[] = [
        { docId: 'd2', reason: 'lastUpdateTime drift', retryCount: 3 },
      ];
      const immutableSkippedDocs: PhaseCImmutableSkippedDoc[] = [
        { docId: 'd3', reason: 'provenance exists, provenanceBackfill absent' },
      ];

      const pointer = await writePhaseCChunk(
        {
          bucketName: BUCKET,
          runId: RUN_ID,
          chunkIndex: 0,
          writtenDocs,
          preconditionFailedDocs,
          immutableSkippedDocs,
        },
        writer
      );

      expect(writer.objects).to.have.length(1);
      expect(writer.objects[0].path).to.equal(
        `gs://${BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-c-backfill-summary-chunk-0.json`
      );
      const parsed: PhaseCBackfillChunk = JSON.parse(writer.objects[0].content);
      expect(parsed.schemaVersion).to.equal('pr-d4-v1.0');
      expect(parsed.chunkIndex).to.equal(0);
      expect(parsed.writtenDocs).to.have.length(1);
      expect(parsed.preconditionFailedDocs).to.have.length(1);
      expect(parsed.immutableSkippedDocs).to.have.length(1);

      expect(pointer.path).to.equal(writer.objects[0].path);
      expect(pointer.sha256).to.equal(sha256Hex(writer.objects[0].content));
      expect(pointer.docCount).to.equal(1); // writtenDocs.length
    });

    it('docCount = writtenDocs.length のみ (precondition/skip は含めない)', async () => {
      const writer = new FakeArtifactWriter();
      const pointer = await writePhaseCChunk(
        {
          bucketName: BUCKET,
          runId: RUN_ID,
          chunkIndex: 5,
          writtenDocs: [],
          preconditionFailedDocs: [
            { docId: 'x', reason: 'lastUpdateTime drift', retryCount: 1 },
            { docId: 'y', reason: 'transient retry exhausted', retryCount: 3 },
          ],
          immutableSkippedDocs: [
            { docId: 'z', reason: 'provenance exists, provenanceBackfill absent' },
          ],
        },
        writer
      );
      expect(pointer.docCount).to.equal(0);
    });
  });

  describe('finalizePhaseCArtifact (main + manifest CAS)', () => {
    it('main artifact が PhaseCBackfillSummary schema を満たし、書込後に manifest を ifGenerationMatch 付きで CAS update', async () => {
      const writer = new FakeArtifactWriter();
      const existingManifest: BackfillManifest = {
        schemaVersion: 'pr-d4-v1.0',
        runId: RUN_ID,
        env: 'dev',
        phaseA: {
          mainArtifact: { path: 'gs://x/phase-a-classify-summary.json', sha256: 'aaa' },
          chunks: [],
        },
        phaseB: {
          mainArtifact: { path: 'gs://x/phase-b-revalidation-summary.json', sha256: 'bbb' },
          chunks: [],
        },
      };

      const result = await finalizePhaseCArtifact(
        {
          bucketName: BUCKET,
          runId: RUN_ID,
          env: 'dev',
          backfillStartedAt: '2026-05-15T00:00:00.000Z',
          backfillCompletedAt: '2026-05-15T00:30:00.000Z',
          phaseBArtifactRef: 'gs://x/phase-b-revalidation-summary.json',
          phaseBManifestSha256: 'phase-b-manifest-sha',
          candidatesIn: 100,
          writtenDocs: 98,
          preconditionFailedDocs: 1,
          skippedImmutable: 1,
          lockAcquiredGeneration: '12345',
          lockReleasedAt: '2026-05-15T00:30:01.000Z',
          rateLimiterConfig: { tokensPerSecond: 100, burstCapacity: 100 },
          chunks: [
            {
              path: `gs://${BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-c-backfill-summary-chunk-0.json`,
              sha256: 'c'.repeat(64),
              docCount: 98,
            },
          ],
          existingManifest,
          manifestGeneration: 7,
        },
        writer
      );

      expect(writer.objects).to.have.length(2);

      // 1 つ目: main artifact (precondition なし)
      const mainObj = writer.objects[0];
      expect(mainObj.path).to.equal(result.mainArtifactPath);
      expect(mainObj.precondition).to.be.undefined;
      const mainBody: PhaseCBackfillSummary = JSON.parse(mainObj.content);
      expect(mainBody.phase).to.equal('C');
      expect(mainBody.schemaVersion).to.equal('pr-d4-v1.0');
      expect(mainBody.env).to.equal('dev');
      expect(mainBody.candidatesIn).to.equal(100);
      expect(mainBody.writtenDocs).to.equal(98);
      expect(mainBody.preconditionFailedDocs).to.equal(1);
      expect(mainBody.skippedImmutable).to.equal(1);
      expect(mainBody.lockAcquiredGeneration).to.equal('12345');
      expect(mainBody.chunks).to.have.length(1);
      expect(mainBody.rateLimiterConfig).to.deep.equal({
        tokensPerSecond: 100,
        burstCapacity: 100,
      });

      // 2 つ目: manifest (precondition 付き、phaseA/B は保持 + phaseC 追記)
      const manifestObj = writer.objects[1];
      expect(manifestObj.path).to.equal(result.manifestPath);
      expect(manifestObj.precondition).to.deep.equal({ ifGenerationMatch: 7 });
      const manifestBody: BackfillManifest = JSON.parse(manifestObj.content);
      expect(manifestBody.phaseA).to.deep.equal(existingManifest.phaseA);
      expect(manifestBody.phaseB).to.deep.equal(existingManifest.phaseB);
      expect(manifestBody.phaseC).to.exist;
      expect(manifestBody.phaseC!.mainArtifact.path).to.equal(result.mainArtifactPath);
      expect(manifestBody.phaseC!.mainArtifact.sha256).to.equal(sha256Hex(mainObj.content));
      expect(manifestBody.phaseC!.chunks).to.have.length(1);
    });

    it('manifestGeneration=0 → 新規 only precondition (race detect for first writer)', async () => {
      const writer = new FakeArtifactWriter();
      await finalizePhaseCArtifact(
        {
          bucketName: BUCKET,
          runId: RUN_ID,
          env: 'dev',
          backfillStartedAt: '2026-05-15T00:00:00.000Z',
          backfillCompletedAt: '2026-05-15T00:30:00.000Z',
          phaseBArtifactRef: 'gs://x/phase-b.json',
          phaseBManifestSha256: 'bbb',
          candidatesIn: 0,
          writtenDocs: 0,
          preconditionFailedDocs: 0,
          skippedImmutable: 0,
          lockAcquiredGeneration: '1',
          lockReleasedAt: '2026-05-15T00:30:01.000Z',
          rateLimiterConfig: { tokensPerSecond: 100, burstCapacity: 100 },
          chunks: [],
          existingManifest: {
            schemaVersion: 'pr-d4-v1.0',
            runId: RUN_ID,
            env: 'dev',
          },
          manifestGeneration: 0,
        },
        writer
      );
      expect(writer.objects[1].precondition).to.deep.equal({ ifGenerationMatch: 0 });
    });
  });
});
