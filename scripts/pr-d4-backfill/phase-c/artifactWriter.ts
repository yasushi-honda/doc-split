/**
 * Issue #445 PR-D4 S1-4: Phase C artifact writer (BF22 chunking + manifest CAS update).
 *
 * impl-plan §4.3 step 6 + Codex 2nd BF19 / 3rd BF22 反映:
 *   phase-c-backfill-summary.json (main) + chunks (writtenDocs / preconditionFailedDocs /
 *   immutableSkippedDocs) + manifest.json の phaseC section CAS update。
 *
 * 構造は Phase A/B writer と一貫。manifest update は existingManifest を base にして
 * phaseC を additive で追記、ifGenerationMatch precondition 付き。
 */

import * as crypto from 'crypto';
import type { ArtifactStorageWriter } from '../phase-a/artifactWriter';
import type {
  ArtifactChunkPointer,
  BackfillEnvName,
  BackfillManifest,
  PhaseCBackfillChunk,
  PhaseCBackfillSummary,
  PhaseCImmutableSkippedDoc,
  PhaseCPreconditionFailedDoc,
  PhaseCRateLimiterConfig,
  PhaseCWrittenDoc,
} from '../types';
import { PR_D4_ARTIFACT_SCHEMA_VERSION, PR_D4_SCRIPT_VERSION } from '../types';

export type { ArtifactStorageWriter } from '../phase-a/artifactWriter';

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function buildObjectPath(bucketName: string, runId: string, fileName: string): string {
  return `gs://${bucketName}/pr-d4-backfill-artifacts/${runId}/${fileName}`;
}

export interface WritePhaseCChunkInput {
  bucketName: string;
  runId: string;
  chunkIndex: number;
  writtenDocs: PhaseCWrittenDoc[];
  preconditionFailedDocs: PhaseCPreconditionFailedDoc[];
  immutableSkippedDocs: PhaseCImmutableSkippedDoc[];
}

/**
 * 1 chunk 書込 (orchestrator が per-chunk flush で呼ぶ)。
 * chunk の docCount は writtenDocs.length を採用 (Phase A/B と同じ意味論)。
 * precondition / immutable skipped 件数は main artifact の集計値で別途記録される。
 */
export async function writePhaseCChunk(
  input: WritePhaseCChunkInput,
  writer: ArtifactStorageWriter
): Promise<ArtifactChunkPointer> {
  const chunkBody: PhaseCBackfillChunk = {
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    chunkIndex: input.chunkIndex,
    writtenDocs: input.writtenDocs,
    preconditionFailedDocs: input.preconditionFailedDocs,
    immutableSkippedDocs: input.immutableSkippedDocs,
  };
  const chunkContent = JSON.stringify(chunkBody);
  const chunkPath = buildObjectPath(
    input.bucketName,
    input.runId,
    `phase-c-backfill-summary-chunk-${input.chunkIndex}.json`
  );
  await writer.writeJson(chunkPath, chunkContent);
  return {
    path: chunkPath,
    sha256: sha256Hex(chunkContent),
    docCount: input.writtenDocs.length,
  };
}

export interface FinalizePhaseCInput {
  bucketName: string;
  runId: string;
  env: BackfillEnvName;
  backfillStartedAt: string;
  backfillCompletedAt: string;
  phaseBArtifactRef: string;
  phaseBManifestSha256: string;
  candidatesIn: number;
  writtenDocs: number;
  preconditionFailedDocs: number;
  skippedImmutable: number;
  lockAcquiredGeneration: string;
  lockReleasedAt: string;
  rateLimiterConfig: PhaseCRateLimiterConfig;
  chunks: ArtifactChunkPointer[];
  /** Phase B 完了時点の manifest (Phase C で phaseC section を追記) */
  existingManifest: BackfillManifest;
  /**
   * existingManifest を read した時点の GCS generation。
   * Phase C finalize で manifest を CAS update する precondition。
   */
  manifestGeneration: number;
}

export interface FinalizePhaseCResult {
  mainArtifactPath: string;
  manifestPath: string;
}

export async function finalizePhaseCArtifact(
  input: FinalizePhaseCInput,
  writer: ArtifactStorageWriter
): Promise<FinalizePhaseCResult> {
  const mainBody: PhaseCBackfillSummary = {
    phase: 'C',
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    scriptVersion: PR_D4_SCRIPT_VERSION,
    env: input.env,
    runId: input.runId,
    phaseBArtifactRef: input.phaseBArtifactRef,
    phaseBManifestSha256: input.phaseBManifestSha256,
    backfillStartedAt: input.backfillStartedAt,
    backfillCompletedAt: input.backfillCompletedAt,
    candidatesIn: input.candidatesIn,
    writtenDocs: input.writtenDocs,
    preconditionFailedDocs: input.preconditionFailedDocs,
    skippedImmutable: input.skippedImmutable,
    lockAcquiredGeneration: input.lockAcquiredGeneration,
    lockReleasedAt: input.lockReleasedAt,
    rateLimiterConfig: input.rateLimiterConfig,
    chunks: input.chunks,
  };
  const mainContent = JSON.stringify(mainBody);
  const mainPath = buildObjectPath(
    input.bucketName,
    input.runId,
    'phase-c-backfill-summary.json'
  );
  await writer.writeJson(mainPath, mainContent);

  const updatedManifest: BackfillManifest = {
    ...input.existingManifest,
    phaseC: {
      mainArtifact: { path: mainPath, sha256: sha256Hex(mainContent) },
      chunks: input.chunks,
    },
  };
  const manifestContent = JSON.stringify(updatedManifest);
  const manifestPath = buildObjectPath(input.bucketName, input.runId, 'manifest.json');
  await writer.writeJson(manifestPath, manifestContent, {
    ifGenerationMatch: input.manifestGeneration,
  });

  return { mainArtifactPath: mainPath, manifestPath };
}
