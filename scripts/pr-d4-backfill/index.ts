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
  if (phase !== 'A') {
    console.error(`FATAL: phase ${phase} not implemented in S1-2 (only Phase A is available)`);
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
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
