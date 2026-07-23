/**
 * backfill-drive-export.ts の純粋ロジック部(I/O非依存、unit test対象)。
 * Phase D/E再設計(Codex High指摘 #2/#4対応、GOAL.md「kanameone・cocoroへのGoogle Drive
 * 連携Phase1本番展開」)。
 *
 * Firestore/ファイルI/Oに依存しない判定・集計・アサーションを分離する
 * (scripts/lib/backfillDetailHelpers.ts と同じ分離パターン)。
 */

/** backfillが一時的にセットするdriveExportErrorのsentinel文字列。rollback判定にも使う。 */
export const BACKFILL_ERROR_MESSAGE =
  '[backfill] Feature Flag有効化前にverifiedされたdocumentの遡及エクスポート待ち';

/**
 * backfill対象判定: `verified==true`(呼び出し元のqueryで既に絞込み済み)かつ
 * `driveExportStatus`フィールド不在のdocのみが対象(既にexported/exporting/errorの
 * いずれかで通常経路に乗っているdocは二重マーク防止のため対象外)。
 */
export function isBackfillCandidate(data: Record<string, unknown>): boolean {
  return !('driveExportStatus' in data);
}

/**
 * rollback対象判定(Codex High指摘#2対応): backfillが書いたsentinelメッセージを
 * 持つ'error'状態のdocのみを対象とする。実際にDrive APIエラーで'error'になったdoc
 * (sentinel以外のメッセージ)や、既にexported/exporting/reprocess済み(field不在)の
 * docは対象外(意図的に部分的なrollback、Finding3のロールバック意味論を参照)。
 */
export function isRollbackCandidate(data: Record<string, unknown>): boolean {
  return data.driveExportStatus === 'error' && data.driveExportError === BACKFILL_ERROR_MESSAGE;
}

/**
 * 次回定期スイープ(`driveExportScheduled.ts`のERROR_RETRY_THRESHOLD_MS)で即座に
 * 拾われるよう`updatedAt`をバックデートする値(ミリ秒)を計算する。
 */
export function computeBackdatedUpdatedAtMs(
  nowMs: number,
  errorRetryThresholdMs: number,
  bufferMs: number
): number {
  return nowMs - errorRetryThresholdMs - bufferMs;
}

/**
 * `--limit`指定時に対象を先頭からN件に絞り込む(canary実行、Codex High指摘#2対応)。
 * 対象の並び順は呼び出し元のFirestore query(documentId順)に従う。
 */
export function applyLimit<T>(candidates: readonly T[], limit: number | undefined): T[] {
  return limit === undefined ? [...candidates] : candidates.slice(0, limit);
}

export class ExpectedCountMismatchError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number
  ) {
    super(
      `--expected-count 不一致: 期待=${expected}件 実際=${actual}件が対象。誤操作防止のため書込みを一切行わず中断します。`
    );
    this.name = 'ExpectedCountMismatchError';
  }
}

/**
 * `--expected-count`のアサーション(Codex High指摘#2対応)。全ページ走査・`--limit`適用後の
 * 実対象件数に対して行い、一致しない場合は例外をthrowして呼び出し元に**書込み前**に
 * 中断させる(部分書込み後のabortを防ぐ)。
 */
export function assertExpectedCount(actualCount: number, expectedCount: number | undefined): void {
  if (expectedCount === undefined) return;
  if (actualCount !== expectedCount) {
    throw new ExpectedCountMismatchError(expectedCount, actualCount);
  }
}

export interface BackfillManifest {
  runId: string;
  projectId: string;
  timestamp: string;
  docIds: string[];
}

export function buildManifest(params: {
  runId: string;
  projectId: string;
  timestampIso: string;
  docIds: readonly string[];
}): BackfillManifest {
  return {
    runId: params.runId,
    projectId: params.projectId,
    timestamp: params.timestampIso,
    docIds: [...params.docIds],
  };
}

export interface SweepEtaEstimate {
  estimatedRuns: number;
  estimatedMinutes: number;
}

/** 定期スイープでの解消見込み時間を概算する(既存の表示ロジックを純粋関数として抽出)。 */
export function estimateSweepEta(
  targetCount: number,
  sweepBatchSize: number,
  sweepIntervalMinutes: number
): SweepEtaEstimate {
  const estimatedRuns = Math.ceil(targetCount / sweepBatchSize);
  return { estimatedRuns, estimatedMinutes: estimatedRuns * sweepIntervalMinutes };
}
