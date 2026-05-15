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

// ============================================================================
// Phase C types (impl-plan §4.3、AC BF10/BF11/BF14/BF16/BF18/BF21/BF22/BF23)
// ============================================================================

/**
 * Phase C で取得する GCS sentinel lock の body (impl-plan §4.3 step 1)。
 *
 * 設計判断:
 * - `runId`: Phase A/B/C で同一の runId を使う (manifest と整合)
 * - `jobId`: Cloud Run Job execution ID (Phase C 起動側で生成、stale lock 解放時に
 *   Cloud Run Console と照合する人間判断材料)
 * - `startedAt`: lock 取得時刻 (lease 60 min 計算基準、stale 判定の参考)
 * - `expectedDuration`: 計画見込み時間 (秒、観測用)
 * - `lockOwner`: GitHub Actions run / 手動実行など lock 取得元 ('github-actions-run-{N}' 等)
 * - `lockSchemaVersion`: lock body 互換性 (script 改修で bump、parse 失敗時の人間判断助け)
 */
export interface PhaseCLockBody {
  lockSchemaVersion: PrD4ArtifactSchemaVersion;
  runId: string;
  jobId: string;
  startedAt: string;
  expectedDurationSec: number;
  lockOwner: string;
}

/**
 * Phase C rate limiter (token bucket) の設定 (BF23 + Codex 3rd I4 反映)。
 *
 * 設計:
 * - batch / individual update 共通の global token bucket
 * - `tokensPerSecond`: refill rate (100-200 / sec、Codex 2nd L2、dev rehearsal 実測で昇格判断)
 * - `burstCapacity`: 一時的に許容する突発 (= tokensPerSecond 同値で安定運用、Codex 3rd I4)
 * - 実装は monotonic clock + token refill で正確性を担保
 */
export interface PhaseCRateLimiterConfig {
  tokensPerSecond: number;
  burstCapacity: number;
}

/**
 * Phase C 書込成功 1 doc の記録 (BF22 chunk 内)。
 *
 * - `writeStatus`: 'ok' = batch / individual で書込成功
 * - `newProvenanceBackfillSha256`: 書込んだ provenanceBackfill metadata を canonical JSON
 *   で sha256 した値 (Phase D verification の入力)
 * - `lastUpdateTimeAfter`: 書込後の Firestore updateTime (ISO8601、後続 backfill の drift 検出用)
 */
export interface PhaseCWrittenDoc {
  docId: string;
  writeStatus: 'ok';
  newProvenanceBackfillSha256: string;
  lastUpdateTimeAfter: string;
}

/**
 * Phase C precondition 失敗で隔離された 1 doc (BF18、impl-plan §4.3 step 5)。
 *
 * - `reason`: 'lastUpdateTime drift' (precondition 失敗時) / 'transient retry exhausted'
 *   (network / timeout で max retry 超過)
 * - `retryCount`: 個別 update での実行回数 (max=3、impl-plan §4.3 step 5)
 */
export interface PhaseCPreconditionFailedDoc {
  docId: string;
  reason: 'lastUpdateTime drift' | 'transient retry exhausted';
  retryCount: number;
}

/**
 * Phase C immutable skip 記録 (BF14 + Codex 6th Important、impl-plan §4.3 step 5)。
 *
 * 2 種類の skip reason:
 * - `'provenance exists, provenanceBackfill absent'`: PR-D2/D3 で書込まれた verified
 *   split-time provenance を本 PR-D4 backfill が上書きしないガード (BF14)
 * - `'already backfilled (provenanceBackfill present)'`: 別 Phase C run / retry で
 *   既 backfilled doc を再 backfill しない idempotency 保護 (Codex 6th)
 */
export interface PhaseCImmutableSkippedDoc {
  docId: string;
  reason:
    | 'provenance exists, provenanceBackfill absent'
    | 'already backfilled (provenanceBackfill present)';
}

/**
 * Phase C 書込 scope 外 (Codex 5th C1 反映、impl-plan §4.0 hard-gate)。
 *
 * 本 PR Phase C 本番書込対象は `category === 'MatchedByHash' && computedConfidence ===
 * 'derived-bytes-verified'` のみ。Phase B 実装は `MatchedByHash` のみ revalidated[] に入れる
 * が、dev fixture / Phase B のバグ / 将来の Phase B 拡張で異種 candidate が混入した場合に
 * 構造的にガードする。
 *
 * reason:
 * - `'category not MatchedByHash'`: Phase B 出力で `category !== 'MatchedByHash'`
 * - `'confidence not derived-bytes-verified'`: `MatchedByHash` だが confidence が
 *   `child-snapshot-only` / `metadata-only` (dev fixture 用、本番書込禁止)
 */
export interface PhaseCOutOfScopeDoc {
  docId: string;
  reason: 'category not MatchedByHash' | 'confidence not derived-bytes-verified';
  observedCategory: BackfillClassifierCategory;
  observedConfidence: BackfillConfidence;
}

/**
 * Phase C 処理不能 doc 記録 (Codex 5th C2 反映、observability)。
 *
 * 過去 `missingDocs` で扱われていたが、原因区別不能だったため reason 付きに統合。
 * `validation`: `createBackfillProvenance` の runtime validation が throw (sha256 不正等)
 * `missing`: Firestore re-read で doc 不在
 */
export interface PhaseCUnprocessableDoc {
  docId: string;
  reason: 'missing' | 'validation';
  message?: string;
}

/**
 * Phase C 書込 chunk file (BF22、1 chunk ≤ PR_D4_CANDIDATES_PER_CHUNK)。
 *
 * 全カテゴリを chunk 単位で分割保存し、全 chunk を一括メモリロードしない。
 * Codex 5th C2 反映で `unprocessableDocs` / `outOfScopeDocs` を追加 (運用観測完全性)。
 *
 * 保全式 (chunk 全件):
 *   writtenDocs + preconditionFailedDocs + immutableSkippedDocs + unprocessableDocs +
 *   outOfScopeDocs == 該当 chunk に渡された候補件数
 */
export interface PhaseCBackfillChunk {
  schemaVersion: PrD4ArtifactSchemaVersion;
  chunkIndex: number;
  writtenDocs: PhaseCWrittenDoc[];
  preconditionFailedDocs: PhaseCPreconditionFailedDoc[];
  immutableSkippedDocs: PhaseCImmutableSkippedDoc[];
  unprocessableDocs: PhaseCUnprocessableDoc[];
  outOfScopeDocs: PhaseCOutOfScopeDoc[];
}

/**
 * Phase C main artifact 構造 (impl-plan §4.3 output)。
 *
 * 設計:
 * - `candidatesIn`: Phase B revalidated[] 全件
 * - `writtenDocs`: 書込成功合計 (chunks の writtenDocs.length 合計と一致)
 * - `preconditionFailedDocs`: 隔離合計 (chunks の preconditionFailedDocs.length 合計と一致)
 * - `skippedImmutable`: immutable skip 合計 (BF14 検証用)
 * - `phaseBArtifactRef`: Phase B main artifact path (manifest chain 再構成可能)
 * - `phaseBManifestSha256`: Phase C 起動時に検証した Phase B manifest sha256
 * - `lockAcquiredGeneration`: 取得した GCS sentinel lock の generation (BF21、解放時に
 *   ifGenerationMatch 必須 = 安全解放確認の証跡)
 * - `lockReleasedAt`: lock 解放完了時刻 (ISO8601、stale lock detection の人間判断材料)
 * - `rateLimiterConfig`: 使用した rate limiter 設定 (BF23、観測用)
 */
export interface PhaseCBackfillSummary {
  phase: 'C';
  schemaVersion: PrD4ArtifactSchemaVersion;
  scriptVersion: PrD4ScriptVersion;
  env: BackfillEnvName;
  runId: string;
  phaseBArtifactRef: string;
  phaseBManifestSha256: string;
  backfillStartedAt: string;
  backfillCompletedAt: string;
  /**
   * 保全式: candidatesIn = writtenDocs + preconditionFailedDocs + skippedImmutable +
   *                       unprocessableDocs + outOfScopeDocs
   * (orchestrator が test でアサート、observability 完全性)
   */
  candidatesIn: number;
  writtenDocs: number;
  preconditionFailedDocs: number;
  skippedImmutable: number;
  /** Codex 5th C2 反映: missing / validation 不能 doc の集計 (silent drop 防止) */
  unprocessableDocs: number;
  /** Codex 5th C1 反映: hard-gate で除外された Phase C スコープ外 doc の集計 */
  outOfScopeDocs: number;
  lockAcquiredGeneration: string;
  /**
   * lock release を要求する直前の時刻 (= finalize 直前の nowProvider 値、Codex 6th Critical 反映)。
   *
   * **重要**: 「実際の release ACK 完了時刻」ではない。Codex 6th Critical で指摘された
   * 「lock release を finalize 前に行うと production-unsafe」を回避するため、
   * 順序は finalize → release で固定し、artifact 内では release **要求** 時刻のみ
   * 記録する。実 release ACK 後の時刻は orchestrator 戻り値 (RunPhaseCResult) でも
   * 同値を返す (artifact 整合性優先)。
   */
  lockReleasedAt: string;
  rateLimiterConfig: PhaseCRateLimiterConfig;
  chunks: ArtifactChunkPointer[];
}

/** Phase C atomic batch 上限 (impl-plan §4.3 step 5、Firestore 上限 500 の余裕値) */
export const PR_D4_PHASE_C_BATCH_SIZE = 20 as const;

/** Phase C individual update retry max (impl-plan §4.3 step 5、transient error 対策) */
export const PR_D4_PHASE_C_INDIVIDUAL_RETRY_MAX = 3 as const;

/** Phase C rate limiter defaults (impl-plan §4.3 / §6.1、Codex 2nd L2) */
export const PR_D4_PHASE_C_DEFAULT_RATE_LIMITER: PhaseCRateLimiterConfig = {
  tokensPerSecond: 100,
  burstCapacity: 100,
} as const;

// ============================================================================
// Phase D types (impl-plan §4.4、AC BF10/BF11/BF12/BF13/BF15、Codex MCP 8th review GO 反映)
// ============================================================================

/**
 * Phase D verify で検出した field mismatch 1 件 (impl-plan §4.4 + Codex 8th Suggestion 1)。
 *
 * `mismatchType` で運用切り分けを高速化:
 * - `'provenance-field'`: `provenance` 10 fields のいずれか不一致 (e.g. sourceSha256 / derivedSha256)
 * - `'backfill-field'`: `provenanceBackfill` Stage 1 field 単位検証で fail (method / confidence /
 *   backfilledAt / evidence.*)
 * - `'sha256'`: Stage 2 deterministic hash 比較で fail (factory 再 invoke 後の sha256 が Phase C
 *   `newProvenanceBackfillSha256` と不一致)
 * - `'missing-expected'`: Phase B candidate index に docId が無い (Phase C と Phase B の同期ズレ)
 *
 * Codex 8th Suggestion 2 反映: observed/expected は JSON scalar union + null。Timestamp や
 * malformed object を記録するため、unknown を許容する側に振る (string 化された JSON 表現 OK)。
 */
export type PhaseDMismatchType =
  | 'provenance-field'
  | 'backfill-field'
  | 'sha256'
  | 'missing-expected';

export interface PhaseDFieldMismatchDoc {
  docId: string;
  mismatchType: PhaseDMismatchType;
  /**
   * 不一致 field 名 (DocumentProvenance 10 keys + provenanceBackfill subfield、sha256 比較時は
   * `'provenanceBackfill.sha256'`、missing-expected 時は `'__phaseBIndex'`)。
   */
  field: string;
  /** observed value (Firestore document から取得)。`null` は不在 / 取得不能 */
  observed: string | number | boolean | null;
  /** expected value (Phase B computedProvenance / Phase C newProvenanceBackfillSha256 由来) */
  expected: string | number | boolean | null;
}

/**
 * Phase D で verify した 1 doc の成功記録 (Codex 8th Critical 1/2 反映)。
 *
 * - `provenanceFieldsConsistent`: provenance 10 fields すべて Phase B `computedProvenance` と一致
 * - `provenanceBackfillSha256Match`: observed metadata を factory 再 invoke して sha256 化した結果が
 *   Phase C `newProvenanceBackfillSha256` と一致 (Stage 2、deterministic hash 二重 validation)
 * - `observedConfidence`: 取得した `provenanceBackfill.confidence` (`BackfillConfidence` の literal)
 * - `observedCreatedAt`: provenance.createdAt の ISO8601 表現 (BF10 検証で document.createdAt と比較)
 */
export interface PhaseDVerifiedDoc {
  docId: string;
  provenanceFieldsConsistent: boolean;
  provenanceBackfillSha256Match: boolean;
  observedConfidence: BackfillConfidence;
  observedCreatedAt: string;
}

/**
 * dev 環境 rotate gate fixture test 結果 (BF12 / BF13)。
 *
 * fixture docId 形式 (Codex 8th 残課題回答 3 反映): `BF13_test_fixture_${runId}_${kind}_${uuid}`
 * (kind = 'verified' | 'child_snapshot_only'、uuid = randomUUID()、prefix + UUID 二重識別)。
 *
 * 本番環境 (cocoro / kanameone) では本 field は `null` (read-only verification のみ、Codex 3rd I6
 * + 7th 回答 6 反映、本番に rotate side effect ゼロを保証)。
 */
export interface PhaseDRotateGateTestResult {
  /** `derived-bytes-verified` fixture で rotate 成功 (BF12) */
  derivedBytesVerified: {
    fixtureDocId: string;
    rotateApiResult: 'success' | 'rejected';
    rotatedAt: string | null;
    rejectionMessage: string | null;
  };
  /** `child-snapshot-only` fixture で failed-precondition reject (BF13) */
  childSnapshotOnly: {
    fixtureDocId: string;
    rotateApiResult: 'success' | 'rejected';
    rotatedAt: string | null;
    rejectionMessage: string | null;
  };
  /**
   * cleanup hook で削除しきれなかった fixture (operator 目視削除を artifact に明示、
   * Codex 8th Important 2 反映)。
   */
  fixtureCleanupFailures: Array<{
    fixtureDocId: string;
    objectPath: string | null;
    error: string;
  }>;
}

/**
 * Phase D coverage 比率 (2 系統、BF15 主指標 + 補助指標、Codex 7th Important 4 反映)。
 *
 * 設計:
 * - `backfillAttemptCoverage`: Phase C candidatesIn (本 run で backfill 試行した母集団) 基準。
 *   分母 = `phaseC.candidatesIn`、各カテゴリの ratio (0.0-1.0)
 * - `estateRotateReadyCoverage`: Phase A totalDocs (env 全 documents) 基準。**BF15 主指標**。
 *   分母 = `phaseA.totalDocs`、kanameone 全体で rotate 可能な状態の比率を直接表現
 *
 * 保全式: `estateRotateReadyCoverage.rotateReadyTotal + notRotateReady === totalDocs`
 */
export interface PhaseDCoverageRatio {
  backfillAttemptCoverage: {
    denominator: number;
    derivedBytesVerified: number;
    childSnapshotOnly: number;
    metadataOnly: number;
    preconditionFailed: number;
    immutableSkipped: number;
  };
  estateRotateReadyCoverage: {
    denominator: number;
    verifiedExisting: number;
    backfilledDerivedBytesVerified: number;
    rotateReadyTotal: number;
    notRotateReady: number;
  };
}

/**
 * Phase D verify 1 chunk (BF22、1 chunk ≤ PR_D4_CANDIDATES_PER_CHUNK)。
 *
 * Codex 9th Critical 3 / Evaluator HIGH / code-reviewer H1 反映:
 * `fieldsMismatch` は **field 単位レコード** 配列。1 doc に複数 field mismatch がある場合、複数件記録される。
 * doc 数の保全式には `mismatchedDocIds` (Set 由来の集計、type は string[]) を使う。
 *
 * 保全式 (chunk 全件、doc 単位):
 *   verifiedDocs.length + uniqueMismatchedDocIds.length === 該当 chunk に渡された Phase C
 *   writtenDocs 件数
 */
export interface PhaseDVerifyChunk {
  schemaVersion: PrD4ArtifactSchemaVersion;
  chunkIndex: number;
  verifiedDocs: PhaseDVerifiedDoc[];
  fieldsMismatchDocs: PhaseDFieldMismatchDoc[];
  /** chunk 内で mismatch を起こした unique docId 集合 (doc 単位保全式の検証用) */
  mismatchedDocIds: string[];
}

/**
 * Phase D main artifact 構造 (impl-plan §4.4 + Codex 7th/8th review 反映)。
 *
 * 設計:
 * - `candidatesIn`: Phase C writtenDocs 総数 (Phase D verify 対象)
 * - `verifiedDocs`: Phase D で再読込 + field 整合 verify 成功した件数 (= chunks の verifiedDocs 合計)
 * - `fieldsConsistent`: provenance 10 fields + provenanceBackfill 全 verify 成功
 * - `fieldsMismatch`: chunks の fieldsMismatchDocs 全件 (BF11 違反の集計)
 * - `createdAtConsistent`: `provenance.createdAt === document.createdAt` を満たした件数 (BF10)
 * - `confidenceDistribution`: observed confidence の集計 (BF11、Phase B 期待と比較)
 * - `provenanceBackfillNullCount`: Codex 8th 回答 4 反映、`provenanceBackfill === null` 件数を
 *   事前検知 (fail-closed 変更前の影響予測)
 * - `rotateGateTest`: dev のみ存在、cocoro/kanameone は `null`
 * - `coverageRatio`: 2 系統 (Codex 7th Important 4)
 * - `phaseACountReadOnly`: Phase A summary を Phase D が取り込む (Codex 7th Important 5)
 * - `phaseBArtifactRef` / `phaseCArtifactRef`: manifest chain authority (Codex 8th 回答 5 反映)
 * - `manifestUpdateStatus`: CAS update 結果 (Codex 8th Important 3 反映、`'pending'` で main 書込、
 *   CAS 後別 status file で結果記録)
 *
 * 保全式 (top-level、Codex 10th Important 2 反映で doc 単位に修正):
 *   verifiedDocs + mismatchedDocCount === candidatesIn (= Phase C writtenDocs、Phase D verify 対象)
 *   createdAtConsistent + createdAtMismatch.length === verifiedDocs (verified 内訳)
 *   streamingDocsObserved === candidatesIn (chunk truncation 検出、orchestrator runtime check)
 *   result.kind === 'verified' ⇒ provenanceBackfillSha256Match === true (verifyDoc 仕様、defensive throw)
 *   estateRotateReadyCoverage.rotateReadyTotal + notRotateReady === 1.0
 *
 * 注: `fieldsConsistent` は「provenance 10 fields + provenanceBackfill Stage 1/2 全 pass」の doc 数。
 *     `mismatchedDocCount` (doc 単位) と `fieldsMismatch.length` (field 単位レコード合計) は別概念。
 *     1 doc が複数 field mismatch を起こすと fieldsMismatch.length > mismatchedDocCount となる。
 */
export interface PhaseDVerifySummary {
  phase: 'D';
  schemaVersion: PrD4ArtifactSchemaVersion;
  scriptVersion: PrD4ScriptVersion;
  env: BackfillEnvName;
  runId: string;
  phaseAArtifactRef: string;
  phaseBArtifactRef: string;
  phaseCArtifactRef: string;
  phaseCManifestSha256: string;
  verifyStartedAt: string;
  verifyCompletedAt: string;
  candidatesIn: number;
  /**
   * verifyDoc が verified を返却した doc 数 (sha256 only mismatch 含まず、mismatch 経路は別途集計)。
   * Codex 9th Critical 3 + Evaluator HIGH 反映で doc 単位カウントを厳密化。
   */
  verifiedDocs: number;
  /** 完全一致 doc 数 (provenance 10 fields + provenanceBackfill Stage 1/2 全 pass) */
  fieldsConsistent: number;
  /**
   * field 単位 mismatch レコード (1 doc に複数 field mismatch あれば複数件)。
   * doc 数の集計は `mismatchedDocCount` で別途保持。
   */
  fieldsMismatch: PhaseDFieldMismatchDoc[];
  /** field 単位 mismatch を起こした unique doc 数 (保全式: verifiedDocs + mismatchedDocCount === candidatesIn) */
  mismatchedDocCount: number;
  createdAtConsistent: number;
  createdAtMismatch: PhaseDFieldMismatchDoc[];
  confidenceDistribution: Record<BackfillConfidence, number>;
  /** Codex 8th 回答 4: provenanceBackfill === null の件数 (fail-closed 変更前影響予測) */
  provenanceBackfillNullCount: number;
  /** Codex 9th Evaluator エッジケース 1: provenanceBackfill field absent (undefined) の件数 */
  provenanceBackfillAbsentCount: number;
  rotateGateTest: PhaseDRotateGateTestResult | null;
  coverageRatio: PhaseDCoverageRatio;
  /** Codex 7th Important 5: Phase A read-only count を Phase D summary に統合 */
  phaseACountReadOnly: {
    totalDocs: number;
    alreadyBackfilled: number;
    verifiedExistingProvenance: number;
    categoryDistribution: Record<BackfillClassifierCategory, number>;
  };
  /**
   * Codex 8th Important 3 反映: main artifact 書込 → CAS update の 2 段階で行うため、main
   * 書込時点では `'pending'` を入れる。CAS 結果は別 status file (`phase-d-finalize-status.json`)
   * に記録し、main artifact は overwrite しない (artifact writer の `ifGenerationMatch: 0` semantics
   * 維持)。
   */
  manifestUpdateStatus: 'pending';
  chunks: ArtifactChunkPointer[];
}

/**
 * Phase D finalize 結果ステータス (Codex 8th Important 3 反映)。
 *
 * main artifact とは独立した別 file に書込 (`phase-d-finalize-status.json`)。CAS 失敗時に main
 * artifact を上書きせず、operator が「main artifact は authoritative ではない」を判断する材料。
 */
export interface PhaseDFinalizeStatus {
  schemaVersion: PrD4ArtifactSchemaVersion;
  runId: string;
  env: BackfillEnvName;
  finalizedAt: string;
  /** 'ok' = CAS 成功、'failed' = CAS で 412 PreconditionFailed (別 process が manifest 書換) */
  manifestUpdateStatus: 'ok' | 'failed';
  expectedGeneration: string;
  /** CAS 失敗時のリトライ手順 (operator 用) */
  remediation?: string;
}
