/**
 * backfill-detail-subcollection.ts の純粋ロジック部(I/O非依存、unit test対象)。
 * Issue #547 ADR-0018 Phase C。
 *
 * Firestore/ネットワークに依存しない分類判定・canonical hash・集計を分離し、
 * モック不要でテストする(confirmedReplayStats.ts と同じ分離パターン)。
 */

import { createHash } from 'node:crypto';

/**
 * backfill 対象判定の結果。1 doc = 1 判定。
 *
 * - `backfill`: detail/main を作成し ocrExcerpt を親に書込む対象
 * - `skip-detail-exists`: Phase B 以降の dual-write で作成済み(冪等スキップ)
 * - `skip-in-pipeline`: status が pending/processing(OCRパイプライン進行中。
 *   ADR-0018 Phase C行 Codex 6th review P1: 再処理開始後に失敗した doc の detail/main が
 *   古い内容のまま残存しうるため、backfill 対象にも完了検証対象にも含めない。
 *   通常のOCRパイプライン完了時に dual-write で自然に解消される)
 */
export type BackfillDecision = 'backfill' | 'skip-detail-exists' | 'skip-in-pipeline';

/** OCRパイプライン進行中の status (backfill/検証の両方から除外) */
export const IN_PIPELINE_STATUSES = ['pending', 'processing'] as const;

export function decideBackfillAction(params: {
  status: unknown;
  detailExists: boolean;
}): BackfillDecision {
  if (
    typeof params.status === 'string' &&
    (IN_PIPELINE_STATUSES as readonly string[]).includes(params.status)
  ) {
    return 'skip-in-pipeline';
  }
  if (params.detailExists) {
    return 'skip-detail-exists';
  }
  return 'backfill';
}

/**
 * detail/main へ書き込む payload を親docフィールドから構築する。
 *
 * ocrProcessor.ts の dual-write (`tx.set(detailRef, { ocrResult, pageResults })`) と
 * 同じ2フィールドのみを対象とし、親に存在するフィールドだけをコピーする
 * (存在しないフィールドを undefined で書いて Firestore エラーになるのを防ぐ)。
 * 両方とも不在の場合は空オブジェクト — ADR-0018 §原子性要件2「存在保証」により、
 * Phase D の FE reprocess-clear (`update()`) が常に成功するには detail/main の
 * 「ドキュメントとしての存在」自体が必要なため、中身が空でも作成する。
 */
export function buildDetailPayload(parentData: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof parentData.ocrResult === 'string') {
    payload.ocrResult = parentData.ocrResult;
  }
  if (Array.isArray(parentData.pageResults)) {
    payload.pageResults = parentData.pageResults;
  }
  return payload;
}

/**
 * 値のcanonical JSON文字列(キーを再帰的にソート)のSHA-256を返す。
 *
 * Firestoreから読んだオブジェクトはキー順序が保証されないため、JSON.stringifyを
 * 直接比較すると同一内容でも不一致になりうる。parity検証(--verify)では必ず本関数を
 * 両辺に適用して比較する。
 */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`
  );
  return `{${entries.join(',')}}`;
}

/** --audit / --dry-run / --execute / --verify の集計カウンタ */
export interface BackfillCounters {
  scanned: number;
  backfillTargets: number;
  skippedDetailExists: number;
  skippedInPipeline: number;
  written: number;
  writeConflicts: number;
  errors: number;
}

export function createCounters(): BackfillCounters {
  return {
    scanned: 0,
    backfillTargets: 0,
    skippedDetailExists: 0,
    skippedInPipeline: 0,
    written: 0,
    writeConflicts: 0,
    errors: 0,
  };
}
