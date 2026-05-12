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
// PR-C3c (AC18 / AC19 / AC-SCHEMA / AC-SURVEY-MANIFEST / AC-CC1): 統合 plan schema v3 +
// 親 PDF provenance lib + lockfile gate lib + survey artifact source manifest 検証。
import {
  COLLISION_PLAN_SCHEMA_VERSION,
  PROVENANCE_REQUIRED_BY_ACTION,
  computeSourceManifestHash,
  type Operation,
  type Plan,
  type PlanSummary,
  type ParentPdfProvenance,
  type SourceManifestEntry,
  type SourceManifestRef,
} from './lib/collisionPlanTypes';
import { computeParentPdfProvenance } from './lib/parentPdfProvenance';
import { readLockfileSnapshot } from './lib/lockfileGate';

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

// PR-C3c (AC15-1): --survey-artifact 必須化。pdf-feature-survey.ts の出力 JSON path を
// 受け取り、後続の survey gate (AC15-2 / AC15-3) で expectations + sourceManifestHash を
// 検証する。
const surveyArtifactPath = getOpt('--survey-artifact', null);
if (!surveyArtifactPath) {
  console.error(
    'FATAL: --survey-artifact <survey.json> required (run pdf-feature-survey first; AC15-1)'
  );
  process.exit(2);
}

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

// PR-C3c: MigrationOperation を削除し、scripts/lib/collisionPlanTypes.ts の統合型
// Operation を使う。Operation には PR-C3c で provenanceRequired + provenance (6 fields)
// が追加されている (AC18 / AC19)。

function buildOperation(
  doc: CollisionDoc,
  result: ClassificationResult,
  opCounter: { n: number }
): Operation {
  const sourcePath = pathFromUrl(doc.fileUrl);
  const destPath =
    result.recommendedAction === 'migrate-to-namespace' ||
    result.recommendedAction === 'regenerate-from-parent'
      ? `${prefix}${doc.id}/${doc.fileName}`
      : null;

  opCounter.n += 1;
  // PR-C3c (AC19-1): category → action → provenanceRequired のマッピング。
  // 既存 classifier は既に正しい action を返している (MatchedByHash=migrate-to-namespace,
  // RepairableMissingFile=regenerate-from-parent, Ambiguous=manual-review,
  // LostOrUnrecoverable=mark-error)。Codex Critical C1 は計画書 v1 の誤記指摘で、既存
  // 実装は OK。本関数は action から PROVENANCE_REQUIRED_BY_ACTION lookup table で
  // provenanceRequired を導出する (AC18-1 invariant の plan-side 保証)。
  const provenanceRequired = PROVENANCE_REQUIRED_BY_ACTION[result.recommendedAction];

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
    // PR-C3c (AC18 / AC19): provenanceRequired を action から導出、provenance は後段で
    // async に埋める (regenerate-from-parent のみ親 PDF を download して sha256 計算)。
    provenanceRequired,
    provenance: null,
  };
}

// PR-C3c (AC15): survey artifact の最小型。pdf-feature-survey.ts の出力 JSON 構造
// (top-level の `summary`/`expectations`/`sourceManifestRef`/`sourceManifestEntries`)
// を classify 側で検証するために必要な field のみ宣言する。
interface SurveyArtifact {
  source?: 'local' | 'gcs';
  summary?: {
    filesWithErrors?: number;
  };
  expectations?: {
    filters?: string[];
    subtypes?: string[];
    encrypted?: boolean;
    acroform?: boolean;
    failures?: string[];
  };
  sourceManifestRef?: SourceManifestRef;
  sourceManifestEntries?: SourceManifestEntry[];
}

/**
 * PR-C3c AC15 反映: survey artifact を読込んで survey gate を評価する。
 *
 *  - AC15-1: --survey-artifact 引数必須 (caller 側で確認、本関数は path 受け取り)
 *  - AC15-2: expectations.failures 空 + --expect-* 最低 1 指定 + filesWithErrors === 0
 *  - AC15-3: sourceManifestHash 再計算一致 (caller 側で再 survey して照合する設計)
 *
 * 本関数では (1) artifact 読込 (2) AC15-2 評価 (3) artifact 内部の sourceManifestHash と
 * sourceManifestEntries から再計算した hash が一致することの sanity check を行う。
 *
 * AC15-3 の本質的な改竄検出 (artifact 提示時の現在 Storage 状態との一致) は本 PR では
 * artifact 内部の自己整合性に留め、execute 側 preflight phase で再度 GCS から fetch して
 * 照合する設計に分離する (Codex Q4 反映、HMAC 不要)。
 */
function loadAndValidateSurveyArtifact(artifactPath: string): SurveyArtifact {
  let raw: string;
  try {
    raw = fs.readFileSync(artifactPath, 'utf8');
  } catch (err) {
    console.error(
      `FATAL: cannot read --survey-artifact at ${artifactPath}: ${(err as Error).message}`
    );
    process.exit(2);
  }
  let artifact: SurveyArtifact;
  try {
    artifact = JSON.parse(raw) as SurveyArtifact;
  } catch (err) {
    console.error(
      `FATAL: --survey-artifact ${artifactPath} is not valid JSON: ${(err as Error).message}`
    );
    process.exit(2);
  }

  // AC15-2 (Codex Important I4 反映): --expect-* 最低 1 指定 + failures empty + filesWithErrors === 0
  const expectations = artifact.expectations;
  if (!expectations) {
    console.error(
      `FATAL: survey artifact missing 'expectations' (AC15-2; produced by pdf-feature-survey before PR-C3c?)`
    );
    process.exit(2);
  }
  const expectCount =
    (expectations.filters?.length ?? 0) +
    (expectations.subtypes?.length ?? 0) +
    (expectations.encrypted ? 1 : 0) +
    (expectations.acroform ? 1 : 0);
  if (expectCount === 0) {
    console.error(
      `FATAL: survey artifact has no --expect-* assertions (AC15-2; survey must be run with at least one --expect-filter / --expect-subtype / --expect-encrypted / --expect-acroform)`
    );
    process.exit(2);
  }
  const failures = expectations.failures ?? [];
  if (failures.length > 0) {
    console.error(
      `FATAL: survey gate failed (AC15-2): ${failures.length} expectation(s) not met:`
    );
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(2);
  }
  const filesWithErrors = artifact.summary?.filesWithErrors ?? 0;
  if (filesWithErrors > 0) {
    console.error(
      `FATAL: survey gate failed (AC15-2): ${filesWithErrors} file(s) had errors during survey (filesWithErrors > 0)`
    );
    process.exit(2);
  }

  // AC15-3 内部 sanity: artifact 内の sourceManifestHash と sourceManifestEntries が
  // 自己整合しているか確認 (改竄 / 古い形式の artifact を弾く)。
  const ref = artifact.sourceManifestRef;
  const entries = artifact.sourceManifestEntries;
  if (!ref || !entries) {
    console.error(
      `FATAL: survey artifact missing 'sourceManifestRef' or 'sourceManifestEntries' (AC15-3; artifact must be produced by pdf-feature-survey with PR-C3c changes)`
    );
    process.exit(2);
  }
  const recomputedHash = computeSourceManifestHash(entries);
  if (recomputedHash !== ref.sourceManifestHash) {
    console.error(
      `FATAL: survey artifact self-inconsistency (AC15-3): sourceManifestHash ${ref.sourceManifestHash} but recomputed from entries = ${recomputedHash}. The artifact may have been tampered or produced by a different version of pdf-feature-survey.`
    );
    process.exit(2);
  }

  return artifact;
}

async function main(): Promise<void> {
  console.log(`Project: ${projectId}`);
  console.log(`Bucket : ${bucket.name}`);
  console.log(`Prefix : ${prefix}\n`);

  // PR-C3c (AC15): survey gate を最初に走らせる (重い classify 処理の前で fail-fast)。
  console.log(`Loading and validating survey artifact: ${surveyArtifactPath}`);
  const surveyArtifact = loadAndValidateSurveyArtifact(surveyArtifactPath!);
  console.log(
    `Survey gate passed (AC15): expectations.failures=0, filesWithErrors=0, sourceManifestHash self-consistent\n`
  );

  // PR-C3c (AC-CC1): lockfile snapshot を取得して plan に記録。execute 側 Gate 10 で照合。
  const lockfileSnapshot = readLockfileSnapshot();
  console.log(
    `Lockfile snapshot: hash=${lockfileSnapshot.lockfileHash.slice(0, 16)}... pdfLibLockfileVersion=${lockfileSnapshot.pdfLibLockfileVersion}\n`
  );

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
  const operations: Operation[] = [];
  const summary: PlanSummary = {
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

  // PR-C3c (AC18): regenerate-from-parent op の provenance 6 fields を非同期計算。
  // 親 PDF を Storage から download → sha256 + metadata 取得して plan に記録する。
  // 同一 parent に対する重複計算を避けるため per-(parentDocId, destPath) cache を使う。
  // ただし derivedObjectPath (= destPath) は op 単位で異なるため、parent 単位 cache に
  // derivedObjectPath を後付けする形にする。
  console.log('\nComputing parent PDF provenance for regenerate-from-parent operations...');
  const provenanceParentCache = new Map<string, ParentPdfProvenance>();
  let provenanceComputed = 0;
  let provenanceFailed = 0;
  for (const op of operations) {
    if (op.recommendedAction !== 'regenerate-from-parent') continue;
    if (!op.parentDocumentId || !op.destPath) {
      // schema invariant 違反: regenerate-from-parent は parentDocumentId + destPath 必須。
      // 既存 buildOperation が満たすはずだが念のため fail-fast (Codex C2 反映)。
      console.error(
        `FATAL: op ${op.operationId} action=regenerate-from-parent but parentDocumentId=${op.parentDocumentId} destPath=${op.destPath}. classify logic bug.`
      );
      await admin.app().delete();
      process.exit(2);
    }
    // parent PDF path: 親 doc の fileUrl から path を抜き出すロジックは buildDocEvidence
    // 等で既出。ここでは parentBufferCache の key (parentDocumentId) を起点に Firestore
    // 経由で fileUrl を再取得する代わりに、parentCache から直接拾う。
    const parentDoc = parentCache.get(op.parentDocumentId);
    if (!parentDoc || !parentDoc.fileUrl) {
      console.error(
        `WARN: op ${op.operationId} parentDocumentId=${op.parentDocumentId} not in parentCache or has no fileUrl. Provenance cannot be computed; this op will fail AC18 gate.`
      );
      provenanceFailed += 1;
      continue;
    }
    const parentPath = extractPathIfBucketMatches(parentDoc.fileUrl, bucket.name);
    if (!parentPath) {
      console.error(
        `WARN: op ${op.operationId} parent fileUrl ${parentDoc.fileUrl} not in current bucket ${bucket.name}. Provenance not computed.`
      );
      provenanceFailed += 1;
      continue;
    }
    try {
      // per-parent cache: 同一 parent から複数 child が出る場合 (敗者 + orphan) は
      // sha256 計算を 1 度だけ行い、derivedObjectPath だけ各 op に差し替える。
      const cacheKey = `${parentPath}|${op.destPath}`;
      let provenance = provenanceParentCache.get(cacheKey);
      if (!provenance) {
        provenance = await computeParentPdfProvenance(bucket, parentPath, op.destPath);
        provenanceParentCache.set(cacheKey, provenance);
      }
      op.provenance = provenance;
      provenanceComputed += 1;
    } catch (err) {
      console.error(
        `WARN: op ${op.operationId} provenance computation failed: ${(err as Error).message}`
      );
      provenanceFailed += 1;
    }
  }
  console.log(
    `Provenance computed: ${provenanceComputed} | failed: ${provenanceFailed}\n`
  );

  // AC13: plan に fingerprint algorithm version を記録。execute 側で固定値と照合し、
  // mismatch なら gate reject (pdf-lib upgrade 等で algorithm が変わった古い plan を
  // 新コードで実行することを防ぐ)。
  const hashAlgorithm: FingerprintAlgorithm = HASH_ALGORITHM;

  // PR-C3c (AC-SCHEMA / AC-CC1 / AC-SURVEY-MANIFEST): Plan v3 完成。
  // projectId / storageBucket は冒頭 L39-48 で fail-fast チェック済みのため non-null。
  // tsc flow analysis が main 関数まで narrowing を持ち越せないので明示的に non-null assert。
  const plan: Plan = {
    schemaVersion: COLLISION_PLAN_SCHEMA_VERSION,
    planId,
    createdAt: new Date().toISOString(),
    environment: process.env.ENVIRONMENT_LABEL ?? projectId!, // CI 経由で渡される環境 label (optional)
    projectId: projectId!,
    bucket: bucket.name,
    prefix,
    hashAlgorithm,
    pdfLibVersion,
    lockfileHash: lockfileSnapshot.lockfileHash,
    pdfLibLockfileVersion: lockfileSnapshot.pdfLibLockfileVersion,
    sourceManifestRef: surveyArtifact.sourceManifestRef!,
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
