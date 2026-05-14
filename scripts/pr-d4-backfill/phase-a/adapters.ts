/**
 * Issue #445 PR-D4 S1-2: production concrete adapters for Phase A.
 *
 * 各 interface (DocumentSource / ParentFetcher / BucketProber / ArtifactStorageWriter) を
 * Firebase admin SDK + @google-cloud/storage で実装する thin wrapper。
 *
 * unit test 対象外 (real SDK 接続のため)。動作検証は dev rehearsal (S2 stage) で行う。
 * 本 file の目的は production wiring を一箇所にまとめ、index.ts を簡潔に保つこと。
 */

import * as admin from 'firebase-admin';
import type { Bucket } from '@google-cloud/storage';
import type {
  DocumentSource,
  DocumentSourceRecord,
} from './auditClassify';
import type { ParentFetcher, BucketProber } from './docSnapshotter';
import type { ArtifactStorageWriter } from './artifactWriter';

/**
 * Firestore _updateTime → ISO8601 UTC 文字列.
 *
 * Firestore admin SDK の DocumentSnapshot.updateTime は write 経由で必ず set される
 * (常に Timestamp 型)。undefined が来るのは未取得 snapshot のみで Phase A の
 * `.get()` 経路では発生しないため、defensive に空時刻を返す。
 */
function timestampToIso(ts: admin.firestore.Timestamp | undefined): string {
  if (!ts) return new Date(0).toISOString();
  return ts.toDate().toISOString();
}

/**
 * Firestore documents collection を cursor pagination で全件 stream する DocumentSource 実装。
 *
 * batchSize 単位で取得し、orderBy('__name__') で安定 cursor を維持する。
 * 大量 docs 環境 (kanameone 5,725 件) でも memory 一括ロードを避ける。
 */
export class FirestoreDocumentSource implements DocumentSource {
  private db: admin.firestore.Firestore;
  private batchSize: number;

  constructor(db: admin.firestore.Firestore, batchSize = 500) {
    this.db = db;
    this.batchSize = batchSize;
  }

  async *streamAll(): AsyncIterable<DocumentSourceRecord> {
    let lastDocId: string | null = null;
    while (true) {
      let query: admin.firestore.Query = this.db
        .collection('documents')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(this.batchSize);
      if (lastDocId !== null) {
        query = query.startAfter(lastDocId);
      }
      const snap = await query.get();
      if (snap.empty) return;
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        yield {
          id: docSnap.id,
          fileUrl: typeof data.fileUrl === 'string' ? data.fileUrl : null,
          parentDocumentId:
            typeof data.parentDocumentId === 'string' ? data.parentDocumentId : null,
          splitFromPages:
            data.splitFromPages &&
            typeof data.splitFromPages.start === 'number' &&
            typeof data.splitFromPages.end === 'number'
              ? { start: data.splitFromPages.start, end: data.splitFromPages.end }
              : null,
          updateTimeIso: timestampToIso(docSnap.updateTime),
          hasProvenance: 'provenance' in data,
          hasProvenanceBackfill: 'provenanceBackfill' in data,
        };
      }
      lastDocId = snap.docs[snap.docs.length - 1].id;
      if (snap.size < this.batchSize) return;
    }
  }
}

/**
 * Firestore documents collection から parent doc を fetch する ParentFetcher 実装。
 *
 * 同一 run 内で同じ parent を何度も参照するケース (split された複数 child が同じ parent)
 * があるため、in-memory LRU cache で同 parent の重複 read を抑制する。
 */
export class FirestoreParentFetcher implements ParentFetcher {
  private db: admin.firestore.Firestore;
  private cache: Map<string, { fileUrl: string | null } | null>;
  private maxCacheSize: number;

  constructor(db: admin.firestore.Firestore, maxCacheSize = 10000) {
    this.db = db;
    this.cache = new Map();
    this.maxCacheSize = maxCacheSize;
  }

  async fetchParent(parentDocId: string): Promise<{ fileUrl: string | null } | null> {
    if (this.cache.has(parentDocId)) {
      return this.cache.get(parentDocId) ?? null;
    }
    const docSnap = await this.db.collection('documents').doc(parentDocId).get();
    const result: { fileUrl: string | null } | null = docSnap.exists
      ? { fileUrl: typeof docSnap.data()?.fileUrl === 'string' ? (docSnap.data()!.fileUrl as string) : null }
      : null;
    if (this.cache.size >= this.maxCacheSize) {
      // 簡易 LRU: 最古キー (insertion order) を 1 件削除
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(parentDocId, result);
    return result;
  }
}

/**
 * GCS Bucket HEAD で object metadata を取得する BucketProber 実装。
 *
 * 404 (object 不在) は null 返却。それ以外のエラーは throw (caller で abort)。
 */
export class GcsBucketProber implements BucketProber {
  private bucket: Bucket;

  constructor(bucket: Bucket) {
    this.bucket = bucket;
  }

  async getMetadata(
    objectPath: string
  ): Promise<{ generation: string; metageneration: string } | null> {
    try {
      const [metadata] = await this.bucket.file(objectPath).getMetadata();
      return {
        generation: String(metadata.generation ?? ''),
        metageneration: String(metadata.metageneration ?? ''),
      };
    } catch (err) {
      // @google-cloud/storage は 404 を ApiError with code 404 として throw する
      const code = (err as { code?: number }).code;
      if (code === 404) return null;
      throw err;
    }
  }
}

/**
 * GCS Bucket に JSON 文字列を書込む ArtifactStorageWriter 実装。
 *
 * 入力 path は `gs://{bucket}/{object}` 形式。bucket name 部分が
 * `this.artifactBucket.name` と一致しない場合は throw (config bug 検出)。
 */
export class GcsArtifactStorageWriter implements ArtifactStorageWriter {
  private artifactBucket: Bucket;

  constructor(artifactBucket: Bucket) {
    this.artifactBucket = artifactBucket;
  }

  async writeJson(objectPath: string, content: string): Promise<void> {
    const match = objectPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`invalid GCS object path (expected gs://bucket/path): ${objectPath}`);
    }
    const [, bucketName, path] = match;
    if (bucketName !== this.artifactBucket.name) {
      throw new Error(
        `artifact bucket mismatch: expected ${this.artifactBucket.name}, got ${bucketName} (path=${objectPath})`
      );
    }
    // ifGenerationMatch: 0 で **既存 object の overwrite を拒否** する (Codex MCP Important 2 反映)。
    // run-id 単位で artifact directory を分けているため、同一 run-id の re-run は
    // 新 run-id を発行することを caller に強制する。これにより Phase B が「古い chunk +
    // 新しい partial main」のような不整合 artifact を読む事故を構造的に閉鎖する。
    await this.artifactBucket.file(path).save(content, {
      contentType: 'application/json',
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        cacheControl: 'no-store',
      },
    });
  }
}
