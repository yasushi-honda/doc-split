/**
 * Issue #445 PR-D4 S1-3: Phase B artifact writer (per-chunk flush + main + manifest 追記).
 *
 * 構造は Phase A writer と類似。Phase B 専用の schema を扱う。
 * manifest.json は既存 Phase A 内容を保持しつつ phaseB section を additive で追記する
 * (caller が existingManifest を渡し、本 module が phaseB section を上書き)。
 *
 * 書込順: chunks (orchestrator が per-chunk flush) → main → manifest。
 */

import * as crypto from 'crypto';
import type {
  ArtifactChunkPointer,
  BackfillEnvName,
  BackfillManifest,
  PhaseBDriftSkipped,
  PhaseBRevalidatedCandidate,
  PhaseBRevalidatedChunk,
  PhaseBRevalidationSummary,
} from '../types';
import { PR_D4_ARTIFACT_SCHEMA_VERSION, PR_D4_SCRIPT_VERSION } from '../types';
import type { ArtifactStorageWriter } from '../phase-a/artifactWriter';

export type { ArtifactStorageWriter } from '../phase-a/artifactWriter';
export type { WrittenObject } from '../phase-a/artifactWriter';

export interface WritePhaseBChunkInput {
  bucketName: string;
  runId: string;
  chunkIndex: number;
  candidates: PhaseBRevalidatedCandidate[];
}

export interface FinalizePhaseBInput {
  bucketName: string;
  runId: string;
  env: BackfillEnvName;
  revalidationStartedAt: string;
  revalidationCompletedAt: string;
  phaseAArtifactRef: string;
  phaseAManifestSha256: string;
  candidatesIn: number;
  candidatesOut: number;
  driftSkipped: PhaseBDriftSkipped;
  verifyFailedMatchedByHash: number;
  skippedNonMatchedByHash: number;
  chunks: ArtifactChunkPointer[];
  /** Phase A 完了時点の manifest (Phase B が phaseB section を追記する) */
  existingManifest: BackfillManifest;
  /**
   * Phase A manifest を read した時点の GCS generation。
   * Phase B finalize で manifest を CAS update する際に precondition として渡す。
   * 0 を指定すると新規 only (Phase A 互換)、>0 で他者上書き検出。
   */
  manifestGeneration: number;
}

export interface FinalizePhaseBResult {
  mainArtifactPath: string;
  manifestPath: string;
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function buildObjectPath(bucketName: string, runId: string, fileName: string): string {
  return `gs://${bucketName}/pr-d4-backfill-artifacts/${runId}/${fileName}`;
}

export async function writePhaseBChunk(
  input: WritePhaseBChunkInput,
  writer: ArtifactStorageWriter
): Promise<ArtifactChunkPointer> {
  const chunkBody: PhaseBRevalidatedChunk = {
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    chunkIndex: input.chunkIndex,
    revalidated: input.candidates,
  };
  const chunkContent = JSON.stringify(chunkBody);
  const chunkPath = buildObjectPath(
    input.bucketName,
    input.runId,
    `phase-b-revalidation-summary-chunk-${input.chunkIndex}.json`
  );
  await writer.writeJson(chunkPath, chunkContent);
  return {
    path: chunkPath,
    sha256: sha256Hex(chunkContent),
    docCount: input.candidates.length,
  };
}

export async function finalizePhaseBArtifact(
  input: FinalizePhaseBInput,
  writer: ArtifactStorageWriter
): Promise<FinalizePhaseBResult> {
  const mainBody: PhaseBRevalidationSummary = {
    phase: 'B',
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    scriptVersion: PR_D4_SCRIPT_VERSION,
    env: input.env,
    runId: input.runId,
    phaseAArtifactRef: input.phaseAArtifactRef,
    phaseAManifestSha256: input.phaseAManifestSha256,
    revalidationStartedAt: input.revalidationStartedAt,
    revalidationCompletedAt: input.revalidationCompletedAt,
    candidatesIn: input.candidatesIn,
    candidatesOut: input.candidatesOut,
    driftSkipped: input.driftSkipped,
    verifyFailedMatchedByHash: input.verifyFailedMatchedByHash,
    skippedNonMatchedByHash: input.skippedNonMatchedByHash,
    chunks: input.chunks,
  };
  const mainContent = JSON.stringify(mainBody);
  const mainPath = buildObjectPath(
    input.bucketName,
    input.runId,
    'phase-b-revalidation-summary.json'
  );
  await writer.writeJson(mainPath, mainContent);

  // existingManifest を base に phaseB を追記 (Phase A の phaseA section は保持)
  const updatedManifest: BackfillManifest = {
    ...input.existingManifest,
    phaseB: {
      mainArtifact: { path: mainPath, sha256: sha256Hex(mainContent) },
      chunks: input.chunks,
    },
  };
  const manifestContent = JSON.stringify(updatedManifest);
  const manifestPath = buildObjectPath(input.bucketName, input.runId, 'manifest.json');
  // manifest は既存 (Phase A が作成済) なので compare-and-swap で update。
  // Phase B 実行中に他者が manifest を書換えていれば 412 fail (artifact 整合性保証)。
  await writer.writeJson(manifestPath, manifestContent, {
    ifGenerationMatch: input.manifestGeneration,
  });

  return { mainArtifactPath: mainPath, manifestPath };
}
