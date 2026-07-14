/**
 * scripts/compare-ocr-arbitration-logic-confirmed.ts の集計・判定ロジック(I/Oを一切伴わない純粋関数のみ)。
 *
 * scripts/lib/confirmedReplayStats.ts は「モデルA/B比較(2.5 vs 3.5)」向け、
 * scripts/lib/ocrLogicCompareStats.ts は「ロジックA/B比較(dev環境合成フィクスチャ、
 * documentType/customerName/officeName/date 4項目全gate)」向け。本ファイルは両者の
 * 交差点にあたる「ロジックA/B比較 × kanameone/cocoro confirmed replay」向けで、
 * kanameone実データにはdocumentType/dateのconfirmed相当ground truthが存在しない
 * (compare-gemini-ocr-models-confirmed.ts冒頭コメント参照)ため、confirmedReplayStats.ts
 * と同じくcustomerName/officeNameの2項目のみをgate対象とする。
 *
 * pct/describeErrorSafely/isNonEmptyStringは対象非依存の汎用ヘルパーのため
 * confirmedReplayStats.tsから再利用する(重複実装を避ける)。
 */

import { pct, computeMatchRate, computeOverallPass } from './confirmedReplayStats';

export interface ArbitrationLogicOutcomeForSummary {
  success: boolean;
  /** candidate側(候補抽出呼出し)のみ非0。baseline側は常に0(追加呼出しなしの意)。 */
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  customerMatch: boolean;
  officeMatch: boolean;
  /** 書類種別一致(参考値、gate対象外。kanameone実データにconfirmed相当ground truthがないため) */
  docTypeMatchReferenceOnly: boolean;
  /**
   * 候補抽出の3項目(documentType/customerName/officeName、dateは本ハーネスでは
   * arbitrateDateを呼ばないため対象外)のうちgroundingされた件数と試行件数。
   * candidate側ロジックのみで意味を持つ(baseline側は常に0/0)。
   */
  groundedCandidateCount: number;
  nonNullCandidateCount: number;
}

export interface ArbitrationLogicSummaryStats {
  totalDocs: number;
  succeededDocs: number;
  failedDocs: number;
  customerPass: number;
  officePass: number;
  /** customerMatch && officeMatch の一致数(gate対象の確定2項目一致) */
  confirmedFieldsPass: number;
  docTypePassReferenceOnly: number;
  totalInput: number;
  totalOutput: number;
  totalThinking: number;
  costUsd: number;
  groundedCandidateCount: number;
  nonNullCandidateCount: number;
}

/**
 * ArbitrationLogicSummaryStatsはconfirmedFieldsPass/succeededDocsを
 * ModelSummaryStatsと同じ意味・同じフィールド名で持つため、
 * scripts/lib/confirmedReplayStats.ts computeMatchRate をそのまま再利用する
 * (重複実装を避ける。絶対件数ではなく成功文書中の一致率で比較する理由も同ファイル参照)。
 */
export const computeArbitrationMatchRate = computeMatchRate;

/** grounding試行件数のうち失敗した割合(candidate側のみ意味を持つ、baseline側は常に0%) */
export function computeGroundingFailureRate(
  stats: Pick<ArbitrationLogicSummaryStats, 'groundedCandidateCount' | 'nonNullCandidateCount'>
): number {
  return stats.nonNullCandidateCount > 0
    ? 1 - stats.groundedCandidateCount / stats.nonNullCandidateCount
    : 0;
}

export function computeArbitrationLogicSummaryStats(
  pricing: { inputPer1MTokens: number; outputPer1MTokens: number },
  outcomes: ArbitrationLogicOutcomeForSummary[]
): ArbitrationLogicSummaryStats {
  const totalDocs = outcomes.length;
  const succeeded = outcomes.filter((o) => o.success);
  const failedDocs = totalDocs - succeeded.length;

  const customerPass = succeeded.filter((o) => o.customerMatch).length;
  const officePass = succeeded.filter((o) => o.officeMatch).length;
  const confirmedFieldsPass = succeeded.filter((o) => o.customerMatch && o.officeMatch).length;
  const docTypePassReferenceOnly = succeeded.filter((o) => o.docTypeMatchReferenceOnly).length;

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
    customerPass,
    officePass,
    confirmedFieldsPass,
    docTypePassReferenceOnly,
    totalInput,
    totalOutput,
    totalThinking,
    costUsd,
    groundedCandidateCount,
    nonNullCandidateCount,
  };
}

/**
 * パラメータ形状がscripts/lib/confirmedReplayStats.ts computeOverallPass と完全に
 * 一致するため、そのまま再利用する(重複実装を避ける)。
 */
export const computeOverallArbitrationPass = computeOverallPass;

export { pct };
