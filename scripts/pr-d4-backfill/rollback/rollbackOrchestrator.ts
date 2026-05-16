/**
 * Issue #445 PR-D4 S6: Rollback orchestrator (dev fixture 限定 provenance + provenanceBackfill delete).
 *
 * BF24 (Codex 3rd 追加) / Codex MCP 12th review I1 反映:
 * - dev fixture 限定 (prefix allowlist `BF_` / `BF13_test_fixture_`) で
 *   `provenance` と `provenanceBackfill` の両方を `FieldValue.delete()` で削除
 * - 既存 verified provenance (provenance exists && provenanceBackfill absent) は
 *   immutable skip (PR-D2/D3 split-time provenance を rollback で失わない、ADR MUST 7)
 * - dry-run default、明示 confirm (CLI `--confirm` / workflow input `confirm=true`) で実 delete
 *
 * 設計 (Codex 12th I1 specific guidance):
 * - dev-only hard gate (本 orchestrator + index.ts + workflow yaml の 3 段 defense in depth)
 * - doc delete / GCS object delete は **行わない** (cleanup と区別)。field 削除のみで doc 残存
 * - 既存 verified provenance には適用しない (`existing-verified-provenance` skip artifact 記録)
 * - artifact: `phase-rollback-summary.json` のみ (chunks なし、fixture 件数少ない)
 *
 * 処理フロー:
 *   1. env hard gate (dev 以外は throw)
 *   2. firestoreReader.scanCandidateDocs() で documents collection scan
 *   3. 各 doc を prefix allowlist で分類: target / out-of-scope skip
 *   4. target を fields 存在で分類: target (要 delete) / existing-verified-provenance / no-provenance-fields
 *   5. dry-run なら writer 呼出スキップ、それ以外は FieldValue.delete() 発行
 *   6. artifact (PhaseRollbackSummary) を artifact bucket に書込
 */

import type { ArtifactStorageWriter } from '../phase-a/artifactWriter';
import {
  PR_D4_ARTIFACT_SCHEMA_VERSION,
  PR_D4_ROLLBACK_FIXTURE_PREFIX_ALLOWLIST,
  type BackfillEnvName,
  type PhaseRollbackSkippedDoc,
  type PhaseRollbackSummary,
  type PhaseRollbackTargetDoc,
  type PrD4ScriptVersion,
} from '../types';

/**
 * documents collection scan 経由で取得した 1 doc の rollback 判定材料。
 *
 * 設計:
 * - `hasProvenance` / `hasProvenanceBackfill`: Firestore document 上の field 有無
 *   (`undefined` でも値 `null` でも present 扱いにするかは adapter 側の責任、orchestrator は
 *   field 値ではなく「set されている / されていない」だけを使う)
 */
export interface DocRollbackSnapshot {
  docId: string;
  hasProvenance: boolean;
  hasProvenanceBackfill: boolean;
}

/**
 * Firestore documents collection を scan する責務 (adapter 抽象)。
 *
 * 実 adapter は prefix-bounded query (`startAt`/`endAt`) で対象を絞り込む。
 * orchestrator 側でも prefix allowlist による 2 段 filter を行う (defense in depth、
 * AC2 で adapter から非 prefix doc が来た場合の挙動を test で検証)。
 */
export interface FirestoreRollbackReader {
  scanCandidateDocs(): AsyncIterable<DocRollbackSnapshot>;
}

/**
 * Firestore に field-only delete を発行する責務 (adapter 抽象)。
 *
 * - `deleteProvenance` / `deleteProvenanceBackfill`: 片方だけ true でも OK
 *   (orphan provenanceBackfill のみ rollback したいケース等)
 * - 両方 false なら no-op (orchestrator 側で 0 件 update を回避するため呼ばないこと)
 * - 実装は `db.collection('documents').doc(docId).update({field: FieldValue.delete()})` で
 *   他 fields (createdAt 等) は変更しないこと (ADR-0008 整合)
 */
export interface FirestoreRollbackWriter {
  deleteProvenanceFields(input: {
    docId: string;
    deleteProvenance: boolean;
    deleteProvenanceBackfill: boolean;
  }): Promise<void>;
}

export interface RunRollbackInput {
  env: BackfillEnvName;
  runId: string;
  /** true = artifact のみ書込 (Firestore update 発行ゼロ)、false = 実 delete */
  dryRun: boolean;
  firestoreReader: FirestoreRollbackReader;
  firestoreWriter: FirestoreRollbackWriter;
  artifactWriter: ArtifactStorageWriter;
  artifactBucketName: string;
  rollbackStartedAt: string;
  scriptVersion: string;
  /** test 用 clock (ISO8601 を返す)。省略時 system clock */
  nowProvider?: () => string;
}

export interface RunRollbackResult {
  summary: PhaseRollbackSummary;
  mainArtifactPath: string;
}

function matchesAllowlist(docId: string): boolean {
  for (const prefix of PR_D4_ROLLBACK_FIXTURE_PREFIX_ALLOWLIST) {
    if (docId.startsWith(prefix)) return true;
  }
  return false;
}

export async function runRollback(input: RunRollbackInput): Promise<RunRollbackResult> {
  // AC1: dev-only hard gate (orchestrator level、defense in depth の 3rd layer)
  if (input.env !== 'dev') {
    throw new Error(
      `rollback is dev-only (env=${input.env}); workflow + index.ts + orchestrator の 3 段 hard gate のうち 3rd で reject`
    );
  }

  const targets: PhaseRollbackTargetDoc[] = [];
  const skipped: PhaseRollbackSkippedDoc[] = [];
  let scanned = 0;

  for await (const doc of input.firestoreReader.scanCandidateDocs()) {
    scanned++;

    // AC2: prefix allowlist filter (2nd layer、adapter 側でも prefix-bounded query するが
    // orchestrator も独立判定して silent drop を防ぐ)
    if (!matchesAllowlist(doc.docId)) {
      skipped.push({ docId: doc.docId, reason: 'out-of-scope' });
      continue;
    }

    // AC4: immutable skip - PR-D2/D3 split-time provenance (provenanceBackfill 不在)
    if (doc.hasProvenance && !doc.hasProvenanceBackfill) {
      skipped.push({ docId: doc.docId, reason: 'existing-verified-provenance' });
      continue;
    }

    // 両 fields 不在 → idempotent skip (既 rollback 済 or 元から無い)
    if (!doc.hasProvenance && !doc.hasProvenanceBackfill) {
      skipped.push({ docId: doc.docId, reason: 'no-provenance-fields' });
      continue;
    }

    // target: provenanceBackfill 存在 (provenance は両 OK)
    const deletedFields: Array<'provenance' | 'provenanceBackfill'> = [];
    if (doc.hasProvenance) deletedFields.push('provenance');
    if (doc.hasProvenanceBackfill) deletedFields.push('provenanceBackfill');

    if (!input.dryRun) {
      // AC3 / AC6: field-only delete (doc 自体は残存)
      await input.firestoreWriter.deleteProvenanceFields({
        docId: doc.docId,
        deleteProvenance: doc.hasProvenance,
        deleteProvenanceBackfill: doc.hasProvenanceBackfill,
      });
    }

    targets.push({
      docId: doc.docId,
      status: input.dryRun ? 'dryRun' : 'executed',
      deletedFields,
    });
  }

  const now = input.nowProvider ?? (() => new Date().toISOString());
  const summary: PhaseRollbackSummary = {
    phase: 'E',
    schemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    scriptVersion: input.scriptVersion as PrD4ScriptVersion,
    env: input.env,
    runId: input.runId,
    rollbackStartedAt: input.rollbackStartedAt,
    rollbackCompletedAt: now(),
    scannedDocs: scanned,
    targetedDocs: targets.length,
    skippedDocs: skipped.length,
    dryRun: input.dryRun,
    targets,
    skipped,
  };

  const mainArtifactPath = `gs://${input.artifactBucketName}/pr-d4-backfill-artifacts/${input.runId}/phase-rollback-summary.json`;
  const content = JSON.stringify(summary);
  await input.artifactWriter.writeJson(mainArtifactPath, content);

  return { summary, mainArtifactPath };
}
