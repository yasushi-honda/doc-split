/**
 * Issue #445 PR-D4 S1-2: artifact-writer.ts streaming API テスト.
 *
 * impl-plan §4.1 の chunked GCS write + SHA256 manifest 仕様を固定する。
 * BF19 (artifact 必須 metadata) + BF22 (chunked streaming) のカバレッジ。
 *
 * Codex MCP NO-GO 反映 (per-chunk flush): orchestrator が per-chunk buffer のみ保持し
 * writer は writePhaseAChunk (1 chunk 単位) + finalizePhaseAArtifact (main + manifest) の
 * 2 関数に分離。本テストは writer 単体の挙動を検証する。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import {
  writePhaseAChunk,
  finalizePhaseAArtifact,
  type ArtifactStorageWriter,
  type WrittenObject,
} from '../../scripts/pr-d4-backfill/phase-a/artifactWriter';
import type {
  ArtifactChunkPointer,
  PhaseACandidate,
  PhaseAClassifyChunk,
  PhaseAClassifySummary,
  BackfillManifest,
} from '../../scripts/pr-d4-backfill/types';

class FakeStorageWriter implements ArtifactStorageWriter {
  public writes: WrittenObject[] = [];
  async writeJson(objectPath: string, content: string): Promise<void> {
    this.writes.push({ path: objectPath, content });
  }
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

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

const COMMON = {
  bucketName: 'docsplit-dev-pr-d4-artifacts',
  runId: '20260514T100000Z-dev-pr-d4-v1',
};

describe('writePhaseAChunk (PR-D4 S1-2 per-chunk flush)', () => {
  it('1 chunk file を書込み ArtifactChunkPointer (path + sha256 + docCount) を返す', async () => {
    const writer = new FakeStorageWriter();
    const candidates = [makeCandidate(0), makeCandidate(1), makeCandidate(2)];
    const pointer = await writePhaseAChunk(
      { ...COMMON, chunkIndex: 0, candidates },
      writer
    );
    expect(writer.writes).to.have.length(1);
    const written = writer.writes[0];
    expect(written.path).to.equal(
      'gs://docsplit-dev-pr-d4-artifacts/pr-d4-backfill-artifacts/20260514T100000Z-dev-pr-d4-v1/phase-a-classify-summary-chunk-0.json'
    );
    expect(pointer.path).to.equal(written.path);
    expect(pointer.sha256).to.equal(sha256Hex(written.content));
    expect(pointer.docCount).to.equal(3);

    const chunk = JSON.parse(written.content) as PhaseAClassifyChunk;
    expect(chunk.chunkIndex).to.equal(0);
    expect(chunk.candidates).to.have.length(3);
    expect(chunk.candidates[0].docId).to.equal('doc-0');
    expect(chunk.candidates[2].docId).to.equal('doc-2');
  });

  it('chunkIndex は入力をそのまま使用 (caller が連番管理)', async () => {
    const writer = new FakeStorageWriter();
    await writePhaseAChunk(
      { ...COMMON, chunkIndex: 5, candidates: [makeCandidate(0)] },
      writer
    );
    expect(writer.writes[0].path).to.include('chunk-5.json');
    const chunk = JSON.parse(writer.writes[0].content) as PhaseAClassifyChunk;
    expect(chunk.chunkIndex).to.equal(5);
  });

  it('GCS object path は gs://{bucket}/pr-d4-backfill-artifacts/{runId}/{filename} 形式', async () => {
    const writer = new FakeStorageWriter();
    await writePhaseAChunk(
      { ...COMMON, chunkIndex: 0, candidates: [makeCandidate(0)] },
      writer
    );
    expect(writer.writes[0].path).to.match(
      /^gs:\/\/docsplit-dev-pr-d4-artifacts\/pr-d4-backfill-artifacts\/20260514T100000Z-dev-pr-d4-v1\/phase-a-classify-summary-chunk-0\.json$/
    );
  });
});

describe('finalizePhaseAArtifact (PR-D4 S1-2 main + manifest writer)', () => {
  function buildFinalizeInput(
    chunkPointers: ArtifactChunkPointer[]
  ): Parameters<typeof finalizePhaseAArtifact>[0] {
    return {
      ...COMMON,
      env: 'dev',
      snapshotStartedAt: '2026-05-14T10:00:00.000Z',
      snapshotCompletedAt: '2026-05-14T10:15:00.000Z',
      bucketLocation: 'asia-northeast1',
      cloudRunJobLocation: 'asia-northeast1',
      egressFreeAssertion: true,
      totalDocs: chunkPointers.reduce((acc, c) => acc + c.docCount, 0),
      categoryDistribution: {
        MatchedByHash: 0,
        RepairableMissingFile: 0,
        Ambiguous: 0,
        LostOrUnrecoverable: 0,
        NeedsManualReview: 0,
      },
      alreadyBackfilled: 0,
      verifiedExistingProvenance: 0,
      chunks: chunkPointers,
    };
  }

  it('main + manifest を書込み (chunks=[] でも書込まれる)', async () => {
    const writer = new FakeStorageWriter();
    const result = await finalizePhaseAArtifact(buildFinalizeInput([]), writer);
    expect(writer.writes).to.have.length(2);
    expect(result.mainArtifactPath).to.match(/phase-a-classify-summary\.json$/);
    expect(result.manifestPath).to.match(/manifest\.json$/);
  });

  it('main artifact の chunks[] には入力 ArtifactChunkPointer 配列が記録される', async () => {
    const writer = new FakeStorageWriter();
    const pointers: ArtifactChunkPointer[] = [
      { path: 'gs://b/p/chunk-0.json', sha256: 'aa', docCount: 1000 },
      { path: 'gs://b/p/chunk-1.json', sha256: 'bb', docCount: 500 },
    ];
    await finalizePhaseAArtifact(buildFinalizeInput(pointers), writer);
    const main = JSON.parse(
      writer.writes.find((w) => w.path.endsWith('phase-a-classify-summary.json'))!.content
    ) as PhaseAClassifySummary;
    expect(main.chunks).to.deep.equal(pointers);
    expect(main.totalDocs).to.equal(1500);
  });

  it('manifest.json には phaseA.mainArtifact (sha256) + phaseA.chunks が記録される', async () => {
    const writer = new FakeStorageWriter();
    const pointers: ArtifactChunkPointer[] = [
      { path: 'gs://b/p/chunk-0.json', sha256: 'aabb', docCount: 100 },
    ];
    await finalizePhaseAArtifact(buildFinalizeInput(pointers), writer);
    const mainContent = writer.writes.find((w) =>
      w.path.endsWith('phase-a-classify-summary.json')
    )!.content;
    const manifestContent = writer.writes.find((w) => w.path.endsWith('manifest.json'))!.content;
    const manifest = JSON.parse(manifestContent) as BackfillManifest;
    expect(manifest.runId).to.equal('20260514T100000Z-dev-pr-d4-v1');
    expect(manifest.env).to.equal('dev');
    expect(manifest.phaseA).to.exist;
    expect(manifest.phaseA!.mainArtifact.sha256).to.equal(sha256Hex(mainContent));
    expect(manifest.phaseA!.chunks).to.deep.equal(pointers);
  });

  it('書込順は main → manifest (consumer が manifest 読めれば main + 全 chunk 書込完了 invariant)', async () => {
    const writer = new FakeStorageWriter();
    await finalizePhaseAArtifact(buildFinalizeInput([]), writer);
    expect(writer.writes[0].path).to.match(/phase-a-classify-summary\.json$/);
    expect(writer.writes[1].path).to.match(/manifest\.json$/);
  });

  it('summary metadata (snapshotStartedAt 等) は main artifact に保持される', async () => {
    const writer = new FakeStorageWriter();
    await finalizePhaseAArtifact(
      {
        ...buildFinalizeInput([]),
        snapshotStartedAt: '2026-05-14T11:11:11.000Z',
        snapshotCompletedAt: '2026-05-14T11:55:55.000Z',
        bucketLocation: 'us-central1',
        cloudRunJobLocation: 'us-central1',
        categoryDistribution: {
          MatchedByHash: 10,
          RepairableMissingFile: 5,
          Ambiguous: 3,
          LostOrUnrecoverable: 2,
          NeedsManualReview: 1,
        },
        alreadyBackfilled: 12,
        verifiedExistingProvenance: 8,
        totalDocs: 41,
      },
      writer
    );
    const main = JSON.parse(
      writer.writes.find((w) => w.path.endsWith('phase-a-classify-summary.json'))!.content
    ) as PhaseAClassifySummary;
    expect(main.snapshotStartedAt).to.equal('2026-05-14T11:11:11.000Z');
    expect(main.snapshotCompletedAt).to.equal('2026-05-14T11:55:55.000Z');
    expect(main.bucketLocation).to.equal('us-central1');
    expect(main.categoryDistribution.MatchedByHash).to.equal(10);
    expect(main.alreadyBackfilled).to.equal(12);
    expect(main.verifiedExistingProvenance).to.equal(8);
    expect(main.totalDocs).to.equal(41);
  });
});
