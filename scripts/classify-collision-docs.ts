#!/usr/bin/env ts-node
/**
 * Issue #432 PR-C: 衝突 doc / fileUrl 孤児を 5 分類して JSON レポート出力 (read-only)
 *
 * 既存 scripts/audit-storage-mismatch.js (検出のみ) を発展させ、各 doc に hash evidence +
 * parent context を gather し scripts/lib/collisionClassifier に渡す。
 *
 * 出力 JSON は execute-collision-migration.ts (T7) の入力となる migration plan。
 * planId / env / bucket / precondition snapshot を含み、4 重 gate (T7 実装) で照合される。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=<project-id> STORAGE_BUCKET=<bucket> \
 *     npx ts-node scripts/classify-collision-docs.ts [--prefix processed/] [--out plan.json]
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as fs from 'fs';
import {
  classifyCollisionGroup,
  classifyOrphan,
  CollisionDoc,
  CollisionGroup,
  ClassificationResult,
  DocEvidence,
} from './lib/collisionClassifier';
import { regenerateChildPdf } from './lib/pdfRegenerator';

const projectId = process.env.FIREBASE_PROJECT_ID;
const storageBucket = process.env.STORAGE_BUCKET;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}
if (!storageBucket) {
  console.error(
    'STORAGE_BUCKET を設定してください (例: docsplit-kanameone.firebasestorage.app)'
  );
  process.exit(1);
}

function getOpt(name: string, def: string | null = null): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const prefix = getOpt('--prefix', 'processed/')!;
const outFile = getOpt('--out', null);

admin.initializeApp({ projectId, storageBucket });
const db = admin.firestore();
const bucket = admin.storage().bucket();

interface RawDoc extends CollisionDoc {
  _raw: admin.firestore.DocumentData;
}

function tsToIso(ts: unknown): string | null {
  if (!ts) return null;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    return (ts as { toDate(): Date }).toDate().toISOString();
  }
  return String(ts);
}

function pathFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^gs:\/\/[^/]+\/(.+)$/);
  return m ? m[1] : null;
}

function extractPathIfBucketMatches(
  url: string | null | undefined,
  expectedBucket: string
): string | null {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  if (m[1] !== expectedBucket) return null;
  return m[2];
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function loadAllDocs(): Promise<RawDoc[]> {
  const snap = await db.collection('documents').get();
  const all: RawDoc[] = [];
  snap.forEach((doc) => {
    const data = doc.data();
    all.push({
      id: doc.id,
      status: data.status,
      fileName: data.fileName,
      fileUrl: data.fileUrl ?? null,
      parentDocumentId: data.parentDocumentId ?? null,
      splitFromPages: data.splitFromPages ?? null,
      rotatedAt: tsToIso(data.rotatedAt),
      processedAt: tsToIso(data.processedAt),
      updatedAt: tsToIso(data.updatedAt),
      _raw: data,
    });
  });
  return all;
}

async function listStorageFiles(prefixPath: string): Promise<Set<string>> {
  const all = new Set<string>();
  let token: string | undefined;
  do {
    const [files, nextQuery] = await bucket.getFiles({
      prefix: prefixPath,
      maxResults: 1000,
      pageToken: token,
      autoPaginate: false,
    });
    files.forEach((f) => all.add(f.name));
    token = (nextQuery as { pageToken?: string } | undefined)?.pageToken;
  } while (token);
  return all;
}

async function downloadIfExists(path: string): Promise<Buffer | null> {
  try {
    const [buf] = await bucket.file(path).download();
    return buf;
  } catch {
    return null;
  }
}

/** doc 1 件分の hash evidence + parent context を gather (Firestore/Storage I/O) */
async function buildDocEvidence(
  doc: CollisionDoc,
  storagePaths: Set<string>,
  parentCache: Map<string, RawDoc | null>,
  parentBufferCache: Map<string, Buffer | null>
): Promise<DocEvidence> {
  // parent context
  let parent: DocEvidence['parent'] = null;
  if (doc.parentDocumentId !== null) {
    let parentDoc = parentCache.get(doc.parentDocumentId);
    if (parentDoc === undefined) {
      const snap = await db.doc(`documents/${doc.parentDocumentId}`).get();
      if (snap.exists) {
        const data = snap.data()!;
        parentDoc = {
          id: snap.id,
          status: data.status,
          fileName: data.fileName,
          fileUrl: data.fileUrl ?? null,
          parentDocumentId: data.parentDocumentId ?? null,
          splitFromPages: data.splitFromPages ?? null,
          rotatedAt: tsToIso(data.rotatedAt),
          processedAt: tsToIso(data.processedAt),
          updatedAt: tsToIso(data.updatedAt),
          _raw: data,
        };
      } else {
        parentDoc = null;
      }
      parentCache.set(doc.parentDocumentId, parentDoc);
    }

    if (parentDoc === null) {
      parent = { exists: false };
    } else {
      const parentPath = pathFromUrl(parentDoc.fileUrl);
      const parentPdfExists = parentPath !== null && storagePaths.has(parentPath);
      parent = { exists: true, originalPdfExists: parentPdfExists };
    }
  }

  // hash evidence (Storage 実体 sha256 vs 親から再生成した期待 sha256)
  const docPath = pathFromUrl(doc.fileUrl);
  if (docPath === null || !storagePaths.has(docPath)) {
    return {
      doc,
      hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
      parent,
    };
  }
  if (doc.parentDocumentId === null || doc.splitFromPages === null) {
    return {
      doc,
      hashEvidence: { type: 'unavailable', reason: 'no-parent' },
      parent,
    };
  }
  if (parent === null || !parent.exists) {
    return {
      doc,
      hashEvidence: { type: 'unavailable', reason: 'no-parent' },
      parent,
    };
  }
  if (!parent.originalPdfExists) {
    return {
      doc,
      hashEvidence: { type: 'unavailable', reason: 'no-parent-original-pdf' },
      parent,
    };
  }

  try {
    const actualBuf = await downloadIfExists(docPath);
    if (actualBuf === null) {
      return {
        doc,
        hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
        parent,
      };
    }

    let parentBuf = parentBufferCache.get(doc.parentDocumentId);
    if (parentBuf === undefined) {
      const parentDoc = parentCache.get(doc.parentDocumentId)!;
      const parentPath = pathFromUrl(parentDoc!.fileUrl);
      parentBuf = parentPath ? await downloadIfExists(parentPath) : null;
      parentBufferCache.set(doc.parentDocumentId, parentBuf);
    }
    if (parentBuf === null) {
      return {
        doc,
        hashEvidence: { type: 'unavailable', reason: 'no-parent-original-pdf' },
        parent,
      };
    }

    const expectedBuf = await regenerateChildPdf(
      parentBuf,
      doc.splitFromPages.start,
      doc.splitFromPages.end
    );
    const actualHash = sha256(actualBuf);
    const expectedHash = sha256(expectedBuf);
    if (actualHash === expectedHash) {
      return { doc, hashEvidence: { type: 'matched', sha256: actualHash }, parent };
    }
    return {
      doc,
      hashEvidence: {
        type: 'mismatched',
        actualSha256: actualHash,
        expectedSha256: expectedHash,
      },
      parent,
    };
  } catch (err) {
    console.warn(`hash computation failed for doc ${doc.id}: ${(err as Error).message}`);
    return {
      doc,
      hashEvidence: { type: 'unavailable', reason: 'computation-error' },
      parent,
    };
  }
}

interface MigrationOperation {
  operationId: string;
  docId: string;
  classification: ClassificationResult['classification'];
  recommendedAction: ClassificationResult['recommendedAction'];
  reason: string;
  suggestedWinner: boolean;
  // precondition snapshot (T7 4 重 gate で照合)
  expectedCurrentFileUrl: string | null;
  expectedStatus: string;
  expectedUpdatedAt: string | null;
  // path 情報
  sourcePath: string | null;
  destPath: string | null;
  // 親情報 (regenerate-from-parent 時に必要)
  parentDocumentId: string | null;
  splitFromPages: { start: number; end: number } | null;
  fileName: string;
}

function buildOperation(
  doc: CollisionDoc,
  result: ClassificationResult,
  opCounter: { n: number }
): MigrationOperation {
  const sourcePath = pathFromUrl(doc.fileUrl);
  const destPath =
    result.recommendedAction === 'migrate-to-namespace' ||
    result.recommendedAction === 'regenerate-from-parent'
      ? `${prefix}${doc.id}/${doc.fileName}`
      : null;

  opCounter.n += 1;
  return {
    operationId: `op-${String(opCounter.n).padStart(4, '0')}`,
    docId: doc.id,
    classification: result.classification,
    recommendedAction: result.recommendedAction,
    reason: result.reason,
    suggestedWinner: result.suggestedWinner,
    expectedCurrentFileUrl: doc.fileUrl,
    expectedStatus: doc.status,
    expectedUpdatedAt: doc.updatedAt,
    sourcePath,
    destPath,
    parentDocumentId: doc.parentDocumentId,
    splitFromPages: doc.splitFromPages,
    fileName: doc.fileName,
  };
}

async function main(): Promise<void> {
  console.log(`Project: ${projectId}`);
  console.log(`Bucket : ${bucket.name}`);
  console.log(`Prefix : ${prefix}\n`);

  const planId = `plan-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto
    .randomBytes(4)
    .toString('hex')}`;

  console.log('Loading documents collection...');
  const allDocs = await loadAllDocs();
  console.log(`Total documents: ${allDocs.length}`);

  const targetDocs = allDocs.filter((d) => {
    const path = pathFromUrl(d.fileUrl);
    return path && path.startsWith(prefix);
  });
  console.log(
    `Documents with fileUrl matching prefix "${prefix}": ${targetDocs.length}\n`
  );

  console.log(`Listing Storage files under prefix "${prefix}"...`);
  const storagePaths = await listStorageFiles(prefix);
  console.log(`Storage files: ${storagePaths.size}\n`);

  // sanity check (audit-storage-mismatch.js と同じ false negative 防止)
  if (targetDocs.length > 0 && storagePaths.size === 0) {
    console.error(
      `FATAL: ${targetDocs.length} docs reference prefix="${prefix}" but Storage list is empty. Aborting to prevent false LostOrUnrecoverable classification.`
    );
    await admin.app().delete();
    process.exit(2);
  }

  // 衝突 group + orphan を分離
  const byFileName = new Map<string, RawDoc[]>();
  const orphanDocs: RawDoc[] = [];
  for (const d of targetDocs) {
    const path = pathFromUrl(d.fileUrl);
    if (path && !storagePaths.has(path)) {
      orphanDocs.push(d);
    }
    if (!d.fileName) continue;
    if (!byFileName.has(d.fileName)) byFileName.set(d.fileName, []);
    byFileName.get(d.fileName)!.push(d);
  }
  const collisionGroups = [...byFileName.entries()].filter(
    ([, docs]) => docs.length > 1
  );
  console.log(
    `Collision groups: ${collisionGroups.length} | fileUrl orphans: ${orphanDocs.length}\n`
  );

  const parentCache = new Map<string, RawDoc | null>();
  const parentBufferCache = new Map<string, Buffer | null>();
  const opCounter = { n: 0 };
  const operations: MigrationOperation[] = [];
  const summary = {
    totalGroups: collisionGroups.length,
    totalCollisionDocs: collisionGroups.reduce((sum, [, docs]) => sum + docs.length, 0),
    totalOrphans: orphanDocs.length,
    byClassification: {
      MatchedByHash: 0,
      Ambiguous: 0,
      RepairableMissingFile: 0,
      LostOrUnrecoverable: 0,
    },
    byAction: {
      'migrate-to-namespace': 0,
      'regenerate-from-parent': 0,
      'manual-review': 0,
      'mark-error': 0,
    },
  };

  // 衝突 group の classify
  console.log('Classifying collision groups...');
  let groupIdx = 0;
  for (const [fileName, docs] of collisionGroups) {
    groupIdx += 1;
    if (groupIdx % 10 === 0) {
      console.log(`  ${groupIdx}/${collisionGroups.length} groups processed`);
    }
    const evidences: DocEvidence[] = [];
    for (const d of docs) {
      evidences.push(await buildDocEvidence(d, storagePaths, parentCache, parentBufferCache));
    }
    const group: CollisionGroup = { fileName, evidences };
    const results = classifyCollisionGroup(group);
    for (const r of results) {
      const doc = docs.find((d) => d.id === r.docId)!;
      const op = buildOperation(doc, r, opCounter);
      operations.push(op);
      summary.byClassification[r.classification] += 1;
      summary.byAction[r.recommendedAction] += 1;
    }
  }

  // orphan の classify
  console.log(`\nClassifying ${orphanDocs.length} orphans...`);
  for (const d of orphanDocs) {
    const evidence = await buildDocEvidence(d, storagePaths, parentCache, parentBufferCache);
    const result = classifyOrphan(evidence);
    const op = buildOperation(d, result, opCounter);
    operations.push(op);
    summary.byClassification[result.classification] += 1;
    summary.byAction[result.recommendedAction] += 1;
  }

  const plan = {
    planId,
    createdAt: new Date().toISOString(),
    environment: process.env.ENVIRONMENT_LABEL ?? projectId, // CI 経由で渡される環境 label (optional)
    projectId,
    bucket: bucket.name,
    prefix,
    summary,
    operations,
  };

  const json = JSON.stringify(plan, null, 2);
  if (outFile) {
    fs.writeFileSync(outFile, json);
    console.log(`\nPlan written to: ${outFile}`);
  }
  console.log('\n=== Plan summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`planId: ${planId}`);
  console.log(`operations: ${operations.length}`);

  if (!outFile) {
    console.log('\n--- Plan JSON (use --out <file> to save) ---');
    console.log(json);
  }

  await admin.app().delete();
}

main().catch(async (err) => {
  console.error('Failed:', err);
  try {
    await admin.app().delete();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
