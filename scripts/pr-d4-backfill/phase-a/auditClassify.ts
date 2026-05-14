/**
 * Issue #445 PR-D4 S1-2: Phase A orchestrator (streaming chunked, BF22 厳密適合).
 *
 * documents collection を全件 stream → docSnapshotter → categoryClassifier →
 * **per-chunk flush** → finalize の pipeline。orchestrator は per-chunk buffer
 * (≤ PR_D4_CANDIDATES_PER_CHUNK 件) のみ保持し全 candidates を一括メモリ保持しない。
 *
 * 処理フロー (impl-plan §4.1, Codex MCP NO-GO 反映):
 *   1. bucket location 検証 (cloud run vs target bucket) - 不一致なら abort
 *   2. documents collection 全件 stream (cursor pagination)
 *   3. 各 doc:
 *      - hasProvenanceBackfill → alreadyBackfilled++ (candidates buffer 入れない)
 *      - hasProvenance && !hasProvenanceBackfill → verifiedExistingProvenance++ (MUST 7)
 *      - 上記以外 → snapshotter で構造観測 → classifier で 5 分類 → buffer 追加
 *   4. buffer が PR_D4_CANDIDATES_PER_CHUNK に達したら writePhaseAChunk で flush
 *   5. streaming 完了後 残 buffer を flush → finalizePhaseAArtifact (main + manifest)
 *
 * 書込責務: Firestore への書込なし (Phase C 担当)。GCS write は artifact bucket のみ。
 */

import type { BackfillClassifierCategory } from '../../../shared/types';
import type {
  ArtifactChunkPointer,
  BackfillEnvName,
  PhaseACandidate,
} from '../types';
import { PR_D4_CANDIDATES_PER_CHUNK } from '../types';
import { classifyForPhaseA } from './categoryClassifier';
import {
  snapshotDocForPhaseA,
  type ParentFetcher,
  type BucketProber,
} from './docSnapshotter';
import { verifyBucketLocation } from './bucketLocationVerifier';
import {
  finalizePhaseAArtifact,
  writePhaseAChunk,
  type ArtifactStorageWriter,
} from './artifactWriter';

/**
 * documents collection 1 doc 分の入力。
 *
 * `hasProvenance` / `hasProvenanceBackfill` は **field existence チェック** で渡す
 * (`'provenance' in data` / `'provenanceBackfill' in data`、Codex 4th review Low 1 反映)。
 */
export interface DocumentSourceRecord {
  id: string;
  fileUrl: string | null;
  parentDocumentId: string | null;
  splitFromPages: { start: number; end: number } | null;
  /** Firestore _updateTime を ISO8601 文字列化 (Phase B drift 検出基準) */
  updateTimeIso: string;
  hasProvenance: boolean;
  hasProvenanceBackfill: boolean;
}

export interface DocumentSource {
  /** documents collection を cursor pagination で全件 stream する */
  streamAll(): AsyncIterable<DocumentSourceRecord>;
}

export interface RunPhaseAInput {
  env: BackfillEnvName;
  runId: string;
  /**
   * 本 environment の production data bucket (例: docsplit-dev.firebasestorage.app)。
   * snapshotter が child/parent PDF の存在確認に使用。**artifact 書込先とは別 bucket** で、
   * artifactBucketName と混同しないこと (両者は別目的、別物理 bucket)。
   */
  productionDataBucketName: string;
  /** artifact (main + chunks + manifest) 保存先 bucket (例: docsplit-dev-pr-d4-artifacts) */
  artifactBucketName: string;
  cloudRunLocation: string;
  bucketLocation: string;
  documentSource: DocumentSource;
  parentFetcher: ParentFetcher;
  bucketProber: BucketProber;
  artifactWriter: ArtifactStorageWriter;
  snapshotStartedAt: string;
  /** テスト時計の DI (省略時 = system clock)。snapshot 完了時刻を artifact に書く */
  nowProvider?: () => string;
}

export interface RunPhaseAResult {
  mainArtifactPath: string;
  manifestPath: string;
  chunkCount: number;
  totalDocs: number;
  alreadyBackfilled: number;
  verifiedExistingProvenance: number;
  categoryDistribution: Record<BackfillClassifierCategory, number>;
  /** artifact 内 snapshotCompletedAt と同一値 (caller がログ出力する canonical 値) */
  snapshotCompletedAt: string;
}

function initCategoryDistribution(): Record<BackfillClassifierCategory, number> {
  return {
    MatchedByHash: 0,
    RepairableMissingFile: 0,
    Ambiguous: 0,
    LostOrUnrecoverable: 0,
    NeedsManualReview: 0,
  };
}

export async function runPhaseA(input: RunPhaseAInput): Promise<RunPhaseAResult> {
  // 1. bucket location 検証 (失敗時は throw で早期 abort、artifact 書込まれない)
  const locationResult = verifyBucketLocation({
    cloudRunLocation: input.cloudRunLocation,
    bucketLocation: input.bucketLocation,
  });

  let totalDocs = 0;
  let alreadyBackfilled = 0;
  let verifiedExistingProvenance = 0;
  const categoryDistribution = initCategoryDistribution();

  // BF22: per-chunk buffer のみ保持 (全 candidates 一括メモリロード禁止)
  const chunkPointers: ArtifactChunkPointer[] = [];
  let buffer: PhaseACandidate[] = [];
  let chunkIndex = 0;

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;
    const pointer = await writePhaseAChunk(
      {
        bucketName: input.artifactBucketName,
        runId: input.runId,
        chunkIndex,
        candidates: buffer,
      },
      input.artifactWriter
    );
    chunkPointers.push(pointer);
    chunkIndex++;
    buffer = [];
  }

  // 2. documents collection 全件 stream
  for await (const doc of input.documentSource.streamAll()) {
    totalDocs++;

    if (doc.hasProvenanceBackfill) {
      alreadyBackfilled++;
      continue;
    }
    if (doc.hasProvenance) {
      verifiedExistingProvenance++;
      continue;
    }

    const { snapshot, candidate } = await snapshotDocForPhaseA({
      doc: {
        id: doc.id,
        fileUrl: doc.fileUrl,
        parentDocumentId: doc.parentDocumentId,
        splitFromPages: doc.splitFromPages,
        updateTimeIso: doc.updateTimeIso,
      },
      bucketName: input.productionDataBucketName,
      parentFetcher: input.parentFetcher,
      bucketProber: input.bucketProber,
    });
    const classification = classifyForPhaseA(snapshot);
    categoryDistribution[classification.category]++;
    buffer.push({
      ...candidate,
      category: classification.category,
      reason: classification.reason,
    });

    if (buffer.length >= PR_D4_CANDIDATES_PER_CHUNK) {
      await flushBuffer();
    }
  }
  // 残 buffer を flush
  await flushBuffer();

  // 3. snapshot 完了時刻 (streaming 直後、main/manifest 書込前)
  const snapshotCompletedAt = (input.nowProvider ?? (() => new Date().toISOString()))();

  // 4. main + manifest 書込 (consumer が manifest 読めれば全 chunk + main 完了 invariant)
  const finalizeResult = await finalizePhaseAArtifact(
    {
      bucketName: input.artifactBucketName,
      runId: input.runId,
      env: input.env,
      snapshotStartedAt: input.snapshotStartedAt,
      snapshotCompletedAt,
      bucketLocation: locationResult.bucketLocation,
      cloudRunJobLocation: locationResult.cloudRunJobLocation,
      egressFreeAssertion: locationResult.egressFreeAssertion,
      totalDocs,
      categoryDistribution,
      alreadyBackfilled,
      verifiedExistingProvenance,
      chunks: chunkPointers,
    },
    input.artifactWriter
  );

  return {
    mainArtifactPath: finalizeResult.mainArtifactPath,
    manifestPath: finalizeResult.manifestPath,
    chunkCount: chunkPointers.length,
    totalDocs,
    alreadyBackfilled,
    verifiedExistingProvenance,
    categoryDistribution,
    snapshotCompletedAt,
  };
}
