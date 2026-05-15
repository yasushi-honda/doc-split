#!/usr/bin/env ts-node
/**
 * Issue #445 PR-D4 S1-2: Phase A CLI entry point.
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=<project-id> \
 *   STORAGE_BUCKET=<production-data-bucket> \
 *   ARTIFACT_BUCKET=<pr-d4-artifact-bucket> \
 *   npx ts-node scripts/pr-d4-backfill/index.ts \
 *     --env <dev|cocoro|kanameone> \
 *     --phase A \
 *     [--run-id <id>] \
 *     [--cloud-run-location asia-northeast1] \
 *     [--bucket-location asia-northeast1]
 *
 * Phase A は read-only。Firestore documents collection を全件 stream + 構造分類し、
 * artifact bucket に main + chunks + manifest を JSON で書込む。
 * Phase B/C/D は本 file の switch を拡張する形で S1-3 以降で追加予定。
 */

import * as admin from 'firebase-admin';
import type { BackfillEnvName } from './types';
import { runPhaseA } from './phase-a/auditClassify';
import {
  FirestoreDocumentSource,
  FirestoreParentFetcher,
  GcsBucketProber,
  GcsArtifactStorageWriter,
} from './phase-a/adapters';
import { runPhaseB } from './phase-b/revalidationOrchestrator';
import {
  GcsArtifactReader,
  GcsObjectDownloader,
  FirestoreReReaderImpl,
} from './phase-b/adapters';
import { runPhaseC } from './phase-c/backfillOrchestrator';
import {
  FirestoreBatchAdapterImpl,
  FirestoreIndividualAdapterImpl,
  GcsLockStoreImpl,
} from './phase-c/adapters';
import {
  PR_D4_PHASE_C_DEFAULT_RATE_LIMITER,
  PR_D4_SCRIPT_VERSION,
} from './types';
import { TokenBucketRateLimiter } from './phase-c/rateLimiter';
import { runPhaseD } from './phase-d/verifyOrchestrator';
import {
  FirestoreDocReaderImpl,
  GcsFixtureStoreImpl,
  HttpsRotateApiCallerImpl,
} from './phase-d/adapters';

function readArg(name: string, defaultValue?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0 || idx + 1 >= process.argv.length) return defaultValue;
  const value = process.argv[idx + 1];
  // 値が `--` で始まる場合は別 flag を誤って value として吸い込んでいる → defaultValue 扱い
  if (value.startsWith('--')) return defaultValue;
  return value;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: env ${name} required`);
    process.exit(2);
  }
  return v;
}

function isBackfillEnv(s: string): s is BackfillEnvName {
  return s === 'dev' || s === 'cocoro' || s === 'kanameone';
}

function generateRunId(env: BackfillEnvName): string {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${ts}-${env}-pr-d4-v1`;
}

async function main(): Promise<void> {
  const envName = readArg('--env');
  if (!envName || !isBackfillEnv(envName)) {
    console.error('FATAL: --env <dev|cocoro|kanameone> required');
    process.exit(2);
  }
  const phase = readArg('--phase', 'A');
  if (phase !== 'A' && phase !== 'B' && phase !== 'C' && phase !== 'D') {
    console.error(
      `FATAL: phase ${phase} not implemented (only Phase A / B / C / D are available in S1-5)`
    );
    process.exit(2);
  }

  const projectId = requireEnv('FIREBASE_PROJECT_ID');
  const productionBucket = requireEnv('STORAGE_BUCKET');
  const artifactBucketName = requireEnv('ARTIFACT_BUCKET');
  // --cloud-run-location / --bucket-location は **明示指定必須**。default を与えると、
  // 実 bucket location を確認せず "asia-northeast1" を assume してしまい、
  // 別 region に作られた bucket への cross-region egress を見逃す (Codex MCP Important 1)
  const cloudRunLocation = readArg('--cloud-run-location');
  const bucketLocation = readArg('--bucket-location');
  if (!cloudRunLocation || !bucketLocation) {
    console.error('FATAL: --cloud-run-location and --bucket-location are required (no default).');
    console.error('       bucket location 確認は egress 課金前提のため明示指定必須');
    process.exit(2);
  }
  const runId = readArg('--run-id', generateRunId(envName))!;

  console.log('Phase A (PR-D4 S1-2) starting:');
  console.log(`  env: ${envName}`);
  console.log(`  projectId: ${projectId}`);
  console.log(`  productionBucket: ${productionBucket}`);
  console.log(`  artifactBucket: ${artifactBucketName}`);
  console.log(`  runId: ${runId}`);
  console.log(`  cloudRunLocation: ${cloudRunLocation}`);
  console.log(`  bucketLocation: ${bucketLocation}`);

  admin.initializeApp({ projectId, storageBucket: productionBucket });
  const db = admin.firestore();
  const productionBucketRef = admin.storage().bucket(productionBucket);
  const artifactBucketRef = admin.storage().bucket(artifactBucketName);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _phaseGuard: 'A' | 'B' | 'C' | 'D' = phase;

  if (phase === 'A') {
    const snapshotStartedAt = new Date().toISOString();
    const result = await runPhaseA({
      env: envName,
      runId,
      productionDataBucketName: productionBucket,
      artifactBucketName,
      cloudRunLocation,
      bucketLocation,
      documentSource: new FirestoreDocumentSource(db),
      parentFetcher: new FirestoreParentFetcher(db),
      bucketProber: new GcsBucketProber(productionBucketRef),
      artifactWriter: new GcsArtifactStorageWriter(artifactBucketRef),
      snapshotStartedAt,
    });

    console.log('\nPhase A complete:');
    console.log(`  totalDocs: ${result.totalDocs}`);
    console.log(`  alreadyBackfilled: ${result.alreadyBackfilled}`);
    console.log(`  verifiedExistingProvenance: ${result.verifiedExistingProvenance}`);
    console.log('  categoryDistribution:');
    for (const [cat, count] of Object.entries(result.categoryDistribution)) {
      console.log(`    ${cat}: ${count}`);
    }
    console.log(`  chunkCount: ${result.chunkCount}`);
    console.log(`  mainArtifact: ${result.mainArtifactPath}`);
    console.log(`  manifest: ${result.manifestPath}`);
    console.log(`  snapshotStartedAt: ${snapshotStartedAt}`);
    console.log(`  snapshotCompletedAt: ${result.snapshotCompletedAt}`);
  } else if (phase === 'B') {
    // Phase B: Phase A artifact 経由 manifest を読み revalidation 実施
    const manifestPath = `gs://${artifactBucketName}/pr-d4-backfill-artifacts/${runId}/manifest.json`;
    console.log(`\nPhase B starting with manifest: ${manifestPath}`);

    const revalidationStartedAt = new Date().toISOString();
    const result = await runPhaseB({
      env: envName,
      runId,
      artifactBucketName,
      manifestPath,
      artifactReader: new GcsArtifactReader(artifactBucketRef),
      artifactWriter: new GcsArtifactStorageWriter(artifactBucketRef),
      firestoreReReader: new FirestoreReReaderImpl(db),
      childDownloader: new GcsObjectDownloader(productionBucketRef),
      parentDownloader: new GcsObjectDownloader(productionBucketRef),
      productionDataBucketName: productionBucket,
      revalidationStartedAt,
    });

    console.log('\nPhase B complete:');
    console.log(`  candidatesIn: ${result.candidatesIn}`);
    console.log(`  candidatesOut: ${result.candidatesOut}`);
    console.log(`  skippedNonMatchedByHash: ${result.skippedNonMatchedByHash}`);
    console.log(`  verifyFailedMatchedByHash: ${result.verifyFailedMatchedByHash}`);
    console.log('  driftSkipped:');
    console.log(`    firestoreUpdateTimeChanged: ${result.driftSkipped.firestoreUpdateTimeChanged}`);
    console.log(`    childGenerationChanged: ${result.driftSkipped.childGenerationChanged}`);
    console.log(`    parentGenerationChanged: ${result.driftSkipped.parentGenerationChanged}`);
    console.log(`  mainArtifact: ${result.mainArtifactPath}`);
    console.log(`  manifest: ${result.manifestPath}`);
    console.log(`  revalidationStartedAt: ${revalidationStartedAt}`);
    console.log(`  revalidationCompletedAt: ${result.revalidationCompletedAt}`);
  } else if (phase === 'C') {
    // Phase C: Phase B artifact 経由 manifest を読み atomic backfill 実施 (S1-4)
    const manifestPath = `gs://${artifactBucketName}/pr-d4-backfill-artifacts/${runId}/manifest.json`;
    const jobId = readArg('--job-id', `job-${runId}`)!;
    // lock owner: GitHub Actions 経由なら GITHUB_RUN_ID + GITHUB_REPOSITORY、ローカルなら 'manual-cli'
    const githubRunId = process.env.GITHUB_RUN_ID;
    const defaultLockOwner = githubRunId
      ? `github-actions-run-${githubRunId}`
      : 'manual-cli';
    const lockOwner = readArg('--lock-owner', defaultLockOwner)!;
    const expectedDurationSec = Number(readArg('--expected-duration-sec', '3600'));

    console.log(`\nPhase C starting with manifest: ${manifestPath}`);
    console.log(`  jobId: ${jobId}`);
    console.log(`  lockOwner: ${lockOwner}`);
    console.log(`  expectedDurationSec: ${expectedDurationSec}`);
    console.log(
      `  rateLimiter: ${PR_D4_PHASE_C_DEFAULT_RATE_LIMITER.tokensPerSecond} tokens/sec, burst ${PR_D4_PHASE_C_DEFAULT_RATE_LIMITER.burstCapacity}`
    );

    const rateLimiter = new TokenBucketRateLimiter(PR_D4_PHASE_C_DEFAULT_RATE_LIMITER);

    const result = await runPhaseC({
      env: envName,
      runId,
      jobId,
      lockOwner,
      artifactBucketName,
      manifestPath,
      artifactReader: new GcsArtifactReader(artifactBucketRef),
      artifactWriter: new GcsArtifactStorageWriter(artifactBucketRef),
      lockStore: new GcsLockStoreImpl(artifactBucketRef),
      batchAdapter: new FirestoreBatchAdapterImpl(db),
      individualAdapter: new FirestoreIndividualAdapterImpl(db),
      rateLimiter,
      rateLimiterConfig: PR_D4_PHASE_C_DEFAULT_RATE_LIMITER,
      backfillScriptVersion: PR_D4_SCRIPT_VERSION,
      expectedDurationSec,
    });

    console.log('\nPhase C complete:');
    console.log(`  candidatesIn: ${result.candidatesIn}`);
    console.log(`  writtenDocs: ${result.writtenDocs}`);
    console.log(`  preconditionFailedDocs: ${result.preconditionFailedDocs}`);
    console.log(`  skippedImmutable: ${result.skippedImmutable}`);
    console.log(`  lockAcquiredGeneration: ${result.lockAcquiredGeneration}`);
    console.log(`  lockReleasedAt: ${result.lockReleasedAt}`);
    console.log(`  mainArtifact: ${result.mainArtifactPath}`);
    console.log(`  manifest: ${result.manifestPath}`);
    console.log(`  backfillCompletedAt: ${result.backfillCompletedAt}`);
  } else {
    // Phase D: Phase C artifact 経由 manifest を読み verify + rotate gate test 実施 (本 PR S1-5)
    const manifestPath = `gs://${artifactBucketName}/pr-d4-backfill-artifacts/${runId}/manifest.json`;
    // dev 環境のみ rotate gate fixture test 実行可、cocoro/kanameone は強制 false (Codex 3rd I6)
    // PR-D4 S1-6 review 反映 (type-design-analyzer): phase=D 制約を container 側でも reject
    // (yaml gate が必ず先に発火するが、container CLI 直叩き時の defense-in-depth)
    const rotateGateFixtureEnabledArg = readArg('--phase-d-rotate-fixture-mode', 'false');
    const rotateGateFixtureEnabled =
      envName === 'dev' && phase === 'D' && rotateGateFixtureEnabledArg === 'true';
    if (rotateGateFixtureEnabledArg === 'true' && (envName !== 'dev' || phase !== 'D')) {
      console.error(
        `FATAL: --phase-d-rotate-fixture-mode=true requires env=dev AND phase=D; received env=${envName}, phase=${phase}`
      );
      process.exit(2);
    }

    console.log(`\nPhase D starting with manifest: ${manifestPath}`);
    console.log(`  rotateGateFixtureEnabled: ${rotateGateFixtureEnabled}`);

    const verifyStartedAt = new Date().toISOString();

    // fixture mode 起動時: rotate URL + auth token を env 経由で受け取る
    let fixtureStore;
    let rotateApiCaller;
    let fixturePdfBytesVerified;
    let fixturePdfBytesChildSnapshotOnly;
    if (rotateGateFixtureEnabled) {
      const rotateUrl = process.env.PR_D4_ROTATE_URL;
      const authToken = process.env.PR_D4_ROTATE_AUTH_TOKEN;
      if (!rotateUrl || !authToken) {
        console.error(
          'FATAL: rotateGateFixtureEnabled=true requires PR_D4_ROTATE_URL + PR_D4_ROTATE_AUTH_TOKEN env'
        );
        process.exit(2);
      }
      // fixture PDF bytes: 最小の valid PDF (test caller が fixture bucket に事前 upload 想定だが、
      // dev rehearsal では本 CLI が直接生成する。最小 1-page PDF を pdf-lib で構築)
      const { PDFDocument } = await import('pdf-lib');
      const docVerified = await PDFDocument.create();
      docVerified.addPage();
      fixturePdfBytesVerified = Buffer.from(await docVerified.save());
      const docChild = await PDFDocument.create();
      docChild.addPage();
      docChild.addPage();
      fixturePdfBytesChildSnapshotOnly = Buffer.from(await docChild.save());

      fixtureStore = new GcsFixtureStoreImpl(db, productionBucketRef, productionBucket);
      // Codex 9th Critical 2 反映: rotate 後 Firestore re-read で実 path + generation 取得するため db を渡す
      rotateApiCaller = new HttpsRotateApiCallerImpl(rotateUrl, authToken, db, productionBucketRef);
    }

    const result = await runPhaseD({
      env: envName,
      runId,
      artifactBucketName,
      manifestPath,
      artifactReader: new GcsArtifactReader(artifactBucketRef),
      artifactWriter: new GcsArtifactStorageWriter(artifactBucketRef),
      docReader: new FirestoreDocReaderImpl(db),
      backfillScriptVersion: PR_D4_SCRIPT_VERSION,
      rotateGateFixtureEnabled,
      fixtureStore,
      rotateApiCaller,
      fixturePdfBytesVerified,
      fixturePdfBytesChildSnapshotOnly,
      verifyStartedAt,
    });

    console.log('\nPhase D complete:');
    console.log(`  candidatesIn: ${result.candidatesIn}`);
    console.log(`  verifiedDocs: ${result.verifiedDocs}`);
    console.log(`  fieldsConsistent: ${result.fieldsConsistent}`);
    console.log(`  fieldsMismatchCount (field 単位): ${result.fieldsMismatchCount}`);
    console.log(`  mismatchedDocCount (doc 単位): ${result.mismatchedDocCount}`);
    console.log(`  createdAtConsistent: ${result.createdAtConsistent}`);
    console.log(`  createdAtMismatchCount: ${result.createdAtMismatchCount}`);
    console.log(`  provenanceBackfillNullCount: ${result.provenanceBackfillNullCount}`);
    console.log(`  provenanceBackfillAbsentCount: ${result.provenanceBackfillAbsentCount}`);
    console.log(`  confidenceDistribution: ${JSON.stringify(result.confidenceDistribution)}`);
    console.log(`  rotateGateTest: ${result.rotateGateTest ? 'executed' : 'skipped (production)'}`);
    if (result.rotateGateTest) {
      console.log(
        `    derivedBytesVerified: ${result.rotateGateTest.derivedBytesVerified.rotateApiResult}`
      );
      console.log(
        `    childSnapshotOnly: ${result.rotateGateTest.childSnapshotOnly.rotateApiResult}`
      );
      console.log(
        `    fixtureCleanupFailures: ${result.rotateGateTest.fixtureCleanupFailures.length}`
      );
    }
    console.log('  coverage:');
    console.log(`    backfillAttempt.derivedBytesVerified: ${result.coverageRatio.backfillAttemptCoverage.derivedBytesVerified.toFixed(4)}`);
    console.log(`    estateRotateReady.rotateReadyTotal: ${result.coverageRatio.estateRotateReadyCoverage.rotateReadyTotal.toFixed(4)} (BF15 主指標)`);
    console.log(`  mainArtifact: ${result.mainArtifactPath}`);
    console.log(`  manifest: ${result.manifestPath}`);
    console.log(`  finalizeStatus: ${result.finalizeStatusPath}`);
    console.log(`  manifestUpdateStatus: ${result.manifestUpdateStatus}`);
    console.log(`  hasVerificationFailure: ${result.hasVerificationFailure}`);
    console.log(`  verifyCompletedAt: ${result.verifyCompletedAt}`);

    // exit code policy (Codex 9th Important 3 反映)
    if (result.manifestUpdateStatus === 'failed') {
      console.error('FATAL: manifest CAS failed; phase-d artifact not authoritative (exit 3)');
      process.exit(3);
    }
    if (result.hasVerificationFailure) {
      console.error(
        `FATAL: Phase D verification failure detected ` +
          `(mismatchedDocCount=${result.mismatchedDocCount}, ` +
          `createdAtMismatchCount=${result.createdAtMismatchCount}, ` +
          `provenanceBackfillNullCount=${result.provenanceBackfillNullCount}, ` +
          `rotateGate=${result.rotateGateTest ? 'tested' : 'skipped'}); exit 4`
      );
      process.exit(4);
    }
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
