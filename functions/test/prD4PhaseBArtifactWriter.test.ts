/**
 * Issue #445 PR-D4 S1-3: phase-b/artifactWriter.ts (writePhaseBChunk + finalizePhaseBArtifact).
 *
 * Phase A writer と類似構造で Phase B 専用 schema を扱う。manifest.json は Phase A の
 * 内容を保持しつつ phaseB section を additive で追記する (caller 経由)。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import {
  writePhaseBChunk,
  finalizePhaseBArtifact,
  type FinalizePhaseBInput,
} from '../../scripts/pr-d4-backfill/phase-b/artifactWriter';
import type {
  ArtifactStorageWriter,
} from '../../scripts/pr-d4-backfill/phase-a/artifactWriter';
import type {
  ArtifactChunkPointer,
  PhaseBRevalidatedCandidate,
  PhaseBRevalidatedChunk,
  PhaseBRevalidationSummary,
  BackfillManifest,
} from '../../scripts/pr-d4-backfill/types';

class FakeStorageWriter implements ArtifactStorageWriter {
  public writes: { path: string; content: string; ifGenerationMatch: number | undefined }[] = [];
  async writeJson(
    path: string,
    content: string,
    precondition?: { ifGenerationMatch: number }
  ): Promise<void> {
    this.writes.push({
      path,
      content,
      ifGenerationMatch: precondition?.ifGenerationMatch,
    });
  }
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function makeCandidate(i: number): PhaseBRevalidatedCandidate {
  return {
    docId: `doc-${i}`,
    category: 'MatchedByHash',
    computedConfidence: 'derived-bytes-verified',
    computedProvenance: {
      sourceGeneration: `s${i}`,
      sourceMetageneration: '1',
      sourceSha256: 'a'.repeat(64),
      sourcePath: `attachments/parent-${i}/source.pdf`,
      sourceBucket: 'docsplit-dev.firebasestorage.app',
      derivedObjectPath: `processed/doc-${i}/output.pdf`,
      derivedGeneration: `d${i}`,
      derivedMetageneration: '1',
      derivedSha256: 'b'.repeat(64),
      createdAt: '2026-04-01T00:00:00.000Z',
    },
    evidence: {
      parentExists: true,
      parentSha256MatchedAtBackfill: true,
      childSha256ComputedAtBackfill: true,
    },
  };
}

const COMMON = {
  bucketName: 'docsplit-dev-pr-d4-artifacts',
  runId: '20260514T100000Z-dev-pr-d4-v1',
};

describe('writePhaseBChunk (PR-D4 S1-3 per-chunk flush)', () => {
  it('1 chunk file を書込み ArtifactChunkPointer を返す', async () => {
    const writer = new FakeStorageWriter();
    const candidates = [makeCandidate(0), makeCandidate(1)];
    const pointer = await writePhaseBChunk(
      { ...COMMON, chunkIndex: 0, candidates },
      writer
    );
    expect(writer.writes).to.have.length(1);
    expect(writer.writes[0].path).to.equal(
      'gs://docsplit-dev-pr-d4-artifacts/pr-d4-backfill-artifacts/20260514T100000Z-dev-pr-d4-v1/phase-b-revalidation-summary-chunk-0.json'
    );
    expect(pointer.sha256).to.equal(sha256Hex(writer.writes[0].content));
    expect(pointer.docCount).to.equal(2);

    const chunk = JSON.parse(writer.writes[0].content) as PhaseBRevalidatedChunk;
    expect(chunk.chunkIndex).to.equal(0);
    expect(chunk.revalidated).to.have.length(2);
    expect(chunk.revalidated[0].docId).to.equal('doc-0');
  });

  it('chunkIndex は caller が連番管理', async () => {
    const writer = new FakeStorageWriter();
    await writePhaseBChunk(
      { ...COMMON, chunkIndex: 7, candidates: [makeCandidate(0)] },
      writer
    );
    expect(writer.writes[0].path).to.include('chunk-7.json');
  });
});

describe('finalizePhaseBArtifact (PR-D4 S1-3 main + manifest update)', () => {
  function buildInput(
    chunkPointers: ArtifactChunkPointer[],
    overrides: Partial<FinalizePhaseBInput> = {}
  ): FinalizePhaseBInput {
    return {
      ...COMMON,
      env: 'dev',
      revalidationStartedAt: '2026-05-14T11:00:00.000Z',
      revalidationCompletedAt: '2026-05-14T11:15:00.000Z',
      phaseAArtifactRef: `gs://${COMMON.bucketName}/pr-d4-backfill-artifacts/${COMMON.runId}/phase-a-classify-summary.json`,
      phaseAManifestSha256: 'a'.repeat(64),
      candidatesIn: 6264,
      candidatesOut: chunkPointers.reduce((a, c) => a + c.docCount, 0),
      driftSkipped: {
        firestoreUpdateTimeChanged: 12,
        childGenerationChanged: 3,
        parentGenerationChanged: 8,
      },
      verifyFailedMatchedByHash: 100,
      skippedNonMatchedByHash: 1200,
      chunks: chunkPointers,
      existingManifest: {
        schemaVersion: 'pr-d4-v1.0',
        runId: COMMON.runId,
        env: 'dev',
        phaseA: {
          mainArtifact: {
            path: `gs://${COMMON.bucketName}/pr-d4-backfill-artifacts/${COMMON.runId}/phase-a-classify-summary.json`,
            sha256: 'a'.repeat(64),
          },
          chunks: [],
        },
      },
      manifestGeneration: 42,
      ...overrides,
    };
  }

  it('main + manifest (Phase A 保持 + phaseB 追記) を書込む', async () => {
    const writer = new FakeStorageWriter();
    const result = await finalizePhaseBArtifact(buildInput([]), writer);
    expect(writer.writes).to.have.length(2);
    expect(result.mainArtifactPath).to.match(/phase-b-revalidation-summary\.json$/);
    expect(result.manifestPath).to.match(/manifest\.json$/);

    const manifest = JSON.parse(
      writer.writes.find((w) => w.path.endsWith('manifest.json'))!.content
    ) as BackfillManifest;
    expect(manifest.phaseA, 'phaseA preserved').to.exist;
    expect(manifest.phaseB, 'phaseB added').to.exist;
    expect(manifest.phaseB!.chunks).to.deep.equal([]);
  });

  it('main artifact に candidatesIn / candidatesOut / driftSkipped / phaseAArtifactRef が記録される', async () => {
    const writer = new FakeStorageWriter();
    const pointers: ArtifactChunkPointer[] = [
      { path: 'gs://b/p/chunk-0.json', sha256: 'aa', docCount: 1000 },
      { path: 'gs://b/p/chunk-1.json', sha256: 'bb', docCount: 500 },
    ];
    await finalizePhaseBArtifact(buildInput(pointers), writer);
    const main = JSON.parse(
      writer.writes.find((w) => w.path.endsWith('phase-b-revalidation-summary.json'))!.content
    ) as PhaseBRevalidationSummary;
    expect(main.phase).to.equal('B');
    expect(main.candidatesIn).to.equal(6264);
    expect(main.candidatesOut).to.equal(1500);
    expect(main.driftSkipped.firestoreUpdateTimeChanged).to.equal(12);
    expect(main.driftSkipped.childGenerationChanged).to.equal(3);
    expect(main.driftSkipped.parentGenerationChanged).to.equal(8);
    expect(main.verifyFailedMatchedByHash).to.equal(100);
    expect(main.skippedNonMatchedByHash).to.equal(1200);
    expect(main.phaseAArtifactRef).to.match(/phase-a-classify-summary\.json$/);
    expect(main.phaseAManifestSha256).to.have.length(64);
    expect(main.chunks).to.deep.equal(pointers);
  });

  it('manifest.phaseB.mainArtifact sha256 は実 main content の sha256 と一致', async () => {
    const writer = new FakeStorageWriter();
    await finalizePhaseBArtifact(buildInput([]), writer);
    const mainContent = writer.writes.find((w) =>
      w.path.endsWith('phase-b-revalidation-summary.json')
    )!.content;
    const manifestContent = writer.writes.find((w) => w.path.endsWith('manifest.json'))!.content;
    const manifest = JSON.parse(manifestContent) as BackfillManifest;
    expect(manifest.phaseB!.mainArtifact.sha256).to.equal(sha256Hex(mainContent));
  });

  it('書込順は main → manifest (consumer が manifest 読めれば main + 全 chunk 完了 invariant)', async () => {
    const writer = new FakeStorageWriter();
    await finalizePhaseBArtifact(buildInput([]), writer);
    expect(writer.writes[0].path).to.match(/phase-b-revalidation-summary\.json$/);
    expect(writer.writes[1].path).to.match(/manifest\.json$/);
  });

  it('manifest write は input.manifestGeneration を ifGenerationMatch として渡し CAS update (Codex S1-3 Critical)', async () => {
    const writer = new FakeStorageWriter();
    await finalizePhaseBArtifact(buildInput([], { manifestGeneration: 99 }), writer);
    const mainWrite = writer.writes.find((w) =>
      w.path.endsWith('phase-b-revalidation-summary.json')
    )!;
    const manifestWrite = writer.writes.find((w) => w.path.endsWith('manifest.json'))!;
    // main は新規 (precondition なし → default 0)
    expect(mainWrite.ifGenerationMatch).to.equal(undefined);
    // manifest は既存 (Phase A が作成済) → 渡された generation を ifGenerationMatch に
    expect(manifestWrite.ifGenerationMatch).to.equal(99);
  });
});
