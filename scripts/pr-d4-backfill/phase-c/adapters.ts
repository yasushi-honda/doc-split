/**
 * Issue #445 PR-D4 S1-4: production concrete adapters for Phase C.
 *
 * - GcsLockStoreImpl: GCS sentinel object 排他 lock (ifGenerationMatch:0 / ifGenerationMatch:<gen>)
 * - FirestoreBatchAdapterImpl: documents collection への atomic batch update + lastUpdateTime precondition
 * - FirestoreIndividualAdapterImpl: batch fallback の doc 単位 update
 *
 * unit test 対象外 (real SDK 接続のため)、dev rehearsal で動作検証。
 * artifact reader / writer は phase-b / phase-a の既存 adapter を再利用する
 * (GcsArtifactReader / GcsArtifactStorageWriter)。
 */

import * as admin from 'firebase-admin';
import type { Bucket } from '@google-cloud/storage';
import type {
  BatchReReadResult,
  BatchUpdateEntry,
  CommitBatchResult,
  FirestoreBatchAdapter,
} from './batchWriter';
import type {
  FirestoreIndividualAdapter,
  IndividualUpdateInput,
  IndividualUpdateResult,
} from './individualRetryWriter';
import type { AcquireResult, LockObjectStore } from './lockManager';

/**
 * GCS sentinel object として lock を扱う production adapter (impl-plan §7.3 / §4.3 step 1)。
 *
 * - acquire: `file.save(body, { preconditionOpts: { ifGenerationMatch: 0 } })`
 *   - 412 Precondition Failed → 既存 lock を read + AcquireResult.acquired=false で返却
 * - release: `file.delete({ preconditionOpts: { ifGenerationMatch: <acquiredGen> } })`
 *   - 412 / 404 は throw (caller 側で stale lock 解放手順を runbook 通り実行)
 */
export class GcsLockStoreImpl implements LockObjectStore {
  constructor(private readonly artifactBucket: Bucket) {}

  private parseAndValidatePath(objectPath: string): string {
    const match = objectPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`invalid GCS object path: ${objectPath}`);
    }
    const [, bucketName, path] = match;
    if (bucketName !== this.artifactBucket.name) {
      throw new Error(
        `lock bucket mismatch: expected ${this.artifactBucket.name}, got ${bucketName} (path=${objectPath})`
      );
    }
    return path;
  }

  async acquire(input: { path: string; body: string }): Promise<AcquireResult> {
    const path = this.parseAndValidatePath(input.path);
    const file = this.artifactBucket.file(path);
    try {
      await file.save(input.body, {
        contentType: 'application/json',
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { cacheControl: 'no-store' },
      });
      const [metadata] = await file.getMetadata();
      return { acquired: true, generation: String(metadata.generation ?? '') };
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 412) {
        // 既存 lock を取得して caller に返却 (人間判断材料)
        const [contents] = await file.download();
        const [metadata] = await file.getMetadata();
        return {
          acquired: false,
          existing: {
            body: contents.toString('utf8'),
            generation: String(metadata.generation ?? ''),
          },
        };
      }
      throw err;
    }
  }

  async release(input: { path: string; acquiredGeneration: string }): Promise<void> {
    const path = this.parseAndValidatePath(input.path);
    const file = this.artifactBucket.file(path);
    await file.delete({
      ignoreNotFound: false,
      preconditionOpts: { ifGenerationMatch: Number(input.acquiredGeneration) },
    });
  }
}

/**
 * Firestore atomic batch + lastUpdateTime precondition の production adapter。
 *
 * commitBatch error 分類 (Codex 1st Critical 4 → 本 PR 反映):
 * - code === 9 (FAILED_PRECONDITION) → kind=batch-failed, reason='precondition'
 * - その他 (UNAVAILABLE / DEADLINE_EXCEEDED 等) → kind=batch-failed, reason='transient'
 *   → caller (orchestrator) が individualRetryWriter で doc 単位 retry / 隔離
 */
export class FirestoreBatchAdapterImpl implements FirestoreBatchAdapter {
  constructor(private readonly db: admin.firestore.Firestore) {}

  async reReadForBatch(docIds: string[]): Promise<Map<string, BatchReReadResult>> {
    const result = new Map<string, BatchReReadResult>();
    // 並行 read は本 PR では避け、順次 get で SDK 自動 throttle に委譲 (Phase A/B と一貫)
    for (const docId of docIds) {
      const snap = await this.db.collection('documents').doc(docId).get();
      if (!snap.exists) {
        result.set(docId, {
          exists: false,
          provenance: undefined,
          provenanceBackfill: undefined,
        });
        continue;
      }
      const data = snap.data() ?? {};
      const updateTimeIso = snap.updateTime?.toDate().toISOString();
      result.set(docId, {
        exists: true,
        updateTime: updateTimeIso,
        provenance: 'provenance' in data ? data.provenance : undefined,
        provenanceBackfill:
          'provenanceBackfill' in data ? data.provenanceBackfill : undefined,
      });
    }
    return result;
  }

  async commitBatch(entries: BatchUpdateEntry[]): Promise<CommitBatchResult> {
    const batch = this.db.batch();
    for (const entry of entries) {
      const docRef = this.db.collection('documents').doc(entry.docId);
      batch.update(
        docRef,
        {
          provenance: entry.provenance,
          provenanceBackfill: entry.provenanceBackfill,
        },
        {
          lastUpdateTime: admin.firestore.Timestamp.fromDate(
            new Date(entry.lastUpdateTimePrecondition)
          ),
        }
      );
    }
    try {
      const writeResults = await batch.commit();
      return {
        kind: 'ok',
        writeResults: entries.map((e, i) => ({
          docId: e.docId,
          updateTime: writeResults[i].writeTime.toDate().toISOString(),
        })),
      };
    } catch (err) {
      const code = (err as { code?: number }).code;
      const message = (err as Error).message ?? String(err);
      if (code === 9) {
        return { kind: 'batch-failed', reason: 'precondition', message };
      }
      return { kind: 'batch-failed', reason: 'transient', message };
    }
  }
}

/**
 * Firestore 個別 update + lastUpdateTime precondition の production adapter。
 *
 * updateOne error 分類:
 * - code === 9 (FAILED_PRECONDITION) → kind=precondition-failed (drift 確定、retry 不要)
 * - その他 → kind=transient, message (retry 対象)
 */
export class FirestoreIndividualAdapterImpl implements FirestoreIndividualAdapter {
  constructor(private readonly db: admin.firestore.Firestore) {}

  async updateOne(input: IndividualUpdateInput): Promise<IndividualUpdateResult> {
    const docRef = this.db.collection('documents').doc(input.docId);
    try {
      const writeResult = await docRef.update(
        {
          provenance: input.provenance,
          provenanceBackfill: input.provenanceBackfill,
        },
        {
          lastUpdateTime: admin.firestore.Timestamp.fromDate(
            new Date(input.lastUpdateTimePrecondition)
          ),
        }
      );
      return { kind: 'ok', updateTime: writeResult.writeTime.toDate().toISOString() };
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 9) {
        return { kind: 'precondition-failed' };
      }
      return {
        kind: 'transient',
        message: (err as Error).message ?? String(err),
      };
    }
  }
}
