#!/usr/bin/env ts-node
/**
 * Issue #432 PR-C: 衝突 doc / fileUrl 孤児を 5 分類して JSON レポート出力 (read-only)
 *
 * 既存 scripts/audit-storage-mismatch.js (検出のみ) を発展させ、各 doc に hash evidence +
 * parent context を gather し scripts/lib/collisionClassifier に渡す。
 *
 * 出力 JSON は execute-collision-migration.ts (T7) の入力となる migration plan。
 * planId / env / bucket / precondition snapshot を含み、多重 gate (T7 実装) で照合される。
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
  FingerprintAlgorithm,
} from './lib/collisionClassifier';
import { regenerateChildPdf } from './lib/pdfRegenerator';
import {
  HASH_ALGORITHM,
  computePdfPageVisualFingerprint,
} from './lib/pdfPageVisualFingerprint';
// AC13 拡張 (Codex Important): plan に pdf-lib version も記録。dependency 更新で
// internal API 挙動が変わったときに古い plan が新コードで黙って通るのを防ぐ。
import { version as pdfLibVersion } from 'pdf-lib/package.json';

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

/**
 * gs://<bucket>/<path> の <path> 部分を返す。bucket 一致確認なし。
 * F-B4 後は呼び出し元を狭く保つため、参照箇所を最小化している。
 */
function pathFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^gs:\/\/[^/]+\/(.+)$/);
  return m ? m[1] : null;
}

/**
 * bucket 一致確認付き (PR-D 同等、F-B4 反映)。マルチクライアント環境で別 bucket
 * 参照を本環境の参照と誤計上する false negative を防ぐ。
 */
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


/**
 * Storage の指定 path が実在するか個別 exists() で確認する (cache 付き)。
 * F-A1: parent PDF は `processed/` に限定されない (通常 `original/...`) ため
 * Storage 一覧 (prefix 限定) には載らない。`bucket.file(p).exists()` で個別確認。
 */
async function makeStorageExistenceChecker(): Promise<
  (path: string) => Promise<boolean>
> {
  const cache = new Map<string, boolean>();
  return async (path: string): Promise<boolean> => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    const [exists] = await bucket.file(path).exists();
    cache.set(path, exists);
    return exists;
  };
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

/**
 * F-B3: catch-all で transient 503/403 を「ファイルなし」と誤分類する silent
 * failure を防ぐ。404 のみ absent、それ以外は error として hashEvidence 側で
 * computation-error 扱いにする (LostOrUnrecoverable に流さない)。
 */
type DownloadResult =
  | { kind: 'ok'; buf: Buffer }
  | { kind: 'absent' }
  | { kind: 'error'; message: string };

async function downloadIfExists(path: string): Promise<DownloadResult> {
  try {
    const [buf] = await bucket.file(path).download();
    return { kind: 'ok', buf };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) return { kind: 'absent' };
    return { kind: 'error', message: (err as Error).message };
  }
}

/**
 * doc 1 件分の hash evidence + parent context を gather (Firestore/Storage I/O)
 *
 * F-A1 反映: parent PDF は通常 `original/...` 配下にあり `processed/` Storage 一覧には
 *   載らない。`storageExists(parentPath)` で個別確認 + cache する。
 * F-B3 反映: download の transient error (403/503) は hashEvidence: unavailable +
 *   reason: 'computation-error' として返し、LostOrUnrecoverable に降格させない。
 * F-B4 反映: bucket 不一致の fileUrl は本環境の path として扱わず、
 *   reason: 'bucket-mismatch' で hash 比較不能として返す。
 */
async function buildDocEvidence(
  doc: CollisionDoc,
  storageExists: (path: string) => Promise<boolean>,
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
      // F-B4: bucket 一致確認、不一致の parent は本環境の参照として扱わない
      const parentPath = extractPathIfBucketMatches(parentDoc.fileUrl, bucket.name);
      const parentPdfExists = parentPath !== null && (await storageExists(parentPath));
      parent = { exists: true, originalPdfExists: parentPdfExists };
    }
  }

  // hash evidence (Storage 実体 sha256 vs 親から再生成した期待 sha256)
  // F-B4: bucket mismatch は本環境の path として扱わず unavailable
  const docPath = extractPathIfBucketMatches(doc.fileUrl, bucket.name);
  if (docPath === null) {
    return {
      doc,
      hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
      parent,
    };
  }
  const docPathExists = await storageExists(docPath);
  if (!docPathExists) {
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
    const actualResult = await downloadIfExists(docPath);
    if (actualResult.kind === 'absent') {
      return {
        doc,
        hashEvidence: { type: 'unavailable', reason: 'no-storage-actual' },
        parent,
      };
    }
    if (actualResult.kind === 'error') {
      console.warn(
        `WARN: actual download failed (transient?) docId=${doc.id} path=${docPath}: ${actualResult.message}`
      );
      return {
        doc,
        hashEvidence: { type: 'unavailable', reason: 'computation-error' },
        parent,
      };
    }
    const actualBuf = actualResult.buf;

    let parentBuf = parentBufferCache.get(doc.parentDocumentId);
    if (parentBuf === undefined) {
      const parentDoc = parentCache.get(doc.parentDocumentId)!;
      // F-B4: parent path も bucket 一致確認
      const parentPath = extractPathIfBucketMatches(parentDoc!.fileUrl, bucket.name);
      if (parentPath === null) {
        parentBuf = null;
      } else {
        const parentResult = await downloadIfExists(parentPath);
        if (parentResult.kind === 'ok') {
          parentBuf = parentResult.buf;
        } else if (parentResult.kind === 'error') {
          console.warn(
            `WARN: parent download failed (transient?) parentId=${doc.parentDocumentId} path=${parentPath}: ${parentResult.message}`
          );
          parentBufferCache.set(doc.parentDocumentId, null);
          return {
            doc,
            hashEvidence: { type: 'unavailable', reason: 'computation-error' },
            parent,
          };
        } else {
          parentBuf = null;
        }
      }
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
    // PR-C2: cross-process deterministic visual fingerprint で比較 (pdf-page-visual-v1)
    const actualFp = await computePdfPageVisualFingerprint(actualBuf);
    const expectedFp = await computePdfPageVisualFingerprint(expectedBuf);

    // どちらかが unsupported (encryption/acroform/optional-content/malformed) なら
    // Ambiguous に倒すための unsupported evidence を返す (両方の状態を 1 つに集約)
    if (actualFp.kind === 'unsupported' || expectedFp.kind === 'unsupported') {
      const target = actualFp.kind === 'unsupported' ? actualFp : expectedFp;
      // type narrowing
      if (target.kind === 'unsupported') {
        return {
          doc,
          hashEvidence: {
            type: 'unsupported',
            reason: target.reason,
            detail:
              actualFp.kind === 'unsupported' && expectedFp.kind === 'unsupported'
                ? `actual+expected: ${target.detail}`
                : `${actualFp.kind === 'unsupported' ? 'actual' : 'expected'}: ${target.detail}`,
            algorithm: HASH_ALGORITHM,
          },
          parent,
        };
      }
    }

    if (
      actualFp.kind === 'ok' &&
      expectedFp.kind === 'ok' &&
      actualFp.hex === expectedFp.hex
    ) {
      return {
        doc,
        hashEvidence: {
          type: 'matched',
          fingerprint: actualFp.hex,
          algorithm: HASH_ALGORITHM,
        },
        parent,
      };
    }
    if (actualFp.kind === 'ok' && expectedFp.kind === 'ok') {
      return {
        doc,
        hashEvidence: {
          type: 'mismatched',
          actualFingerprint: actualFp.hex,
          expectedFingerprint: expectedFp.hex,
          algorithm: HASH_ALGORITHM,
        },
        parent,
      };
    }
    // ここに到達するのは defensive case (両方 unsupported かつ最初の分岐から抜けた等)
    return {
      doc,
      hashEvidence: { type: 'unavailable', reason: 'computation-error' },
      parent,
    };
  } catch (err) {
    // silent-failure-hunter I2 反映: 残った throw は regenerateChildPdf 系の permanent
    // failure (parent PDF malformed / page range out-of-bounds / pdf-lib copyPages 失敗)
    // が支配的。computation-error (transient) に流すと operator が永久に retry し続ける
    // silent retry loop になる。unsupported.malformed に倒し、Ambiguous + manual-review
    // 経路 (classifyOrphan / classifyLoserForRegeneration 共通) に確実に到達させる。
    const msg = (err as Error).message;
    console.error(
      `PERMANENT hash failure docId=${doc.id} parentId=${doc.parentDocumentId} msg=${msg}`
    );
    return {
      doc,
      hashEvidence: {
        type: 'unsupported',
        reason: 'malformed',
        detail: `regenerate/fingerprint failure: ${msg}`,
        algorithm: HASH_ALGORITHM,
      },
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
  // precondition snapshot (T7 多重 gate で照合)
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

  // F-B4: bucket 一致確認付きで target 抽出 (別 bucket 参照を本環境に誤計上しない)
  const targetDocs = allDocs.filter((d) => {
    const path = extractPathIfBucketMatches(d.fileUrl, bucket.name);
    return path !== null && path.startsWith(prefix);
  });
  console.log(
    `Documents with fileUrl matching prefix "${prefix}" in bucket "${bucket.name}": ${targetDocs.length}\n`
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

  // F-A2: 衝突 group + orphan を排他的に分離 (orphan を byFileName に push しない)
  const byFileName = new Map<string, RawDoc[]>();
  const orphanDocs: RawDoc[] = [];
  for (const d of targetDocs) {
    const path = extractPathIfBucketMatches(d.fileUrl, bucket.name);
    if (path !== null && !storagePaths.has(path)) {
      orphanDocs.push(d);
      continue; // ★ orphan は collision group 集計から除外 (二重登録防止)
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

  // F-A1: parent PDF 個別 exists() checker (`original/` 配下も含めて検出可能)
  const storageExists = await makeStorageExistenceChecker();

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
      evidences.push(await buildDocEvidence(d, storageExists, parentCache, parentBufferCache));
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
    const evidence = await buildDocEvidence(d, storageExists, parentCache, parentBufferCache);
    const result = classifyOrphan(evidence);
    const op = buildOperation(d, result, opCounter);
    operations.push(op);
    summary.byClassification[result.classification] += 1;
    summary.byAction[result.recommendedAction] += 1;
  }

  // AC13: plan に fingerprint algorithm version を記録。execute 側で固定値と照合し、
  // mismatch なら gate reject (pdf-lib upgrade 等で algorithm が変わった古い plan を
  // 新コードで実行することを防ぐ)。
  const hashAlgorithm: FingerprintAlgorithm = HASH_ALGORITHM;

  const plan = {
    planId,
    createdAt: new Date().toISOString(),
    environment: process.env.ENVIRONMENT_LABEL ?? projectId, // CI 経由で渡される環境 label (optional)
    projectId,
    bucket: bucket.name,
    prefix,
    hashAlgorithm,
    pdfLibVersion,
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
