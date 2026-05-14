/**
 * Issue #445 PR-D4 S1-2: Phase A artifact schemas (read-only audit + classify).
 *
 * impl-plan v3.1 §4.1 の artifact 構造を型で固定する。
 *
 * 配置: scripts/pr-d4-backfill/ 配下に独立。Phase B/C/D の型も同ディレクトリで段階追加予定
 * (S1-3 以降)。shared/types.ts に置かないのは frontend bundle と layer 規約を守るため。
 *
 * 参照:
 * - impl-plan: docs/specs/pr-d4-backfill-impl-plan.md §4.1
 * - BackfillClassifierCategory: shared/types.ts (PR-D4 S1-1 で確定済)
 */

import type { BackfillClassifierCategory, BackfillConfidence } from '../../shared/types';

/**
 * artifact schema version (script 改修時に bump)。Phase A/B/C/D で共通の prefix を持つ。
 */
export const PR_D4_ARTIFACT_SCHEMA_VERSION = 'pr-d4-v1.0' as const;
export type PrD4ArtifactSchemaVersion = typeof PR_D4_ARTIFACT_SCHEMA_VERSION;

/**
 * scriptVersion: script 改修で artifact 互換性に影響する場合に bump。
 * schemaVersion と独立: schemaVersion は wire-format、scriptVersion は logic 実装。
 */
export const PR_D4_SCRIPT_VERSION = 'pr-d4-v1.0' as const;
export type PrD4ScriptVersion = typeof PR_D4_SCRIPT_VERSION;

/**
 * 環境名 (Phase A 起動時に CLI / env var で受け取る)。マルチクライアント運用と整合。
 * - dev: doc-split-dev (開発・rehearsal)
 * - cocoro: docsplit-cocoro (本番 539 docs)
 * - kanameone: docsplit-kanameone (本番 5,725 docs)
 */
export type BackfillEnvName = 'dev' | 'cocoro' | 'kanameone';

/**
 * GCS chunk pointer (artifact main file に埋め込み、Phase B/C/D が streaming read 時に
 * sha256 verify するため使う)。BF19/BF22 反映。
 */
export interface ArtifactChunkPointer {
  /** 例: gs://docsplit-kanameone-pr-d4-artifacts/{run-id}/phase-a-classify-summary-chunk-0.json */
  path: string;
  /** chunk file の content sha256 (hex lowercase) */
  sha256: string;
  /** chunk 内の candidates 件数 (chunking 規則: 1000 docs/chunk が上限、最終 chunk は ≤ 1000) */
  docCount: number;
}

/**
 * Phase A artifact 内に保持する 1 doc 分の評価結果 (Phase B の入力)。
 *
 * 設計判断:
 * - `category`: 5 分類 (BackfillClassifierCategory)
 * - `reason`: classifier が返した文字列 (Ambiguous の細分化情報を含む、operator 監査用)
 * - `splitFromPages`: Phase B で再 split 検証する際の入力 (Phase A 時点 snapshot)
 * - `firestoreUpdateTime`: Phase B の drift 検出基準 (ISO8601、Firestore Timestamp 由来)
 * - `parent*` フィールド: parent doc が存在しない / parentDocumentId 不在のケースは null
 * - `child*` フィールド: orphan (Storage 実体なし) は null (childObjectPath は記録するが
 *   generation/metageneration は取得不能 = null)
 */
export interface PhaseACandidate {
  docId: string;
  category: BackfillClassifierCategory;
  reason: string;
  firestoreUpdateTime: string;
  /** child Storage 内 object path (gs:// prefix なし、bucket は env 共通) */
  childObjectPath: string | null;
  childGeneration: string | null;
  childMetageneration: string | null;
  /** parent doc id (split 親、document.parentDocumentId 由来) */
  parentDocId: string | null;
  parentObjectPath: string | null;
  parentGeneration: string | null;
  parentMetageneration: string | null;
  /** 子 doc の document.splitFromPages snapshot (Phase B の再 split で必要) */
  splitFromPages: { start: number; end: number } | null;
}

/**
 * Phase A artifact (main file) の構造。chunks 配列 + summary metadata のみで、
 * candidates 本体は別 chunk file に格納 (BF22 chunked streaming 反映)。
 */
export interface PhaseAClassifySummary {
  phase: 'A';
  schemaVersion: PrD4ArtifactSchemaVersion;
  scriptVersion: PrD4ScriptVersion;
  env: BackfillEnvName;
  /** Phase A 実行を一意識別する ID (例: 20260514T100000Z-dev-pr-d4-v1) */
  runId: string;
  /** Firestore snapshot 読込開始時刻 (ISO8601 UTC) */
  snapshotStartedAt: string;
  /** Firestore snapshot 読込完了時刻 (ISO8601 UTC) */
  snapshotCompletedAt: string;
  /** target bucket の region (Codex 2nd I4 / BF19 反映) */
  bucketLocation: string;
  /** Cloud Run Job 実行 region */
  cloudRunJobLocation: string;
  /** bucketLocation === cloudRunJobLocation の検証結果 (egress 無料 assertion) */
  egressFreeAssertion: boolean;
  /** documents collection 全件数 (alreadyBackfilled + verifiedExistingProvenance + Σcategoryを含む) */
  totalDocs: number;
  /**
   * 5 分類別の candidate 件数。`alreadyBackfilled` + `verifiedExistingProvenance` は除外。
   * keys は BackfillClassifierCategory の全 5 値が必ず present (0 件でも 0 を記録)。
   */
  categoryDistribution: Record<BackfillClassifierCategory, number>;
  /**
   * provenanceBackfill 既存 doc 件数 (PR-D4 で再 backfill しない、count のみ artifact 化)。
   */
  alreadyBackfilled: number;
  /**
   * provenance 存在 + provenanceBackfill 不在 = verified split-time provenance (PR-D2/D3 生成、
   * ADR MUST 7 で immutable skip)。candidates には含めず count のみ artifact 化。
   */
  verifiedExistingProvenance: number;
  /** candidates を格納した chunk file の pointers (順序保持) */
  chunks: ArtifactChunkPointer[];
}

/**
 * Phase A chunk file の構造 (1000 candidates まで含む)。main artifact から chunks[] で参照。
 */
export interface PhaseAClassifyChunk {
  schemaVersion: PrD4ArtifactSchemaVersion;
  /** chunks[] 配列内 index (0-based) */
  chunkIndex: number;
  candidates: PhaseACandidate[];
}

/**
 * manifest.json の構造 (BF19/BF22 反映)。
 *
 * Phase A 完了時に書込み、Phase B/C/D 各 phase 完了時に同じ manifest を更新追記する
 * (各 phase chunk の sha256 と path を蓄積)。
 *
 * 設計:
 * - `runId`: Phase A の runId と同一 (cross-phase で 1 run = 1 manifest)
 * - `phaseA.mainArtifact`: main artifact file の {path, sha256}
 * - `phaseA.chunks`: PhaseAClassifySummary.chunks と同内容 (重複だが consumer の便宜)
 * - Phase B/C/D 追記時は `phaseB`/`phaseC`/`phaseD` field を additive で増やす
 */
export interface BackfillManifest {
  schemaVersion: PrD4ArtifactSchemaVersion;
  runId: string;
  env: BackfillEnvName;
  phaseA?: {
    mainArtifact: { path: string; sha256: string };
    chunks: ArtifactChunkPointer[];
  };
  phaseB?: {
    mainArtifact: { path: string; sha256: string };
    chunks: ArtifactChunkPointer[];
  };
  phaseC?: {
    mainArtifact: { path: string; sha256: string };
    chunks: ArtifactChunkPointer[];
  };
  phaseD?: {
    mainArtifact: { path: string; sha256: string };
    chunks: ArtifactChunkPointer[];
  };
}

/** chunk 1 件あたり最大件数 (impl-plan §4.1 BF19 / BF22 反映) */
export const PR_D4_CANDIDATES_PER_CHUNK = 1000 as const;

// ============================================================================
// Phase B types (impl-plan §4.2)
// ============================================================================

/**
 * Phase B drift skip 種別ごとのカウンタ (BF9 / impl-plan §4.2)。
 *
 * - `firestoreUpdateTimeChanged`: Phase A 取得後に Firestore doc が更新された (status 変化等)
 * - `childGenerationChanged`: Phase A 取得後に child Storage object が更新された
 *   (rotate / replace / delete-then-write 等)
 * - `parentGenerationChanged`: Phase A 取得後に parent Storage object が更新された
 *   (MatchedByHash の再 split 検証で parent も再照合するため検出される)
 */
export interface PhaseBDriftSkipped {
  firestoreUpdateTimeChanged: number;
  childGenerationChanged: number;
  parentGenerationChanged: number;
}

/**
 * Phase B revalidated 1 candidate (impl-plan §4.2 chunk 構造)。
 *
 * 設計判断:
 * - 本 PR スコープでは **MatchedByHash かつ drift 無し かつ re-split verify 結果記録済**
 *   のみが revalidated[] に入る。Phase C で `provenance` + `provenanceBackfill` 書込対象は
 *   `computedConfidence === 'derived-bytes-verified'` 限定 (ADR MUST 7 + impl-plan §4.0)
 * - `computedProvenance` は Phase C atomic batch に渡す 10 fields を完全構築済。caller は
 *   `createBackfillProvenance()` factory にそのまま渡せる
 * - `computedConfidence === 'derived-bytes-verified'`: re-split で sha256 一致確認済
 * - `computedConfidence === 'child-snapshot-only'`: re-split で sha256 不一致 (dev fixture
 *   テスト用、本番 Phase C は書込しない)
 * - `evidence` は ProvenanceBackfillMetadata.evidence に詰込まれる runtime 整合性検証情報
 */
export interface PhaseBRevalidatedCandidate {
  docId: string;
  category: BackfillClassifierCategory;
  computedConfidence: BackfillConfidence;
  computedProvenance: {
    sourceGeneration: string;
    sourceMetageneration: string;
    sourceSha256: string;
    sourcePath: string;
    sourceBucket: string;
    derivedObjectPath: string;
    derivedGeneration: string;
    derivedMetageneration: string;
    derivedSha256: string;
    /** ISO8601 (= document.createdAt から取得した split 完了時刻、Phase C で Timestamp 化) */
    createdAt: string;
  };
  evidence: {
    parentExists: boolean;
    parentSha256MatchedAtBackfill: boolean;
    childSha256ComputedAtBackfill: boolean;
  };
}

/**
 * Phase B revalidated chunk (1 chunk ≤ PR_D4_CANDIDATES_PER_CHUNK 件)。
 */
export interface PhaseBRevalidatedChunk {
  schemaVersion: PrD4ArtifactSchemaVersion;
  chunkIndex: number;
  revalidated: PhaseBRevalidatedCandidate[];
}

/**
 * Phase B main artifact 構造 (impl-plan §4.2)。
 *
 * 設計:
 * - `candidatesIn`: Phase A artifact から streaming read した candidates 全件
 *   (`PhaseAClassifySummary.totalDocs` ではなく Phase A revalidate 対象 = candidates 配列件数)
 * - `candidatesOut`: revalidated[] に入った件数 = chunks の docCount 合計
 * - `driftSkipped`: drift 検出された件数の内訳 (合計 = candidatesIn - candidatesOut - skipped 他)
 * - `verifyFailedMatchedByHash`: MatchedByHash で drift 無しだが re-split verify 失敗した件数
 *   (本番 Phase C 書込対象外)
 * - `skippedNonMatchedByHash`: Phase A で MatchedByHash 以外の category だった件数
 *   (Phase B では re-split しない、本番 Phase C 書込対象外)
 * - `phaseAArtifactRef`: Phase A main artifact path (consumer が manifest chain を再構成可能)
 * - `phaseAManifestSha256`: Phase B 起動時に検証した manifest sha256 (Phase A → B 連携の整合性)
 */
export interface PhaseBRevalidationSummary {
  phase: 'B';
  schemaVersion: PrD4ArtifactSchemaVersion;
  scriptVersion: PrD4ScriptVersion;
  env: BackfillEnvName;
  runId: string;
  phaseAArtifactRef: string;
  phaseAManifestSha256: string;
  revalidationStartedAt: string;
  revalidationCompletedAt: string;
  candidatesIn: number;
  candidatesOut: number;
  driftSkipped: PhaseBDriftSkipped;
  verifyFailedMatchedByHash: number;
  skippedNonMatchedByHash: number;
  chunks: ArtifactChunkPointer[];
}
