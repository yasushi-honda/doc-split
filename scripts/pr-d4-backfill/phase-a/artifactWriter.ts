/**
 * Issue #445 PR-D4 S1-2: Phase A artifact writer (streaming chunked GCS write + SHA256 manifest).
 *
 * impl-plan v3.1 §4.1 + BF22 (streaming) を実装する:
 * - chunks: phase-a-classify-summary-chunk-{N}.json (≤ 1000 candidates each)
 * - main artifact: phase-a-classify-summary.json (metadata + chunk pointers)
 * - manifest: manifest.json (cross-phase で additive 追記)
 *
 * 書込順は chunks (streaming, one-at-a-time) → main → manifest。
 * orchestrator は per-chunk buffer (≤ 1000 docs) のみ保持し、全 candidates を一括
 * メモリ保持しない (BF22 厳密適合、Codex MCP NO-GO 反映)。
 *
 * 依存性逆転: ArtifactStorageWriter interface 経由で GCS Bucket を受け取り、unit test
 * は in-memory mock で実行する。
 */

import * as crypto from 'crypto';
import type {
  ArtifactChunkPointer,
  BackfillEnvName,
  BackfillManifest,
  PhaseACandidate,
  PhaseAClassifyChunk,
  PhaseAClassifySummary,
} from '../types';
import {
  PR_D4_ARTIFACT_SCHEMA_VERSION,
  PR_D4_SCRIPT_VERSION,
} from '../types';
import type { BackfillClassifierCategory } from '../../../shared/types';

export interface ArtifactStorageWriter {
  /**
   * `gs://{bucket}/{path}` 形式の path に JSON 文字列を書込む。
   * 実装側で必要に応じて Content-Type 設定 + ifGenerationMatch: 0 (overwrite 禁止) を強制。
   */
  writeJson(objectPath: string, content: string): Promise<void>;
}

/** test 側で書込履歴を assertion するための表現 */
export interface WrittenObject {
  path: string;
  content: string;
}

/**
 * 1 chunk 書込入力 (orchestrator が per-chunk flush で呼び出す)。
 */
export interface WritePhaseAChunkInput {
  bucketName: string;
  runId: string;
  chunkIndex: number;
  candidates: PhaseACandidate[];
}

/**
 * Phase A main artifact + manifest 書込入力 (orchestrator が streaming 完了後に 1 度だけ呼ぶ)。
 */
export interface FinalizePhaseAInput {
  bucketName: string;
  runId: string;
  env: BackfillEnvName;
  snapshotStartedAt: string;
  snapshotCompletedAt: string;
  bucketLocation: string;
  cloudRunJobLocation: string;
  egressFreeAssertion: boolean;
  totalDocs: number;
  categoryDistribution: Record<BackfillClassifierCategory, number>;
  alreadyBackfilled: number;
  verifiedExistingProvenance: number;
  chunks: ArtifactChunkPointer[];
}

export interface FinalizePhaseAResult {
  mainArtifactPath: string;
  manifestPath: string;
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function buildObjectPath(bucketName: string, runId: string, fileName: string): string {
  return `gs://${bucketName}/pr-d4-backfill-artifacts/${runId}/${fileName}`;
}

/**
 * 1 chunk 分の candidates を chunk file に書込み、ArtifactChunkPointer を返す。
 * orchestrator が buffer がフルになった時点 / streaming 完了時の残バッファ flush で呼ぶ。
 */
export async function writePhaseAChunk(
  input: WritePhaseAChunkInput,
  writer: ArtifactStorageWriter
): Promise<ArtifactChunkPointer> {
  const chunkBody: PhaseAClassifyChunk = {
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    chunkIndex: input.chunkIndex,
    candidates: input.candidates,
  };
  const chunkContent = JSON.stringify(chunkBody);
  const chunkPath = buildObjectPath(
    input.bucketName,
    input.runId,
    `phase-a-classify-summary-chunk-${input.chunkIndex}.json`
  );
  await writer.writeJson(chunkPath, chunkContent);
  return {
    path: chunkPath,
    sha256: sha256Hex(chunkContent),
    docCount: input.candidates.length,
  };
}

/**
 * 全 chunk 書込完了後に main artifact + manifest を書込む。consumer が manifest 読めれば
 * 全 file 書込完了 invariant を満たす書込順 (main → manifest)。
 */
export async function finalizePhaseAArtifact(
  input: FinalizePhaseAInput,
  writer: ArtifactStorageWriter
): Promise<FinalizePhaseAResult> {
  const mainBody: PhaseAClassifySummary = {
    phase: 'A',
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    scriptVersion: PR_D4_SCRIPT_VERSION,
    env: input.env,
    runId: input.runId,
    snapshotStartedAt: input.snapshotStartedAt,
    snapshotCompletedAt: input.snapshotCompletedAt,
    bucketLocation: input.bucketLocation,
    cloudRunJobLocation: input.cloudRunJobLocation,
    egressFreeAssertion: input.egressFreeAssertion,
    totalDocs: input.totalDocs,
    categoryDistribution: input.categoryDistribution,
    alreadyBackfilled: input.alreadyBackfilled,
    verifiedExistingProvenance: input.verifiedExistingProvenance,
    chunks: input.chunks,
  };
  const mainContent = JSON.stringify(mainBody);
  const mainPath = buildObjectPath(input.bucketName, input.runId, 'phase-a-classify-summary.json');
  await writer.writeJson(mainPath, mainContent);

  const manifestBody: BackfillManifest = {
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    runId: input.runId,
    env: input.env,
    phaseA: {
      mainArtifact: { path: mainPath, sha256: sha256Hex(mainContent) },
      chunks: input.chunks,
    },
  };
  const manifestContent = JSON.stringify(manifestBody);
  const manifestPath = buildObjectPath(input.bucketName, input.runId, 'manifest.json');
  await writer.writeJson(manifestPath, manifestContent);

  return { mainArtifactPath: mainPath, manifestPath };
}
