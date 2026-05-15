/**
 * Issue #445 PR-D4 S1-5: Phase D verify orchestrator (impl-plan §4.4).
 *
 * フロー:
 *   1. Phase C manifest 読込 → manifest chain authority (phaseA / phaseB / phaseC ref を取得)
 *   2. Phase A read-only count を抽出 (Codex 7th Important 5)
 *   3. Phase B candidates を in-memory index 化 (Codex 7th 回答 1)
 *   4. Phase C writtenDocs を streaming で順次 verify
 *      - 各 doc を Firestore re-read → docVerifier.verifyDoc (Stage 1 / Stage 2)
 *      - per-chunk buffer flush + provenanceBackfillNullCount 集計
 *   5. dev 環境のみ rotate gate fixture test 起動 (BF12/BF13、Codex 7th Important 2)
 *   6. coverage 比率算出 (2 系統、Codex 7th Important 4)
 *   7. finalize (BF22 + manifest CAS、Codex 8th Important 3)
 *
 * 保全式 (orchestrator test でアサート):
 *   verifiedDocs === fieldsConsistent + fieldsMismatch.length
 *   createdAtConsistent + createdAtMismatch.length === verifiedDocs
 *   estateRotateReadyCoverage.rotateReadyTotal + notRotateReady === phaseA.totalDocs
 */

import { PR_D4_CANDIDATES_PER_CHUNK } from '../types';
import type {
  ArtifactChunkPointer,
  BackfillEnvName,
  PhaseDCoverageRatio,
  PhaseDFieldMismatchDoc,
  PhaseDRotateGateTestResult,
  PhaseDVerifiedDoc,
} from '../types';
import type { BackfillConfidence } from '../../../shared/types';
import {
  readPhaseACountReadOnly,
  readPhaseBCandidatesIndex,
  readPhaseCArtifactFromManifest,
  type ArtifactStorageReader,
} from './artifactReader';
import type { ArtifactStorageWriter } from './artifactWriter';
import { writePhaseDChunk, finalizePhaseDArtifact } from './artifactWriter';
import { verifyDoc, type ObservedDocState } from './docVerifier';
import { runRotateGateFixtureTest, type FixtureStore, type RotateApiCaller } from './rotateGateFixtureTester';

/**
 * Firestore document を Phase D 用に read する adapter (DI、production wire は adapters.ts)。
 *
 * 返却値 (ObservedDocState):
 * - docId, documentCreatedAt, provenance (typed), provenanceBackfill (typed or null)
 * - provenanceBackfillRaw: raw unknown (null / undefined / malformed の区別に必要)
 */
export interface PhaseDDocReader {
  readDoc(docId: string): Promise<ObservedDocState>;
}

export interface RunPhaseDInput {
  env: BackfillEnvName;
  runId: string;
  artifactBucketName: string;
  manifestPath: string;
  artifactReader: ArtifactStorageReader;
  artifactWriter: ArtifactStorageWriter;
  docReader: PhaseDDocReader;
  backfillScriptVersion: string;
  /** dev 環境で rotate gate fixture test を起動するか (本番では false 固定、Codex 3rd I6) */
  rotateGateFixtureEnabled: boolean;
  /** dev fixture test 用 (rotateGateFixtureEnabled=true 時のみ参照) */
  fixtureStore?: FixtureStore;
  rotateApiCaller?: RotateApiCaller;
  fixturePdfBytesVerified?: Buffer;
  fixturePdfBytesChildSnapshotOnly?: Buffer;
  verifyStartedAt: string;
  /** test の deterministic 時刻注入 (production は Date.now()) */
  nowProvider?: () => Date;
}

export interface RunPhaseDResult {
  candidatesIn: number;
  verifiedDocs: number;
  fieldsConsistent: number;
  fieldsMismatchCount: number;
  /** doc 単位 mismatch 数 (Codex 9th Critical 3 反映、保全式: verifiedDocs + mismatchedDocCount === candidatesIn) */
  mismatchedDocCount: number;
  createdAtConsistent: number;
  createdAtMismatchCount: number;
  provenanceBackfillNullCount: number;
  /** Codex 9th Evaluator エッジケース 1 反映: field absent (undefined) を null とは別軸で集計 */
  provenanceBackfillAbsentCount: number;
  confidenceDistribution: Record<BackfillConfidence, number>;
  rotateGateTest: PhaseDRotateGateTestResult | null;
  coverageRatio: PhaseDCoverageRatio;
  mainArtifactPath: string;
  manifestPath: string;
  finalizeStatusPath: string;
  manifestUpdateStatus: 'ok' | 'failed';
  /** いずれかの検証 fail があったか (CLI exit non-zero 判定用、Codex 9th Important 3) */
  hasVerificationFailure: boolean;
  verifyCompletedAt: string;
}

/**
 * Phase D verify を実行。
 *
 * fixture test は env === 'dev' && rotateGateFixtureEnabled の両方で true の場合のみ起動。
 * 本番 (cocoro / kanameone) では `rotateGateFixtureEnabled: false` を渡し、`rotateGateTest: null`
 * を artifact に記録 (本番 doc に rotate side effect ゼロ、Codex 3rd I6)。
 */
export async function runPhaseD(input: RunPhaseDInput): Promise<RunPhaseDResult> {
  const now = input.nowProvider ?? (() => new Date());

  const phaseCStream = await readPhaseCArtifactFromManifest({
    manifestPath: input.manifestPath,
    reader: input.artifactReader,
  });
  // Codex 9th Important 2 反映: Phase A/B main artifact も sha256 verify (chain authority)
  const phaseAExpectedSha = phaseCStream.manifest.phaseA!.mainArtifact.sha256;
  const phaseBExpectedSha = phaseCStream.manifest.phaseB!.mainArtifact.sha256;
  const phaseACount = await readPhaseACountReadOnly(
    phaseCStream.phaseAArtifactRef,
    phaseAExpectedSha,
    input.artifactReader
  );
  const phaseBIndex = await readPhaseBCandidatesIndex(
    phaseCStream.phaseBArtifactRef,
    phaseBExpectedSha,
    input.artifactReader
  );

  let verifiedDocsBuffer: PhaseDVerifiedDoc[] = [];
  let fieldsMismatchBuffer: PhaseDFieldMismatchDoc[] = [];
  let mismatchedDocIdsBuffer = new Set<string>();
  const chunks: ArtifactChunkPointer[] = [];

  let verifiedDocsTotal = 0;
  let fieldsConsistent = 0;
  const allFieldsMismatch: PhaseDFieldMismatchDoc[] = [];
  const allMismatchedDocIds = new Set<string>();
  let createdAtConsistent = 0;
  const allCreatedAtMismatch: PhaseDFieldMismatchDoc[] = [];
  let provenanceBackfillNullCount = 0;
  let provenanceBackfillAbsentCount = 0;
  const confidenceDistribution: Record<BackfillConfidence, number> = {
    'derived-bytes-verified': 0,
    'child-snapshot-only': 0,
    'metadata-only': 0,
  };
  /** Codex 9th Evaluator エッジケース 2 反映: streaming yield count を計測し candidatesIn と照合 */
  let streamingDocsObserved = 0;

  let chunkIndex = 0;

  async function flushChunk(): Promise<void> {
    if (verifiedDocsBuffer.length === 0 && fieldsMismatchBuffer.length === 0) return;
    const pointer = await writePhaseDChunk(
      {
        bucketName: input.artifactBucketName,
        runId: input.runId,
        chunkIndex,
        verifiedDocs: verifiedDocsBuffer,
        fieldsMismatchDocs: fieldsMismatchBuffer,
        mismatchedDocIds: Array.from(mismatchedDocIdsBuffer),
      },
      input.artifactWriter
    );
    chunks.push(pointer);
    verifiedDocsBuffer = [];
    fieldsMismatchBuffer = [];
    mismatchedDocIdsBuffer = new Set<string>();
    chunkIndex += 1;
  }

  for await (const writtenDoc of phaseCStream.writtenDocs()) {
    streamingDocsObserved += 1;
    const observed = await input.docReader.readDoc(writtenDoc.docId);
    if (observed.provenanceBackfillRaw === null) {
      provenanceBackfillNullCount += 1;
    } else if (observed.provenanceBackfillRaw === undefined) {
      // field 不在 = backfill が書込まれていない doc (Codex 9th Evaluator エッジケース 1)
      provenanceBackfillAbsentCount += 1;
    }

    const result = verifyDoc({
      observed,
      expectedFromPhaseB: phaseBIndex.get(writtenDoc.docId),
      expectedSha256FromPhaseC: writtenDoc.newProvenanceBackfillSha256,
      backfillScriptVersion: input.backfillScriptVersion,
    });

    if (result.kind === 'verified') {
      verifiedDocsBuffer.push({
        docId: result.docId,
        provenanceFieldsConsistent: result.provenanceFieldsConsistent,
        provenanceBackfillSha256Match: result.provenanceBackfillSha256Match,
        observedConfidence: result.observedConfidence,
        observedCreatedAt: result.observedCreatedAt,
      });
      verifiedDocsTotal += 1;
      confidenceDistribution[result.observedConfidence] += 1;
      // Codex Critical 3 + code-reviewer H1 反映: verifyDoc 仕様上 verified ⇒ sha256Match=true 必須
      if (!result.provenanceBackfillSha256Match) {
        // 到達不能 (verifyDoc は sha256 mismatch を kind:mismatch で返す) だが防御
        throw new Error(
          `invariant violation: verifyDoc returned kind=verified with provenanceBackfillSha256Match=false (docId=${result.docId})`
        );
      }
      if (result.provenanceFieldsConsistent) {
        fieldsConsistent += 1;
      }
      if (result.createdAtConsistent) {
        createdAtConsistent += 1;
      } else if (result.createdAtMismatch) {
        allCreatedAtMismatch.push(result.createdAtMismatch);
      }
    } else {
      // mismatch case: field 単位レコード + doc 単位 Set
      fieldsMismatchBuffer.push(...result.mismatches);
      allFieldsMismatch.push(...result.mismatches);
      mismatchedDocIdsBuffer.add(result.docId);
      allMismatchedDocIds.add(result.docId);
    }

    if (
      verifiedDocsBuffer.length + fieldsMismatchBuffer.length >=
      PR_D4_CANDIDATES_PER_CHUNK
    ) {
      await flushChunk();
    }
  }
  await flushChunk();

  // rotate gate fixture test (dev のみ)
  let rotateGateTest: PhaseDRotateGateTestResult | null = null;
  if (input.env === 'dev' && input.rotateGateFixtureEnabled) {
    if (
      !input.fixtureStore ||
      !input.rotateApiCaller ||
      !input.fixturePdfBytesVerified ||
      !input.fixturePdfBytesChildSnapshotOnly
    ) {
      throw new Error(
        'rotateGateFixtureEnabled=true requires fixtureStore + rotateApiCaller + fixturePdfBytesVerified + fixturePdfBytesChildSnapshotOnly'
      );
    }
    rotateGateTest = await runRotateGateFixtureTest({
      env: input.env,
      runId: input.runId,
      pdfBytesVerified: input.fixturePdfBytesVerified,
      pdfBytesChildSnapshotOnly: input.fixturePdfBytesChildSnapshotOnly,
      fixtureStore: input.fixtureStore,
      rotateApiCaller: input.rotateApiCaller,
    });
  }

  // Phase D の "verify 対象" = Phase C writtenDocs (= Phase D が再読込 + verify した doc 数)
  // Phase C "backfillAttempt 母集団" = Phase C candidatesIn (= Phase B revalidated 全件、書込試行した母集団)
  // Codex 10th Important 1 反映: backfillAttemptCoverage 分母は phaseCSummary.candidatesIn が正しい
  const verifyTargetDocs = phaseCStream.writtenDocsIn;
  const phaseCSummary = phaseCStream.phaseCSummary;
  const backfillAttemptDenominator = phaseCSummary.candidatesIn;

  // streaming yield count vs verify 対象 doc 数 保全式 (Codex 9th Evaluator エッジケース 2)
  if (streamingDocsObserved !== verifyTargetDocs) {
    throw new Error(
      `invariant violation: streaming yielded ${streamingDocsObserved} docs but Phase C summary writtenDocs=${verifyTargetDocs} (chunk truncation 可能性)`
    );
  }

  // doc 単位保全式 (Codex 9th Critical 3): verifyTargetDocs 内訳
  const mismatchedDocCount = allMismatchedDocIds.size;
  if (verifiedDocsTotal + mismatchedDocCount !== verifyTargetDocs) {
    throw new Error(
      `invariant violation: verifiedDocs(${verifiedDocsTotal}) + mismatchedDocCount(${mismatchedDocCount}) !== verifyTargetDocs(${verifyTargetDocs})`
    );
  }

  // coverage 比率算出 (Codex 7th Important 4 + 10th Important 1 反映)
  // - backfillAttemptCoverage: Phase B revalidated 全件 (= phaseC.candidatesIn) を母集団とする
  //   「backfill 試行した全 docs に対する各 outcome の比率」
  // - estateRotateReadyCoverage: Phase A totalDocs を母集団とする「env 全体で rotate 可能な比率」(BF15 主指標)
  const verifiedConfidenceCount = confidenceDistribution['derived-bytes-verified'];
  const childSnapshotCount = confidenceDistribution['child-snapshot-only'];
  const metadataOnlyCount = confidenceDistribution['metadata-only'];
  const safeDiv = (numer: number, denom: number): number => (denom === 0 ? 0 : numer / denom);
  const preconditionFailedCount = phaseCSummary.preconditionFailedDocs;
  const immutableSkippedCount = phaseCSummary.skippedImmutable;

  const coverageRatio: PhaseDCoverageRatio = {
    backfillAttemptCoverage: {
      // Codex 10th Important 1 反映: 分母は phaseC.candidatesIn (Phase B revalidated 全件)
      denominator: backfillAttemptDenominator,
      derivedBytesVerified: safeDiv(verifiedConfidenceCount, backfillAttemptDenominator),
      childSnapshotOnly: safeDiv(childSnapshotCount, backfillAttemptDenominator),
      metadataOnly: safeDiv(metadataOnlyCount, backfillAttemptDenominator),
      preconditionFailed: safeDiv(preconditionFailedCount, backfillAttemptDenominator),
      immutableSkipped: safeDiv(immutableSkippedCount, backfillAttemptDenominator),
    },
    estateRotateReadyCoverage: {
      denominator: phaseACount.totalDocs,
      verifiedExisting: safeDiv(phaseACount.verifiedExistingProvenance, phaseACount.totalDocs),
      backfilledDerivedBytesVerified: safeDiv(verifiedConfidenceCount, phaseACount.totalDocs),
      rotateReadyTotal: safeDiv(
        phaseACount.verifiedExistingProvenance + verifiedConfidenceCount,
        phaseACount.totalDocs
      ),
      notRotateReady: safeDiv(
        phaseACount.totalDocs - (phaseACount.verifiedExistingProvenance + verifiedConfidenceCount),
        phaseACount.totalDocs
      ),
    },
  };

  const verifyCompletedAt = now().toISOString();
  const fieldsMismatchCount = allFieldsMismatch.length;
  const createdAtMismatchCount = allCreatedAtMismatch.length;

  // 検証失敗判定 (Codex 9th Important 3 反映、CLI exit non-zero 用)
  const fixtureFailure =
    rotateGateTest !== null &&
    (rotateGateTest.derivedBytesVerified.rotateApiResult !== 'success' ||
      rotateGateTest.childSnapshotOnly.rotateApiResult !== 'rejected' ||
      rotateGateTest.fixtureCleanupFailures.length > 0);
  const hasVerificationFailure =
    mismatchedDocCount > 0 ||
    createdAtMismatchCount > 0 ||
    provenanceBackfillNullCount > 0 ||
    fixtureFailure;

  const finalizeResult = await finalizePhaseDArtifact(
    {
      bucketName: input.artifactBucketName,
      runId: input.runId,
      env: input.env,
      verifyStartedAt: input.verifyStartedAt,
      verifyCompletedAt,
      phaseAArtifactRef: phaseCStream.phaseAArtifactRef,
      phaseBArtifactRef: phaseCStream.phaseBArtifactRef,
      phaseCArtifactRef: phaseCStream.phaseCArtifactRef,
      phaseCManifestSha256: phaseCStream.phaseCManifestSha256,
      candidatesIn: verifyTargetDocs,
      verifiedDocs: verifiedDocsTotal,
      fieldsConsistent,
      fieldsMismatch: allFieldsMismatch,
      mismatchedDocCount,
      createdAtConsistent,
      createdAtMismatch: allCreatedAtMismatch,
      confidenceDistribution,
      provenanceBackfillNullCount,
      provenanceBackfillAbsentCount,
      rotateGateTest,
      coverageRatio,
      phaseACountReadOnly: phaseACount,
      chunks,
      existingManifest: phaseCStream.manifest,
      manifestGeneration: phaseCStream.manifestGeneration,
    },
    input.artifactWriter
  );

  return {
    candidatesIn: verifyTargetDocs,
    verifiedDocs: verifiedDocsTotal,
    fieldsConsistent,
    fieldsMismatchCount,
    mismatchedDocCount,
    createdAtConsistent,
    createdAtMismatchCount,
    provenanceBackfillNullCount,
    provenanceBackfillAbsentCount,
    confidenceDistribution,
    rotateGateTest,
    coverageRatio,
    mainArtifactPath: finalizeResult.mainArtifactPath,
    manifestPath: finalizeResult.manifestPath,
    finalizeStatusPath: finalizeResult.finalizeStatusPath,
    manifestUpdateStatus: finalizeResult.manifestUpdateStatus,
    hasVerificationFailure,
    verifyCompletedAt,
  };
}

// re-exports for adapters.ts / index.ts
export type { ObservedDocState } from './docVerifier';
export type { FixtureStore, RotateApiCaller } from './rotateGateFixtureTester';
