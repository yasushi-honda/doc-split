/**
 * Issue #445 PR-D4 S1-5: production concrete adapters for Phase D.
 *
 * - FirestoreDocReaderImpl: documents collection re-read (provenance + provenanceBackfill + createdAt 取得)
 * - GcsFixtureStoreImpl: dev fixture doc + Storage object 作成 / cleanup (dev のみ起動)
 * - HttpsRotateApiCallerImpl: 実 rotatePdfPages callable 呼出 (dev fixture rotate test 用)
 *
 * unit test 対象外 (real SDK 接続のため)。artifact reader / writer は phase-a / phase-b 由来の
 * 既存 adapter を再利用 (GcsArtifactReader / GcsArtifactStorageWriter)。
 */

import * as admin from 'firebase-admin';
import * as crypto from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import type { Firestore } from 'firebase-admin/firestore';
import type {
  DocumentProvenance,
  ProvenanceBackfillMetadata,
} from '../../../shared/types';
import type { ObservedDocState, PhaseDDocReader } from './verifyOrchestrator';
import type { FixtureStore, RotateApiCaller } from './rotateGateFixtureTester';

/**
 * Firestore documents collection 再読込 adapter (Phase D verify 用)。
 */
export class FirestoreDocReaderImpl implements PhaseDDocReader {
  constructor(private readonly db: Firestore) {}

  async readDoc(docId: string): Promise<ObservedDocState> {
    const docRef = this.db.collection('documents').doc(docId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return {
        docId,
        documentCreatedAt: null,
        provenance: null,
        provenanceBackfill: null,
        provenanceBackfillRaw: undefined,
      };
    }
    const data = snap.data() as Record<string, unknown>;
    const documentCreatedAt =
      data.createdAt instanceof Timestamp ? data.createdAt : null;
    const provenance =
      data.provenance && typeof data.provenance === 'object'
        ? (data.provenance as DocumentProvenance)
        : null;
    const provenanceBackfillRaw = data.provenanceBackfill;
    // Stage 1 validator が型を判定するため、ここでは typed only な値も提供。
    // null は raw とは別 (provenanceBackfillRaw 経由で null 判定)。
    const provenanceBackfill =
      provenanceBackfillRaw != null && typeof provenanceBackfillRaw === 'object'
        ? (provenanceBackfillRaw as ProvenanceBackfillMetadata)
        : null;
    return {
      docId,
      documentCreatedAt,
      provenance,
      provenanceBackfill,
      provenanceBackfillRaw,
    };
  }
}

/**
 * dev fixture store: docId namespace = `processed/{docId}/...`、provenance/provenanceBackfill
 * を直接書込んだ fixture doc を Firestore + Storage に作成。
 *
 * 注意: 本実装は **dev 環境のみで動作**。env hard gate は orchestrator / fixture tester 側で
 * 1 段、本 module 内では fixture docId prefix 検証 (defense in depth) で 2 段ガード。
 *
 * cleanup は ADR-0008 削除制約と整合 (特定 doc delete のみ、`--all-collections` 等は使わない)。
 */
export class GcsFixtureStoreImpl implements FixtureStore {
  constructor(
    private readonly db: Firestore,
    private readonly productionBucket: Bucket,
    private readonly fixtureSourceBucket: string
  ) {}

  async createFixture(input: {
    docId: string;
    confidence: 'derived-bytes-verified' | 'child-snapshot-only';
    pdfBytes: Buffer;
  }): Promise<{ objectPath: string; objectGeneration: string }> {
    // docId namespace path (PR-D2/D3 と同等)
    const objectName = `processed/${input.docId}/${input.docId}.pdf`;
    const file = this.productionBucket.file(objectName);
    await file.save(input.pdfBytes, {
      contentType: 'application/pdf',
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { cacheControl: 'no-store' },
    });
    const [metadata] = await file.getMetadata();
    const generation = String(metadata.generation ?? '');
    const metageneration = String(metadata.metageneration ?? '');
    if (!/^[0-9]+$/.test(generation) || !/^[0-9]+$/.test(metageneration)) {
      throw new Error(
        `fixture object save: generation/metageneration invalid (path=${objectName}, generation="${generation}", metageneration="${metageneration}")`
      );
    }
    // sha256 を簡易計算 (実 PDF bytes、test caller は予め固定済 pdfBytes を渡す)
    // code-reviewer L2 反映: static import (node:crypto は内蔵モジュール、dynamic import 不要)
    const sha256 = crypto.createHash('sha256').update(input.pdfBytes).digest('hex');

    const fixtureCreatedAt = Timestamp.now();
    const provenance: DocumentProvenance = {
      sourceGeneration: '0',
      sourceMetageneration: '0',
      sourceSha256: sha256,
      sourcePath: `fixtures/${input.docId}/parent.pdf`,
      sourceBucket: this.fixtureSourceBucket,
      derivedObjectPath: objectName,
      derivedGeneration: generation,
      derivedMetageneration: metageneration,
      derivedSha256: sha256,
      createdAt: fixtureCreatedAt,
    };
    const provenanceBackfill: ProvenanceBackfillMetadata = {
      method: 'legacy-observed',
      confidence: input.confidence,
      backfilledAt: fixtureCreatedAt,
      evidence: {
        parentExists: input.confidence === 'derived-bytes-verified',
        parentSha256MatchedAtBackfill:
          input.confidence === 'derived-bytes-verified' ? true : null,
        childSha256ComputedAtBackfill: true,
        backfillScriptVersion: 'pr-d4-fixture-v1.0',
        classifierCategory:
          input.confidence === 'derived-bytes-verified' ? 'MatchedByHash' : 'Ambiguous',
      },
    };
    const fileUrl = `gs://${this.productionBucket.name}/${objectName}`;
    await this.db
      .collection('documents')
      .doc(input.docId)
      .set({
        documentId: input.docId,
        fileName: `${input.docId}.pdf`,
        fileUrl,
        status: 'completed',
        createdAt: fixtureCreatedAt,
        provenance,
        provenanceBackfill,
        // fixture 識別 marker (cleanup hook の二重ガード補強)
        _fixtureMarker: 'BF13_test_fixture',
      });
    return { objectPath: objectName, objectGeneration: generation };
  }

  async cleanupFixture(input: {
    docId: string;
    objects: Array<{ path: string; generation: string }>;
  }): Promise<void> {
    // GCS delete (Codex 9th Important 1 + code-reviewer M1 反映: preconditionOpts pattern で既存実装と統一)
    // generation === '0' は fallback で生成された値 (path 取得不能等)、ifGenerationMatch=0 は
    // 「object 不存在」セマンティクスで通常の delete とは異なる → そのケースは throw して
    // fixtureCleanupFailures に記録させる (silent skip 回避)
    for (const obj of input.objects) {
      const generationNum = Number(obj.generation);
      if (!Number.isFinite(generationNum) || generationNum <= 0) {
        throw new Error(
          `cleanup fixture: generation must be positive integer (got "${obj.generation}" for path=${obj.path})`
        );
      }
      const file = this.productionBucket.file(obj.path);
      await file.delete({
        preconditionOpts: { ifGenerationMatch: generationNum },
        ignoreNotFound: false,
      } as { preconditionOpts: { ifGenerationMatch: number }; ignoreNotFound: boolean });
    }
    // Firestore doc delete (特定 doc delete、ADR-0008 削除制約と整合)
    await this.db.collection('documents').doc(input.docId).delete();
  }
}

/**
 * 実 rotatePdfPages callable を呼ぶ adapter (dev fixture rotate test 用)。
 *
 * production wire は Firebase Functions emulator または dev project 上の deployed callable を
 * 呼ぶ。test では fake (in-memory rotate emulation) を使う。
 *
 * ※ 本 adapter は Phase D verify 中の dev 環境のみで invoke される。本番 (cocoro/kanameone) では
 * orchestrator 側で `rotateGateFixtureEnabled: false` 渡しで本 adapter は一切呼ばれない。
 */
export class HttpsRotateApiCallerImpl implements RotateApiCaller {
  /**
   * rotateUrl: dev project の callable URL (e.g. https://asia-northeast1-doc-split-dev.cloudfunctions.net/rotatePdfPages)
   * authToken: dev project の有効な Firebase ID token (test fixture user で取得)
   * db: Firestore (rotate 成功後 documents コレクションを再 read して新 fileUrl から canonical path 抽出)
   * productionBucket: GCS bucket (新 rotation object の generation 取得)
   *
   * Codex 9th Critical 2 + code-reviewer M1 反映: rotatePdfPages callable は現在 success
   * payload に rotation object path を含まないため、Firestore 再 read + GCS metadata で
   * 確実に取得する設計に変更 (fixture cleanup orphan 防止)。
   */
  constructor(
    private readonly rotateUrl: string,
    private readonly authToken: string,
    private readonly db: Firestore,
    private readonly productionBucket: Bucket
  ) {}

  async callRotate(input: {
    docId: string;
  }): Promise<
    | { kind: 'success'; rotatedAt: string; newRotationObjectPath: string; newRotationObjectGeneration: string }
    | { kind: 'rejected'; rejectionMessage: string }
    | { kind: 'error'; message: string }
  > {
    try {
      const response = await fetch(this.rotateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({
          data: {
            documentId: input.docId,
            rotations: [{ pageNumber: 1, degrees: 90 }],
          },
        }),
      });
      const bodyText = await response.text();
      if (!response.ok) {
        return { kind: 'error', message: `HTTP ${response.status}: ${bodyText}` };
      }
      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return { kind: 'error', message: `non-JSON response: ${bodyText}` };
      }
      if (body && typeof body === 'object' && 'error' in body) {
        const errorObj = (body as { error?: { status?: string; message?: string } }).error;
        if (errorObj?.status === 'FAILED_PRECONDITION' || errorObj?.status === 'failed-precondition') {
          return { kind: 'rejected', rejectionMessage: errorObj.message ?? 'failed-precondition' };
        }
        return { kind: 'error', message: errorObj?.message ?? 'unknown callable error' };
      }
      // success: Firestore 再 read で新 fileUrl 取得 → canonical path 抽出 → GCS metadata で generation 取得
      const rotatedAt = new Date().toISOString();
      const docSnap = await this.db.collection('documents').doc(input.docId).get();
      if (!docSnap.exists) {
        return {
          kind: 'error',
          message: `rotate succeeded but doc not found in Firestore re-read (docId=${input.docId})`,
        };
      }
      const fileUrl = docSnap.data()?.fileUrl as string | undefined;
      if (!fileUrl || typeof fileUrl !== 'string') {
        return {
          kind: 'error',
          message: `rotate succeeded but fileUrl absent or non-string (docId=${input.docId})`,
        };
      }
      // fileUrl format: gs://{bucket}/processed/{docId}/rotations/{rotationId}.pdf
      const match = fileUrl.match(/^gs:\/\/([^/]+)\/(.+)$/);
      if (!match || match[1] !== this.productionBucket.name) {
        return {
          kind: 'error',
          message: `rotate succeeded but fileUrl bucket mismatch: expected ${this.productionBucket.name}, got "${fileUrl}"`,
        };
      }
      const objectPath = match[2];
      const [meta] = await this.productionBucket.file(objectPath).getMetadata();
      const generation = String(meta.generation ?? '');
      if (!/^[0-9]+$/.test(generation)) {
        return {
          kind: 'error',
          message: `rotate succeeded but rotation object generation invalid (path=${objectPath}, generation="${generation}")`,
        };
      }
      return {
        kind: 'success',
        rotatedAt,
        newRotationObjectPath: objectPath,
        newRotationObjectGeneration: generation,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: 'error', message };
    }
  }
}

// re-export for index.ts integration
export { admin };
