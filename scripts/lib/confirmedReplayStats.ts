/**
 * compare-gemini-ocr-models-confirmed.ts の集計・判定ロジック(I/Oを一切伴わない純粋関数のみ)。
 * Firestore/Storage/Vertex AI等の外部依存を持たないため、この関数群はモック不要でunit test
 * できる。過去に同種のロジックで実バグが3件発生している(①API最終失敗がsuccess:trueのまま
 * 集計され失敗率ゲートが機能しなかった/②精度比較を絶対件数で行い成功文書数の違いで誤判定
 * していた/③失敗率ゲート超過時もヘッドラインが「✅ PASS」のままだった)ため、
 * 回帰防止のため分離・重点的にテストする。
 */

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, idx)];
}

export function pct(n: number, total: number): string {
  if (total === 0) return '0.0';
  return ((n / total) * 100).toFixed(1);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** totalPagesが正の整数でない(欠損/0/負数/非数値)場合は1にフォールバックする */
export function toValidTotalPages(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}

export interface DocOutcomeForSummary {
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  elapsedMs: number;
  docTypeMatch: boolean;
  customerMatch: boolean;
  officeMatch: boolean;
  anomalousPages: number;
  hadRetry: boolean;
}

export interface ModelSummaryStats {
  totalDocs: number;
  succeededDocs: number;
  failedDocs: number;
  docTypePass: number;
  customerPass: number;
  officePass: number;
  allPass: number;
  anomalousPageCount: number;
  retriedDocCount: number;
  totalInput: number;
  totalOutput: number;
  totalThinking: number;
  costUsd: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

/**
 * 一致率(allPass/succeededDocs)ではなく絶対件数(allPass)で比較すると、モデル間で
 * succeededDocsが異なる場合に誤判定しうる(例: baseline 300成功/250一致=83.3% vs
 * candidate 271成功/240一致=88.6%は実質candidateの方が高精度だが、240<250で誤判定していた)。
 * この関数はallPass/succeededDocsの一致率のみを返し、呼出元で比較させることで
 * 絶対件数比較への回帰を防ぐ。
 */
export function computeMatchRate(stats: Pick<ModelSummaryStats, 'allPass' | 'succeededDocs'>): number {
  return stats.succeededDocs > 0 ? stats.allPass / stats.succeededDocs : 0;
}

export function computeModelSummaryStats(
  pricing: { inputPer1MTokens: number; outputPer1MTokens: number },
  outcomes: DocOutcomeForSummary[]
): ModelSummaryStats {
  const totalDocs = outcomes.length;
  const succeeded = outcomes.filter((o) => o.success);
  const failedDocs = totalDocs - succeeded.length;

  const docTypePass = succeeded.filter((o) => o.docTypeMatch).length;
  const customerPass = succeeded.filter((o) => o.customerMatch).length;
  const officePass = succeeded.filter((o) => o.officeMatch).length;
  const allPass = succeeded.filter((o) => o.docTypeMatch && o.customerMatch && o.officeMatch).length;
  const anomalousPageCount = outcomes.reduce((s, o) => s + o.anomalousPages, 0);
  const retriedDocCount = outcomes.filter((o) => o.hadRetry).length;

  const totalInput = outcomes.reduce((s, o) => s + o.inputTokens, 0);
  const totalOutput = outcomes.reduce((s, o) => s + o.outputTokens, 0);
  const totalThinking = outcomes.reduce((s, o) => s + o.thinkingTokens, 0);
  const billableOutput = totalOutput + totalThinking;
  const costUsd = (totalInput * pricing.inputPer1MTokens + billableOutput * pricing.outputPer1MTokens) / 1_000_000;

  const sortedMs = outcomes.map((o) => o.elapsedMs).sort((a, b) => a - b);

  return {
    totalDocs,
    succeededDocs: succeeded.length,
    failedDocs,
    docTypePass,
    customerPass,
    officePass,
    allPass,
    anomalousPageCount,
    retriedDocCount,
    totalInput,
    totalOutput,
    totalThinking,
    costUsd,
    p50Ms: percentile(sortedMs, 50),
    p95Ms: percentile(sortedMs, 95),
    p99Ms: percentile(sortedMs, 99),
  };
}

/**
 * 精度劣化(regressed)判定と3つの失敗率ゲートを1つの総合PASS/FAIL判定に統合する。
 * 以前はregressedのみでヘッドラインを表示しており、失敗率ゲート超過時も「✅ PASS」と
 * 表示されてしまい、ゲート警告行を見落とすと誤って安全と判断しうる状態だった。
 */
export function computeOverallPass(params: {
  regressed: boolean;
  baselineFailureRateExceeded: boolean;
  candidateFailureRateExceeded: boolean;
  downloadFailureRateExceeded: boolean;
}): boolean {
  return (
    !params.regressed &&
    !params.baselineFailureRateExceeded &&
    !params.candidateFailureRateExceeded &&
    !params.downloadFailureRateExceeded
  );
}
