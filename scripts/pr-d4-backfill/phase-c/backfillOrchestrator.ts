/**
 * Issue #445 PR-D4 S1-4: Phase C orchestrator (atomic backfill verified docs).
 *
 * Phase B artifact streaming read → 各 candidate を ≤20 docs/batch にまとめて
 * processBatch → 失敗時 processFallback → writtenDocs / preconditionFailedDocs /
 * immutableSkippedDocs を per-chunk flush → finalize (main + manifest CAS) → lock 解放。
 *
 * 処理フロー (impl-plan §4.3):
 *   1. lock acquire (lockManager) → existing lock 検出で即 abort
 *   2. Phase B manifest 読込 + sha256 verify (artifactReader)
 *   3. candidates AsyncIterable を for-await で消費し PR_D4_PHASE_C_BATCH_SIZE で grouping
 *   4. processBatch (skip + commit)
 *   5. outcome=batch-failed → processFallback (個別 retry + 隔離)
 *   6. 結果を per-chunk buffer (PR_D4_CANDIDATES_PER_CHUNK 上限) で flush
 *   7. finalize (main + manifest) → lock release
 *
 * lock 解放は finalize 後の最終操作。中断 / error 時は try/catch で best-effort 解放
 * (release 失敗は console.error で運用者通知、元 error を伝播、Codex 2nd 反映)
 */

import { Timestamp } from 'firebase-admin/firestore';
import type {
  ArtifactChunkPointer,
  BackfillEnvName,
  PhaseBRevalidatedCandidate,
  PhaseCImmutableSkippedDoc,
  PhaseCOutOfScopeDoc,
  PhaseCPreconditionFailedDoc,
  PhaseCRateLimiterConfig,
  PhaseCUnprocessableDoc,
  PhaseCWrittenDoc,
} from '../types';
import {
  PR_D4_CANDIDATES_PER_CHUNK,
  PR_D4_PHASE_C_BATCH_SIZE,
} from '../types';
import { readPhaseBArtifact, type ArtifactStorageReader } from './artifactReader';
import { finalizePhaseCArtifact, writePhaseCChunk } from './artifactWriter';
import type { ArtifactStorageWriter } from '../phase-a/artifactWriter';
import {
  processBatch,
  type FirestoreBatchAdapter,
} from './batchWriter';
import {
  processFallback,
  type FirestoreIndividualAdapter,
} from './individualRetryWriter';
import {
  acquirePhaseCLock,
  releasePhaseCLock,
  type LockObjectStore,
} from './lockManager';
import type { RateLimiter } from './rateLimiter';

export interface RunPhaseCInput {
  env: BackfillEnvName;
  runId: string;
  jobId: string;
  lockOwner: string;
  artifactBucketName: string;
  manifestPath: string;
  artifactReader: ArtifactStorageReader;
  artifactWriter: ArtifactStorageWriter;
  lockStore: LockObjectStore;
  batchAdapter: FirestoreBatchAdapter;
  individualAdapter: FirestoreIndividualAdapter;
  rateLimiter: RateLimiter;
  rateLimiterConfig: PhaseCRateLimiterConfig;
  backfillScriptVersion: string;
  expectedDurationSec: number;
  /** test 用 clock (ISO8601 を返す)。省略時 system clock */
  nowProvider?: () => string;
  /**
   * test 用 backfilledAt Timestamp。省略時 nowProvider 由来。
   * run 単位で 1 度生成し全 batch で共有 (観測一貫性)
   */
  backfilledAtProvider?: () => Timestamp;
}

export interface RunPhaseCResult {
  mainArtifactPath: string;
  manifestPath: string;
  /**
   * 保全式: candidatesIn = writtenDocs + preconditionFailedDocs + skippedImmutable +
   *                       unprocessableDocs + outOfScopeDocs (orchestrator が test でアサート)
   */
  candidatesIn: number;
  writtenDocs: number;
  preconditionFailedDocs: number;
  skippedImmutable: number;
  unprocessableDocs: number;
  outOfScopeDocs: number;
  lockAcquiredGeneration: string;
  lockReleasedAt: string;
  backfillCompletedAt: string;
}

function defaultNow(): string {
  return new Date().toISOString();
}

export async function runPhaseC(input: RunPhaseCInput): Promise<RunPhaseCResult> {
  const nowProvider = input.nowProvider ?? defaultNow;
  const backfilledAtProvider =
    input.backfilledAtProvider ?? (() => Timestamp.fromDate(new Date(nowProvider())));

  const backfillStartedAt = nowProvider();
  const backfilledAt = backfilledAtProvider();

  // (1) lock acquire — 既存 lock 検出で LockHeldByOthersError throw、orchestrator は呼出元へ伝播
  const lockAcquired = await acquirePhaseCLock(
    {
      bucketName: input.artifactBucketName,
      env: input.env,
      runId: input.runId,
      jobId: input.jobId,
      startedAt: backfillStartedAt,
      expectedDurationSec: input.expectedDurationSec,
      lockOwner: input.lockOwner,
    },
    input.lockStore
  );

  try {
    // (2) Phase B artifact read + sha256 verify
    const stream = await readPhaseBArtifact({
      manifestPath: input.manifestPath,
      reader: input.artifactReader,
    });
    const existingManifest = stream.manifest;

    let totalCandidatesIn = 0;
    let totalWritten = 0;
    let totalPreconditionFailed = 0;
    let totalImmutableSkipped = 0;
    let totalUnprocessable = 0;
    let totalOutOfScope = 0;

    const chunkPointers: ArtifactChunkPointer[] = [];
    let writtenBuffer: PhaseCWrittenDoc[] = [];
    let preconditionFailedBuffer: PhaseCPreconditionFailedDoc[] = [];
    let immutableSkippedBuffer: PhaseCImmutableSkippedDoc[] = [];
    let unprocessableBuffer: PhaseCUnprocessableDoc[] = [];
    let outOfScopeBuffer: PhaseCOutOfScopeDoc[] = [];
    let chunkIndex = 0;

    /**
     * buffer flush 判定 (全カテゴリ対象):
     *   - forceFlush=true (最終 flush): 残 buffer を空にする
     *   - いずれかの buffer 数が PR_D4_CANDIDATES_PER_CHUNK 以上: 1 chunk 出力
     *   - 全 buffer が空 / forceFlush=true でも 0 件: chunk 出力なし
     */
    async function flushChunkBuffersIfFull(forceFlush = false): Promise<void> {
      const totalBuffered =
        writtenBuffer.length +
        preconditionFailedBuffer.length +
        immutableSkippedBuffer.length +
        unprocessableBuffer.length +
        outOfScopeBuffer.length;
      const shouldFlush =
        forceFlush ||
        writtenBuffer.length >= PR_D4_CANDIDATES_PER_CHUNK ||
        preconditionFailedBuffer.length >= PR_D4_CANDIDATES_PER_CHUNK ||
        immutableSkippedBuffer.length >= PR_D4_CANDIDATES_PER_CHUNK ||
        unprocessableBuffer.length >= PR_D4_CANDIDATES_PER_CHUNK ||
        outOfScopeBuffer.length >= PR_D4_CANDIDATES_PER_CHUNK;
      if (!shouldFlush || totalBuffered === 0) return;
      const pointer = await writePhaseCChunk(
        {
          bucketName: input.artifactBucketName,
          runId: input.runId,
          chunkIndex,
          writtenDocs: writtenBuffer,
          preconditionFailedDocs: preconditionFailedBuffer,
          immutableSkippedDocs: immutableSkippedBuffer,
          unprocessableDocs: unprocessableBuffer,
          outOfScopeDocs: outOfScopeBuffer,
        },
        input.artifactWriter
      );
      chunkPointers.push(pointer);
      chunkIndex++;
      writtenBuffer = [];
      preconditionFailedBuffer = [];
      immutableSkippedBuffer = [];
      unprocessableBuffer = [];
      outOfScopeBuffer = [];
    }

    // (3) batch 単位 grouping (batch size = 20)
    let batchAccumulator: PhaseBRevalidatedCandidate[] = [];

    async function flushBatch(): Promise<void> {
      if (batchAccumulator.length === 0) return;
      const batchResult = await processBatch(
        {
          candidates: batchAccumulator,
          backfillScriptVersion: input.backfillScriptVersion,
          backfilledAt,
        },
        input.batchAdapter,
        input.rateLimiter
      );

      // batch 直前段で除外された immutable / unprocessable / out-of-scope を先に積む
      immutableSkippedBuffer.push(...batchResult.immutableSkippedDocs);
      totalImmutableSkipped += batchResult.immutableSkippedDocs.length;
      unprocessableBuffer.push(...batchResult.unprocessableDocs);
      totalUnprocessable += batchResult.unprocessableDocs.length;
      outOfScopeBuffer.push(...batchResult.outOfScopeDocs);
      totalOutOfScope += batchResult.outOfScopeDocs.length;

      if (batchResult.outcome === 'all-committed') {
        writtenBuffer.push(...batchResult.writtenDocs);
        totalWritten += batchResult.writtenDocs.length;
      } else {
        // (5) batch 失敗 → fallback (immutable / unprocessable / out-of-scope は既に積み済)
        const fallback = await processFallback(
          {
            candidates: batchResult.candidatesForFallback,
            lastUpdateTimePreconditions: batchResult.lastUpdateTimePreconditions,
            backfillScriptVersion: input.backfillScriptVersion,
            backfilledAt,
          },
          input.individualAdapter,
          input.rateLimiter
        );
        writtenBuffer.push(...fallback.writtenDocs);
        totalWritten += fallback.writtenDocs.length;
        preconditionFailedBuffer.push(...fallback.preconditionFailedDocs);
        totalPreconditionFailed += fallback.preconditionFailedDocs.length;
        unprocessableBuffer.push(...fallback.unprocessableDocs);
        totalUnprocessable += fallback.unprocessableDocs.length;
      }

      batchAccumulator = [];
      await flushChunkBuffersIfFull(false);
    }

    for await (const candidate of stream.candidates()) {
      totalCandidatesIn++;
      batchAccumulator.push(candidate);
      if (batchAccumulator.length >= PR_D4_PHASE_C_BATCH_SIZE) {
        await flushBatch();
      }
    }
    // 残 batch flush
    await flushBatch();
    // 残 buffer chunk 出力
    await flushChunkBuffersIfFull(true);

    // Codex 6th Critical 反映: lock release は finalize の **後** に行う。
    // 先に release すると finalize 失敗時に別 run が同 env lock を取得可能になり、
    // 「Firestore writes は committed + manifest.phaseC 未反映」の中途半端な状態が
    // 別 run に観測される (production-unsafe window)。
    //
    // `lockReleasedAt` field は **lock release を要求する直前の時刻** を記録する。
    // 実際の release ACK 後の時刻は別途 `runPhaseC` 戻り値で追加観測することも
    // 可能だが、artifact 完整性 (= lock 保護下で書込まれる) を優先する。
    const backfillCompletedAt = nowProvider();
    const lockReleasedAt = backfillCompletedAt;

    const finalize = await finalizePhaseCArtifact(
      {
        bucketName: input.artifactBucketName,
        runId: input.runId,
        env: input.env,
        backfillStartedAt,
        backfillCompletedAt,
        phaseBArtifactRef: stream.phaseBArtifactRef,
        phaseBManifestSha256: stream.phaseBManifestSha256,
        candidatesIn: totalCandidatesIn,
        writtenDocs: totalWritten,
        preconditionFailedDocs: totalPreconditionFailed,
        skippedImmutable: totalImmutableSkipped,
        unprocessableDocs: totalUnprocessable,
        outOfScopeDocs: totalOutOfScope,
        lockAcquiredGeneration: lockAcquired.acquiredGeneration,
        lockReleasedAt,
        rateLimiterConfig: input.rateLimiterConfig,
        chunks: chunkPointers,
        existingManifest,
        manifestGeneration: stream.manifestGeneration,
      },
      input.artifactWriter
    );

    // finalize 完了後に lock release (Codex 6th Critical 反映)
    await releasePhaseCLock(
      {
        lockPath: lockAcquired.lockPath,
        acquiredGeneration: lockAcquired.acquiredGeneration,
      },
      input.lockStore
    );

    return {
      mainArtifactPath: finalize.mainArtifactPath,
      manifestPath: finalize.manifestPath,
      candidatesIn: totalCandidatesIn,
      writtenDocs: totalWritten,
      preconditionFailedDocs: totalPreconditionFailed,
      skippedImmutable: totalImmutableSkipped,
      unprocessableDocs: totalUnprocessable,
      outOfScopeDocs: totalOutOfScope,
      lockAcquiredGeneration: lockAcquired.acquiredGeneration,
      lockReleasedAt,
      backfillCompletedAt,
    };
  } catch (e) {
    // 中断 / error 時は lock を best-effort で解放 (release 失敗は console.error で
    // 通知、運用者が stale lock 解放手順を runbook 通り実行できるよう支援、Codex 5th I2 反映)。
    try {
      await releasePhaseCLock(
        {
          lockPath: lockAcquired.lockPath,
          acquiredGeneration: lockAcquired.acquiredGeneration,
        },
        input.lockStore
      );
    } catch (releaseErr) {
      console.error(
        `[PR-D4 Phase C] lock release failed during error recovery (lockPath=${lockAcquired.lockPath}, generation=${lockAcquired.acquiredGeneration}):`,
        releaseErr
      );
    }
    throw e;
  }
}
