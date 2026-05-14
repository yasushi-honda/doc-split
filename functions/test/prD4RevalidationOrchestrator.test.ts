/**
 * Issue #445 PR-D4 S1-3: revalidationOrchestrator.ts (Phase B orchestrator).
 *
 * Phase A artifact streaming read → 各 candidate に drift 検出 + child revalidation +
 * MatchedByHash の parent 再 split verify → 結果を per-chunk flush で Phase B artifact 書込。
 *
 * 検証観点:
 *   - 非 MatchedByHash candidate は revalidation スキップ (skippedNonMatchedByHash++)
 *   - drift 検出された MatchedByHash は driftSkipped に分類カウンタ加算
 *   - MatchedByHash で drift なし + verify pass → derived-bytes-verified で revalidated に追加
 *   - MatchedByHash で drift なし + verify fail → verifyFailedMatchedByHash++ (revalidated 追加なし)
 *   - BF22 streaming flush (per-chunk buffer 上限 ≤ 1000)
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import {
  runPhaseB,
  type FirestoreReReader,
  type RunPhaseBInput,
} from '../../scripts/pr-d4-backfill/phase-b/revalidationOrchestrator';
import type { ArtifactStorageReader } from '../../scripts/pr-d4-backfill/phase-b/artifactReader';
import type {
  ChildObjectDownloader,
} from '../../scripts/pr-d4-backfill/phase-b/childRevalidator';
import type {
  ParentObjectDownloader,
} from '../../scripts/pr-d4-backfill/phase-b/parentReSplitVerifier';
import type {
  ArtifactStorageWriter,
  WrittenObject,
} from '../../scripts/pr-d4-backfill/phase-a/artifactWriter';
import type {
  PhaseACandidate,
  PhaseAClassifyChunk,
  PhaseAClassifySummary,
  BackfillManifest,
  PhaseBRevalidatedChunk,
  PhaseBRevalidationSummary,
} from '../../scripts/pr-d4-backfill/types';
import { PDFDocument } from 'pdf-lib';

function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function makePdfBuffer(pageCount: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) pdf.addPage([100, 100]);
  return Buffer.from(await pdf.save());
}

async function makeChildPdfFromParent(
  parentBytes: Buffer,
  start: number,
  end: number
): Promise<Buffer> {
  const parent = await PDFDocument.load(parentBytes);
  const child = await PDFDocument.create();
  const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  const pages = await child.copyPages(parent, indices);
  pages.forEach((p) => child.addPage(p));
  return Buffer.from(await child.save());
}

// --- In-memory storage (read + write) ---
class InMemoryStorage implements ArtifactStorageReader, ArtifactStorageWriter {
  public contents: Record<string, string> = {};
  public generations: Record<string, number> = {};
  public writes: WrittenObject[] = [];
  async readJson(path: string): Promise<{ content: string; generation: number }> {
    if (!(path in this.contents)) throw new Error(`not found: ${path}`);
    return { content: this.contents[path], generation: this.generations[path] ?? 1 };
  }
  async writeJson(
    path: string,
    content: string,
    precondition?: { ifGenerationMatch: number }
  ): Promise<void> {
    // テスト用 CAS シミュレーション
    const existing = this.generations[path] ?? 0;
    const ifGen = precondition?.ifGenerationMatch ?? 0;
    if (ifGen === 0 && existing !== 0) {
      throw new Error(`412 PreconditionFailed: path=${path} expected new (gen=0), existing gen=${existing}`);
    }
    if (ifGen !== 0 && existing !== ifGen) {
      throw new Error(`412 PreconditionFailed: path=${path} expected gen=${ifGen}, existing gen=${existing}`);
    }
    this.contents[path] = content;
    this.generations[path] = existing + 1;
    this.writes.push({ path, content });
  }
}

// --- Firestore re-fetch fake ---
class FakeFirestoreReReader implements FirestoreReReader {
  private docs: Record<
    string,
    {
      updateTimeIso: string;
      createdAtIso: string;
    } | null
  >;
  constructor(
    docs: Record<string, { updateTimeIso: string; createdAtIso: string } | null>
  ) {
    this.docs = docs;
  }
  async fetchDoc(
    docId: string
  ): Promise<{ updateTimeIso: string; createdAtIso: string } | null> {
    return docId in this.docs ? this.docs[docId] : null;
  }
}

// --- Child downloader fake ---
class FakeChildDownloader implements ChildObjectDownloader {
  private bytesByPath: Record<string, Buffer>;
  private metaByPath: Record<string, { generation: string; metageneration: string }>;
  constructor(
    bytesByPath: Record<string, Buffer>,
    metaByPath: Record<string, { generation: string; metageneration: string }>
  ) {
    this.bytesByPath = bytesByPath;
    this.metaByPath = metaByPath;
  }
  async download(path: string) {
    if (!(path in this.bytesByPath)) return null;
    return {
      bytes: this.bytesByPath[path],
      generation: this.metaByPath[path]?.generation ?? '1',
      metageneration: this.metaByPath[path]?.metageneration ?? '1',
    };
  }
}

// --- Parent downloader fake (reuses child interface shape) ---
class FakeParentDownloader implements ParentObjectDownloader {
  private bytesByPath: Record<string, Buffer>;
  private metaByPath: Record<string, { generation: string; metageneration: string }>;
  public downloadCalls: string[] = [];
  public metadataCalls: string[] = [];
  constructor(
    bytesByPath: Record<string, Buffer>,
    metaByPath: Record<string, { generation: string; metageneration: string }>
  ) {
    this.bytesByPath = bytesByPath;
    this.metaByPath = metaByPath;
  }
  async download(path: string) {
    this.downloadCalls.push(path);
    if (!(path in this.bytesByPath)) return null;
    return {
      bytes: this.bytesByPath[path],
      generation: this.metaByPath[path]?.generation ?? '1',
      metageneration: this.metaByPath[path]?.metageneration ?? '1',
    };
  }
  async getMetadataOnly(path: string) {
    this.metadataCalls.push(path);
    if (!(path in this.metaByPath)) return null;
    return this.metaByPath[path];
  }
}

const BUCKET = 'docsplit-dev-pr-d4-artifacts';
const PROD_BUCKET = 'docsplit-dev.firebasestorage.app';
const RUN_ID = '20260514T100000Z-dev-pr-d4-v1';
const PREFIX = `gs://${BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}`;

function setupPhaseAArtifact(
  storage: InMemoryStorage,
  candidates: PhaseACandidate[]
): void {
  // 直接 contents に書込む際は generations も 1 に初期化 (writeJson 経由ではないので
  // CAS 用 generation が立たないため、Phase B finalize の manifest update が 412 にならないよう手動設定)
  function setContent(path: string, content: string): void {
    storage.contents[path] = content;
    storage.generations[path] = 1;
  }
  const chunkPath = `${PREFIX}/phase-a-classify-summary-chunk-0.json`;
  const chunkBody: PhaseAClassifyChunk = {
    schemaVersion: 'pr-d4-v1.0',
    chunkIndex: 0,
    candidates,
  };
  const chunkContent = JSON.stringify(chunkBody);
  setContent(chunkPath, chunkContent);
  const chunkPointer = {
    path: chunkPath,
    sha256: sha256Hex(chunkContent),
    docCount: candidates.length,
  };
  const main: PhaseAClassifySummary = {
    phase: 'A',
    schemaVersion: 'pr-d4-v1.0',
    scriptVersion: 'pr-d4-v1.0',
    env: 'dev',
    runId: RUN_ID,
    snapshotStartedAt: '2026-05-14T10:00:00.000Z',
    snapshotCompletedAt: '2026-05-14T10:00:10.000Z',
    bucketLocation: 'asia-northeast1',
    cloudRunJobLocation: 'asia-northeast1',
    egressFreeAssertion: true,
    totalDocs: candidates.length,
    categoryDistribution: {
      MatchedByHash: candidates.filter((c) => c.category === 'MatchedByHash').length,
      RepairableMissingFile: candidates.filter((c) => c.category === 'RepairableMissingFile').length,
      Ambiguous: candidates.filter((c) => c.category === 'Ambiguous').length,
      LostOrUnrecoverable: candidates.filter((c) => c.category === 'LostOrUnrecoverable').length,
      NeedsManualReview: candidates.filter((c) => c.category === 'NeedsManualReview').length,
    },
    alreadyBackfilled: 0,
    verifiedExistingProvenance: 0,
    chunks: [chunkPointer],
  };
  const mainPath = `${PREFIX}/phase-a-classify-summary.json`;
  const mainContent = JSON.stringify(main);
  setContent(mainPath, mainContent);
  const manifestPath = `${PREFIX}/manifest.json`;
  const manifest: BackfillManifest = {
    schemaVersion: 'pr-d4-v1.0',
    runId: RUN_ID,
    env: 'dev',
    phaseA: {
      mainArtifact: { path: mainPath, sha256: sha256Hex(mainContent) },
      chunks: [chunkPointer],
    },
  };
  setContent(manifestPath, JSON.stringify(manifest));
}

function makePhaseACandidate(
  i: number,
  overrides: Partial<PhaseACandidate> = {}
): PhaseACandidate {
  return {
    docId: `doc-${i}`,
    category: 'MatchedByHash',
    reason: 'structural-prediction',
    firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
    childObjectPath: `processed/doc-${i}/output.pdf`,
    childGeneration: `cg${i}`,
    childMetageneration: '1',
    parentDocId: `parent-${i}`,
    parentObjectPath: `attachments/parent-${i}/source.pdf`,
    parentGeneration: `pg${i}`,
    parentMetageneration: '1',
    splitFromPages: { start: 1, end: 1 },
    ...overrides,
  };
}

describe('runPhaseB (PR-D4 S1-3 revalidation orchestrator)', () => {
  it('MatchedByHash + drift なし + verify pass → revalidated に derived-bytes-verified で追加', async () => {
    const parentBytes = await makePdfBuffer(3);
    const childBytes = await makeChildPdfFromParent(parentBytes, 1, 1);
    const phaseACandidates: PhaseACandidate[] = [
      makePhaseACandidate(1),
    ];
    const storage = new InMemoryStorage();
    setupPhaseAArtifact(storage, phaseACandidates);

    const input: RunPhaseBInput = {
      env: 'dev',
      runId: RUN_ID,
      artifactBucketName: BUCKET,
      manifestPath: `${PREFIX}/manifest.json`,
      artifactReader: storage,
      artifactWriter: storage,
      firestoreReReader: new FakeFirestoreReReader({
        'doc-1': {
          updateTimeIso: '2026-05-14T10:00:00.000Z',
          createdAtIso: '2026-04-01T00:00:00.000Z',
        },
      }),
      childDownloader: new FakeChildDownloader(
        { 'processed/doc-1/output.pdf': childBytes },
        { 'processed/doc-1/output.pdf': { generation: 'cg1', metageneration: '1' } }
      ),
      parentDownloader: new FakeParentDownloader(
        { 'attachments/parent-1/source.pdf': parentBytes },
        { 'attachments/parent-1/source.pdf': { generation: 'pg1', metageneration: '1' } }
      ),
      productionDataBucketName: PROD_BUCKET,
      revalidationStartedAt: '2026-05-14T11:00:00.000Z',
      nowProvider: () => '2026-05-14T11:00:01.000Z',
    };
    const result = await runPhaseB(input);
    expect(result.candidatesIn).to.equal(1);
    expect(result.candidatesOut).to.equal(1);
    expect(result.verifyFailedMatchedByHash).to.equal(0);

    const chunkContent = storage.writes.find((w) => w.path.includes('phase-b') && w.path.includes('chunk-0.json'))!.content;
    const chunk = JSON.parse(chunkContent) as PhaseBRevalidatedChunk;
    expect(chunk.revalidated).to.have.length(1);
    expect(chunk.revalidated[0].docId).to.equal('doc-1');
    expect(chunk.revalidated[0].computedConfidence).to.equal('derived-bytes-verified');
    expect(chunk.revalidated[0].computedProvenance.derivedSha256).to.equal(sha256Hex(childBytes));
    expect(chunk.revalidated[0].computedProvenance.sourceSha256).to.equal(sha256Hex(parentBytes));
    expect(chunk.revalidated[0].computedProvenance.createdAt).to.equal('2026-04-01T00:00:00.000Z');
    expect(chunk.revalidated[0].computedProvenance.sourceBucket).to.equal(PROD_BUCKET);
    expect(chunk.revalidated[0].evidence.parentExists).to.equal(true);
    expect(chunk.revalidated[0].evidence.parentSha256MatchedAtBackfill).to.equal(true);
    expect(chunk.revalidated[0].evidence.childSha256ComputedAtBackfill).to.equal(true);
  });

  it('drift 検出 (Firestore updateTime 変化) → driftSkipped.firestoreUpdateTimeChanged++、revalidated 追加なし', async () => {
    const parentBytes = await makePdfBuffer(3);
    const childBytes = await makeChildPdfFromParent(parentBytes, 1, 1);
    const phaseACandidates = [makePhaseACandidate(1)];
    const storage = new InMemoryStorage();
    setupPhaseAArtifact(storage, phaseACandidates);
    const input: RunPhaseBInput = {
      env: 'dev',
      runId: RUN_ID,
      artifactBucketName: BUCKET,
      manifestPath: `${PREFIX}/manifest.json`,
      artifactReader: storage,
      artifactWriter: storage,
      firestoreReReader: new FakeFirestoreReReader({
        'doc-1': {
          updateTimeIso: '2026-05-14T11:00:00.000Z', // drift
          createdAtIso: '2026-04-01T00:00:00.000Z',
        },
      }),
      childDownloader: new FakeChildDownloader(
        { 'processed/doc-1/output.pdf': childBytes },
        { 'processed/doc-1/output.pdf': { generation: 'cg1', metageneration: '1' } }
      ),
      parentDownloader: new FakeParentDownloader(
        { 'attachments/parent-1/source.pdf': parentBytes },
        { 'attachments/parent-1/source.pdf': { generation: 'pg1', metageneration: '1' } }
      ),
      productionDataBucketName: PROD_BUCKET,
      revalidationStartedAt: '2026-05-14T11:00:00.000Z',
    };
    const result = await runPhaseB(input);
    expect(result.candidatesOut).to.equal(0);
    expect(result.driftSkipped.firestoreUpdateTimeChanged).to.equal(1);
    expect(result.driftSkipped.childGenerationChanged).to.equal(0);
    expect(result.driftSkipped.parentGenerationChanged).to.equal(0);
  });

  it('MatchedByHash で verify fail (child bytes 不一致) → verifyFailedMatchedByHash++', async () => {
    const parentBytes = await makePdfBuffer(3);
    const wrongChild = Buffer.from('not matching content');
    const phaseACandidates = [makePhaseACandidate(1)];
    const storage = new InMemoryStorage();
    setupPhaseAArtifact(storage, phaseACandidates);
    const input: RunPhaseBInput = {
      env: 'dev',
      runId: RUN_ID,
      artifactBucketName: BUCKET,
      manifestPath: `${PREFIX}/manifest.json`,
      artifactReader: storage,
      artifactWriter: storage,
      firestoreReReader: new FakeFirestoreReReader({
        'doc-1': {
          updateTimeIso: '2026-05-14T10:00:00.000Z',
          createdAtIso: '2026-04-01T00:00:00.000Z',
        },
      }),
      childDownloader: new FakeChildDownloader(
        { 'processed/doc-1/output.pdf': wrongChild },
        { 'processed/doc-1/output.pdf': { generation: 'cg1', metageneration: '1' } }
      ),
      parentDownloader: new FakeParentDownloader(
        { 'attachments/parent-1/source.pdf': parentBytes },
        { 'attachments/parent-1/source.pdf': { generation: 'pg1', metageneration: '1' } }
      ),
      productionDataBucketName: PROD_BUCKET,
      revalidationStartedAt: '2026-05-14T11:00:00.000Z',
    };
    const result = await runPhaseB(input);
    expect(result.candidatesOut).to.equal(0);
    expect(result.verifyFailedMatchedByHash).to.equal(1);
  });

  it('非 MatchedByHash candidate → skippedNonMatchedByHash++ (revalidation/parent download スキップ)', async () => {
    let parentDownloads = 0;
    class CountingParentDl implements ParentObjectDownloader {
      async download() {
        parentDownloads++;
        return null;
      }
      async getMetadataOnly() {
        return null;
      }
    }
    const phaseACandidates: PhaseACandidate[] = [
      makePhaseACandidate(1, { category: 'Ambiguous' }),
      makePhaseACandidate(2, { category: 'RepairableMissingFile' }),
      makePhaseACandidate(3, { category: 'LostOrUnrecoverable' }),
      makePhaseACandidate(4, { category: 'NeedsManualReview' }),
    ];
    const storage = new InMemoryStorage();
    setupPhaseAArtifact(storage, phaseACandidates);
    const input: RunPhaseBInput = {
      env: 'dev',
      runId: RUN_ID,
      artifactBucketName: BUCKET,
      manifestPath: `${PREFIX}/manifest.json`,
      artifactReader: storage,
      artifactWriter: storage,
      firestoreReReader: new FakeFirestoreReReader({}),
      childDownloader: new FakeChildDownloader({}, {}),
      parentDownloader: new CountingParentDl(),
      productionDataBucketName: PROD_BUCKET,
      revalidationStartedAt: '2026-05-14T11:00:00.000Z',
    };
    const result = await runPhaseB(input);
    expect(result.skippedNonMatchedByHash).to.equal(4);
    expect(result.candidatesOut).to.equal(0);
    expect(parentDownloads).to.equal(0);
  });

  it('main artifact に candidatesIn / candidatesOut / driftSkipped が記録される', async () => {
    const parentBytes = await makePdfBuffer(3);
    const childBytes = await makeChildPdfFromParent(parentBytes, 1, 1);
    const phaseACandidates = [
      makePhaseACandidate(1),
      makePhaseACandidate(2, { category: 'Ambiguous' }),
    ];
    const storage = new InMemoryStorage();
    setupPhaseAArtifact(storage, phaseACandidates);
    const input: RunPhaseBInput = {
      env: 'dev',
      runId: RUN_ID,
      artifactBucketName: BUCKET,
      manifestPath: `${PREFIX}/manifest.json`,
      artifactReader: storage,
      artifactWriter: storage,
      firestoreReReader: new FakeFirestoreReReader({
        'doc-1': {
          updateTimeIso: '2026-05-14T10:00:00.000Z',
          createdAtIso: '2026-04-01T00:00:00.000Z',
        },
      }),
      childDownloader: new FakeChildDownloader(
        { 'processed/doc-1/output.pdf': childBytes },
        { 'processed/doc-1/output.pdf': { generation: 'cg1', metageneration: '1' } }
      ),
      parentDownloader: new FakeParentDownloader(
        { 'attachments/parent-1/source.pdf': parentBytes },
        { 'attachments/parent-1/source.pdf': { generation: 'pg1', metageneration: '1' } }
      ),
      productionDataBucketName: PROD_BUCKET,
      revalidationStartedAt: '2026-05-14T11:00:00.000Z',
      nowProvider: () => '2026-05-14T11:00:01.000Z',
    };
    await runPhaseB(input);
    const mainContent = storage.writes.find((w) =>
      w.path.endsWith('phase-b-revalidation-summary.json')
    )!.content;
    const main = JSON.parse(mainContent) as PhaseBRevalidationSummary;
    expect(main.candidatesIn).to.equal(2);
    expect(main.candidatesOut).to.equal(1);
    expect(main.skippedNonMatchedByHash).to.equal(1);
    expect(main.revalidationStartedAt).to.equal('2026-05-14T11:00:00.000Z');
    expect(main.revalidationCompletedAt).to.equal('2026-05-14T11:00:01.000Z');
  });

  it('FirestoreReReader.fetchDoc が null (createdAt 不在 / doc 消失) → firestoreUpdateTimeChanged++ で除外', async () => {
    const phaseACandidates = [makePhaseACandidate(1)];
    const storage = new InMemoryStorage();
    setupPhaseAArtifact(storage, phaseACandidates);
    const input: RunPhaseBInput = {
      env: 'dev',
      runId: RUN_ID,
      artifactBucketName: BUCKET,
      manifestPath: `${PREFIX}/manifest.json`,
      artifactReader: storage,
      artifactWriter: storage,
      firestoreReReader: new FakeFirestoreReReader({}), // doc-1 不在
      childDownloader: new FakeChildDownloader({}, {}),
      parentDownloader: new FakeParentDownloader({}, {}),
      productionDataBucketName: PROD_BUCKET,
      revalidationStartedAt: '2026-05-14T11:00:00.000Z',
    };
    const result = await runPhaseB(input);
    expect(result.candidatesOut).to.equal(0);
    expect(result.driftSkipped.firestoreUpdateTimeChanged).to.equal(1);
  });

  it('child orphan (childObjectExists=false) なら parent download 呼ばずに verifyFailed カウンタ (cost 削減)', async () => {
    let parentDownloadCalls = 0;
    class CountingParentDl implements ParentObjectDownloader {
      async download() {
        parentDownloadCalls++;
        return null;
      }
      async getMetadataOnly() {
        return null;
      }
    }
    const phaseACandidates = [makePhaseACandidate(1)];
    const storage = new InMemoryStorage();
    setupPhaseAArtifact(storage, phaseACandidates);
    const input: RunPhaseBInput = {
      env: 'dev',
      runId: RUN_ID,
      artifactBucketName: BUCKET,
      manifestPath: `${PREFIX}/manifest.json`,
      artifactReader: storage,
      artifactWriter: storage,
      firestoreReReader: new FakeFirestoreReReader({
        'doc-1': {
          updateTimeIso: '2026-05-14T10:00:00.000Z',
          createdAtIso: '2026-04-01T00:00:00.000Z',
        },
      }),
      childDownloader: new FakeChildDownloader({}, {}), // child 不在
      parentDownloader: new CountingParentDl(),
      productionDataBucketName: PROD_BUCKET,
      revalidationStartedAt: '2026-05-14T11:00:00.000Z',
    };
    const result = await runPhaseB(input);
    expect(parentDownloadCalls).to.equal(0);
    // child 不在 + Phase A は parent あり → parentGeneration drift で skip
    expect(result.driftSkipped.childGenerationChanged + result.driftSkipped.parentGenerationChanged).to.equal(1);
    expect(result.candidatesOut).to.equal(0);
  });

  it('manifest.phaseA は保持されつつ phaseB が additive 追記される', async () => {
    const parentBytes = await makePdfBuffer(3);
    const childBytes = await makeChildPdfFromParent(parentBytes, 1, 1);
    const phaseACandidates = [makePhaseACandidate(1)];
    const storage = new InMemoryStorage();
    setupPhaseAArtifact(storage, phaseACandidates);
    const input: RunPhaseBInput = {
      env: 'dev',
      runId: RUN_ID,
      artifactBucketName: BUCKET,
      manifestPath: `${PREFIX}/manifest.json`,
      artifactReader: storage,
      artifactWriter: storage,
      firestoreReReader: new FakeFirestoreReReader({
        'doc-1': {
          updateTimeIso: '2026-05-14T10:00:00.000Z',
          createdAtIso: '2026-04-01T00:00:00.000Z',
        },
      }),
      childDownloader: new FakeChildDownloader(
        { 'processed/doc-1/output.pdf': childBytes },
        { 'processed/doc-1/output.pdf': { generation: 'cg1', metageneration: '1' } }
      ),
      parentDownloader: new FakeParentDownloader(
        { 'attachments/parent-1/source.pdf': parentBytes },
        { 'attachments/parent-1/source.pdf': { generation: 'pg1', metageneration: '1' } }
      ),
      productionDataBucketName: PROD_BUCKET,
      revalidationStartedAt: '2026-05-14T11:00:00.000Z',
    };
    await runPhaseB(input);
    const finalManifest = JSON.parse(
      storage.contents[`${PREFIX}/manifest.json`]
    ) as BackfillManifest;
    expect(finalManifest.phaseA, 'phaseA preserved').to.exist;
    expect(finalManifest.phaseB, 'phaseB added').to.exist;
    expect(finalManifest.phaseA!.chunks).to.have.length(1);
  });
});
