/**
 * 複数顧客FAX複製ロジック(kanameone現場要件、GOAL.md D3/D4/D5)
 *
 * OCRで複数の顧客候補を検出したFAXを検出人数分複製し、各コピーに異なる顧客を割り当てる
 * 判定・payload構築を行う純粋関数群。Firestore/Storage副作用を持たないため直接ユニット
 * テスト可能(ocrUpdatePayloadBuilder.ts/splitDocumentBuilder.tsと同じ設計規約)。
 *
 * トリガー条件(D3): matchType==='exact' && !isDuplicate の候補をcustomerIdで重複排除した
 * 結果が2件以上。家族名等の偽陽性リスク(Codexセカンドオピニオン指摘)を避けるため、
 * fuzzy/partialマッチや同姓同名フラグ(isDuplicate)付き候補は複製対象に含めない。
 *
 * 再複製防止(AC-c): 呼出元がfreshData.distributionId(既に配信済みかどうか)を
 * alreadyDistributedとして渡す。既に配信済みのdoc(元doc・複製コピーいずれも自身のid
 * またはdistributionIdが設定済み)を再処理しても、本関数はshouldDuplicate:falseを返す。
 *
 * 確定済み/確認済みdocの保護(code-review high指摘、CONFIRMED): 呼出元がfreshData.
 * customerConfirmed/verifiedのいずれかをalreadyConfirmedOrVerifiedとして渡す。人間が
 * 既に顧客を確定(customerConfirmed:true)または確認(verified:true)したdocは、
 * confirmedFieldMerge.tsの既存保護機構と同じ精神で、複製によって上書き・分割されて
 * はならない(ops script経由の再処理等でcustomerConfirmedがクリアされずにOCRが再実行
 * された場合、複製が人間の確定済み割当を無条件で上書きしてしまう問題への対策)。
 */

import type { CustomerCandidate } from '../utils/extractors';

export interface FaxDuplicationAssignment {
  customerId: string;
  customerName: string;
  careManagerName: string | null;
}

export interface FaxDuplicationConsideredCandidate {
  customerId: string;
  matchType: string;
  score: number;
  isDuplicate: boolean;
}

export type FaxDuplicationPlanReason =
  | 'flagDisabled'
  | 'alreadyDistributed'
  | 'alreadyConfirmedOrVerified'
  | 'insufficientExactCandidates'
  | 'exactCandidatesDistributed';

export interface FaxDuplicationPlan {
  shouldDuplicate: boolean;
  /** 割当先(customerId重複排除済み、score降順)。shouldDuplicate:falseの場合は空配列。 */
  assignments: FaxDuplicationAssignment[];
  /** 判定理由。構造化ログにそのまま使う。 */
  reason: FaxDuplicationPlanReason;
  /** 判定に使った候補一覧(観測用ログ・過剰/過少配信の監視に使う、D3参照) */
  consideredCandidates: FaxDuplicationConsideredCandidate[];
}

export interface PlanFaxDuplicationInput {
  flagEnabled: boolean;
  alreadyDistributed: boolean;
  /** freshData.customerConfirmed === true || freshData.verified === true */
  alreadyConfirmedOrVerified: boolean;
  candidates: CustomerCandidate[];
}

export function planFaxDuplication(input: PlanFaxDuplicationInput): FaxDuplicationPlan {
  const consideredCandidates: FaxDuplicationConsideredCandidate[] = input.candidates.map((c) => ({
    customerId: c.id,
    matchType: c.matchType,
    score: c.score,
    isDuplicate: c.isDuplicate,
  }));

  if (!input.flagEnabled) {
    return { shouldDuplicate: false, assignments: [], reason: 'flagDisabled', consideredCandidates };
  }
  if (input.alreadyDistributed) {
    return { shouldDuplicate: false, assignments: [], reason: 'alreadyDistributed', consideredCandidates };
  }
  if (input.alreadyConfirmedOrVerified) {
    return {
      shouldDuplicate: false,
      assignments: [],
      reason: 'alreadyConfirmedOrVerified',
      consideredCandidates,
    };
  }

  const exactNonDuplicate = input.candidates.filter(
    (c) => c.matchType === 'exact' && !c.isDuplicate
  );

  const deduped = new Map<string, CustomerCandidate>();
  for (const c of exactNonDuplicate) {
    if (!deduped.has(c.id)) deduped.set(c.id, c);
  }

  const assignments: FaxDuplicationAssignment[] = Array.from(deduped.values()).map((c) => ({
    customerId: c.id,
    customerName: c.name,
    careManagerName: c.careManagerName ?? null,
  }));

  if (assignments.length < 2) {
    return {
      shouldDuplicate: false,
      assignments: [],
      reason: 'insufficientExactCandidates',
      consideredCandidates,
    };
  }

  return {
    shouldDuplicate: true,
    assignments,
    reason: 'exactCandidatesDistributed',
    consideredCandidates,
  };
}

/** 複製先ドキュメント1件分の顧客識別フィールドのoverride(D4/D5)。 */
export interface FaxDuplicationMemberOverride {
  customerId: string;
  customerName: string;
  careManager: string | null;
  isDuplicateCustomer: false;
  needsManualCustomerSelection: false;
  customerConfirmed: true;
  confirmedBy: null;
  confirmedAt: null;
  verified: false;
  verifiedBy: null;
  verifiedAt: null;
  distributionId: string;
}

/**
 * 複製メンバー1件分のoverrideを構築する。distributionIdには常に「元doc」のdocIdを渡す
 * (元doc自身への割当の場合も含む。`doc.id === doc.distributionId`で元doc判定できる設計、D4)。
 */
export function buildFaxDuplicationMemberOverride(
  assignment: FaxDuplicationAssignment,
  distributionId: string
): FaxDuplicationMemberOverride {
  return {
    customerId: assignment.customerId,
    customerName: assignment.customerName,
    careManager: assignment.careManagerName,
    isDuplicateCustomer: false,
    needsManualCustomerSelection: false,
    customerConfirmed: true,
    confirmedBy: null,
    confirmedAt: null,
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    distributionId,
  };
}
