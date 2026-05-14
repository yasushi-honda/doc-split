/**
 * Issue #445 PR-D4 S1-3: production concrete adapters for Phase B.
 *
 * - GcsArtifactReader: artifact bucket からの read 専用 (Phase A 出力を Phase B が読む)
 * - GcsObjectDownloader: production bucket からの download + metadata (child + parent 共通)
 * - FirestoreReReader: documents collection 再 fetch (updateTime + createdAt)
 *
 * unit test 対象外 (real SDK 接続のため)、dev rehearsal で動作検証。
 */

import * as admin from 'firebase-admin';
import type { Bucket } from '@google-cloud/storage';
import type { ArtifactStorageReader } from './artifactReader';
import type { ChildObjectDownloader } from './childRevalidator';
import type { ParentObjectDownloader } from './parentReSplitVerifier';
import type { FirestoreReReader } from './revalidationOrchestrator';

/**
 * GCS bucket からの read (Phase B が Phase A artifact を消費)。
 * `gs://{bucket}/{path}` 形式で受取り、bucket name が一致する artifact bucket からのみ
 * 読み込む (configuration bug 検出)。
 */
export class GcsArtifactReader implements ArtifactStorageReader {
  private artifactBucket: Bucket;

  constructor(artifactBucket: Bucket) {
    this.artifactBucket = artifactBucket;
  }

  async readJson(objectPath: string): Promise<{ content: string; generation: number }> {
    const match = objectPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`invalid GCS object path: ${objectPath}`);
    }
    const [, bucketName, path] = match;
    if (bucketName !== this.artifactBucket.name) {
      throw new Error(
        `artifact bucket mismatch: expected ${this.artifactBucket.name}, got ${bucketName} (path=${objectPath})`
      );
    }
    const file = this.artifactBucket.file(path);
    const [contents] = await file.download();
    const [metadata] = await file.getMetadata();
    return {
      content: contents.toString('utf8'),
      generation: Number(metadata.generation ?? 0),
    };
  }
}

/**
 * production bucket からの object download (bytes + metadata)。
 * child / parent 両方の downloader interface を satisfies する (両者は型同一)。
 */
export class GcsObjectDownloader implements ChildObjectDownloader, ParentObjectDownloader {
  private productionBucket: Bucket;

  constructor(productionBucket: Bucket) {
    this.productionBucket = productionBucket;
  }

  async download(
    objectPath: string
  ): Promise<{ bytes: Buffer; generation: string; metageneration: string } | null> {
    try {
      const file = this.productionBucket.file(objectPath);
      const [bytes] = await file.download();
      const [metadata] = await file.getMetadata();
      return {
        bytes,
        generation: String(metadata.generation ?? ''),
        metageneration: String(metadata.metageneration ?? ''),
      };
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 404) return null;
      throw err;
    }
  }

  async getMetadataOnly(
    objectPath: string
  ): Promise<{ generation: string; metageneration: string } | null> {
    try {
      const [metadata] = await this.productionBucket.file(objectPath).getMetadata();
      return {
        generation: String(metadata.generation ?? ''),
        metageneration: String(metadata.metageneration ?? ''),
      };
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 404) return null;
      throw err;
    }
  }
}

/**
 * Firestore documents collection から doc を fetch し updateTime + createdAt を取得。
 *
 * ADR-0016 Critical 2 反映: provenance.createdAt = document.createdAt 由来 (split 完了時刻)。
 * - doc 不在: null 返却 (orchestrator が firestoreUpdateTimeChanged 等に分類)
 * - doc 存在だが createdAt 不在 / 不正型: null 返却 (silent epoch fallback 禁止)
 * - doc 存在 + createdAt 正常: { updateTimeIso, createdAtIso } 返却
 */
export class FirestoreReReaderImpl implements FirestoreReReader {
  private db: admin.firestore.Firestore;

  constructor(db: admin.firestore.Firestore) {
    this.db = db;
  }

  async fetchDoc(
    docId: string
  ): Promise<{ updateTimeIso: string; createdAtIso: string } | null> {
    const docSnap = await this.db.collection('documents').doc(docId).get();
    if (!docSnap.exists) return null;
    const data = docSnap.data() ?? {};
    const updateTime = docSnap.updateTime;
    if (!updateTime) return null;
    const updateTimeIso = updateTime.toDate().toISOString();

    const createdAt = data.createdAt;
    let createdAtIso: string | null = null;
    if (createdAt && typeof createdAt === 'object' && 'toDate' in createdAt) {
      createdAtIso = (createdAt as { toDate(): Date }).toDate().toISOString();
    } else if (typeof createdAt === 'string' && createdAt.length > 0) {
      createdAtIso = createdAt;
    }
    if (createdAtIso === null) {
      // createdAt 不在 / 不正型 → null 返却で silent epoch fallback 禁止 (evaluator HIGH 1)
      return null;
    }
    return { updateTimeIso, createdAtIso };
  }
}
