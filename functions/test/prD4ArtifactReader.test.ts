/**
 * Issue #445 PR-D4 S1-3: phase-b/artifactReader.ts streaming read + sha256 verify.
 *
 * BF22 反映: Phase A main artifact (chunk pointers) を読み、各 chunk を **逐次 stream read**
 * しながら manifest sha256 値で integrity verify。全 chunk を一括メモリロードしない。
 * AsyncIterable で 1 candidate ずつ caller (orchestrator) に yield する。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import {
  readPhaseAArtifact,
  ArtifactIntegrityError,
  type ArtifactStorageReader,
} from '../../scripts/pr-d4-backfill/phase-b/artifactReader';
import type {
  PhaseACandidate,
  PhaseAClassifyChunk,
  PhaseAClassifySummary,
  BackfillManifest,
} from '../../scripts/pr-d4-backfill/types';

class FakeStorageReader implements ArtifactStorageReader {
  private contents: Record<string, string>;
  public reads: string[] = [];
  constructor(contents: Record<string, string>) {
    this.contents = contents;
  }
  async readJson(path: string): Promise<{ content: string; generation: number }> {
    this.reads.push(path);
    if (!(path in this.contents)) throw new Error(`not found: ${path}`);
    return { content: this.contents[path], generation: 1 };
  }
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function makeCandidate(i: number): PhaseACandidate {
  return {
    docId: `doc-${i}`,
    category: 'MatchedByHash',
    reason: 'test',
    firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
    childObjectPath: `processed/doc-${i}/output.pdf`,
    childGeneration: `${1000000 + i}`,
    childMetageneration: '1',
    parentDocId: `parent-${i}`,
    parentObjectPath: `attachments/parent-${i}/source.pdf`,
    parentGeneration: `${2000000 + i}`,
    parentMetageneration: '1',
    splitFromPages: { start: 1, end: 1 },
  };
}

interface BuiltArtifact {
  manifestPath: string;
  mainArtifactPath: string;
  contents: Record<string, string>;
  manifest: BackfillManifest;
}

function buildArtifact(totalCandidates: number, chunkSize = 1000): BuiltArtifact {
  const bucket = 'docsplit-dev-pr-d4-artifacts';
  const runId = '20260514T100000Z-dev-pr-d4-v1';
  const prefix = `gs://${bucket}/pr-d4-backfill-artifacts/${runId}`;
  const mainPath = `${prefix}/phase-a-classify-summary.json`;
  const manifestPath = `${prefix}/manifest.json`;
  const candidates = Array.from({ length: totalCandidates }, (_, i) => makeCandidate(i));
  const chunkPointers: { path: string; sha256: string; docCount: number }[] = [];
  const contents: Record<string, string> = {};
  for (let i = 0; i < Math.max(1, Math.ceil(totalCandidates / chunkSize)); i++) {
    const slice = candidates.slice(i * chunkSize, (i + 1) * chunkSize);
    if (slice.length === 0 && totalCandidates > 0) break;
    const chunkPath = `${prefix}/phase-a-classify-summary-chunk-${i}.json`;
    const chunkBody: PhaseAClassifyChunk = {
      schemaVersion: 'pr-d4-v1.0',
      chunkIndex: i,
      candidates: slice,
    };
    const chunkContent = JSON.stringify(chunkBody);
    contents[chunkPath] = chunkContent;
    chunkPointers.push({ path: chunkPath, sha256: sha256Hex(chunkContent), docCount: slice.length });
  }
  const main: PhaseAClassifySummary = {
    phase: 'A',
    schemaVersion: 'pr-d4-v1.0',
    scriptVersion: 'pr-d4-v1.0',
    env: 'dev',
    runId,
    snapshotStartedAt: '2026-05-14T10:00:00.000Z',
    snapshotCompletedAt: '2026-05-14T10:00:10.000Z',
    bucketLocation: 'asia-northeast1',
    cloudRunJobLocation: 'asia-northeast1',
    egressFreeAssertion: true,
    totalDocs: totalCandidates,
    categoryDistribution: {
      MatchedByHash: totalCandidates,
      RepairableMissingFile: 0,
      Ambiguous: 0,
      LostOrUnrecoverable: 0,
      NeedsManualReview: 0,
    },
    alreadyBackfilled: 0,
    verifiedExistingProvenance: 0,
    chunks: chunkPointers,
  };
  const mainContent = JSON.stringify(main);
  contents[mainPath] = mainContent;
  const manifest: BackfillManifest = {
    schemaVersion: 'pr-d4-v1.0',
    runId,
    env: 'dev',
    phaseA: {
      mainArtifact: { path: mainPath, sha256: sha256Hex(mainContent) },
      chunks: chunkPointers,
    },
  };
  contents[manifestPath] = JSON.stringify(manifest);
  return { manifestPath, mainArtifactPath: mainPath, contents, manifest };
}

async function collectCandidates(
  iter: AsyncIterable<PhaseACandidate>
): Promise<PhaseACandidate[]> {
  const out: PhaseACandidate[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('readPhaseAArtifact (PR-D4 S1-3 streaming reader)', () => {
  it('manifest 読込 → main artifact 読込 → chunks 順次 stream で全 candidate を yield', async () => {
    const { manifestPath, contents } = buildArtifact(2500);
    const reader = new FakeStorageReader(contents);
    const stream = await readPhaseAArtifact({ manifestPath, reader });
    const collected = await collectCandidates(stream.candidates());
    expect(collected).to.have.length(2500);
    expect(collected[0].docId).to.equal('doc-0');
    expect(collected[2499].docId).to.equal('doc-2499');
    expect(stream.phaseAManifestSha256).to.be.a('string').and.have.length(64);
  });

  it('chunks=[] (Phase A で 0 candidate) → 空 stream', async () => {
    const { manifestPath, contents } = buildArtifact(0);
    const reader = new FakeStorageReader(contents);
    const stream = await readPhaseAArtifact({ manifestPath, reader });
    const collected = await collectCandidates(stream.candidates());
    expect(collected).to.have.length(0);
  });

  it('main artifact sha256 が manifest 値と不一致 → ArtifactIntegrityError (eager check)', async () => {
    const { manifestPath, mainArtifactPath, contents } = buildArtifact(100);
    contents[mainArtifactPath] = contents[mainArtifactPath] + ' '; // 1 byte tamper
    const reader = new FakeStorageReader(contents);
    let err: unknown = null;
    try {
      await readPhaseAArtifact({ manifestPath, reader });
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(ArtifactIntegrityError);
    expect((err as Error).message).to.match(/main artifact.*sha256/i);
  });

  it('chunk sha256 が manifest 値と不一致 → ArtifactIntegrityError', async () => {
    const { manifestPath, contents, manifest } = buildArtifact(1500);
    // chunk-1 を tamper
    const chunk1Path = manifest.phaseA!.chunks[1].path;
    contents[chunk1Path] = contents[chunk1Path] + ' ';
    const reader = new FakeStorageReader(contents);
    const stream = await readPhaseAArtifact({ manifestPath, reader });
    let err: unknown = null;
    try {
      await collectCandidates(stream.candidates());
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(ArtifactIntegrityError);
    expect((err as Error).message).to.match(/chunk.*sha256/i);
  });

  it('manifest.phaseA 不在 → Error throw (eager check、Phase A 未完了 artifact)', async () => {
    const { manifestPath, contents, manifest } = buildArtifact(100);
    const tamperedManifest: BackfillManifest = { ...manifest, phaseA: undefined };
    contents[manifestPath] = JSON.stringify(tamperedManifest);
    const reader = new FakeStorageReader(contents);
    let err: unknown = null;
    try {
      await readPhaseAArtifact({ manifestPath, reader });
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(Error);
    expect((err as Error).message).to.match(/phaseA/i);
  });

  it('BF22 streaming: chunks は yield 順序通り 1 chunk ずつ read される (全 chunk 同時メモリ不可)', async () => {
    const { manifestPath, contents } = buildArtifact(3500);
    const reader = new FakeStorageReader(contents);
    const stream = await readPhaseAArtifact({ manifestPath, reader });
    // manifest + main を先に読む → reads は ['manifest', 'main', 'chunk-0', 'chunk-1', 'chunk-2', 'chunk-3']
    await collectCandidates(stream.candidates());
    const chunkReadOrder = reader.reads.filter((p) => p.includes('chunk-'));
    expect(chunkReadOrder).to.have.length(4);
    chunkReadOrder.forEach((p, i) => expect(p).to.include(`chunk-${i}.json`));
  });

  it('candidatesIn は manifest.phaseA.chunks の docCount 合計 (streaming 開始前に判明)', async () => {
    const { manifestPath, contents } = buildArtifact(2500);
    const reader = new FakeStorageReader(contents);
    const stream = await readPhaseAArtifact({ manifestPath, reader });
    expect(stream.candidatesIn).to.equal(2500);
  });

  it('phaseAArtifactRef は main artifact path、phaseAManifestSha256 は main sha256', async () => {
    const { manifestPath, mainArtifactPath, contents, manifest } = buildArtifact(100);
    const reader = new FakeStorageReader(contents);
    const stream = await readPhaseAArtifact({ manifestPath, reader });
    expect(stream.phaseAArtifactRef).to.equal(mainArtifactPath);
    expect(stream.phaseAManifestSha256).to.equal(manifest.phaseA!.mainArtifact.sha256);
  });
});
