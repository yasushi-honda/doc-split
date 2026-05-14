/**
 * Issue #445 PR-D4 S1-4: Phase C atomic batch writer (BF10/BF11/BF14/BF18/BF23).
 *
 * impl-plan §4.3 step 5 + Codex 2nd C3 + 3rd I3 反映:
 *   20 docs/batch + 各 doc に `lastUpdateTime` precondition + batch 直前 immutable skip
 *   再確認 + `provenance` 10 fields + `provenanceBackfill` metadata を atomic update。
 *
 * 設計判断:
 * - 依存性逆転: `FirestoreBatchAdapter` interface 経由で Firestore SDK を受け取り、
 *   unit test では in-memory fake で挙動を制御する (Phase A/B Writer pattern と同じ)
 * - batch commit は **全体成功 / 全体失敗の二択** (Firestore atomic batch 仕様)。
 *   precondition 失敗 / transient error 等で batch 全体が fail した場合、caller
 *   (individualRetryWriter) が doc 単位 fallback で続行する (BF18)
 * - immutable skip は batch 直前の再読込で field existence 判定 (BF14、null sentinel 禁止)
 * - rate limiter は batch size 分の token を **commit 直前** に acquire
 *   (canonical JSON 構築 / immutable skip filter の cost は token 消費前)
 * - `backfilledAt` は orchestrator 側で 1 度生成し全 batch で共有 (run 単位の観測一貫性)
 * - `lastUpdateTimeAfter` は commitBatch が返す writeResults から取得 (Firestore batch commit
 *   の WriteResult.writeTime で十分、追加 read 不要)
 *
 * provenanceBackfill metadata の sha256 計算は canonical JSON (キー順固定の JSON.stringify
 * は ECMA-262 で deterministic) ベース。Timestamp は { seconds, nanoseconds } で stringify
 * されるため backfilledAt 含めて deterministic に sha256 が計算できる。
 */

import * as crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type {
  DocumentProvenance,
  ProvenanceBackfillMetadata,
} from '../../../shared/types';
import {
  createBackfillProvenance,
  ProvenanceValidationError,
} from '../../../functions/src/pdf/provenance';
import type {
  PhaseBRevalidatedCandidate,
  PhaseCImmutableSkippedDoc,
  PhaseCOutOfScopeDoc,
  PhaseCUnprocessableDoc,
  PhaseCWrittenDoc,
} from '../types';
import { checkImmutableSkip } from './immutableSkipChecker';
import type { RateLimiter } from './rateLimiter';

export interface BatchReReadResult {
  exists: boolean;
  /** ISO8601 (Firestore updateTime) — doc 不在時 undefined */
  updateTime?: string;
  provenance: unknown;
  provenanceBackfill: unknown;
}

export interface FirestoreBatchAdapter {
  /**
   * doc 単位で snapshot 再取得 (batch 直前 immutable skip + precondition 値取得用)。
   * doc 不在は `exists: false` で返却 (caller が skip 候補から除外)。
   */
  reReadForBatch(docIds: string[]): Promise<Map<string, BatchReReadResult>>;
  /**
   * Firestore atomic batch commit。各 entry の `lastUpdateTimePrecondition` を precondition
   * として渡し、全体成功 / 全体失敗で返却。
   */
  commitBatch(entries: BatchUpdateEntry[]): Promise<CommitBatchResult>;
}

export interface BatchUpdateEntry {
  docId: string;
  provenance: DocumentProvenance;
  provenanceBackfill: ProvenanceBackfillMetadata;
  /** ISO8601、batch precondition (lastUpdateTime drift で全体 fail) */
  lastUpdateTimePrecondition: string;
}

export type CommitBatchResult =
  | {
      kind: 'ok';
      /** 各 doc の commit 後 updateTime (ISO8601) */
      writeResults: Array<{ docId: string; updateTime: string }>;
    }
  | {
      kind: 'batch-failed';
      /** 失敗種別: 'precondition' / 'transient' / 'unknown' */
      reason: 'precondition' | 'transient' | 'unknown';
      message: string;
    };

export interface ProcessBatchInput {
  candidates: PhaseBRevalidatedCandidate[];
  backfillScriptVersion: string;
  /** backfilledAt: run 単位で 1 度生成し全 batch 共有 */
  backfilledAt: Timestamp;
}

export type ProcessBatchOutcome =
  | {
      outcome: 'all-committed';
      writtenDocs: PhaseCWrittenDoc[];
      immutableSkippedDocs: PhaseCImmutableSkippedDoc[];
      unprocessableDocs: PhaseCUnprocessableDoc[];
      outOfScopeDocs: PhaseCOutOfScopeDoc[];
    }
  | {
      outcome: 'batch-failed';
      failureReason: string;
      /** individualRetryWriter で fallback 対象 (immutable skip / unprocessable / out-of-scope は既に除外済) */
      candidatesForFallback: PhaseBRevalidatedCandidate[];
      /** 各 fallback candidate に対応する precondition lastUpdateTime (再読込時の値) */
      lastUpdateTimePreconditions: Map<string, string>;
      immutableSkippedDocs: PhaseCImmutableSkippedDoc[];
      unprocessableDocs: PhaseCUnprocessableDoc[];
      outOfScopeDocs: PhaseCOutOfScopeDoc[];
    };

/**
 * provenanceBackfill metadata を canonical JSON で sha256 算出。
 * Timestamp は { seconds, nanoseconds } へ展開 (admin SDK の Timestamp.toJSON 互換)。
 *
 * individualRetryWriter からも writtenDocs[].newProvenanceBackfillSha256 計算で利用するため
 * export する (BF22 artifact 観測一貫性)。
 *
 * **cross-process determinism の注意** (memory: feedback_deterministic_cross_process.md):
 *   本関数は **同一 process 内で `createBackfillProvenance` factory 経由で構築された
 *   metadata object** に対しては deterministic に sha256 を返す。
 *   ECMA-262 で string (non-integer) key の object literal は insertion order を保持し、
 *   `createBackfillProvenance` factory 内の field 構築順は固定。
 *
 *   一方、**Phase D で Firestore から `data().provenanceBackfill` を読んで再 sha256 計算**
 *   する場合、Firestore admin SDK が返す object の key order は実装依存で insertion order
 *   を保証しない可能性がある。Phase D verification では:
 *     (a) `createBackfillProvenance` を再 invoke して metadata を再構築してから sha256 比較
 *     (b) または field 単位 deep-equal で sha256 比較を回避
 *   いずれかを採用すること (cross-process byte 一致は要求しない設計)。
 */
export function sha256ProvenanceBackfill(metadata: ProvenanceBackfillMetadata): string {
  const canonical = JSON.stringify(metadata, (_key, value) => {
    if (value instanceof Timestamp) {
      return { seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    return value;
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Phase B revalidated candidate から `createBackfillProvenance` 入力を構築する。
 *
 * - `createdAt` ISO string → admin SDK Timestamp 変換 (impl-plan §4.2 JSDoc 明文化済)
 * - confidence は candidate.computedConfidence をそのまま採用
 * - parent re-split 検証済 candidate (= MatchedByHash + derived-bytes-verified) は
 *   `evidence.parentSha256MatchedAtBackfill = true`、それ以外 (child-snapshot-only fixture
 *   等) は false / null。本 batch writer は candidate.evidence を信頼する
 *   (Phase B で構築済 / classifierCategory ↔ confidence invariant は caller scope)
 *
 * individualRetryWriter (BF18 fallback) からも同入力を構築するため export する (DRY)。
 */
export function buildBackfillRecord(
  candidate: PhaseBRevalidatedCandidate,
  backfillScriptVersion: string,
  backfilledAt: Timestamp
): { provenance: DocumentProvenance; provenanceBackfill: ProvenanceBackfillMetadata } {
  const createdAt = Timestamp.fromDate(new Date(candidate.computedProvenance.createdAt));
  return createBackfillProvenance({
    provenanceFields: {
      sourceGeneration: candidate.computedProvenance.sourceGeneration,
      sourceMetageneration: candidate.computedProvenance.sourceMetageneration,
      sourceSha256: candidate.computedProvenance.sourceSha256,
      sourcePath: candidate.computedProvenance.sourcePath,
      sourceBucket: candidate.computedProvenance.sourceBucket,
      derivedObjectPath: candidate.computedProvenance.derivedObjectPath,
      derivedGeneration: candidate.computedProvenance.derivedGeneration,
      derivedMetageneration: candidate.computedProvenance.derivedMetageneration,
      derivedSha256: candidate.computedProvenance.derivedSha256,
      createdAt,
    },
    confidence: candidate.computedConfidence,
    classifierCategory: candidate.category,
    evidence: {
      parentExists: candidate.evidence.parentExists,
      parentSha256MatchedAtBackfill: candidate.evidence.parentSha256MatchedAtBackfill,
      childSha256ComputedAtBackfill: candidate.evidence.childSha256ComputedAtBackfill,
    },
    backfillScriptVersion,
    backfilledAt,
  });
}

/**
 * 1 batch (≤20 docs) を処理する。
 *
 * 処理順:
 *   1. reReadForBatch で snapshot 取得
 *   2. immutable skip (BF14) / doc 不在 を除外
 *   3. createBackfillProvenance で entries 構築 (validation error は doc 単位 skip)
 *   4. rateLimiter.acquire (batch size 分の token、BF23)
 *   5. commitBatch
 *   6. 成功 → writtenDocs[]、失敗 → candidatesForFallback (immutable skip / missing 除外済)
 */
export async function processBatch(
  input: ProcessBatchInput,
  adapter: FirestoreBatchAdapter,
  rateLimiter: RateLimiter
): Promise<ProcessBatchOutcome> {
  const { candidates, backfillScriptVersion, backfilledAt } = input;
  if (candidates.length === 0) {
    return {
      outcome: 'all-committed',
      writtenDocs: [],
      immutableSkippedDocs: [],
      unprocessableDocs: [],
      outOfScopeDocs: [],
    };
  }

  const immutableSkippedDocs: PhaseCImmutableSkippedDoc[] = [];
  const unprocessableDocs: PhaseCUnprocessableDoc[] = [];
  const outOfScopeDocs: PhaseCOutOfScopeDoc[] = [];

  // (Codex 5th C1 反映) impl-plan §4.0 hard-gate: 本番 Phase C 書込対象は
  // category === 'MatchedByHash' かつ computedConfidence === 'derived-bytes-verified' のみ。
  // Phase B 実装は MatchedByHash のみ revalidated[] に入れるが、dev fixture / 将来の
  // Phase B 拡張 / 設計バグで異種 candidate が混入した場合に構造的にガードする。
  const inScopeCandidates: PhaseBRevalidatedCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.category !== 'MatchedByHash') {
      outOfScopeDocs.push({
        docId: candidate.docId,
        reason: 'category not MatchedByHash',
        observedCategory: candidate.category,
        observedConfidence: candidate.computedConfidence,
      });
      continue;
    }
    if (candidate.computedConfidence !== 'derived-bytes-verified') {
      outOfScopeDocs.push({
        docId: candidate.docId,
        reason: 'confidence not derived-bytes-verified',
        observedCategory: candidate.category,
        observedConfidence: candidate.computedConfidence,
      });
      continue;
    }
    inScopeCandidates.push(candidate);
  }

  if (inScopeCandidates.length === 0) {
    return {
      outcome: 'all-committed',
      writtenDocs: [],
      immutableSkippedDocs,
      unprocessableDocs,
      outOfScopeDocs,
    };
  }

  const snapshots = await adapter.reReadForBatch(inScopeCandidates.map((c) => c.docId));
  const eligible: Array<{
    candidate: PhaseBRevalidatedCandidate;
    record: { provenance: DocumentProvenance; provenanceBackfill: ProvenanceBackfillMetadata };
    lastUpdateTimePrecondition: string;
  }> = [];

  for (const candidate of inScopeCandidates) {
    const snapshot = snapshots.get(candidate.docId);
    if (!snapshot || !snapshot.exists || !snapshot.updateTime) {
      unprocessableDocs.push({ docId: candidate.docId, reason: 'missing' });
      continue;
    }
    const skipDecision = checkImmutableSkip({
      provenance: snapshot.provenance,
      provenanceBackfill: snapshot.provenanceBackfill,
    });
    if (skipDecision.skip) {
      immutableSkippedDocs.push({ docId: candidate.docId, reason: skipDecision.reason });
      continue;
    }
    let record;
    try {
      record = buildBackfillRecord(candidate, backfillScriptVersion, backfilledAt);
    } catch (e) {
      if (e instanceof ProvenanceValidationError) {
        // Codex 5th C2 反映: validation error は 'missing' とは区別して unprocessable に分類
        unprocessableDocs.push({
          docId: candidate.docId,
          reason: 'validation',
          message: e.message,
        });
        continue;
      }
      throw e;
    }
    eligible.push({
      candidate,
      record,
      lastUpdateTimePrecondition: snapshot.updateTime,
    });
  }

  if (eligible.length === 0) {
    return {
      outcome: 'all-committed',
      writtenDocs: [],
      immutableSkippedDocs,
      unprocessableDocs,
      outOfScopeDocs,
    };
  }

  // BF23: batch size 分の token を commit 直前 acquire
  await rateLimiter.acquire(eligible.length);

  const entries: BatchUpdateEntry[] = eligible.map((e) => ({
    docId: e.candidate.docId,
    provenance: e.record.provenance,
    provenanceBackfill: e.record.provenanceBackfill,
    lastUpdateTimePrecondition: e.lastUpdateTimePrecondition,
  }));

  const commitResult = await adapter.commitBatch(entries);

  if (commitResult.kind === 'batch-failed') {
    const lastUpdateTimePreconditions = new Map(
      eligible.map((e) => [e.candidate.docId, e.lastUpdateTimePrecondition])
    );
    return {
      outcome: 'batch-failed',
      failureReason: `${commitResult.reason}: ${commitResult.message}`,
      candidatesForFallback: eligible.map((e) => e.candidate),
      lastUpdateTimePreconditions,
      immutableSkippedDocs,
      unprocessableDocs,
      outOfScopeDocs,
    };
  }

  const writeResultMap = new Map(
    commitResult.writeResults.map((r) => [r.docId, r.updateTime])
  );
  const writtenDocs: PhaseCWrittenDoc[] = eligible.map((e) => {
    const updateTimeAfter = writeResultMap.get(e.candidate.docId);
    if (!updateTimeAfter) {
      throw new Error(
        `commit returned ok but writeResult missing for docId=${e.candidate.docId}`
      );
    }
    return {
      docId: e.candidate.docId,
      writeStatus: 'ok',
      newProvenanceBackfillSha256: sha256ProvenanceBackfill(e.record.provenanceBackfill),
      lastUpdateTimeAfter: updateTimeAfter,
    };
  });

  return {
    outcome: 'all-committed',
    writtenDocs,
    immutableSkippedDocs,
    unprocessableDocs,
    outOfScopeDocs,
  };
}
