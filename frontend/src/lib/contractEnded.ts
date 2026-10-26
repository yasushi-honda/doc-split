/**
 * 契約終了した利用者の書類を非表示にする判定ロジック(Issue #1033)
 *
 * 判定の要点:
 * - customerIdがマスターに存在する場合は、名前照合なしでそのマスターの契約状態を正とする
 *   (customerNameが未同期でも判定が効くように。/plan-crossreview codex指摘)
 * - customerIdが無い/空文字/マスターに存在しない場合のみ、名前キーによるフォールバックを使う。
 *   このとき「同じ名前キーを持つマスターが全員契約終了」の場合だけ非表示にする(同姓同名で
 *   一方だけ契約中なら表示側に倒す)
 * - 迷ったら表示(fail-open)。マスター未読込・表示トグルONは常に表示
 * - 確認済み/未確認(選択待ち含む)は問わず非表示にする(クライアント要望 2026-10-27。
 *   以前は未確認書類を常に表示していたが、契約終了後も一覧に残り続けるため廃止)
 */

import type { CustomerMaster } from '@shared/types';
import { normalizeGroupKey } from './normalizeGroupKey';

export interface ContractEndedLookup {
  /** customersマスターの読み込みが完了しているか */
  isReady: boolean;
  /** customerId → そのマスターが契約終了か */
  endedById: ReadonlyMap<string, boolean>;
  /** 名前キー → その名前キーを持つ全マスターが契約終了か */
  fullyEndedNameKeys: ReadonlySet<string>;
}

export function buildContractEndedLookup(customers: CustomerMaster[] | undefined): ContractEndedLookup {
  if (!customers) {
    return { isReady: false, endedById: new Map(), fullyEndedNameKeys: new Set() };
  }

  const endedById = new Map<string, boolean>();
  const nameKeyGroups = new Map<string, CustomerMaster[]>();
  for (const customer of customers) {
    endedById.set(customer.id, customer.isContractEnded === true);
    const nameKey = normalizeGroupKey(customer.name);
    if (!nameKey) continue;
    const group = nameKeyGroups.get(nameKey);
    if (group) {
      group.push(customer);
    } else {
      nameKeyGroups.set(nameKey, [customer]);
    }
  }

  const fullyEndedNameKeys = new Set<string>();
  for (const [nameKey, group] of nameKeyGroups) {
    if (group.every((c) => c.isContractEnded === true)) {
      fullyEndedNameKeys.add(nameKey);
    }
  }

  return { isReady: true, endedById, fullyEndedNameKeys };
}

interface ContractEndedDocLike {
  customerId?: string | null;
  customerName?: string;
  customerKey?: string;
  verified?: boolean;
}

export function isDocumentHiddenByContractEnd(
  doc: ContractEndedDocLike,
  lookup: ContractEndedLookup,
  showContractEnded: boolean,
): boolean {
  if (showContractEnded || !lookup.isReady) return false;
  if (doc.customerId) {
    const isEnded = lookup.endedById.get(doc.customerId);
    if (isEnded !== undefined) {
      return isEnded;
    }
    // customerIdはあるがマスターに存在しない(削除済み等) → 名前フォールバックへ
  }

  const nameKey = doc.customerKey || normalizeGroupKey(doc.customerName);
  if (!nameKey) return false;
  return lookup.fullyEndedNameKeys.has(nameKey);
}

export function isCustomerGroupHiddenByContractEnd(
  groupKey: string,
  lookup: ContractEndedLookup,
  showContractEnded: boolean,
): boolean {
  if (showContractEnded || !lookup.isReady) return false;
  if (!groupKey) return false;
  return lookup.fullyEndedNameKeys.has(groupKey);
}

/** 名前キー(normalizeGroupKey) → その名前キーを持つ顧客マスター一覧 */
export type CustomerNameIndex = ReadonlyMap<string, CustomerMaster[]>;

export function buildCustomerNameIndex(customers: CustomerMaster[] | undefined): CustomerNameIndex {
  const index = new Map<string, CustomerMaster[]>();
  for (const customer of customers ?? []) {
    const nameKey = normalizeGroupKey(customer.name);
    if (!nameKey) continue;
    const group = index.get(nameKey);
    if (group) {
      group.push(customer);
    } else {
      index.set(nameKey, [customer]);
    }
  }
  return index;
}

/**
 * 利用者別グループのキーから、操作対象の顧客マスターを特定する。
 * 名前キーが一致する顧客がちょうど1人のときだけ返す。0人(未登録)・2人以上(同姓同名)は
 * 別人を誤更新しないよう null を返す(スタッフ向けの契約終了切替操作を出さない根拠)。
 * groupKeyは書類側のcustomerNameから作られるため、customerIdとの一致までは保証しない。
 */
export function findCustomerForGroupKey(
  groupKey: string,
  index: CustomerNameIndex,
): CustomerMaster | null {
  if (!groupKey) return null;
  const matches = index.get(groupKey);
  return matches && matches.length === 1 ? (matches[0] ?? null) : null;
}
