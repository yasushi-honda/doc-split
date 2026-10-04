/**
 * 手動要約依頼の計測ログ (PR-C)
 *
 * 手動依頼(`summaryManualRequestedAt`の印を持つ文書)が終端(done/error/skipped)に達した時に、
 * 依頼から終端までの経過時間を1行のログとして残す。固定接頭辞のログを
 * `scripts/setup-log-based-metrics.sh`のログベースメトリクス(`summary_manual_result`)で数える。
 * 1依頼につき1行(印は終端と同時に削除されるため重複しない)。語や本文はPIIを含みうるため出さない。
 */

export type ManualSummaryOutcome = 'done' | 'error' | 'skipped';

export interface ManualSummaryResultLogParams {
  functionName: string;
  documentId: string;
  outcome: ManualSummaryOutcome;
  /** error時の分類(`SummaryErrorKind`)。それ以外はnull。 */
  kind: string | null;
  /** done時の生成プロバイダ。それ以外はnull。 */
  provider: string | null;
  /** 依頼時刻(`summaryManualRequestedAt`のepoch ms)。印がなければnull(=手動由来ではない)。 */
  requestedAtMs: number | null;
  nowMs: number;
}

/**
 * 手動由来の文書(requestedAtMsあり)のときだけログを出す。自動由来(印なし)では何も出さない。
 * 時計のずれで経過時間が負になった場合は0に丸める。
 */
export function logManualSummaryResult(params: ManualSummaryResultLogParams): void {
  const { functionName, documentId, outcome, kind, provider, requestedAtMs, nowMs } = params;
  if (requestedAtMs === null) return;
  const latencyMs = Math.max(0, nowMs - requestedAtMs);
  console.log(
    `[${functionName}] summary_manual_result documentId=${documentId} outcome=${outcome} ` +
      `kind=${kind ?? 'none'} provider=${provider ?? 'none'} latencyMs=${latencyMs}`
  );
}

/** 手動依頼を受け付けた時のログ(onCall側)。 */
export function logManualSummaryRequested(documentId: string, alreadyQueued: boolean): void {
  console.log(`[regenerateSummary] summary_manual_requested documentId=${documentId} alreadyQueued=${alreadyQueued}`);
}
