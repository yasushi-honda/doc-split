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
 * `--rollback` が `docRef.update()` に渡す復元ペイロードを組み立てる。manifestに記録された
 * deletedFields(削除時に実際に消したフィールド名)のうち、detail/main側の現在値が期待する
 * 型を満たすものだけを復元対象に含める(Partial Update: 対象外フィールドは一切含めない)。
 *
 * 型不一致(detail/mainの値がstring/Arrayでない)のフィールドは黙って除外する。呼出元は
 * 戻り値が空オブジェクトになったケースを「型不一致で復元不可」として明示的にカウント・
 * 警告すること(review指摘反映: ここで空を返すこと自体は正常な仕様だが、呼出元が
 * 無視すると復元失敗がexitCode 0のまま検知されずに終わる)。
 */
export function buildRollbackFieldUpdate(params: {
  deletedFields: string[];
  detailOcrResult: unknown;
  detailPageResults: unknown;
}): Record<string, unknown> {
  const restore: Record<string, unknown> = {};
  if (params.deletedFields.includes('ocrResult') && typeof params.detailOcrResult === 'string') {
    restore.ocrResult = params.detailOcrResult;
  }
  if (params.deletedFields.includes('pageResults') && Array.isArray(params.detailPageResults)) {
    restore.pageResults = params.detailPageResults;
  }
  return restore;
}

/**
 * 値のcanonical JSON文字列(キーを再帰的にソート)のSHA-256を返す。
 * backfillDetailHelpers.ts (Phase C) の実装を再利用する(review指摘反映: 独自複製すると
 * Phase C/Eで「一致」の判定基準が将来乖離し、destructive削除の安全条件が壊れるリスクが
 * あった)。
 */
export { canonicalHash } from './backfillDetailHelpers';

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
    errors: 0,
  };
}
