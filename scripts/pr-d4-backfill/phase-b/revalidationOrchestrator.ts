/**
 * Issue #445 PR-D4 S1-3: Phase B orchestrator (write-free preflight revalidation).
 *
 * Phase A artifact streaming read → 各 candidate に drift 検出 + child revalidation +
 * MatchedByHash の parent 再 split verify → 結果を per-chunk flush (BF22)。
 *
 * 処理フロー (impl-plan §4.2):
 *   1. Phase A manifest 読込 + main artifact 整合性検証 (artifactReader.eager init)
 *   2. 各 PhaseACandidate を AsyncIterable で streaming consume
 *   3. category === 'MatchedByHash' 以外 → skippedNonMatchedByHash++ で continue
 *   4. Firestore _updateTime 再 fetch (createdAt 取得を兼ねる)
 *   5. child object download + sha256 計算 (revalidateChildObject)
 *   6. drift 検出 (detectDrift)
 *      - 検出 → driftSkipped 対応カウンタ++ で continue
 *   7. parent download + 再 split + verify (verifyParentReSplit)
 *      - parentSha256MatchedAtBackfill=false → verifyFailedMatchedByHash++ で continue
 *      - parent 不在 → verifyFailedMatchedByHash++ で continue (本番 Phase C 対象外)
 *   8. PhaseBRevalidatedCandidate を per-chunk buffer に追加、満杯時 flush
 *   9. 全 candidate 処理後、残 buffer flush + finalize (main + manifest)
 */

import type {
  ArtifactChunkPointer,
  BackfillEnvName,
  PhaseBDriftSkipped,
  PhaseBRevalidatedCandidate,
} from '../types';
import { PR_D4_CANDIDATES_PER_CHUNK } from '../types';
import {
  readPhaseAArtifact,
  type ArtifactStorageReader,
} from './artifactReader';
import { detectDrift } from './driftDetector';
import {
  revalidateChildObject,
  type ChildObjectDownloader,
} from './childRevalidator';
import {
  verifyParentReSplit,
  type ParentObjectDownloader,
} from './parentReSplitVerifier';
import {
  writePhaseBChunk,
  finalizePhaseBArtifact,
} from './artifactWriter';
import type { ArtifactStorageWriter } from '../phase-a/artifactWriter';

/**
 * Firestore re-read: updateTime + createdAt を返す。createdAt は ADR Critical 2 反映で
 * provenance.createdAt = document.createdAt 由来 (split 完了時刻) として記録する。
 */
export interface FirestoreReReader {
  fetchDoc(
    docId: string
  ): Promise<{ updateTimeIso: string; createdAtIso: string } | null>;
}

export interface RunPhaseBInput {
  env: BackfillEnvName;
  runId: string;
  /** artifact 保存 bucket (Phase A と同一 = manifest 共有) */
  artifactBucketName: string;
  /** Phase A manifest path */
  manifestPath: string;
  artifactReader: ArtifactStorageReader;
  artifactWriter: ArtifactStorageWriter;
  firestoreReReader: FirestoreReReader;
  childDownloader: ChildObjectDownloader;
  parentDownloader: ParentObjectDownloader;
  /** production data bucket name (provenance.sourceBucket 記録用) */
  productionDataBucketName: string;
  revalidationStartedAt: string;
  /** テスト用 clock (省略時 system clock) */
  nowProvider?: () => string;
}

export interface RunPhaseBResult {
  mainArtifactPath: string;
  manifestPath: string;
  candidatesIn: number;
  candidatesOut: number;
  driftSkipped: PhaseBDriftSkipped;
  verifyFailedMatchedByHash: number;
  skippedNonMatchedByHash: number;
  revalidationCompletedAt: string;
}

function initDriftSkipped(): PhaseBDriftSkipped {
  return {
    firestoreUpdateTimeChanged: 0,
    childGenerationChanged: 0,
    parentGenerationChanged: 0,
  };
}

export async function runPhaseB(input: RunPhaseBInput): Promise<RunPhaseBResult> {
  const stream = await readPhaseAArtifact({
    manifestPath: input.manifestPath,
    reader: input.artifactReader,
  });
  const existingManifest = stream.manifest;

  let skippedNonMatchedByHash = 0;
  let verifyFailedMatchedByHash = 0;
  const driftSkipped = initDriftSkipped();
  let candidatesIn = 0;
  let candidatesOut = 0;

  const chunkPointers: ArtifactChunkPointer[] = [];
  let buffer: PhaseBRevalidatedCandidate[] = [];
  let chunkIndex = 0;

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;
    const pointer = await writePhaseBChunk(
      {
        bucketName: input.artifactBucketName,
        runId: input.runId,
        chunkIndex,
        candidates: buffer,
      },
      input.artifactWriter
    );
    chunkPointers.push(pointer);
    chunkIndex++;
    buffer = [];
  }

  for await (const candidate of stream.candidates()) {
    candidatesIn++;

    if (candidate.category !== 'MatchedByHash') {
      skippedNonMatchedByHash++;
      continue;
    }

    // Firestore re-fetch (updateTime + createdAt)。
    // fsRead === null = doc 不在 or createdAt 不在 (silent epoch 防止、evaluator HIGH 1)
    const fsRead = await input.firestoreReReader.fetchDoc(candidate.docId);
    if (fsRead === null) {
      driftSkipped.firestoreUpdateTimeChanged++;
      continue;
    }

    // child revalidate (download + sha256)
    const childResult = await revalidateChildObject({
      childObjectPath: candidate.childObjectPath,
      downloader: input.childDownloader,
    });
    const currentChildGeneration = childResult.exists ? childResult.derivedGeneration : null;
    const currentChildMetageneration = childResult.exists ? childResult.derivedMetageneration : null;

    // parent metadata HEAD のみ (drift 検出 → 不一致なら parent bytes download スキップ、Codex MCP Important 反映)
    const parentMeta = candidate.parentObjectPath
      ? await input.parentDownloader.getMetadataOnly(candidate.parentObjectPath)
      : null;
    const currentParentGeneration = parentMeta?.generation ?? null;
    const currentParentMetageneration = parentMeta?.metageneration ?? null;

    // drift 検出 (parent bytes download 前)
    const drift = detectDrift({
      phaseA: {
        firestoreUpdateTime: candidate.firestoreUpdateTime,
        childGeneration: candidate.childGeneration,
        childMetageneration: candidate.childMetageneration,
        parentGeneration: candidate.parentGeneration,
        parentMetageneration: candidate.parentMetageneration,
      },
      current: {
        firestoreUpdateTime: fsRead.updateTimeIso,
        childGeneration: currentChildGeneration,
        childMetageneration: currentChildMetageneration,
        parentGeneration: currentParentGeneration,
        parentMetageneration: currentParentMetageneration,
      },
    });

    if (drift.kind !== 'no-drift') {
      driftSkipped[drift.kind]++;
      continue;
    }

    // child 不在 (orphan) は parent verify せず verifyFailed に分類
    if (!childResult.exists) {
      verifyFailedMatchedByHash++;
      continue;
    }

    // drift なし + child 存在 → parent bytes download + re-split verify
    const parentResult = await verifyParentReSplit({
      parentObjectPath: candidate.parentObjectPath,
      splitFromPages: candidate.splitFromPages,
      childBytes: childResult.bytes,
      downloader: input.parentDownloader,
    });

    if (!parentResult.parentExists || !parentResult.parentSha256MatchedAtBackfill) {
      verifyFailedMatchedByHash++;
      continue;
    }

    // MatchedByHash + drift なし + parent 再 split 一致 → derived-bytes-verified
    const revalidated: PhaseBRevalidatedCandidate = {
      docId: candidate.docId,
      category: 'MatchedByHash',
      computedConfidence: 'derived-bytes-verified',
      computedProvenance: {
        sourceGeneration: parentResult.sourceGeneration,
        sourceMetageneration: parentResult.sourceMetageneration,
        sourceSha256: parentResult.sourceSha256,
        sourcePath: candidate.parentObjectPath!,
        sourceBucket: input.productionDataBucketName,
        derivedObjectPath: candidate.childObjectPath!,
        derivedGeneration: childResult.derivedGeneration,
        derivedMetageneration: childResult.derivedMetageneration,
        derivedSha256: childResult.derivedSha256,
        createdAt: fsRead.createdAtIso,
      },
      evidence: {
        parentExists: true,
        parentSha256MatchedAtBackfill: true,
        childSha256ComputedAtBackfill: true,
      },
    };

    buffer.push(revalidated);
    candidatesOut++;
    if (buffer.length >= PR_D4_CANDIDATES_PER_CHUNK) {
      await flushBuffer();
    }
  }
  await flushBuffer();

  const revalidationCompletedAt = (input.nowProvider ?? (() => new Date().toISOString()))();

  const finalizeResult = await finalizePhaseBArtifact(
    {
      bucketName: input.artifactBucketName,
      runId: input.runId,
      env: input.env,
      revalidationStartedAt: input.revalidationStartedAt,
      revalidationCompletedAt,
      phaseAArtifactRef: stream.phaseAArtifactRef,
      phaseAManifestSha256: stream.phaseAManifestSha256,
      candidatesIn,
      candidatesOut,
      driftSkipped,
      verifyFailedMatchedByHash,
      skippedNonMatchedByHash,
      chunks: chunkPointers,
      existingManifest,
      manifestGeneration: stream.manifestGeneration,
    },
    input.artifactWriter
  );

  return {
    mainArtifactPath: finalizeResult.mainArtifactPath,
    manifestPath: finalizeResult.manifestPath,
    candidatesIn,
    candidatesOut,
    driftSkipped,
    verifyFailedMatchedByHash,
    skippedNonMatchedByHash,
    revalidationCompletedAt,
  };
}
