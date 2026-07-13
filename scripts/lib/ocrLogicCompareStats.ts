/**
 * scripts/compare-ocr-arbitration-logic.ts の集計・判定ロジック(I/Oを一切伴わない純粋関数のみ)。
 *
 * scripts/lib/confirmedReplayStats.ts は「モデルA/B比較(2.5 vs 3.5)」向けに、customer/office
 * の2項目のみをgate対象とする設計(documentType/dateはkanameone実運用でconfirmed相当の
 * ground truthを持たないため参考値扱い)。本ファイルは「ロジックA/B比較(既存抽出のみ vs
 * 候補抽出+arbitration統合後)」向けで、dev環境の合成フィクスチャは4項目(documentType/
 * customerName/officeName/date)全てのground truthを持つため、4項目全てをgate対象とする点が
 * confirmedReplayStats.tsとの意図的な差分。
 *
 * pct/percentile/describeErrorSafely/isNonEmptyStringは対象非依存の汎用ヘルパーのため
 * confirmedReplayStats.tsから再利用する(重複実装を避ける)。
 */

import { pct } from './confirmedReplayStats';

export interface LogicOutcomeForSummary {
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  docTypeMatch: boolean;
  customerMatch: boolean;
  officeMatch: boolean;
  dateMatch: boolean;
  /**
   * 候補抽出の4項目のうちgroundingされた(OCR全文へ逐語的に存在した)件数と、
   * grounding判定を試行した件数(候補がnullでない=何らかの値を返した件数)。
   * candidate側ロジックのみで意味を持つ(baseline側は常に0/0)。
   */
  groundedCandidateCount: number;
  nonNullCandidateCount: number;
}

export interface LogicSummaryStats {
  totalDocs: number;
  succeededDocs: number;
  failedDocs: number;
  docTypePass: number;
  customerPass: number;
  officePass: number;
  datePass: number;
  /** documentType/customerName/officeName/date の4項目全一致数 */
  allFourPass: number;
  totalInput: number;
  totalOutput: number;
  totalThinking: number;
  costUsd: number;
  groundedCandidateCount: number;
  nonNullCandidateCount: number;
}

/**
 * 絶対件数ではなく成功文書中の一致率で比較する
 * (scripts/lib/confirmedReplayStats.ts computeMatchRate と同じ理由: baseline/candidateで
 * succeededDocsが異なりうるため、絶対件数比較だと誤判定しうる)。
 */
export function computeLogicMatchRate(
  stats: Pick<LogicSummaryStats, 'allFourPass' | 'succeededDocs'>
): number {
  return stats.succeededDocs > 0 ? stats.allFourPass / stats.succeededDocs : 0;
}

/** grounding試行件数のうち失敗した割合(candidate側のみ意味を持つ、baseline側は常に0%) */
export function computeGroundingFailureRate(
  stats: Pick<LogicSummaryStats, 'groundedCandidateCount' | 'nonNullCandidateCount'>
): number {
  return stats.nonNullCandidateCount > 0
    ? 1 - stats.groundedCandidateCount / stats.nonNullCandidateCount
    : 0;
}

export function computeLogicSummaryStats(
  pricing: { inputPer1MTokens: number; outputPer1MTokens: number },
  outcomes: LogicOutcomeForSummary[]
): LogicSummaryStats {
  const totalDocs = outcomes.length;
  const succeeded = outcomes.filter((o) => o.success);
  const failedDocs = totalDocs - succeeded.length;

  const docTypePass = succeeded.filter((o) => o.docTypeMatch).length;
  const customerPass = succeeded.filter((o) => o.customerMatch).length;
  const officePass = succeeded.filter((o) => o.officeMatch).length;
  const datePass = succeeded.filter((o) => o.dateMatch).length;
  const allFourPass = succeeded.filter(
    (o) => o.docTypeMatch && o.customerMatch && o.officeMatch && o.dateMatch
  ).length;

  const totalInput = outcomes.reduce((s, o) => s + o.inputTokens, 0);
  const totalOutput = outcomes.reduce((s, o) => s + o.outputTokens, 0);
  const totalThinking = outcomes.reduce((s, o) => s + o.thinkingTokens, 0);
  const billableOutput = totalOutput + totalThinking;
  const costUsd = (totalInput * pricing.inputPer1MTokens + billableOutput * pricing.outputPer1MTokens) / 1_000_000;

  const groundedCandidateCount = outcomes.reduce((s, o) => s + o.groundedCandidateCount, 0);
  const nonNullCandidateCount = outcomes.reduce((s, o) => s + o.nonNullCandidateCount, 0);

  return {
    totalDocs,
    succeededDocs: succeeded.length,
    failedDocs,
    docTypePass,
    customerPass,
    officePass,
    datePass,
    allFourPass,
    totalInput,
    totalOutput,
    totalThinking,
    costUsd,
    groundedCandidateCount,
    nonNullCandidateCount,
  };
}

/**
 * 精度劣化(regressed)判定と失敗率ゲートを1つの総合PASS/FAIL判定に統合する
 * (scripts/lib/confirmedReplayStats.ts computeOverallPass と同じ設計意図)。
 */
export function computeOverallLogicPass(params: {
  regressed: boolean;
  baselineFailureRateExceeded: boolean;
  candidateFailureRateExceeded: boolean;
}): boolean {
  return !params.regressed && !params.baselineFailureRateExceeded && !params.candidateFailureRateExceeded;
}

export { pct };
