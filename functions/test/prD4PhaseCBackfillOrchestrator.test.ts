/**
 * Issue #445 PR-D4 S1-4: Phase C backfillOrchestrator 統合テスト.
 *
 * lock acquire → Phase B chunk streaming → batchWriter / individualRetryWriter →
 * per-chunk flush → finalize (main + manifest) → lock release の統合動作検証。
 *
 * fake adapters で in-memory に Phase B manifest + chunks を seed して run。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { runPhaseC } from '../../scripts/pr-d4-backfill/phase-c/backfillOrchestrator';
import {
  LockHeldByOthersError,
  type AcquireResult,
  type LockObjectStore,
} from '../../scripts/pr-d4-backfill/phase-c/lockManager';
import type {
  BatchReReadResult,
  BatchUpdateEntry,
  CommitBatchResult,
  FirestoreBatchAdapter,
} from '../../scripts/pr-d4-backfill/phase-c/batchWriter';
import type {
  FirestoreIndividualAdapter,
  IndividualUpdateInput,
  IndividualUpdateResult,
} from '../../scripts/pr-d4-backfill/phase-c/individualRetryWriter';
import type { RateLimiter } from '../../scripts/pr-d4-backfill/phase-c/rateLimiter';
import type {
  ArtifactStorageReader,
} from '../../scripts/pr-d4-backfill/phase-c/artifactReader';
import type { ArtifactStorageWriter } from '../../scripts/pr-d4-backfill/phase-a/artifactWriter';
import type {
  BackfillManifest,
  PhaseBRevalidatedCandidate,
  PhaseBRevalidatedChunk,
  PhaseBRevalidationSummary,
  PhaseCBackfillSummary,
} from '../../scripts/pr-d4-backfill/types';

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

const RUN_ID = '20260515T010000Z-dev-pr-d4-v1';
const ARTIFACT_BUCKET = 'docsplit-dev-pr-d4-artifacts';
const PHASE_B_MAIN_PATH = `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-b-revalidation-summary.json`;
const PHASE_B_CHUNK_PATH_0 = `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-b-revalidation-summary-chunk-0.json`;
const MANIFEST_PATH = `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/manifest.json`;

function buildCandidate(docId: string): PhaseBRevalidatedCandidate {
  return {
    docId,
    category: 'MatchedByHash',
    computedConfidence: 'derived-bytes-verified',
    computedProvenance: {
      sourceGeneration: '1000',
      sourceMetageneration: '1',
      sourceSha256: 'a'.repeat(64),
      sourcePath: 'original/parent.pdf',
      sourceBucket: 'docsplit-dev-storage',
      derivedObjectPath: `processed/${docId}.pdf`,
      derivedGeneration: '2000',
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
}

interface FakeArtifactObject {
  content: string;
  generation: number;
}

class FakeArtifactStorage implements ArtifactStorageReader, ArtifactStorageWriter {
  public objects = new Map<string, FakeArtifactObject>();
  private nextGen = 1;
  public writeCalls: Array<{
    path: string;
    content: string;
    precondition?: { ifGenerationMatch: number };
  }> = [];

  async readJson(path: string): Promise<{ content: string; generation: number }> {
    const obj = this.objects.get(path);
    if (!obj) throw new Error(`object not found: ${path}`);
    return { content: obj.content, generation: obj.generation };
  }

  async writeJson(
    path: string,
    content: string,
    precondition?: { ifGenerationMatch: number }
  ): Promise<void> {
    this.writeCalls.push({ path, content, precondition });
    this.objects.set(path, { content, generation: this.nextGen++ });
  }

  seedPhaseBArtifacts(candidates: PhaseBRevalidatedCandidate[]): void {
    const chunkBody: PhaseBRevalidatedChunk = {
      schemaVersion: 'pr-d4-v1.0',
      chunkIndex: 0,
      revalidated: candidates,
    };
    const chunkContent = JSON.stringify(chunkBody);
    this.objects.set(PHASE_B_CHUNK_PATH_0, { content: chunkContent, generation: this.nextGen++ });

    const mainBody: PhaseBRevalidationSummary = {
      phase: 'B',
      schemaVersion: 'pr-d4-v1.0',
      scriptVersion: 'pr-d4-v1.0',
      env: 'dev',
      runId: RUN_ID,
      phaseAArtifactRef: 'gs://x/phase-a.json',
      phaseAManifestSha256: 'aaa',
      revalidationStartedAt: '2026-05-14T00:00:00.000Z',
      revalidationCompletedAt: '2026-05-14T00:30:00.000Z',
      candidatesIn: candidates.length,
      candidatesOut: candidates.length,
      driftSkipped: {
        firestoreUpdateTimeChanged: 0,
        childGenerationChanged: 0,
        parentGenerationChanged: 0,
      },
      verifyFailedMatchedByHash: 0,
      skippedNonMatchedByHash: 0,
      chunks: [
        {
          path: PHASE_B_CHUNK_PATH_0,
          sha256: sha256Hex(chunkContent),
          docCount: candidates.length,
        },
      ],
    };
    const mainContent = JSON.stringify(mainBody);
    this.objects.set(PHASE_B_MAIN_PATH, { content: mainContent, generation: this.nextGen++ });

    const manifest: BackfillManifest = {
      schemaVersion: 'pr-d4-v1.0',
      runId: RUN_ID,
      env: 'dev',
      phaseA: {
        mainArtifact: { path: 'gs://x/phase-a.json', sha256: 'aaa' },
        chunks: [],
      },
      phaseB: {
        mainArtifact: { path: PHASE_B_MAIN_PATH, sha256: sha256Hex(mainContent) },
        chunks: [
          {
            path: PHASE_B_CHUNK_PATH_0,
            sha256: sha256Hex(chunkContent),
            docCount: candidates.length,
          },
        ],
      },
    };
    const manifestContent = JSON.stringify(manifest);
    this.objects.set(MANIFEST_PATH, {
      content: manifestContent,
      generation: this.nextGen++,
    });
  }
}

class FakeLockStore implements LockObjectStore {
  private objects = new Map<string, { body: string; generation: number }>();
  private nextGen = 1;
  public acquired = 0;
  public released = 0;

  async acquire(input: { path: string; body: string }): Promise<AcquireResult> {
    this.acquired++;
    const existing = this.objects.get(input.path);
    if (existing) {
      return {
        acquired: false,
        existing: { body: existing.body, generation: String(existing.generation) },
      };
    }
    const gen = this.nextGen++;
    this.objects.set(input.path, { body: input.body, generation: gen });
    return { acquired: true, generation: String(gen) };
  }

  async release(input: { path: string; acquiredGeneration: string }): Promise<void> {
    this.released++;
    const obj = this.objects.get(input.path);
    if (!obj) throw new Error('lock not found');
    if (String(obj.generation) !== input.acquiredGeneration) throw new Error('gen mismatch');
    this.objects.delete(input.path);
  }

  seedExistingLock(path: string, body: string): void {
    this.objects.set(path, { body, generation: this.nextGen++ });
  }
}

class FakeBatchAdapter implements FirestoreBatchAdapter {
  public commitCalls = 0;
  public commitBehavior: 'ok' | 'batch-failed' = 'ok';
  async reReadForBatch(docIds: string[]): Promise<Map<string, BatchReReadResult>> {
    const m = new Map<string, BatchReReadResult>();
    for (const id of docIds) {
      m.set(id, {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });
    }
    return m;
  }
  async commitBatch(entries: BatchUpdateEntry[]): Promise<CommitBatchResult> {
    this.commitCalls++;
    if (this.commitBehavior === 'batch-failed') {
      return { kind: 'batch-failed', reason: 'precondition', message: 'drift' };
    }
    return {
      kind: 'ok',
      writeResults: entries.map((e) => ({
        docId: e.docId,
        updateTime: '2026-05-15T01:00:00.000Z',
      })),
    };
  }
}

class FakeIndividualAdapter implements FirestoreIndividualAdapter {
  public calls = 0;
  public behavior: 'ok' | 'all-precondition-failed' = 'ok';
  async updateOne(_input: IndividualUpdateInput): Promise<IndividualUpdateResult> {
    this.calls++;
    if (this.behavior === 'all-precondition-failed') {
      return { kind: 'precondition-failed' };
    }
    return { kind: 'ok', updateTime: '2026-05-15T01:00:00.000Z' };
  }
}

class FakeRateLimiter implements RateLimiter {
  public calls: number[] = [];
  async acquire(tokens: number = 1): Promise<void> {
    this.calls.push(tokens);
  }
}

function buildRunInput(deps: {
  storage: FakeArtifactStorage;
  lock: FakeLockStore;
  batch: FakeBatchAdapter;
  individual: FakeIndividualAdapter;
  rateLimiter: RateLimiter;
}): Parameters<typeof runPhaseC>[0] {
  let nowCallCount = 0;
  return {
    env: 'dev',
    runId: RUN_ID,
    jobId: 'job-001',
    lockOwner: 'github-actions-run-100',
    artifactBucketName: ARTIFACT_BUCKET,
    manifestPath: MANIFEST_PATH,
    artifactReader: deps.storage,
    artifactWriter: deps.storage,
    lockStore: deps.lock,
    batchAdapter: deps.batch,
    individualAdapter: deps.individual,
    rateLimiter: deps.rateLimiter,
    rateLimiterConfig: { tokensPerSecond: 100, burstCapacity: 100 },
    backfillScriptVersion: 'pr-d4-v1.0',
    expectedDurationSec: 3600,
    nowProvider: () => {
      // started → released で 2 種類の時刻を返す
      const times = ['2026-05-15T00:00:00.000Z', '2026-05-15T00:30:00.000Z'];
      const t = times[Math.min(nowCallCount, times.length - 1)];
      nowCallCount++;
      return t;
    },
    backfilledAtProvider: () => Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
  };
}

describe('runPhaseC orchestrator (PR-D4 S1-4 統合)', () => {
  it('happy path: 5 docs を全件書込し、main + manifest + chunk が出力される + lock release', async () => {
    const storage = new FakeArtifactStorage();
    const lock = new FakeLockStore();
    const batch = new FakeBatchAdapter();
    const individual = new FakeIndividualAdapter();
    const rateLimiter = new FakeRateLimiter();
    const candidates = Array.from({ length: 5 }, (_, i) => buildCandidate(`d${i}`));
    storage.seedPhaseBArtifacts(candidates);

    const result = await runPhaseC(
      buildRunInput({ storage, lock, batch, individual, rateLimiter })
    );

    expect(result.candidatesIn).to.equal(5);
    expect(result.writtenDocs).to.equal(5);
    expect(result.preconditionFailedDocs).to.equal(0);
    expect(result.skippedImmutable).to.equal(0);
    expect(lock.acquired).to.equal(1);
    expect(lock.released).to.equal(1);
    expect(batch.commitCalls).to.equal(1);
    expect(individual.calls).to.equal(0);

    // main + chunk + manifest が書込まれている
    const mainObj = storage.writeCalls.find((c) =>
      c.path.includes('phase-c-backfill-summary.json')
    );
    expect(mainObj).to.exist;
    const main: PhaseCBackfillSummary = JSON.parse(mainObj!.content);
    expect(main.phase).to.equal('C');
    expect(main.writtenDocs).to.equal(5);
    expect(main.lockAcquiredGeneration).to.equal(result.lockAcquiredGeneration);

    const manifestWrite = storage.writeCalls.find((c) =>
      c.path.endsWith('/manifest.json')
    );
    expect(manifestWrite).to.exist;
    expect(manifestWrite!.precondition).to.exist;
  });

  it('既存 lock 検出 → LockHeldByOthersError throw (Phase B artifact は読まない、別 owner lock は解放されない)', async () => {
    const storage = new FakeArtifactStorage();
    const lock = new FakeLockStore();
    const batch = new FakeBatchAdapter();
    const individual = new FakeIndividualAdapter();
    const rateLimiter = new FakeRateLimiter();
    // Phase B seed なし (orchestrator が manifest 読みに行く前で abort することを検証)
    lock.seedExistingLock(
      `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-locks/dev-phase-c.lock`,
      JSON.stringify({
        lockSchemaVersion: 'pr-d4-v1.0',
        runId: 'older',
        jobId: 'older-job',
        startedAt: '2026-05-14T00:00:00.000Z',
        expectedDurationSec: 3600,
        lockOwner: 'github-actions-run-1',
      })
    );
    let err: Error | null = null;
    try {
      await runPhaseC(buildRunInput({ storage, lock, batch, individual, rateLimiter }));
    } catch (e) {
      err = e as Error;
    }
    expect(err).to.be.instanceOf(LockHeldByOthersError);
    expect(batch.commitCalls).to.equal(0);
    // acquire 失敗時は orchestrator の try ブロックに入らない → release も呼ばれない
    // (= 別 owner の lock が誤って解放されないことを構造的に保証、code-reviewer #5 反映)
    expect(lock.released).to.equal(0);
  });

  it('batch 失敗 → fallback individual update で 5 件書込', async () => {
    const storage = new FakeArtifactStorage();
    const lock = new FakeLockStore();
    const batch = new FakeBatchAdapter();
    batch.commitBehavior = 'batch-failed';
    const individual = new FakeIndividualAdapter();
    const rateLimiter = new FakeRateLimiter();
    const candidates = Array.from({ length: 5 }, (_, i) => buildCandidate(`d${i}`));
    storage.seedPhaseBArtifacts(candidates);

    const result = await runPhaseC(
      buildRunInput({ storage, lock, batch, individual, rateLimiter })
    );
    expect(result.writtenDocs).to.equal(5);
    expect(result.preconditionFailedDocs).to.equal(0);
    expect(batch.commitCalls).to.equal(1);
    expect(individual.calls).to.equal(5); // fallback 5 docs
  });

  it('全 fallback 失敗 → preconditionFailedDocs 集計反映', async () => {
    const storage = new FakeArtifactStorage();
    const lock = new FakeLockStore();
    const batch = new FakeBatchAdapter();
    batch.commitBehavior = 'batch-failed';
    const individual = new FakeIndividualAdapter();
    individual.behavior = 'all-precondition-failed';
    const rateLimiter = new FakeRateLimiter();
    const candidates = Array.from({ length: 3 }, (_, i) => buildCandidate(`d${i}`));
    storage.seedPhaseBArtifacts(candidates);

    const result = await runPhaseC(
      buildRunInput({ storage, lock, batch, individual, rateLimiter })
    );
    expect(result.writtenDocs).to.equal(0);
    expect(result.preconditionFailedDocs).to.equal(3);
  });

  it('candidates=[] でも lock acquire → release + 空 chunk なしで finalize 完了', async () => {
    const storage = new FakeArtifactStorage();
    const lock = new FakeLockStore();
    const batch = new FakeBatchAdapter();
    const individual = new FakeIndividualAdapter();
    const rateLimiter = new FakeRateLimiter();
    storage.seedPhaseBArtifacts([]);

    const result = await runPhaseC(
      buildRunInput({ storage, lock, batch, individual, rateLimiter })
    );
    expect(result.candidatesIn).to.equal(0);
    expect(result.writtenDocs).to.equal(0);
    expect(lock.released).to.equal(1);
    expect(batch.commitCalls).to.equal(0);
  });

  it('保全式: candidatesIn = writtenDocs + preconditionFailedDocs + skippedImmutable + unprocessableDocs + outOfScopeDocs (Evaluator HIGH 反映)', async () => {
    const storage = new FakeArtifactStorage();
    const lock = new FakeLockStore();
    const batch = new FakeBatchAdapter();
    const individual = new FakeIndividualAdapter();
    const rateLimiter = new FakeRateLimiter();
    const candidates = Array.from({ length: 5 }, (_, i) => buildCandidate(`d${i}`));
    storage.seedPhaseBArtifacts(candidates);

    const result = await runPhaseC(
      buildRunInput({ storage, lock, batch, individual, rateLimiter })
    );
    expect(
      result.writtenDocs +
        result.preconditionFailedDocs +
        result.skippedImmutable +
        result.unprocessableDocs +
        result.outOfScopeDocs
    ).to.equal(result.candidatesIn);
  });

  it('out-of-scope hard-gate (Codex 5th C1): Phase B の異種 candidate は outOfScopeDocs に記録され Firestore 書込なし', async () => {
    const storage = new FakeArtifactStorage();
    const lock = new FakeLockStore();
    const batch = new FakeBatchAdapter();
    const individual = new FakeIndividualAdapter();
    const rateLimiter = new FakeRateLimiter();
    // 1 doc を out-of-scope (Ambiguous + child-snapshot-only) で混入
    const outOfScope = buildCandidate('amb-1');
    outOfScope.category = 'Ambiguous';
    outOfScope.computedConfidence = 'child-snapshot-only';
    const candidates = [buildCandidate('ok-1'), outOfScope, buildCandidate('ok-2')];
    storage.seedPhaseBArtifacts(candidates);

    const result = await runPhaseC(
      buildRunInput({ storage, lock, batch, individual, rateLimiter })
    );
    expect(result.candidatesIn).to.equal(3);
    expect(result.writtenDocs).to.equal(2); // ok-1 + ok-2
    expect(result.outOfScopeDocs).to.equal(1);
    expect(result.preconditionFailedDocs).to.equal(0);
    // 保全式
    expect(
      result.writtenDocs +
        result.preconditionFailedDocs +
        result.skippedImmutable +
        result.unprocessableDocs +
        result.outOfScopeDocs
    ).to.equal(result.candidatesIn);
  });

  it('lock 順序: finalize → release (Codex 6th Critical 反映、release 前の finalize で artifact 整合性保証)', async () => {
    const storage = new FakeArtifactStorage();
    const lock = new FakeLockStore();
    const batch = new FakeBatchAdapter();
    const individual = new FakeIndividualAdapter();
    const rateLimiter = new FakeRateLimiter();
    storage.seedPhaseBArtifacts([buildCandidate('d1')]);

    // storage write 履歴と lock release の順序を観測
    const eventOrder: string[] = [];
    const origRelease = lock.release.bind(lock);
    lock.release = async (input) => {
      eventOrder.push('lock-released');
      return origRelease(input);
    };
    const origWriteJson = storage.writeJson.bind(storage);
    storage.writeJson = async (path, content, precondition) => {
      if (path.includes('manifest.json')) eventOrder.push('manifest-written');
      else if (path.includes('phase-c-backfill-summary.json')) {
        eventOrder.push('main-artifact-written');
      }
      return origWriteJson(path, content, precondition);
    };

    await runPhaseC(buildRunInput({ storage, lock, batch, individual, rateLimiter }));
    // 順序: main artifact → manifest → release (release は finalize 後)
    expect(eventOrder).to.deep.equal([
      'main-artifact-written',
      'manifest-written',
      'lock-released',
    ]);
  });

  it('既存 provenanceBackfill (= already backfilled) → skipReason "already backfilled" で skip (Codex 6th Important 反映)', async () => {
    const storage = new FakeArtifactStorage();
    const lock = new FakeLockStore();
    const batch = new FakeBatchAdapter();
    const individual = new FakeIndividualAdapter();
    const rateLimiter = new FakeRateLimiter();
    storage.seedPhaseBArtifacts([buildCandidate('already-bf')]);
    // 既 backfilled snapshot を返すよう adapter を上書き
    const origReRead = batch.reReadForBatch.bind(batch);
    batch.reReadForBatch = async (docIds) => {
      const m = await origReRead(docIds);
      m.set('already-bf', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: { sourceSha256: 'x' },
        provenanceBackfill: { method: 'legacy-observed', confidence: 'derived-bytes-verified' },
      });
      return m;
    };

    const result = await runPhaseC(buildRunInput({ storage, lock, batch, individual, rateLimiter }));
    expect(result.writtenDocs).to.equal(0);
    expect(result.skippedImmutable).to.equal(1);
    expect(batch.commitCalls).to.equal(0); // immutable skip で commit 不要
  });
});
