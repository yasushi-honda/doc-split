/**
 * delete-legacy-ocr-fields.ts の純粋ロジック部(I/O非依存、unit test対象)。
 * ADR-0018 Phase E, Issue #547。
 *
 * backfillDetailHelpers.ts (Phase C, 「親→detail」方向) と対をなす「detail確認済み→
 * 親から削除」方向の判定ロジック。PR-E1 (dual-write停止) 完了後は「親にocrResult/
 * pageResultsが存在しない」のがdocの正常状態になるため、backfillの判定ロジックを
 * そのまま逆転させるのではなく、削除固有の分類が必要 (Codexセカンドオピニオン指摘:
 * PR-E1後は正常docが「親になし」になるため、従来のhash一致判定だけでは正常docを
 * mismatch誤判定する)。
 */

import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

/** in-pipeline status (削除対象・検証対象から除外。backfillDetailHelpers.tsと同じ定義) */
export const IN_PIPELINE_STATUSES = ['pending', 'processing'] as const;

/**
 * 削除対象判定の結果。1 doc = 1 判定。
 *
 * - `delete`: 親に値があり、detailと内容が一致 → 削除実行対象
 * - `already-deleted`: 親にocrResult/pageResultsどちらも値がない(PR-E1後の正常状態、
 *   または既に削除済み) → skip、正常(要調査ではない)
 * - `skip-mismatch`: 親に値があるが、detailの値と一致しない → skip、要調査
 * - `skip-detail-missing`: 親に値があるが、detail自体が存在しない → skip、要調査
 * - `skip-in-pipeline`: status が pending/processing(OCRパイプライン進行中) → skip
 */
export type DeletionDecision =
  | 'delete'
  | 'already-deleted'
  | 'skip-mismatch'
  | 'skip-detail-missing'
  | 'skip-in-pipeline';

export function decideDeletionAction(params: {
  status: unknown;
  parentHasOcrResult: boolean;
  parentHasPageResults: boolean;
  detailExists: boolean;
  /** canonicalHash比較結果。比較不可(親に値がない等)の場合は null */
  ocrResultMatches: boolean | null;
  pageResultsMatches: boolean | null;
}): DeletionDecision {
  if (
    typeof params.status === 'string' &&
    (IN_PIPELINE_STATUSES as readonly string[]).includes(params.status)
  ) {
    return 'skip-in-pipeline';
  }

  const hasLegacyValue = params.parentHasOcrResult || params.parentHasPageResults;
  if (!hasLegacyValue) {
    return 'already-deleted';
  }
  if (!params.detailExists) {
    return 'skip-detail-missing';
  }

  const ocrOk = !params.parentHasOcrResult || params.ocrResultMatches === true;
  const pageOk = !params.parentHasPageResults || params.pageResultsMatches === true;
  if (!ocrOk || !pageOk) {
    return 'skip-mismatch';
  }

  return 'delete';
}

/**
 * 削除対象の doc に対し、`tx.update()` に渡す FieldValue.delete() ペイロードを組み立てる。
 * 親に存在するフィールドのみを削除対象に含める(片方だけ存在するケースで、存在しない
 * 方まで削除しようとして無駄な書込みキーを生成しないため)。
 */
export function buildDeletionFieldUpdate(params: {
  parentHasOcrResult: boolean;
  parentHasPageResults: boolean;
}): Record<string, FirebaseFirestore.FieldValue> {
  const update: Record<string, FirebaseFirestore.FieldValue> = {};
  if (params.parentHasOcrResult) update.ocrResult = FieldValue.delete();
  if (params.parentHasPageResults) update.pageResults = FieldValue.delete();
  return update;
}

/**
 * 値のcanonical JSON文字列(キーを再帰的にソート)のSHA-256を返す。
 * backfillDetailHelpers.ts と同一実装(重複だが、scripts/lib配下は各スクリプトが
 * 独立npmコンテキストを持たないシンプルな構成のため、依存関係を増やさず値渡しで
 * 済む範囲は許容する)。
 */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function canonicalStringify(value: unknown): string {
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

/**
 * --audit / --dry-run / --execute / --verify の集計カウンタ。
 */
export interface DeletionCounters {
  scanned: number;
  targetsDelete: number;
  skippedAlreadyDeleted: number;
  skippedMismatch: number;
  skippedDetailMissing: number;
  skippedInPipeline: number;
  deleted: number;
  parentDeletedDuringRun: number;
  decisionChanged: number;
  errors: number;
}

export function createDeletionCounters(): DeletionCounters {
  return {
    scanned: 0,
    targetsDelete: 0,
    skippedAlreadyDeleted: 0,
    skippedMismatch: 0,
    skippedDetailMissing: 0,
    skippedInPipeline: 0,
    deleted: 0,
    parentDeletedDuringRun: 0,
    decisionChanged: 0,
    errors: 0,
  };
}
