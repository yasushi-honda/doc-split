/**
 * Issue #445 PR-D4 S1-2: Phase A doc-snapshotter (Firestore doc + parent + GCS HEAD → PhaseADocSnapshot).
 *
 * 1 doc 分の構造的状態を Firestore + Storage HEAD で観測し、
 *   - PhaseADocSnapshot: classifyForPhaseA() への入力
 *   - PhaseACandidate metadata: artifact に保存する per-doc record
 * を構築する。
 *
 * 依存性逆転: ParentFetcher / BucketProber interface で Firestore / GCS を抽象化し、
 * unit test は in-memory mock で実行する。
 *
 * F-B4 反映: doc.fileUrl の bucket が target bucket と不一致なら childObjectPath は
 * null 扱い (本 environment 外の Storage 参照を本 environment の data として誤計上しない)。
 */

import type { PhaseACandidate } from '../types';
import type { PhaseADocSnapshot } from './categoryClassifier';

export interface ParentFetcher {
  /**
   * parent doc を Firestore から fetch。
   * - 存在しない: null
   * - 存在 + fileUrl なし: { fileUrl: null }
   * - 存在 + fileUrl あり: { fileUrl: 'gs://...' }
   */
  fetchParent(
    parentDocId: string
  ): Promise<{ fileUrl: string | null } | null>;
}

export interface BucketProber {
  /**
   * GCS HEAD 相当。object が存在すれば metadata を返し、404 なら null を返す。
   * 入力 path は bucket name を含まない object path (例: 'processed/doc-1/output.pdf')。
   */
  getMetadata(
    objectPath: string
  ): Promise<{ generation: string; metageneration: string } | null>;
}

export interface SnapshotDocInput {
  doc: {
    id: string;
    fileUrl: string | null;
    parentDocumentId: string | null;
    splitFromPages: { start: number; end: number } | null;
    /** Firestore _updateTime を ISO8601 文字列化 (Phase B drift 検出基準) */
    updateTimeIso: string;
  };
  /** 本 environment の primary bucket 名 (例: docsplit-dev.firebasestorage.app) */
  bucketName: string;
  parentFetcher: ParentFetcher;
  bucketProber: BucketProber;
}

export interface SnapshotDocResult {
  snapshot: PhaseADocSnapshot;
  candidate: Omit<PhaseACandidate, 'category' | 'reason'>;
}

/**
 * `gs://<bucket>/<path>` から path を抽出。`expectedBucket` と一致しない場合は null
 * (本 environment 外 Storage を本 environment data として誤計上しない、F-B4 反映)。
 */
function extractPathIfBucketMatches(
  url: string | null | undefined,
  expectedBucket: string
): string | null {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, bucket, path] = match;
  return bucket === expectedBucket ? path : null;
}

export async function snapshotDocForPhaseA(
  input: SnapshotDocInput
): Promise<SnapshotDocResult> {
  const { doc, bucketName, parentFetcher, bucketProber } = input;

  // --- child object 観測 ---
  const childObjectPath = extractPathIfBucketMatches(doc.fileUrl, bucketName);
  let childMetadata: { generation: string; metageneration: string } | null = null;
  if (childObjectPath !== null) {
    childMetadata = await bucketProber.getMetadata(childObjectPath);
  }
  const childObjectExists = childMetadata !== null;

  // --- parent doc + parent object 観測 ---
  let parentSnapshotState: PhaseADocSnapshot['parent'] = null;
  let parentObjectPath: string | null = null;
  let parentMetadata: { generation: string; metageneration: string } | null = null;

  if (doc.parentDocumentId !== null) {
    const parentDoc = await parentFetcher.fetchParent(doc.parentDocumentId);
    if (parentDoc === null) {
      parentSnapshotState = { exists: false };
    } else {
      parentObjectPath = extractPathIfBucketMatches(parentDoc.fileUrl, bucketName);
      if (parentObjectPath !== null) {
        parentMetadata = await bucketProber.getMetadata(parentObjectPath);
      }
      parentSnapshotState = {
        exists: true,
        originalPdfExists: parentMetadata !== null,
      };
    }
  }

  const snapshot: PhaseADocSnapshot = {
    docId: doc.id,
    parentDocumentId: doc.parentDocumentId,
    splitFromPages: doc.splitFromPages,
    childObjectExists,
    parent: parentSnapshotState,
  };

  const candidate: Omit<PhaseACandidate, 'category' | 'reason'> = {
    docId: doc.id,
    firestoreUpdateTime: doc.updateTimeIso,
    childObjectPath,
    childGeneration: childMetadata?.generation ?? null,
    childMetageneration: childMetadata?.metageneration ?? null,
    parentDocId: doc.parentDocumentId,
    parentObjectPath,
    parentGeneration: parentMetadata?.generation ?? null,
    parentMetageneration: parentMetadata?.metageneration ?? null,
    splitFromPages: doc.splitFromPages,
  };

  return { snapshot, candidate };
}
