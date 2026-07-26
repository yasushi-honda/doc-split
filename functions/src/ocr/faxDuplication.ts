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
 *
 * 同姓同名マスター衝突の除外(ADR-0022顧客未確定ゲート再設計、2026-07-25。Plan agent検証で
 * 発覚した致命的な穴への対応): `!c.isDuplicate`だけでは、マスター側の`isDuplicate`フラグが
 * 未設定(登録時に自動付与されるが事後の追加・改名では更新されない、
 * `frontend/src/pages/MastersPage.tsx`の`handleForceAdd`参照)の同姓同名2件を「別人2名」と
 * 誤認し、`buildFaxDuplicationMemberOverride()`が無条件で`customerConfirmed:true`を書き込む
 * ため、Drive エクスポートの顧客未確定ゲート(`functions/src/drive/customerAmbiguityGate.ts`)を
 * 完全に迂回してしまう。呼出元が`sameNameCollisionNames`(同名マスターが2件以上存在する名前の
 * 集合、`shared/customerIdentity.ts`の`findSameNameCollisionNames()`で計算)を渡し、
 * `isDuplicate`フラグに依存せず候補自体を除外することで根本から塞ぐ。
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
  /**
   * 同名マスターが2件以上存在する顧客名の集合(`shared/customerIdentity.ts`の
   * `findSameNameCollisionNames()`で計算、呼出元がロード済みの顧客マスター全件から
   * 追加読み込みなしで算出する)。この集合に含まれる名前の候補は、`isDuplicate`フラグの
   * 値によらず複製対象から除外する(上記モジュールJSDoc参照)。
   */
  sameNameCollisionNames: ReadonlySet<string>;
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

  // CodeRabbit指摘: score降順の保証を呼出元(extractors.tsのsort)の暗黙の前提だけに
  // 委ねず、本関数自身でも明示的にソートしてから重複排除する(「先勝ち」dedupが
  // 最高スコア以外を拾ってしまう回帰を、モジュール境界をまたいだ暗黙契約に頼らず防ぐ)。
  // c.name.trim(): sameNameCollisionNamesはfindSameNameCollisionNames()がtrim済みキーで
  // 返す集合のため、c.name側もtrimしてから照合しないと前後空白付きマスター名の同名衝突を
  // 見逃す(Codex review-diff P2指摘、2026-07-26)。インメモリ処理のため追加コストなし。
  const exactNonDuplicate = input.candidates
    .filter((c) => c.matchType === 'exact' && !c.isDuplicate && !input.sameNameCollisionNames.has(c.name.trim()))
    .sort((a, b) => b.score - a.score);

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
