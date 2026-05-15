/**
 * Issue #445 PR-D4 S1-5: Phase D verifyOrchestrator 統合テスト.
 *
 * Phase C manifest 読込 → Phase A read-only count + Phase B index 構築 → writtenDocs streaming
 * verify → coverage 算出 → finalize (main + manifest CAS) の統合動作検証。
 *
 * fake adapters で in-memory artifact bucket + Firestore re-read を seed して run。
 *
 * 検証観点:
 * - 正常系 (全 verified、保全式アサート)
 * - sha256 mismatch / provenance-field mismatch / missing-expected の混在
 * - per-chunk flush (BF22 streaming、chunk size > buffer threshold)
 * - rotate gate fixture test (dev 環境 enabled / 本番相当 disabled)
 * - manifest CAS 失敗時の status file 書込 (Codex 8th Important 3)
 * - 2 系統 coverage ratio (Codex 7th Important 4)
 * - provenanceBackfillNullCount (Codex 8th 回答 4)
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { runPhaseD } from '../../scripts/pr-d4-backfill/phase-d/verifyOrchestrator';
import type {
  PhaseDDocReader,
} from '../../scripts/pr-d4-backfill/phase-d/verifyOrchestrator';
import type { ObservedDocState } from '../../scripts/pr-d4-backfill/phase-d/docVerifier';
import type {
  ArtifactStorageReader,
} from '../../scripts/pr-d4-backfill/phase-b/artifactReader';
import type { ArtifactStorageWriter } from '../../scripts/pr-d4-backfill/phase-a/artifactWriter';
import { sha256ProvenanceBackfill } from '../../scripts/pr-d4-backfill/phase-c/batchWriter';
import { createBackfillProvenance } from '../src/pdf/provenance';
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
import type {
  FixtureStore,
  RotateApiCaller,
} from '../../scripts/pr-d4-backfill/phase-d/rotateGateFixtureTester';

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

const RUN_ID = '20260515T020000Z-dev-pr-d4-v1';
const ARTIFACT_BUCKET = 'docsplit-dev-pr-d4-artifacts';
const BACKFILL_SCRIPT_VERSION = 'pr-d4-v1.0';
const MANIFEST_PATH = `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/manifest.json`;
const PHASE_A_MAIN = `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-a-classify-summary.json`;
const PHASE_B_MAIN = `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-b-revalidation-summary.json`;
const PHASE_C_MAIN = `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-c-backfill-summary.json`;

interface FakeArtifactObject {
  content: string;
  generation: number;
}

class FakeInMemoryStorage {
  private store = new Map<string, FakeArtifactObject>();
  private nextGen = 100;
  /** Set to true to simulate manifest CAS failure (412 PreconditionFailed) */
  failManifestCAS = false;

  reader: ArtifactStorageReader = {
    readJson: async (path: string) => {
      const obj = this.store.get(path);
      if (!obj) throw new Error(`fake storage: object not found: ${path}`);
      return { content: obj.content, generation: obj.generation };
    },
  };

  writer: ArtifactStorageWriter = {
    writeJson: async (
      path: string,
      content: string,
      precondition?: { ifGenerationMatch: number }
    ) => {
      if (this.failManifestCAS && path === MANIFEST_PATH && precondition && precondition.ifGenerationMatch > 0) {
        const err = new Error('412 PreconditionFailed (simulated)');
        (err as Error & { code?: number }).code = 412;
        throw err;
      }
      const ifGenMatch = precondition?.ifGenerationMatch;
      if (ifGenMatch !== undefined) {
        const existing = this.store.get(path);
        if (ifGenMatch === 0) {
          if (existing) {
            const err = new Error('412 PreconditionFailed: object already exists');
            (err as Error & { code?: number }).code = 412;
            throw err;
          }
        } else {
          if (!existing) {
            const err = new Error('412 PreconditionFailed: object missing for CAS');
            (err as Error & { code?: number }).code = 412;
            throw err;
          }
          if (existing.generation !== ifGenMatch) {
            const err = new Error(
              `412 PreconditionFailed: expected gen ${ifGenMatch}, got ${existing.generation}`
            );
            (err as Error & { code?: number }).code = 412;
            throw err;
          }
        }
      }
      this.store.set(path, { content, generation: this.nextGen++ });
    },
  };

  seed(path: string, content: string, generation?: number): void {
    this.store.set(path, { content, generation: generation ?? this.nextGen++ });
  }
  get(path: string): FakeArtifactObject | undefined {
    return this.store.get(path);
  }
}

let docCounter = 0;
function makeCandidate(docId: string, confidence: 'derived-bytes-verified' | 'child-snapshot-only'): PhaseBRevalidatedCandidate {
  docCounter += 1;
  const gen = String(1700000000 + docCounter);
  return {
    docId,
    category: confidence === 'derived-bytes-verified' ? 'MatchedByHash' : 'Ambiguous',
    computedConfidence: confidence,
    computedProvenance: {
      sourceGeneration: gen,
      sourceMetageneration: '1',
      // 64-char hex (a-f only)
      sourceSha256: ('a' + (docCounter % 16).toString(16)).repeat(32),
      sourcePath: `original/${docId}-parent.pdf`,
      sourceBucket: 'docsplit-dev-storage',
      derivedObjectPath: `processed/${docId}/${docId}.pdf`,
      derivedGeneration: String(2700000000 + docCounter),
      derivedMetageneration: '1',
      derivedSha256: ('b' + (docCounter % 16).toString(16)).repeat(32),
      createdAt: '2026-05-13T10:00:00.000Z',
    },
    evidence: {
      parentExists: confidence === 'derived-bytes-verified',
      parentSha256MatchedAtBackfill: confidence === 'derived-bytes-verified',
      childSha256ComputedAtBackfill: true,
    },
  };
}

/**
 * Phase D test seed builder: Phase A summary + Phase B chunks + Phase C chunks + manifest を構築。
 *
 * computedProvenance + createBackfillProvenance を経由して `newProvenanceBackfillSha256` を計算し、
 * Phase C writtenDocs に格納 + observed (Firestore re-read fake) も同 metadata を返す。
 */
function seedArtifacts(
  storage: FakeInMemoryStorage,
  options: {
    candidates: PhaseBRevalidatedCandidate[];
    phaseATotalDocs: number;
    phaseAVerifiedExisting: number;
  }
): {
  manifest: BackfillManifest;
  manifestGeneration: number;
  observedMap: Map<string, ObservedDocState>;
  expectedSha256Map: Map<string, string>;
} {
  const observedMap = new Map<string, ObservedDocState>();
  const expectedSha256Map = new Map<string, string>();
  const writtenDocs: PhaseCWrittenDoc[] = [];

  for (const cand of options.candidates) {
    const splitCreatedAt = Timestamp.fromDate(new Date(cand.computedProvenance.createdAt));
    const backfilledAt = Timestamp.fromDate(new Date('2026-05-15T10:00:00.000Z'));
    const built = createBackfillProvenance({
      provenanceFields: {
        sourceGeneration: cand.computedProvenance.sourceGeneration,
        sourceMetageneration: cand.computedProvenance.sourceMetageneration,
        sourceSha256: cand.computedProvenance.sourceSha256,
        sourcePath: cand.computedProvenance.sourcePath,
        sourceBucket: cand.computedProvenance.sourceBucket,
        derivedObjectPath: cand.computedProvenance.derivedObjectPath,
        derivedGeneration: cand.computedProvenance.derivedGeneration,
        derivedMetageneration: cand.computedProvenance.derivedMetageneration,
        derivedSha256: cand.computedProvenance.derivedSha256,
        createdAt: splitCreatedAt,
      },
      confidence: cand.computedConfidence,
      classifierCategory: cand.category,
      evidence: {
        parentExists: cand.evidence.parentExists,
        parentSha256MatchedAtBackfill: cand.evidence.parentSha256MatchedAtBackfill,
        childSha256ComputedAtBackfill: cand.evidence.childSha256ComputedAtBackfill,
      },
      backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
      backfilledAt,
    });
    const sha = sha256ProvenanceBackfill(built.provenanceBackfill);
    expectedSha256Map.set(cand.docId, sha);
    writtenDocs.push({
      docId: cand.docId,
      writeStatus: 'ok',
      newProvenanceBackfillSha256: sha,
      lastUpdateTimeAfter: '2026-05-15T10:00:01.000Z',
    });
    observedMap.set(cand.docId, {
      docId: cand.docId,
      documentCreatedAt: splitCreatedAt,
      provenance: built.provenance,
      provenanceBackfill: built.provenanceBackfill,
      provenanceBackfillRaw: built.provenanceBackfill,
    });
  }

  // Phase A summary
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
    totalDocs: options.phaseATotalDocs,
    categoryDistribution: {
      MatchedByHash: options.candidates.length,
      RepairableMissingFile: 0,
      Ambiguous: 0,
      LostOrUnrecoverable: 0,
      NeedsManualReview: 0,
    },
    alreadyBackfilled: 0,
    verifiedExistingProvenance: options.phaseAVerifiedExisting,
    chunks: [],
  };
  const phaseAMainContent = JSON.stringify(phaseAMain);
  storage.seed(PHASE_A_MAIN, phaseAMainContent);

  // Phase B chunk + main
  const phaseBChunk: PhaseBRevalidatedChunk = {
    schemaVersion: 'pr-d4-v1.0',
    chunkIndex: 0,
    revalidated: options.candidates,
  };
  const phaseBChunkContent = JSON.stringify(phaseBChunk);
  const phaseBChunkPath = `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-b-chunk-0.json`;
  storage.seed(phaseBChunkPath, phaseBChunkContent);
  const phaseBMain: PhaseBRevalidationSummary = {
    phase: 'B',
    schemaVersion: 'pr-d4-v1.0',
    scriptVersion: 'pr-d4-v1.0',
    env: 'dev',
    runId: RUN_ID,
    phaseAArtifactRef: PHASE_A_MAIN,
    phaseAManifestSha256: 'phaseA-sha-fake',
    revalidationStartedAt: '2026-05-15T01:00:00.000Z',
    revalidationCompletedAt: '2026-05-15T01:30:00.000Z',
    candidatesIn: options.candidates.length,
    candidatesOut: options.candidates.length,
    driftSkipped: { firestoreUpdateTimeChanged: 0, childGenerationChanged: 0, parentGenerationChanged: 0 },
    verifyFailedMatchedByHash: 0,
    skippedNonMatchedByHash: 0,
    chunks: [{ path: phaseBChunkPath, sha256: sha256Hex(phaseBChunkContent), docCount: options.candidates.length }],
  };
  const phaseBMainContent = JSON.stringify(phaseBMain);
  storage.seed(PHASE_B_MAIN, phaseBMainContent);

  // Phase C chunk + main
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
  const phaseCChunkPath = `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-c-chunk-0.json`;
  storage.seed(phaseCChunkPath, phaseCChunkContent);
  const phaseCMain: PhaseCBackfillSummary = {
    phase: 'C',
    schemaVersion: 'pr-d4-v1.0',
    scriptVersion: 'pr-d4-v1.0',
    env: 'dev',
    runId: RUN_ID,
    phaseBArtifactRef: PHASE_B_MAIN,
    phaseBManifestSha256: 'phaseB-sha-fake',
    backfillStartedAt: '2026-05-15T02:00:00.000Z',
    backfillCompletedAt: '2026-05-15T02:30:00.000Z',
    candidatesIn: options.candidates.length,
    writtenDocs: writtenDocs.length,
    preconditionFailedDocs: 0,
    skippedImmutable: 0,
    unprocessableDocs: 0,
    outOfScopeDocs: 0,
    lockAcquiredGeneration: '999',
    lockReleasedAt: '2026-05-15T02:30:01.000Z',
    rateLimiterConfig: { tokensPerSecond: 100, burstCapacity: 100 },
    chunks: [{ path: phaseCChunkPath, sha256: sha256Hex(phaseCChunkContent), docCount: writtenDocs.length }],
  };
  const phaseCMainContent = JSON.stringify(phaseCMain);
  storage.seed(PHASE_C_MAIN, phaseCMainContent);

  // manifest
  const manifest: BackfillManifest = {
    schemaVersion: 'pr-d4-v1.0',
    runId: RUN_ID,
    env: 'dev',
    phaseA: { mainArtifact: { path: PHASE_A_MAIN, sha256: sha256Hex(phaseAMainContent) }, chunks: [] },
    phaseB: {
      mainArtifact: { path: PHASE_B_MAIN, sha256: sha256Hex(phaseBMainContent) },
      chunks: phaseBMain.chunks,
    },
    phaseC: {
      mainArtifact: { path: PHASE_C_MAIN, sha256: sha256Hex(phaseCMainContent) },
      chunks: phaseCMain.chunks,
    },
  };
  const manifestContent = JSON.stringify(manifest);
  const manifestGen = 500;
  storage.seed(MANIFEST_PATH, manifestContent, manifestGen);

  return { manifest, manifestGeneration: manifestGen, observedMap, expectedSha256Map };
}

class FakeDocReader implements PhaseDDocReader {
  private map: Map<string, ObservedDocState>;
  constructor(map: Map<string, ObservedDocState>) {
    this.map = map;
  }
  async readDoc(docId: string): Promise<ObservedDocState> {
    const obs = this.map.get(docId);
    if (!obs) {
      return {
        docId,
        documentCreatedAt: null,
        provenance: null,
        provenanceBackfill: null,
        provenanceBackfillRaw: undefined,
      };
    }
    return obs;
  }
}

describe('runPhaseD - verify orchestrator (Codex 8th GO 反映)', () => {
  describe('正常系: 全 verified + 保全式 + coverage 算出', () => {
    it('全 3 docs verified + coverage 2 系統 + provenanceBackfillNullCount=0', async () => {
      const storage = new FakeInMemoryStorage();
      const candidates = [
        makeCandidate('doc1', 'derived-bytes-verified'),
        makeCandidate('doc2', 'derived-bytes-verified'),
        makeCandidate('doc3', 'derived-bytes-verified'),
      ];
      const seeded = seedArtifacts(storage, {
        candidates,
        phaseATotalDocs: 100,
        phaseAVerifiedExisting: 50,
      });
      const result = await runPhaseD({
        env: 'dev',
        runId: RUN_ID,
        artifactBucketName: ARTIFACT_BUCKET,
        manifestPath: MANIFEST_PATH,
        artifactReader: storage.reader,
        artifactWriter: storage.writer,
        docReader: new FakeDocReader(seeded.observedMap),
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
        rotateGateFixtureEnabled: false,
        verifyStartedAt: '2026-05-15T03:00:00.000Z',
        nowProvider: () => new Date('2026-05-15T03:30:00.000Z'),
      });
      expect(result.candidatesIn).to.equal(3);
      expect(result.verifiedDocs).to.equal(3);
      expect(result.fieldsConsistent).to.equal(3);
      expect(result.fieldsMismatchCount).to.equal(0);
      expect(result.createdAtConsistent).to.equal(3);
      expect(result.createdAtMismatchCount).to.equal(0);
      expect(result.provenanceBackfillNullCount).to.equal(0);
      expect(result.confidenceDistribution['derived-bytes-verified']).to.equal(3);
      expect(result.rotateGateTest).to.be.null;
      expect(result.manifestUpdateStatus).to.equal('ok');
      // 2 系統 coverage
      expect(result.coverageRatio.backfillAttemptCoverage.denominator).to.equal(3);
      expect(result.coverageRatio.backfillAttemptCoverage.derivedBytesVerified).to.equal(1.0);
      expect(result.coverageRatio.estateRotateReadyCoverage.denominator).to.equal(100);
      // verifiedExisting(50) + backfilledDerivedBytesVerified(3) = 53 / 100 = 0.53
      expect(result.coverageRatio.estateRotateReadyCoverage.rotateReadyTotal).to.be.closeTo(0.53, 0.001);
      // 保全式: rotateReadyTotal + notRotateReady === 1.0
      const sumCov =
        result.coverageRatio.estateRotateReadyCoverage.rotateReadyTotal +
        result.coverageRatio.estateRotateReadyCoverage.notRotateReady;
      expect(sumCov).to.be.closeTo(1.0, 0.001);
    });
  });

  describe('mismatch 検出ケース', () => {
    it('observed.provenance.sourceSha256 drift → fieldsMismatch に sourceSha256 含まれる', async () => {
      const storage = new FakeInMemoryStorage();
      const candidates = [makeCandidate('doc1', 'derived-bytes-verified')];
      const seeded = seedArtifacts(storage, {
        candidates,
        phaseATotalDocs: 10,
        phaseAVerifiedExisting: 0,
      });
      // observed の sourceSha256 を強制改竄
      const obs = seeded.observedMap.get('doc1')!;
      obs.provenance!.sourceSha256 = 'z'.repeat(64);
      const result = await runPhaseD({
        env: 'dev',
        runId: RUN_ID,
        artifactBucketName: ARTIFACT_BUCKET,
        manifestPath: MANIFEST_PATH,
        artifactReader: storage.reader,
        artifactWriter: storage.writer,
        docReader: new FakeDocReader(seeded.observedMap),
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
        rotateGateFixtureEnabled: false,
        verifyStartedAt: '2026-05-15T03:00:00.000Z',
        nowProvider: () => new Date('2026-05-15T03:30:00.000Z'),
      });
      expect(result.fieldsMismatchCount).to.be.greaterThan(0);
      expect(result.fieldsConsistent).to.equal(0);
    });

    it('provenanceBackfillRaw が null の doc → provenanceBackfillNullCount=1 (Codex 8th 回答 4)', async () => {
      const storage = new FakeInMemoryStorage();
      const candidates = [makeCandidate('doc1', 'derived-bytes-verified')];
      const seeded = seedArtifacts(storage, {
        candidates,
        phaseATotalDocs: 10,
        phaseAVerifiedExisting: 0,
      });
      const obs = seeded.observedMap.get('doc1')!;
      obs.provenanceBackfillRaw = null;
      const result = await runPhaseD({
        env: 'dev',
        runId: RUN_ID,
        artifactBucketName: ARTIFACT_BUCKET,
        manifestPath: MANIFEST_PATH,
        artifactReader: storage.reader,
        artifactWriter: storage.writer,
        docReader: new FakeDocReader(seeded.observedMap),
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
        rotateGateFixtureEnabled: false,
        verifyStartedAt: '2026-05-15T03:00:00.000Z',
      });
      expect(result.provenanceBackfillNullCount).to.equal(1);
      expect(result.fieldsMismatchCount).to.be.greaterThan(0);
    });
  });

  describe('rotate gate fixture test (dev only、Codex 7th Important 2)', () => {
    it('rotateGateFixtureEnabled=true で derived-bytes-verified success + child-snapshot-only reject', async () => {
      const storage = new FakeInMemoryStorage();
      const candidates = [makeCandidate('doc1', 'derived-bytes-verified')];
      const seeded = seedArtifacts(storage, {
        candidates,
        phaseATotalDocs: 10,
        phaseAVerifiedExisting: 0,
      });
      const cleanupCalls: string[] = [];
      const fakeFixtureStore: FixtureStore = {
        async createFixture(input) {
          return { objectPath: `processed/${input.docId}/${input.docId}.pdf`, objectGeneration: '777' };
        },
        async cleanupFixture(input) {
          cleanupCalls.push(input.docId);
        },
      };
      const fakeRotate: RotateApiCaller = {
        async callRotate(input) {
          if (input.docId.includes('child_snapshot_only')) {
            return { kind: 'rejected', rejectionMessage: 'failed-precondition: confidence' };
          }
          return {
            kind: 'success',
            rotatedAt: '2026-05-15T03:30:00.000Z',
            newRotationObjectPath: `processed/${input.docId}/rotations/uuid.pdf`,
            newRotationObjectGeneration: '888',
          };
        },
      };
      const result = await runPhaseD({
        env: 'dev',
        runId: RUN_ID,
        artifactBucketName: ARTIFACT_BUCKET,
        manifestPath: MANIFEST_PATH,
        artifactReader: storage.reader,
        artifactWriter: storage.writer,
        docReader: new FakeDocReader(seeded.observedMap),
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
        rotateGateFixtureEnabled: true,
        fixtureStore: fakeFixtureStore,
        rotateApiCaller: fakeRotate,
        fixturePdfBytesVerified: Buffer.from('verified-pdf'),
        fixturePdfBytesChildSnapshotOnly: Buffer.from('child-snapshot-pdf'),
        verifyStartedAt: '2026-05-15T03:00:00.000Z',
      });
      expect(result.rotateGateTest).to.not.be.null;
      expect(result.rotateGateTest!.derivedBytesVerified.rotateApiResult).to.equal('success');
      expect(result.rotateGateTest!.childSnapshotOnly.rotateApiResult).to.equal('rejected');
      expect(result.rotateGateTest!.fixtureCleanupFailures).to.have.length(0);
      // cleanup hook 2 件呼出 (verified + child_snapshot_only)
      expect(cleanupCalls).to.have.length(2);
      expect(cleanupCalls[0]).to.match(/BF13_test_fixture_/);
    });

    it('本番相当 (rotateGateFixtureEnabled=false) で rotateGateTest=null + 副作用なし', async () => {
      const storage = new FakeInMemoryStorage();
      const candidates = [makeCandidate('doc1', 'derived-bytes-verified')];
      const seeded = seedArtifacts(storage, {
        candidates,
        phaseATotalDocs: 10,
        phaseAVerifiedExisting: 0,
      });
      let createCalls = 0;
      const fakeFixtureStore: FixtureStore = {
        async createFixture() {
          createCalls++;
          return { objectPath: 'should-not-be-called', objectGeneration: '0' };
        },
        async cleanupFixture() {},
      };
      const fakeRotate: RotateApiCaller = {
        async callRotate() {
          return { kind: 'error', message: 'should-not-be-called' };
        },
      };
      const result = await runPhaseD({
        env: 'cocoro',
        runId: RUN_ID,
        artifactBucketName: ARTIFACT_BUCKET,
        manifestPath: MANIFEST_PATH,
        artifactReader: storage.reader,
        artifactWriter: storage.writer,
        docReader: new FakeDocReader(seeded.observedMap),
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
        rotateGateFixtureEnabled: false,
        fixtureStore: fakeFixtureStore,
        rotateApiCaller: fakeRotate,
        verifyStartedAt: '2026-05-15T03:00:00.000Z',
      });
      expect(result.rotateGateTest).to.be.null;
      expect(createCalls).to.equal(0);  // 本番副作用ゼロ
    });
  });

  describe('Codex 10th: hasVerificationFailure 判定 + exit non-zero 用フラグ', () => {
    it('mismatch あり → hasVerificationFailure=true', async () => {
      const storage = new FakeInMemoryStorage();
      const candidates = [makeCandidate('docA1', 'derived-bytes-verified')];
      const seeded = seedArtifacts(storage, {
        candidates,
        phaseATotalDocs: 10,
        phaseAVerifiedExisting: 0,
      });
      seeded.observedMap.get('docA1')!.provenance!.sourceSha256 = 'x'.repeat(64);
      const result = await runPhaseD({
        env: 'dev',
        runId: RUN_ID,
        artifactBucketName: ARTIFACT_BUCKET,
        manifestPath: MANIFEST_PATH,
        artifactReader: storage.reader,
        artifactWriter: storage.writer,
        docReader: new FakeDocReader(seeded.observedMap),
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
        rotateGateFixtureEnabled: false,
        verifyStartedAt: '2026-05-15T03:00:00.000Z',
      });
      expect(result.hasVerificationFailure).to.be.true;
      expect(result.mismatchedDocCount).to.equal(1);
    });

    it('all clean + no fixture → hasVerificationFailure=false', async () => {
      const storage = new FakeInMemoryStorage();
      const candidates = [makeCandidate('docB1', 'derived-bytes-verified')];
      const seeded = seedArtifacts(storage, {
        candidates,
        phaseATotalDocs: 10,
        phaseAVerifiedExisting: 0,
      });
      const result = await runPhaseD({
        env: 'dev',
        runId: RUN_ID,
        artifactBucketName: ARTIFACT_BUCKET,
        manifestPath: MANIFEST_PATH,
        artifactReader: storage.reader,
        artifactWriter: storage.writer,
        docReader: new FakeDocReader(seeded.observedMap),
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
        rotateGateFixtureEnabled: false,
        verifyStartedAt: '2026-05-15T03:00:00.000Z',
      });
      expect(result.hasVerificationFailure).to.be.false;
      expect(result.mismatchedDocCount).to.equal(0);
    });
  });

  describe('Codex 10th: BF15 backfillAttemptCoverage の正しい分母 (phaseC.candidatesIn)', () => {
    it('phaseC summary に preconditionFailed=2 / skippedImmutable=3 がある場合、分母は writtenDocs ではなく candidatesIn', async () => {
      const storage = new FakeInMemoryStorage();
      const candidates = [
        makeCandidate('docC1', 'derived-bytes-verified'),
        makeCandidate('docC2', 'derived-bytes-verified'),
      ];
      const seeded = seedArtifacts(storage, {
        candidates,
        phaseATotalDocs: 100,
        phaseAVerifiedExisting: 0,
      });
      // Phase C main artifact を改竄して preconditionFailed=2, skippedImmutable=3, candidatesIn=7 (= 2 + 2 + 3) にする
      const phaseCMainObj = storage.get(PHASE_C_MAIN)!;
      const phaseCMain = JSON.parse(phaseCMainObj.content) as PhaseCBackfillSummary;
      phaseCMain.candidatesIn = 7;
      phaseCMain.preconditionFailedDocs = 2;
      phaseCMain.skippedImmutable = 3;
      const newContent = JSON.stringify(phaseCMain);
      storage.seed(PHASE_C_MAIN, newContent, phaseCMainObj.generation);
      // manifest の phaseC sha256 も再計算
      const manifestObj = storage.get(MANIFEST_PATH)!;
      const manifest = JSON.parse(manifestObj.content) as BackfillManifest;
      manifest.phaseC!.mainArtifact.sha256 = sha256Hex(newContent);
      storage.seed(MANIFEST_PATH, JSON.stringify(manifest), manifestObj.generation);

      const result = await runPhaseD({
        env: 'dev',
        runId: RUN_ID,
        artifactBucketName: ARTIFACT_BUCKET,
        manifestPath: MANIFEST_PATH,
        artifactReader: storage.reader,
        artifactWriter: storage.writer,
        docReader: new FakeDocReader(seeded.observedMap),
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
        rotateGateFixtureEnabled: false,
        verifyStartedAt: '2026-05-15T03:00:00.000Z',
      });
      // 分母 = candidatesIn = 7 (writtenDocs=2 ではない)
      expect(result.coverageRatio.backfillAttemptCoverage.denominator).to.equal(7);
      // derivedBytesVerified = 2 / 7
      expect(result.coverageRatio.backfillAttemptCoverage.derivedBytesVerified).to.be.closeTo(2 / 7, 0.001);
      // preconditionFailed = 2 / 7
      expect(result.coverageRatio.backfillAttemptCoverage.preconditionFailed).to.be.closeTo(2 / 7, 0.001);
      // immutableSkipped = 3 / 7
      expect(result.coverageRatio.backfillAttemptCoverage.immutableSkipped).to.be.closeTo(3 / 7, 0.001);
    });
  });

  describe('manifest CAS 失敗 (Codex 8th Important 3)', () => {
    it('CAS 失敗時 manifestUpdateStatus="failed" + finalize status file 書込', async () => {
      const storage = new FakeInMemoryStorage();
      const candidates = [makeCandidate('doc1', 'derived-bytes-verified')];
      const seeded = seedArtifacts(storage, {
        candidates,
        phaseATotalDocs: 10,
        phaseAVerifiedExisting: 0,
      });
      storage.failManifestCAS = true;
      const result = await runPhaseD({
        env: 'dev',
        runId: RUN_ID,
        artifactBucketName: ARTIFACT_BUCKET,
        manifestPath: MANIFEST_PATH,
        artifactReader: storage.reader,
        artifactWriter: storage.writer,
        docReader: new FakeDocReader(seeded.observedMap),
        backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
        rotateGateFixtureEnabled: false,
        verifyStartedAt: '2026-05-15T03:00:00.000Z',
      });
      expect(result.manifestUpdateStatus).to.equal('failed');
      // finalize status file は書込まれている
      const statusObj = storage.get(result.finalizeStatusPath);
      expect(statusObj).to.not.be.undefined;
      const status = JSON.parse(statusObj!.content);
      expect(status.manifestUpdateStatus).to.equal('failed');
      expect(status.remediation).to.match(/CAS failed/i);
    });
  });
});
