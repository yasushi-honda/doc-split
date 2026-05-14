/**
 * Issue #445 PR-D4 S1-2: audit-classify.ts (Phase A orchestrator) テスト.
 *
 * documents collection を全件 stream → docSnapshotter → categoryClassifier →
 * artifact-writer に流す pipeline を組立てる。
 *
 * 検証観点:
 *   - alreadyBackfilled (provenanceBackfill 存在) / verifiedExistingProvenance (provenance
 *     存在 + provenanceBackfill 不在) は candidates から除外され count のみ記録される
 *   - その他は 5 分類別に candidates として artifact 化
 *   - categoryDistribution は 5 値全部 present (0 件でも 0 を書く)
 *   - bucket location 検証エラー時は throw + artifact 書込まれない
 */

import { expect } from 'chai';
import {
  runPhaseA,
  type DocumentSource,
  type DocumentSourceRecord,
} from '../../scripts/pr-d4-backfill/phase-a/auditClassify';
import {
  type ArtifactStorageWriter,
  type WrittenObject,
} from '../../scripts/pr-d4-backfill/phase-a/artifactWriter';
import {
  type ParentFetcher,
  type BucketProber,
} from '../../scripts/pr-d4-backfill/phase-a/docSnapshotter';
import type {
  PhaseAClassifySummary,
  PhaseAClassifyChunk,
} from '../../scripts/pr-d4-backfill/types';

class FakeDocumentSource implements DocumentSource {
  private docs: DocumentSourceRecord[];
  constructor(docs: DocumentSourceRecord[]) {
    this.docs = docs;
  }
  async *streamAll(): AsyncIterable<DocumentSourceRecord> {
    for (const doc of this.docs) yield doc;
  }
}

class StaticParentFetcher implements ParentFetcher {
  private parents: Record<string, { fileUrl: string | null } | null>;
  constructor(parents: Record<string, { fileUrl: string | null } | null>) {
    this.parents = parents;
  }
  async fetchParent(id: string) {
    return id in this.parents ? this.parents[id] : null;
  }
}

class StaticBucketProber implements BucketProber {
  private metadataByPath: Record<
    string,
    { generation: string; metageneration: string } | null
  >;
  constructor(
    metadataByPath: Record<
      string,
      { generation: string; metageneration: string } | null
    >
  ) {
    this.metadataByPath = metadataByPath;
  }
  async getMetadata(path: string) {
    return path in this.metadataByPath ? this.metadataByPath[path] : null;
  }
}

class FakeStorageWriter implements ArtifactStorageWriter {
  public writes: WrittenObject[] = [];
  async writeJson(
    path: string,
    content: string,
    _precondition?: { ifGenerationMatch: number }
  ) {
    this.writes.push({ path, content });
  }
}

const BUCKET = 'docsplit-dev.firebasestorage.app';

function fullDoc(id: string, overrides: Partial<DocumentSourceRecord> = {}): DocumentSourceRecord {
  return {
    id,
    fileUrl: `gs://${BUCKET}/processed/${id}/output.pdf`,
    parentDocumentId: `parent-${id}`,
    splitFromPages: { start: 1, end: 1 },
    updateTimeIso: '2026-05-14T10:00:00.000Z',
    hasProvenance: false,
    hasProvenanceBackfill: false,
    ...overrides,
  };
}

function buildInput(
  docs: DocumentSourceRecord[],
  parents: Record<string, { fileUrl: string | null } | null>,
  metadata: Record<string, { generation: string; metageneration: string } | null>,
  writer: ArtifactStorageWriter
) {
  return {
    env: 'dev' as const,
    runId: '20260514T100000Z-dev-pr-d4-v1',
    productionDataBucketName: BUCKET,
    artifactBucketName: 'docsplit-dev-pr-d4-artifacts',
    cloudRunLocation: 'asia-northeast1',
    bucketLocation: 'asia-northeast1',
    documentSource: new FakeDocumentSource(docs),
    parentFetcher: new StaticParentFetcher(parents),
    bucketProber: new StaticBucketProber(metadata),
    artifactWriter: writer,
    snapshotStartedAt: '2026-05-14T10:00:00.000Z',
    nowProvider: () => '2026-05-14T10:00:01.000Z',
  };
}

describe('runPhaseA (PR-D4 S1-2 orchestrator)', () => {
  it('全 doc が 5 分類別に集計される (MatchedByHash + Ambiguous 各 1 件)', async () => {
    const docs = [
      fullDoc('m1'),
      fullDoc('a1'),
    ];
    const parents = {
      'parent-m1': { fileUrl: `gs://${BUCKET}/attachments/parent-m1/source.pdf` },
      'parent-a1': null,
    };
    const metadata = {
      'processed/m1/output.pdf': { generation: '1', metageneration: '1' },
      'processed/a1/output.pdf': { generation: '2', metageneration: '1' },
      'attachments/parent-m1/source.pdf': { generation: '3', metageneration: '1' },
    };
    const writer = new FakeStorageWriter();
    const result = await runPhaseA(buildInput(docs, parents, metadata, writer));
    expect(result.totalDocs).to.equal(2);
    expect(result.categoryDistribution.MatchedByHash).to.equal(1);
    expect(result.categoryDistribution.Ambiguous).to.equal(1);
    expect(result.categoryDistribution.RepairableMissingFile).to.equal(0);
    expect(result.categoryDistribution.LostOrUnrecoverable).to.equal(0);
    expect(result.categoryDistribution.NeedsManualReview).to.equal(0);
    expect(result.alreadyBackfilled).to.equal(0);
    expect(result.verifiedExistingProvenance).to.equal(0);
  });

  it('provenanceBackfill 既存 doc は alreadyBackfilled count 加算 + candidates 除外', async () => {
    const docs = [
      fullDoc('m1'),
      fullDoc('already', { hasProvenanceBackfill: true, hasProvenance: true }),
    ];
    const parents = {
      'parent-m1': { fileUrl: `gs://${BUCKET}/attachments/parent-m1/source.pdf` },
    };
    const metadata = {
      'processed/m1/output.pdf': { generation: '1', metageneration: '1' },
      'attachments/parent-m1/source.pdf': { generation: '2', metageneration: '1' },
    };
    const writer = new FakeStorageWriter();
    const result = await runPhaseA(buildInput(docs, parents, metadata, writer));
    expect(result.totalDocs).to.equal(2);
    expect(result.alreadyBackfilled).to.equal(1);
    expect(result.categoryDistribution.MatchedByHash).to.equal(1);

    const chunkContent = writer.writes.find((w) => w.path.includes('chunk-0.json'))!.content;
    const chunk = JSON.parse(chunkContent) as PhaseAClassifyChunk;
    expect(chunk.candidates).to.have.length(1);
    expect(chunk.candidates[0].docId).to.equal('m1');
  });

  it('provenance 存在 + provenanceBackfill 不在 → verifiedExistingProvenance + candidates 除外 (MUST 7 immutable skip)', async () => {
    const docs = [
      fullDoc('verified', { hasProvenance: true, hasProvenanceBackfill: false }),
      fullDoc('m1'),
    ];
    const parents = {
      'parent-m1': { fileUrl: `gs://${BUCKET}/attachments/parent-m1/source.pdf` },
    };
    const metadata = {
      'processed/m1/output.pdf': { generation: '1', metageneration: '1' },
      'attachments/parent-m1/source.pdf': { generation: '2', metageneration: '1' },
    };
    const writer = new FakeStorageWriter();
    const result = await runPhaseA(buildInput(docs, parents, metadata, writer));
    expect(result.verifiedExistingProvenance).to.equal(1);
    expect(result.alreadyBackfilled).to.equal(0);
    expect(result.categoryDistribution.MatchedByHash).to.equal(1);

    const chunkContent = writer.writes.find((w) => w.path.includes('chunk-0.json'))!.content;
    const chunk = JSON.parse(chunkContent) as PhaseAClassifyChunk;
    expect(chunk.candidates).to.have.length(1);
    expect(chunk.candidates[0].docId).to.equal('m1');
  });

  it('bucket location 不一致なら BucketLocationMismatchError throw + artifact 書込まれない', async () => {
    const writer = new FakeStorageWriter();
    let threw = false;
    try {
      await runPhaseA({
        ...buildInput([], {}, {}, writer),
        bucketLocation: 'us-central1',
        cloudRunLocation: 'asia-northeast1',
      });
    } catch (err) {
      threw = true;
      expect((err as Error).name).to.equal('BucketLocationMismatchError');
    }
    expect(threw, 'expected throw').to.equal(true);
    expect(writer.writes).to.have.length(0);
  });

  it('main artifact に egressFreeAssertion / bucketLocation / cloudRunJobLocation 記録', async () => {
    const writer = new FakeStorageWriter();
    await runPhaseA(buildInput([], {}, {}, writer));
    const main = JSON.parse(
      writer.writes.find((w) => w.path.endsWith('phase-a-classify-summary.json'))!.content
    ) as PhaseAClassifySummary;
    expect(main.egressFreeAssertion).to.equal(true);
    expect(main.bucketLocation).to.equal('asia-northeast1');
    expect(main.cloudRunJobLocation).to.equal('asia-northeast1');
  });

  it('totalDocs はストリーム全 doc 数 (alreadyBackfilled + verifiedExistingProvenance + Σcategory)', async () => {
    const docs = [
      fullDoc('m1'),
      fullDoc('m2'),
      fullDoc('a1'),
      fullDoc('verified', { hasProvenance: true }),
      fullDoc('backfilled', { hasProvenance: true, hasProvenanceBackfill: true }),
    ];
    const parents = {
      'parent-m1': { fileUrl: `gs://${BUCKET}/attachments/parent-m1/source.pdf` },
      'parent-m2': { fileUrl: `gs://${BUCKET}/attachments/parent-m2/source.pdf` },
      'parent-a1': null,
    };
    const metadata = {
      'processed/m1/output.pdf': { generation: '1', metageneration: '1' },
      'processed/m2/output.pdf': { generation: '2', metageneration: '1' },
      'processed/a1/output.pdf': { generation: '3', metageneration: '1' },
      'attachments/parent-m1/source.pdf': { generation: '4', metageneration: '1' },
      'attachments/parent-m2/source.pdf': { generation: '5', metageneration: '1' },
    };
    const writer = new FakeStorageWriter();
    const result = await runPhaseA(buildInput(docs, parents, metadata, writer));
    expect(result.totalDocs).to.equal(5);
    expect(result.alreadyBackfilled).to.equal(1);
    expect(result.verifiedExistingProvenance).to.equal(1);
    expect(result.categoryDistribution.MatchedByHash).to.equal(2);
    expect(result.categoryDistribution.Ambiguous).to.equal(1);
    expect(
      result.alreadyBackfilled +
        result.verifiedExistingProvenance +
        Object.values(result.categoryDistribution).reduce((a, b) => a + b, 0)
    ).to.equal(5);
  });

  it('candidates の order は streaming 順を維持 (operator 監査用)', async () => {
    const docs = [fullDoc('z1'), fullDoc('a1'), fullDoc('m1')];
    const parents = {
      'parent-z1': { fileUrl: `gs://${BUCKET}/attachments/parent-z1/source.pdf` },
      'parent-a1': { fileUrl: `gs://${BUCKET}/attachments/parent-a1/source.pdf` },
      'parent-m1': { fileUrl: `gs://${BUCKET}/attachments/parent-m1/source.pdf` },
    };
    const metadata = {
      'processed/z1/output.pdf': { generation: '1', metageneration: '1' },
      'processed/a1/output.pdf': { generation: '2', metageneration: '1' },
      'processed/m1/output.pdf': { generation: '3', metageneration: '1' },
      'attachments/parent-z1/source.pdf': { generation: '4', metageneration: '1' },
      'attachments/parent-a1/source.pdf': { generation: '5', metageneration: '1' },
      'attachments/parent-m1/source.pdf': { generation: '6', metageneration: '1' },
    };
    const writer = new FakeStorageWriter();
    await runPhaseA(buildInput(docs, parents, metadata, writer));
    const chunk = JSON.parse(
      writer.writes.find((w) => w.path.includes('chunk-0.json'))!.content
    ) as PhaseAClassifyChunk;
    expect(chunk.candidates.map((c) => c.docId)).to.deep.equal(['z1', 'a1', 'm1']);
  });

  it('BF22 streaming: 1000 件超で per-chunk flush され chunkCount=2 + 各 chunk の docCount 確認', async () => {
    const docs = Array.from({ length: 1500 }, (_, i) => fullDoc(`m${i}`));
    const parents: Record<string, { fileUrl: string | null } | null> = {};
    const metadata: Record<string, { generation: string; metageneration: string } | null> = {};
    for (let i = 0; i < 1500; i++) {
      parents[`parent-m${i}`] = {
        fileUrl: `gs://${BUCKET}/attachments/parent-m${i}/source.pdf`,
      };
      metadata[`processed/m${i}/output.pdf`] = { generation: `${i}`, metageneration: '1' };
      metadata[`attachments/parent-m${i}/source.pdf`] = {
        generation: `p${i}`,
        metageneration: '1',
      };
    }
    const writer = new FakeStorageWriter();
    const result = await runPhaseA(buildInput(docs, parents, metadata, writer));
    expect(result.chunkCount).to.equal(2);
    expect(result.categoryDistribution.MatchedByHash).to.equal(1500);

    // 2 chunks + main + manifest = 4 writes
    expect(writer.writes).to.have.length(4);
    const chunkWrites = writer.writes.filter((w) => w.path.includes('chunk-'));
    expect(chunkWrites).to.have.length(2);

    // chunk index 連番、docCount 合計 == 1500
    const chunk0 = JSON.parse(
      chunkWrites.find((w) => w.path.includes('chunk-0.json'))!.content
    );
    const chunk1 = JSON.parse(
      chunkWrites.find((w) => w.path.includes('chunk-1.json'))!.content
    );
    expect(chunk0.chunkIndex).to.equal(0);
    expect(chunk1.chunkIndex).to.equal(1);
    expect(chunk0.candidates.length + chunk1.candidates.length).to.equal(1500);
    expect(chunk0.candidates.length).to.equal(1000);
    expect(chunk1.candidates.length).to.equal(500);
  });

  it('BF22 streaming: 書込順は chunks (streaming) → main → manifest', async () => {
    const docs = Array.from({ length: 1200 }, (_, i) => fullDoc(`m${i}`));
    const parents: Record<string, { fileUrl: string | null } | null> = {};
    const metadata: Record<string, { generation: string; metageneration: string } | null> = {};
    for (let i = 0; i < 1200; i++) {
      parents[`parent-m${i}`] = {
        fileUrl: `gs://${BUCKET}/attachments/parent-m${i}/source.pdf`,
      };
      metadata[`processed/m${i}/output.pdf`] = { generation: `${i}`, metageneration: '1' };
      metadata[`attachments/parent-m${i}/source.pdf`] = {
        generation: `p${i}`,
        metageneration: '1',
      };
    }
    const writer = new FakeStorageWriter();
    await runPhaseA(buildInput(docs, parents, metadata, writer));
    const order = writer.writes.map((w) => {
      if (w.path.endsWith('manifest.json')) return 'manifest';
      if (w.path.endsWith('phase-a-classify-summary.json')) return 'main';
      return 'chunk';
    });
    // 全 chunk 書込は main より前、main は manifest より前
    const lastChunkIdx = order.lastIndexOf('chunk');
    const mainIdx = order.indexOf('main');
    const manifestIdx = order.indexOf('manifest');
    expect(lastChunkIdx).to.be.lessThan(mainIdx);
    expect(mainIdx).to.be.lessThan(manifestIdx);
  });

  it('結果には mainArtifactPath / manifestPath / chunkCount が含まれる', async () => {
    const docs = [fullDoc('m1')];
    const parents = {
      'parent-m1': { fileUrl: `gs://${BUCKET}/attachments/parent-m1/source.pdf` },
    };
    const metadata = {
      'processed/m1/output.pdf': { generation: '1', metageneration: '1' },
      'attachments/parent-m1/source.pdf': { generation: '2', metageneration: '1' },
    };
    const writer = new FakeStorageWriter();
    const result = await runPhaseA(buildInput(docs, parents, metadata, writer));
    expect(result.mainArtifactPath).to.match(/phase-a-classify-summary\.json$/);
    expect(result.manifestPath).to.match(/manifest\.json$/);
    expect(result.chunkCount).to.equal(1);
  });
});
