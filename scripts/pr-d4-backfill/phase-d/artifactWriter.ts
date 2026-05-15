/**
 * Issue #445 PR-D4 S1-5: Phase D artifact writer (BF22 chunking + Codex 8th Important 3 反映).
 *
 * Phase D の特殊性: CAS update 失敗時に main artifact を上書きすると `ifGenerationMatch: 0`
 * semantics と衝突する。設計は以下:
 *   1. main artifact は `manifestUpdateStatus: 'pending'` で書込 (新規 only、412 回避)
 *   2. CAS update を試行
 *   3. 結果 (ok / failed) を別 file (`phase-d-finalize-status.json`) に書込
 *   4. main artifact 自体は CAS 結果に関わらず authoritative 判定材料を残す
 *
 * 効果: CAS 失敗時に operator が `phase-d-finalize-status.json` を見て main artifact の
 * 信頼性を判断可能。main artifact 自体は overwrite せず GCS 上で 1 度だけ書込まれる。
 */

import * as crypto from 'crypto';
import type { ArtifactStorageWriter } from '../phase-a/artifactWriter';
import type {
  ArtifactChunkPointer,
  BackfillEnvName,
  BackfillManifest,
  PhaseDFieldMismatchDoc,
  PhaseDVerifyChunk,
  PhaseDVerifySummary,
  PhaseDVerifiedDoc,
  PhaseDRotateGateTestResult,
  PhaseDCoverageRatio,
  PhaseDFinalizeStatus,
} from '../types';
import { PR_D4_ARTIFACT_SCHEMA_VERSION, PR_D4_SCRIPT_VERSION } from '../types';
import type { BackfillConfidence, BackfillClassifierCategory } from '../../../shared/types';

export type { ArtifactStorageWriter } from '../phase-a/artifactWriter';

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function buildObjectPath(bucketName: string, runId: string, fileName: string): string {
  return `gs://${bucketName}/pr-d4-backfill-artifacts/${runId}/${fileName}`;
}

export interface WritePhaseDChunkInput {
  bucketName: string;
  runId: string;
  chunkIndex: number;
  verifiedDocs: PhaseDVerifiedDoc[];
  fieldsMismatchDocs: PhaseDFieldMismatchDoc[];
  /** Codex 9th Critical 3 反映: doc 単位 mismatch ID 集合 (保全式の doc 数算出用) */
  mismatchedDocIds: string[];
}

/**
 * 1 chunk 書込 (orchestrator が per-chunk flush で呼ぶ)。
 * docCount は verifiedDocs + mismatchedDocIds 合計 (Codex 9th Critical 3 反映、doc 単位)。
 */
export async function writePhaseDChunk(
  input: WritePhaseDChunkInput,
  writer: ArtifactStorageWriter
): Promise<ArtifactChunkPointer> {
  const chunkBody: PhaseDVerifyChunk = {
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    chunkIndex: input.chunkIndex,
    verifiedDocs: input.verifiedDocs,
    fieldsMismatchDocs: input.fieldsMismatchDocs,
    mismatchedDocIds: input.mismatchedDocIds,
  };
  const chunkContent = JSON.stringify(chunkBody);
  const chunkPath = buildObjectPath(
    input.bucketName,
    input.runId,
    `phase-d-verify-summary-chunk-${input.chunkIndex}.json`
  );
  await writer.writeJson(chunkPath, chunkContent);
  return {
    path: chunkPath,
    sha256: sha256Hex(chunkContent),
    docCount: input.verifiedDocs.length + input.mismatchedDocIds.length,
  };
}

export interface FinalizePhaseDInput {
  bucketName: string;
  runId: string;
  env: BackfillEnvName;
  verifyStartedAt: string;
  verifyCompletedAt: string;
  phaseAArtifactRef: string;
  phaseBArtifactRef: string;
  phaseCArtifactRef: string;
  phaseCManifestSha256: string;
  candidatesIn: number;
  verifiedDocs: number;
  fieldsConsistent: number;
  fieldsMismatch: PhaseDFieldMismatchDoc[];
  mismatchedDocCount: number;
  createdAtConsistent: number;
  createdAtMismatch: PhaseDFieldMismatchDoc[];
  confidenceDistribution: Record<BackfillConfidence, number>;
  provenanceBackfillNullCount: number;
  /** Codex 9th Evaluator エッジケース 1 反映: field absent (undefined) を null と別軸で集計 */
  provenanceBackfillAbsentCount: number;
  rotateGateTest: PhaseDRotateGateTestResult | null;
  coverageRatio: PhaseDCoverageRatio;
  phaseACountReadOnly: {
    totalDocs: number;
    alreadyBackfilled: number;
    verifiedExistingProvenance: number;
    categoryDistribution: Record<BackfillClassifierCategory, number>;
  };
  chunks: ArtifactChunkPointer[];
  existingManifest: BackfillManifest;
  manifestGeneration: number;
}

export interface FinalizePhaseDResult {
  mainArtifactPath: string;
  manifestPath: string;
  manifestUpdateStatus: 'ok' | 'failed';
  finalizeStatusPath: string;
}

/**
 * Phase D finalize: main 書込 → CAS update 試行 → status file 書込。
 *
 * Codex 8th Important 3 反映:
 * - main artifact は `manifestUpdateStatus: 'pending'` で書込 (overwrite なし)
 * - CAS update を try / catch で wrap、412 検出時は `manifestUpdateStatus: 'failed'` で status file 書込
 * - 戻り値の `manifestUpdateStatus` を caller (orchestrator) が判定し、exit code 3 で終了させる
 */
export async function finalizePhaseDArtifact(
  input: FinalizePhaseDInput,
  writer: ArtifactStorageWriter
): Promise<FinalizePhaseDResult> {
  const mainBody: PhaseDVerifySummary = {
    phase: 'D',
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    scriptVersion: PR_D4_SCRIPT_VERSION,
    env: input.env,
    runId: input.runId,
    phaseAArtifactRef: input.phaseAArtifactRef,
    phaseBArtifactRef: input.phaseBArtifactRef,
    phaseCArtifactRef: input.phaseCArtifactRef,
    phaseCManifestSha256: input.phaseCManifestSha256,
    verifyStartedAt: input.verifyStartedAt,
    verifyCompletedAt: input.verifyCompletedAt,
    candidatesIn: input.candidatesIn,
    verifiedDocs: input.verifiedDocs,
    fieldsConsistent: input.fieldsConsistent,
    fieldsMismatch: input.fieldsMismatch,
    mismatchedDocCount: input.mismatchedDocCount,
    createdAtConsistent: input.createdAtConsistent,
    createdAtMismatch: input.createdAtMismatch,
    confidenceDistribution: input.confidenceDistribution,
    provenanceBackfillNullCount: input.provenanceBackfillNullCount,
    provenanceBackfillAbsentCount: input.provenanceBackfillAbsentCount,
    rotateGateTest: input.rotateGateTest,
    coverageRatio: input.coverageRatio,
    phaseACountReadOnly: input.phaseACountReadOnly,
    manifestUpdateStatus: 'pending',
    chunks: input.chunks,
  };
  const mainContent = JSON.stringify(mainBody);
  const mainPath = buildObjectPath(input.bucketName, input.runId, 'phase-d-verify-summary.json');
  await writer.writeJson(mainPath, mainContent);

  const updatedManifest: BackfillManifest = {
    ...input.existingManifest,
    phaseD: {
      mainArtifact: { path: mainPath, sha256: sha256Hex(mainContent) },
      chunks: input.chunks,
    },
  };
  const manifestContent = JSON.stringify(updatedManifest);
  const manifestPath = buildObjectPath(input.bucketName, input.runId, 'manifest.json');

  let manifestUpdateStatus: 'ok' | 'failed' = 'ok';
  let remediation: string | undefined;
  try {
    await writer.writeJson(manifestPath, manifestContent, {
      ifGenerationMatch: input.manifestGeneration,
    });
  } catch (err) {
    manifestUpdateStatus = 'failed';
    const message = err instanceof Error ? err.message : String(err);
    remediation =
      `manifest CAS failed (expectedGeneration=${input.manifestGeneration}); phase-d artifact ` +
      `not authoritative. Remediation: re-run Phase D with fresh manifestGeneration after ` +
      `confirming concurrent Phase D / retry is stopped. Original error: ${message}`;
    console.error('manifest CAS failed; phase-d artifact not authoritative', {
      runId: input.runId,
      expectedGeneration: input.manifestGeneration,
      observedAt: new Date().toISOString(),
      remediation,
    });
  }

  // status file 書込 (main artifact とは独立、`ifGenerationMatch: 0` で新規 only)
  const statusBody: PhaseDFinalizeStatus = {
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    runId: input.runId,
    env: input.env,
    finalizedAt: new Date().toISOString(),
    manifestUpdateStatus,
    expectedGeneration: String(input.manifestGeneration),
    remediation,
  };
  const statusContent = JSON.stringify(statusBody);
  const statusPath = buildObjectPath(
    input.bucketName,
    input.runId,
    'phase-d-finalize-status.json'
  );
  // code-reviewer L3 反映: 新規 only を明示 (Phase D retry 時に status file 既存なら 412 で
  // operator が「同 runId で Phase D が既に走った」を即把握できる)
  await writer.writeJson(statusPath, statusContent, { ifGenerationMatch: 0 });

  return {
    mainArtifactPath: mainPath,
    manifestPath,
    manifestUpdateStatus,
    finalizeStatusPath: statusPath,
  };
}
