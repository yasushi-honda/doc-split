/**
 * Issue #432 PR-C3c: Collision migration plan の共通型定義 (schemaVersion v3)。
 *
 * 旧 classify-collision-docs.ts (MigrationOperation) と execute-collision-migration.ts
 * (Operation) が独立に定義していた型を統合し、PR-C3c の以下 AC を反映:
 *
 *   - AC-SCHEMA: plan.schemaVersion 必須 ("collision-plan-v3")。execute 側で literal
 *     比較し、旧 plan は明示的に reject する。
 *   - AC18 / AC19: Operation に provenanceRequired flag + 親 PDF provenance 6 fields。
 *     action ↔ provenanceRequired の組合せは schema invariant として強制 (execute 側
 *     Gate 8 で評価)。
 *   - AC-SURVEY-MANIFEST: Plan に sourceManifestRef を持ち、survey artifact の同 hash
 *     と classify 時に再計算 / execute 時に runtime と再照合する。
 *   - AC-CC1 (Codex Critical 1 plan-side lockfile gate): Plan に lockfileHash +
 *     pdfLibLockfileVersion を持ち、execute Gate 10 で照合。
 *
 * 参考: Codex MCP セカンドオピニオン thread 019e1e7b-1425-77d2-844e-1258858822d1
 * (Critical 5 + Important 6 + 追加 AC 6 件を反映済)。
 */

import crypto from 'crypto';

import type { Classification, RecommendedAction } from './collisionClassifier';

/**
 * 現在の plan schema version。execute-collision-migration.ts は literal 比較で
 * `'collision-plan-v3'` 以外を `exit 2` で reject する (AC-SCHEMA-2)。
 *
 * 旧 v1/v2 plan は存在しない (PR-C2 までは schemaVersion field なしの暗黙 v0 扱い、
 * PR-C3c で v3 として明示化)。
 */
export const COLLISION_PLAN_SCHEMA_VERSION = 'collision-plan-v3' as const;
export type CollisionPlanSchemaVersion = typeof COLLISION_PLAN_SCHEMA_VERSION;

/**
 * 親 PDF provenance snapshot (regenerate-from-parent 時の bytes 不変性証拠)。
 *
 * Codex Q1 反映: 6 fields は全部が「親 PDF bytes 不変」を保証するわけではなく、
 * `sourceSha256 + sourceGeneration` が中核。他は補助 (sourceBucket/sourcePath = 参照先
 * 同一性、sourceMetageneration = metadata 変更検出、derivedObjectPath = どの child 出力
 * をこの parent snapshot から作るかの整合確認)。
 *
 * AC18-2 反映: execute 側照合は本 interface の 6 fields のみ (sourceBucket / sourcePath
 * / sourceGeneration / sourceMetageneration / sourceSha256 / derivedObjectPath)。
 * GCS metadata の size / contentType / md5Hash 等は比較対象外 (irrelevant metadata 変更
 * で false reject を避ける)。bytes 不変判定の主証拠は sourceSha256、sourceGeneration が
 * 中核補助、他 4 fields は識別性確認。
 *
 * AC-PRD-BRIDGE: PR-D2 (Issue #445) で Firestore に永続化する provenance field 名と
 * 一致させる。同名のまま PR-D 側 schema 候補として ADR-0016 で記録する予定。
 */
export interface ParentPdfProvenance {
  /** GCS object generation (PDF 世代、long string) */
  sourceGeneration: string;
  /** GCS object metageneration (metadata 世代) */
  sourceMetageneration: string;
  /** 親 PDF bytes sha256 (中核証拠、AC18-2 主判定) */
  sourceSha256: string;
  /** GCS object path (例: `original/<parentDocId>/<fileName>`) */
  sourcePath: string;
  /** GCS bucket name */
  sourceBucket: string;
  /**
   * 派生 PDF object path (例: `processed/<docId>/<splitFileName>`)。
   * provenance 行レベルでどの child 出力を生成する snapshot かを束ねる。
   */
  derivedObjectPath: string;
}

/**
 * survey artifact 内の単一 PDF object の manifest entry。
 *
 * 対象は GCS object (gcs モード) または local file (local モード、test fixture 用)。
 * local モードでは bucket='local', generation='0', metageneration='0' 固定。
 *
 * AC-SURVEY-MANIFEST 反映: 各 entry の field を安定 sort 順に並べた string を join し、
 * 全体を sha256 することで sourceManifestHash を算出する (`computeSourceManifestHash`)。
 */
export interface SourceManifestEntry {
  /** survey 実行時の bucket (local モードでは 'local') */
  bucket: string;
  /** survey 実行時の prefix (local モードでは '.' 等) */
  prefix: string;
  /** object name (gcs では full path、local では basename) */
  objectName: string;
  /** GCS object generation (local モードでは '0') */
  generation: string;
  /** GCS object metageneration (local モードでは '0') */
  metageneration: string;
  /** byte size */
  size: string;
  /** bytes sha256 (16 進文字列) */
  sha256: string;
}

/**
 * survey artifact reference (AC-SURVEY-MANIFEST)。
 *
 * survey 実行時点の対象 object set を一意特定する hash。bucket/prefix/objectName/
 * generation/metageneration/size/sha256 を安定 sort して sha256。classify 時に同関数で
 * 再計算して一致確認、execute 時も runtime で再計算可能 (preflight 時の二重確認用)。
 *
 * Codex Q4 反映: HMAC 不要、「artifact が今の対象集合から作られたこと」を再計算可能な
 * manifest として保持すれば十分。
 */
export interface SourceManifestRef {
  /** survey 実行時の bucket */
  bucket: string;
  /** survey 実行時の prefix */
  prefix: string;
  /** 安定 sort 後の objects の sha256 (manifest hash) */
  sourceManifestHash: string;
  /** survey artifact の生成時刻 (informational) */
  surveyedAt: string;
}

/**
 * SourceManifestEntry 配列から sourceManifestHash を計算する pure function。
 *
 * 安定 sort + 区切り文字 join で deterministic に hash を出す。classify 側で同関数を
 * 呼んで再計算一致確認できる。
 *
 * @param entries - survey artifact 内の全 manifest entry 配列
 * @returns 16 進 sha256 文字列
 */
export function computeSourceManifestHash(entries: SourceManifestEntry[]): string {
  // 安定 sort: objectName 昇順 (同 objectName は generation 昇順、tiebreaker は不要のはず)
  const sorted = [...entries].sort((a, b) => {
    if (a.objectName !== b.objectName) {
      return a.objectName < b.objectName ? -1 : 1;
    }
    if (a.generation !== b.generation) {
      return a.generation < b.generation ? -1 : 1;
    }
    return 0;
  });
  // 各 entry を改行区切りで join、entry 内は '|' 区切り。null/undefined 混入を防ぐため
  // 全 field を文字列化してから join する。
  const lines = sorted.map((e) =>
    [e.bucket, e.prefix, e.objectName, e.generation, e.metageneration, e.size, e.sha256].join('|')
  );
  const payload = lines.join('\n');
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * 単一 doc に対する migration 操作。
 *
 * action ↔ provenanceRequired の組合せ invariant (AC18-1 / AC-INVARIANT):
 *   - 'regenerate-from-parent'   → provenanceRequired === true、provenance 6 fields 必須
 *   - 'migrate-to-namespace'     → provenanceRequired === false
 *   - 'manual-review'            → provenanceRequired === false
 *   - 'mark-error'               → provenanceRequired === false
 *
 * 上記以外の組合せは execute 側 Gate 8 で gate-rejected。plan 改竄で provenance gate
 * を bypass する経路を schema レベルで塞ぐ (Codex Critical C2 反映)。
 */
export interface Operation {
  /** operation 識別子 (例: `op-0001`、4 桁 0 詰め連番) */
  operationId: string;
  /** Firestore document ID */
  docId: string;
  classification: Classification;
  recommendedAction: RecommendedAction;
  reason: string;
  /** Ambiguous 内の「勝者候補」hint (operator 参考、自動 destructive action には使わない) */
  suggestedWinner: boolean;

  // ─── precondition snapshot (T7 多重 gate で照合) ────────────────
  expectedCurrentFileUrl: string | null;
  expectedStatus: string;
  expectedUpdatedAt: string | null;

  // ─── path 情報 ───────────────────────────────────────────────
  sourcePath: string | null;
  destPath: string | null;

  // ─── 親情報 (regenerate-from-parent 時に必要) ─────────────────
  parentDocumentId: string | null;
  splitFromPages: { start: number; end: number } | null;
  fileName: string;

  // ─── PR-C3c 新規 (AC18 / AC19) ───────────────────────────────
  /**
   * 親 PDF provenance gate を強制するか。action 別に invariant:
   *   - 'regenerate-from-parent' のみ true、それ以外は false。
   * execute Gate 8 で `action` と一緒に検証 (AC-INVARIANT)。
   */
  provenanceRequired: boolean;
  /**
   * 親 PDF provenance snapshot。provenanceRequired === true の場合は必須 (6 fields
   * 全て埋まる)、false の場合は null。execute Gate 9 で runtime 親 PDF と照合 (AC18-2)。
   */
  provenance: ParentPdfProvenance | null;
}

/**
 * collision migration の実行計画 (classify-collision-docs.ts が出力、execute-collision-migration.ts
 * が読込)。
 *
 * v3 schema 必須 fields:
 *   - schemaVersion: literal 'collision-plan-v3' (AC-SCHEMA-1)
 *   - planId / createdAt / environment / projectId / bucket / prefix: 既存
 *   - hashAlgorithm: fingerprint algorithm version (AC13、v1/v2 並記)
 *   - pdfLibVersion: pdf-lib runtime version import 値 (AC13 拡張、後方互換 import gate)
 *   - lockfileHash: package-lock.json 全体 sha256 (AC-CC1-1、Codex Critical 1)
 *   - pdfLibLockfileVersion: package-lock.json から読んだ pdf-lib resolved version (AC-CC1-1、Codex Important I1)
 *   - sourceManifestRef: survey artifact source manifest hash + 関連メタ (AC-SURVEY-MANIFEST)
 *   - summary: 集計値 (operator 監査用)
 *   - operations: Operation[] (per-doc 操作)
 *
 * Codex Critical 1 (Important I1) 反映: pdfLibLockfileVersion は package.json の declared
 * version ではなく `package-lock.json.packages["node_modules/pdf-lib"].version` (resolved)
 * を読む。pdfLibVersion (runtime import 値) は別物として並存。
 */
export interface Plan {
  /** AC-SCHEMA-1: literal 'collision-plan-v3' (将来 v4+ で bump) */
  schemaVersion: CollisionPlanSchemaVersion;

  planId: string;
  createdAt: string;
  environment: string;
  projectId: string;
  bucket: string;
  prefix: string;

  /** AC13 (PR-C2): fingerprint algorithm version */
  hashAlgorithm: string;
  /** AC13 拡張 (PR-C2 Codex Important): pdf-lib runtime import 値 */
  pdfLibVersion: string;

  /** AC-CC1-1 (PR-C3c, Codex Critical 1): package-lock.json 全体 sha256 */
  lockfileHash: string;
  /** AC-CC1-1 (PR-C3c, Codex Important I1): package-lock.json から読んだ pdf-lib resolved version */
  pdfLibLockfileVersion: string;

  /** AC-SURVEY-MANIFEST (PR-C3c, Codex Critical C4): survey artifact source manifest reference */
  sourceManifestRef: SourceManifestRef;

  /** 集計値 (byClassification / byAction / totals) */
  summary: PlanSummary;

  /** per-doc 操作 */
  operations: Operation[];

  /**
   * PR-C3c (silent-failure-hunter HIGH-1 / code-reviewer I-1 反映): classify 時に
   * 親 PDF provenance 計算が失敗した op の operationId 一覧。これら op は本 classify run
   * で `recommendedAction: 'manual-review'` に degrade されており、provenance fail 詳細は
   * `op.reason` に記録される。空配列なら全 regenerate-from-parent 候補で provenance 計算
   * 成功 (理想状態)。operator は plan.json から非空を検出し、operator review に回す。
   */
  provenanceFailedOps: string[];
}

/**
 * Plan summary 集計値。operator 監査用、AC-NONRESTRICTIVE 機械検証用。
 *
 * AC-NONRESTRICTIVE-1: dev fixture で byClassification.MatchedByHash === 1 AND
 * .RepairableMissingFile === 1 AND .Ambiguous === 0 AND .LostOrUnrecoverable === 0
 * を T4 dev リハーサル Stage 3 で assertion する。
 */
export interface PlanSummary {
  totalGroups: number;
  totalCollisionDocs: number;
  totalOrphans: number;
  byClassification: Record<Classification, number>;
  byAction: Record<RecommendedAction, number>;
}

/**
 * Operator 承認 (--approval JSON、execute 起動時の Gate 1 で照合)。
 *
 * PR-C3c では schema 変更なし (既存 PR-C2 と同形式)。
 */
export interface Approval {
  planId: string;
  approvedOperationIds: string[];
  approvedPaths: string[];
}

// ─── action ↔ provenanceRequired invariant (AC-INVARIANT / AC18-1) ───────────────

/**
 * action 別の `provenanceRequired` 期待値。execute 側 Gate 8 で literal 比較し、
 * mismatch なら gate-rejected。
 *
 * Codex Critical C2 反映: plan 改竄で `regenerate-from-parent + provenanceRequired:false`
 * を作っても execute 側で reject される。
 */
export const PROVENANCE_REQUIRED_BY_ACTION: Record<RecommendedAction, boolean> = {
  'regenerate-from-parent': true,
  'migrate-to-namespace': false,
  'manual-review': false,
  'mark-error': false,
};

/**
 * action ↔ provenanceRequired invariant を検証する pure function。
 *
 * @returns 検証結果。invariant 違反時は `{ ok: false, reason }`、合致時は `{ ok: true }`
 */
export function verifyActionProvenanceInvariant(
  action: RecommendedAction,
  provenanceRequired: boolean
): { ok: true } | { ok: false; reason: string } {
  const expected = PROVENANCE_REQUIRED_BY_ACTION[action];
  if (expected === provenanceRequired) return { ok: true };
  return {
    ok: false,
    reason: `schema invariant violated: action='${action}' requires provenanceRequired=${expected}, got ${provenanceRequired}`,
  };
}

/**
 * Provenance 6 fields の completeness を検証する pure function。
 *
 * AC18-1 反映: provenanceRequired === true の op で 6 fields のいずれかが欠落していたら
 * gate-rejected。string field は空文字も欠落扱い (Firebase Storage の generation/sha256
 * 等は必ず非空)。
 */
export function verifyProvenanceCompleteness(
  provenance: ParentPdfProvenance | null
): { ok: true } | { ok: false; reason: string } {
  if (!provenance) {
    return { ok: false, reason: 'provenance missing: null or undefined' };
  }
  const fields: (keyof ParentPdfProvenance)[] = [
    'sourceGeneration',
    'sourceMetageneration',
    'sourceSha256',
    'sourcePath',
    'sourceBucket',
    'derivedObjectPath',
  ];
  for (const field of fields) {
    const value = provenance[field];
    if (typeof value !== 'string' || value.length === 0) {
      return {
        ok: false,
        reason: `provenance missing: ${field}=${value === undefined ? '<undefined>' : value === null ? '<null>' : '<empty-string>'}`,
      };
    }
  }
  return { ok: true };
}
