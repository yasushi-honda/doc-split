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
  PhaseCOutOfScopeDoc,
  PhaseCPreconditionFailedDoc,
  PhaseCRateLimiterConfig,
  PhaseCUnprocessableDoc,
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
  unprocessableDocs: PhaseCUnprocessableDoc[];
  outOfScopeDocs: PhaseCOutOfScopeDoc[];
}

/**
 * 1 chunk 書込 (orchestrator が per-chunk flush で呼ぶ)。
 * Codex 5th I3 反映: chunk docCount は全カテゴリ合計 (BF22 artifact 完全性、運用者が
 * 「この chunk で扱った全 doc 数」を pointer 単独で把握可能)。
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
    unprocessableDocs: input.unprocessableDocs,
    outOfScopeDocs: input.outOfScopeDocs,
  };
  const chunkContent = JSON.stringify(chunkBody);
  const chunkPath = buildObjectPath(
    input.bucketName,
    input.runId,
    `phase-c-backfill-summary-chunk-${input.chunkIndex}.json`
  );
  await writer.writeJson(chunkPath, chunkContent);
  const totalDocCount =
    input.writtenDocs.length +
    input.preconditionFailedDocs.length +
    input.immutableSkippedDocs.length +
    input.unprocessableDocs.length +
    input.outOfScopeDocs.length;
  return {
    path: chunkPath,
    sha256: sha256Hex(chunkContent),
    docCount: totalDocCount,
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
  /** Codex 5th C2 反映: missing / validation 不能 doc の集計 */
  unprocessableDocs: number;
  /** Codex 5th C1 反映: hard-gate で除外された Phase C スコープ外 doc の集計 */
  outOfScopeDocs: number;
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
    unprocessableDocs: input.unprocessableDocs,
    outOfScopeDocs: input.outOfScopeDocs,
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
