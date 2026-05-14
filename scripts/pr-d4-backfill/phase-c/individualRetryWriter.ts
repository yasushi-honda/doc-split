/**
 * Issue #445 PR-D4 S1-4: Phase C batch fallback individual retry writer (BF18/BF23).
 *
 * impl-plan §4.3 step 5 + Codex 2nd Critical 3 + 3rd L3/BF23 反映:
 *   batch 全体が失敗した時、 doc 単位の個別 update に分解して再実行する。
 *   - precondition 失敗 (drift あり) → `preconditionFailedDocs` に隔離 (retry しない)
 *   - transient error (timeout / network) → max 3 回 retry → 超過で `preconditionFailedDocs` 隔離
 *   - rate limiter は各 attempt で token 1 を acquire (BF23 lock-in、突発 rate 増加防止)
 *
 * 設計判断:
 * - batchWriter と同じ `RateLimiter` interface + 同じ `buildBackfillRecord` factory を
 *   共有する (DRY、provenanceBackfill metadata 構築の一貫性 = artifact 観測整合性)
 * - 個別 adapter は `FirestoreIndividualAdapter` interface で抽象化 (batch とは別 SDK call)
 * - immutable skip は batchWriter scope で既に除外済の前提 (本 module は eligible のみ受取)
 */

import { Timestamp } from 'firebase-admin/firestore';
import type {
  DocumentProvenance,
  ProvenanceBackfillMetadata,
} from '../../../shared/types';
import { ProvenanceValidationError } from '../../../functions/src/pdf/provenance';
import type {
  PhaseBRevalidatedCandidate,
  PhaseCPreconditionFailedDoc,
  PhaseCUnprocessableDoc,
  PhaseCWrittenDoc,
} from '../types';
import { PR_D4_PHASE_C_INDIVIDUAL_RETRY_MAX } from '../types';
import { buildBackfillRecord, sha256ProvenanceBackfill } from './batchWriter';
import type { RateLimiter } from './rateLimiter';

export interface IndividualUpdateInput {
  docId: string;
  provenance: DocumentProvenance;
  provenanceBackfill: ProvenanceBackfillMetadata;
  /** ISO8601 precondition (Phase C reReadForBatch 時の updateTime) */
  lastUpdateTimePrecondition: string;
}

export type IndividualUpdateResult =
  | { kind: 'ok'; updateTime: string }
  | { kind: 'precondition-failed' }
  | { kind: 'transient'; message: string };

export interface FirestoreIndividualAdapter {
  updateOne(input: IndividualUpdateInput): Promise<IndividualUpdateResult>;
}

export interface ProcessFallbackInput {
  candidates: PhaseBRevalidatedCandidate[];
  /** docId → batchWriter reReadForBatch で取得した updateTime (precondition) */
  lastUpdateTimePreconditions: Map<string, string>;
  backfillScriptVersion: string;
  backfilledAt: Timestamp;
  /** default = PR_D4_PHASE_C_INDIVIDUAL_RETRY_MAX (=3) */
  retryMax?: number;
}

export interface ProcessFallbackOutcome {
  writtenDocs: PhaseCWrittenDoc[];
  preconditionFailedDocs: PhaseCPreconditionFailedDoc[];
  /**
   * caller-bug 経路 (lastUpdateTimePreconditions 不在 / ProvenanceValidationError) を
   * 'lastUpdateTime drift' と混同せず、unprocessable に分類 (code-reviewer #3 反映)。
   */
  unprocessableDocs: PhaseCUnprocessableDoc[];
}

/**
 * 1 doc を retryMax 回まで個別 update。
 * - precondition-failed → 即終了 (drift 確定、retry 不要)
 * - transient → 次 attempt、retryMax 到達で 'transient retry exhausted' 隔離
 * - ok → 成功
 */
async function attemptOneDocWithRetry(
  candidate: PhaseBRevalidatedCandidate,
  record: { provenance: DocumentProvenance; provenanceBackfill: ProvenanceBackfillMetadata },
  lastUpdateTimePrecondition: string,
  adapter: FirestoreIndividualAdapter,
  rateLimiter: RateLimiter,
  retryMax: number
): Promise<
  | { kind: 'ok'; updateTime: string; retryCount: number }
  | { kind: 'precondition-failed'; retryCount: number }
  | { kind: 'transient-exhausted'; retryCount: number }
> {
  let attemptCount = 0;
  for (let i = 0; i < retryMax; i++) {
    attemptCount++;
    await rateLimiter.acquire(1);
    const result = await adapter.updateOne({
      docId: candidate.docId,
      provenance: record.provenance,
      provenanceBackfill: record.provenanceBackfill,
      lastUpdateTimePrecondition,
    });
    if (result.kind === 'ok') {
      return { kind: 'ok', updateTime: result.updateTime, retryCount: attemptCount };
    }
    if (result.kind === 'precondition-failed') {
      return { kind: 'precondition-failed', retryCount: attemptCount };
    }
    // transient: 次 attempt へ
  }
  return { kind: 'transient-exhausted', retryCount: attemptCount };
}

/**
 * batch 失敗時の fallback: 各 doc を個別 update + retry max=3 + drift 確定で隔離。
 *
 * 注意: immutable skip / missing doc は batchWriter で既に除外済の前提。本 module は
 * candidates の各 doc が更新候補であることを信頼する。
 */
export async function processFallback(
  input: ProcessFallbackInput,
  adapter: FirestoreIndividualAdapter,
  rateLimiter: RateLimiter
): Promise<ProcessFallbackOutcome> {
  const retryMax = input.retryMax ?? PR_D4_PHASE_C_INDIVIDUAL_RETRY_MAX;
  const writtenDocs: PhaseCWrittenDoc[] = [];
  const preconditionFailedDocs: PhaseCPreconditionFailedDoc[] = [];
  const unprocessableDocs: PhaseCUnprocessableDoc[] = [];

  for (const candidate of input.candidates) {
    const lastUpdateTime = input.lastUpdateTimePreconditions.get(candidate.docId);
    if (!lastUpdateTime) {
      // batchWriter outcome から渡された Map に必ず entry がある前提だが、defense-in-depth:
      // entry 不在は caller-bug = unprocessable に分類 (drift とは別観測軸、code-reviewer #3 反映)
      unprocessableDocs.push({
        docId: candidate.docId,
        reason: 'missing',
        message: 'lastUpdateTimePreconditions entry absent (caller bug)',
      });
      continue;
    }
    let record;
    try {
      record = buildBackfillRecord(candidate, input.backfillScriptVersion, input.backfilledAt);
    } catch (e) {
      if (e instanceof ProvenanceValidationError) {
        // validation error は batchWriter scope で既に除外済の前提だが、defense:
        // unprocessable に分類 (caller observability、drift とは別観測軸)
        unprocessableDocs.push({
          docId: candidate.docId,
          reason: 'validation',
          message: e.message,
        });
        continue;
      }
      throw e;
    }

    const outcome = await attemptOneDocWithRetry(
      candidate,
      record,
      lastUpdateTime,
      adapter,
      rateLimiter,
      retryMax
    );

    if (outcome.kind === 'ok') {
      writtenDocs.push({
        docId: candidate.docId,
        writeStatus: 'ok',
        newProvenanceBackfillSha256: sha256ProvenanceBackfill(record.provenanceBackfill),
        lastUpdateTimeAfter: outcome.updateTime,
      });
    } else if (outcome.kind === 'precondition-failed') {
      preconditionFailedDocs.push({
        docId: candidate.docId,
        reason: 'lastUpdateTime drift',
        retryCount: outcome.retryCount,
      });
    } else {
      preconditionFailedDocs.push({
        docId: candidate.docId,
        reason: 'transient retry exhausted',
        retryCount: outcome.retryCount,
      });
    }
  }

  return { writtenDocs, preconditionFailedDocs, unprocessableDocs };
}
