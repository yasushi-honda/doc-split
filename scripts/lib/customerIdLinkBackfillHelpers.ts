/**
 * 確認済み書類の顧客ID紐づけ補完(`scripts/backfill-customer-id-link.ts`)の純粋関数群。
 *
 * 背景: 確認ボタンの自動確定・書類詳細の保存は、顧客名が有効で同名衝突が無ければ`customerId`が
 * 空のままでも「確認済み」にする。Driveエクスポートは`customerId`でマスターを引いてフリガナを
 * 取るため、紐づけが無い確認済み書類は「フリガナが未設定」でエラーになる(kanameone、2026-10-01)。
 *
 * 方針(decision-maker承認済み): 同名の顧客マスターが**ちょうど1件**の場合だけ、`customerId`を
 * そのマスターへ補完する。同姓同名(空白違いを含む)・同名なしは自動では紐づけない。
 *
 * Firestore/Admin SDKには依存しない(I/Oは呼び出し側)。PII対策: manifestにはdocId・マスターID・
 * 件数のみ入れ、顧客名・ファイル名は入れない。
 */

import { findSameNameCollisionNames, isValidCustomerSelection } from '../../shared/customerIdentity';

export const CUSTOMER_ID_LINK_MANIFEST_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- 分類

export type SkipReason = 'not-confirmed' | 'invalid-name' | 'ambiguous-same-name' | 'no-master' | 'invalid-field-type';
export const SKIP_REASONS: readonly SkipReason[] = [
  'not-confirmed',
  'invalid-name',
  'ambiguous-same-name',
  'no-master',
  'invalid-field-type',
];

/** 紐づけ前の`customerId`の状態(rollbackで元に戻すために記録する)。 */
export type CustomerIdBefore = { state: 'absent' } | { state: 'empty' } | { state: 'dangling'; id: string };

export type LinkClassification =
  | { kind: 'link'; masterId: string; before: CustomerIdBefore }
  | { kind: 'skip'; reason: SkipReason }
  | { kind: 'not-applicable' };

export interface LinkCandidateDoc {
  customerId?: unknown;
  customerName?: unknown;
  verified?: unknown;
  customerConfirmed?: unknown;
}

export interface MasterIndex {
  /** マスターの生の`name`(trimしない)→ ID一覧。エクスポートの乖離チェック(書類名trim済み vs マスター名の生)と揃える。 */
  idsByExactName: Map<string, string[]>;
  ids: Set<string>;
  /** 同名衝突(trim+内部空白除去で2件以上)の生のtrim済み名の集合。 */
  collisionNames: Set<string>;
}

export function buildMasterIndex(masters: Array<{ id: string; name: unknown }>): MasterIndex {
  const idsByExactName = new Map<string, string[]>();
  const ids = new Set<string>();
  const named: Array<{ name: string }> = [];
  for (const m of masters) {
    ids.add(m.id);
    if (typeof m.name !== 'string') continue;
    named.push({ name: m.name });
    const list = idsByExactName.get(m.name) ?? [];
    list.push(m.id);
    idsByExactName.set(m.name, list);
  }
  return { idsByExactName, ids, collisionNames: findSameNameCollisionNames(named) };
}

/**
 * 1書類を分類する。紐づけ不備(customerIdが無い・空・存在しないマスターを指す)でなければ
 * `not-applicable`(既に有効に紐づいている)。不備があっても、確認済みでない・顧客名が無効・
 * 同名が曖昧/不在の場合は`skip`(理由付き)。
 */
export function classifyCustomerIdLink(doc: LinkCandidateDoc, index: MasterIndex): LinkClassification {
  const id = doc.customerId;
  let before: CustomerIdBefore;
  if (id === undefined || id === null) {
    before = { state: 'absent' };
  } else if (typeof id !== 'string') {
    return { kind: 'skip', reason: 'invalid-field-type' };
  } else if (id === '') {
    before = { state: 'empty' };
  } else if (index.ids.has(id)) {
    return { kind: 'not-applicable' };
  } else {
    before = { state: 'dangling', id };
  }

  // 未確定の書類は既存の「顧客未確定」ゲートの領分(人の確定が先)。ここでは触らない
  if (doc.verified !== true || doc.customerConfirmed !== true) return { kind: 'skip', reason: 'not-confirmed' };

  if (typeof doc.customerName !== 'string' || !isValidCustomerSelection(doc.customerName)) {
    return { kind: 'skip', reason: 'invalid-name' };
  }
  const name = doc.customerName.trim();

  // 空白違いの同姓同名は、完全一致が1件でも自動で紐づけない(別人の可能性)
  if (index.collisionNames.has(name)) return { kind: 'skip', reason: 'ambiguous-same-name' };
  const matches = index.idsByExactName.get(name) ?? [];
  if (matches.length >= 2) return { kind: 'skip', reason: 'ambiguous-same-name' };
  if (matches.length === 0) return { kind: 'skip', reason: 'no-master' };
  return { kind: 'link', masterId: matches[0], before };
}

// ---------------------------------------------------------------- manifest

export interface CustomerIdLinkManifestEntry {
  docId: string;
  customerIdBefore: CustomerIdBefore;
  customerIdAfter: string;
  /** 書込み結果の`writeTime`(rollbackで「backfill後に誰も書いていない」ことを確認する)。 */
  backfillUpdateTime: { seconds: number; nanoseconds: number };
}

export interface CustomerIdLinkManifest {
  schemaVersion: typeof CUSTOMER_ID_LINK_MANIFEST_SCHEMA_VERSION;
  runId: string;
  projectId: string;
  timestamp: string;
  dryRun: boolean;
  entries: CustomerIdLinkManifestEntry[];
  /** 対象外の理由別docId(現場判断用)。 */
  skipped: Record<SkipReason, string[]>;
  totalScanned: number;
  scanIncomplete: boolean;
}

export function buildCustomerIdLinkManifest(input: Omit<CustomerIdLinkManifest, 'schemaVersion'>): CustomerIdLinkManifest {
  return { schemaVersion: CUSTOMER_ID_LINK_MANIFEST_SCHEMA_VERSION, ...input };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOnlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));
const isNonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
/** Firestoreのdocument IDとして不正(空・スラッシュ含む)なものを拒否する。 */
const isValidDocId = (v: unknown): v is string => isNonEmptyStr(v) && !v.includes('/');

function isValidBefore(v: unknown): v is CustomerIdBefore {
  if (!isObj(v)) return false;
  if (v.state === 'absent' || v.state === 'empty') return hasOnlyKeys(v, ['state']);
  if (v.state === 'dangling') return hasOnlyKeys(v, ['state', 'id']) && isNonEmptyStr(v.id);
  return false;
}

function isValidEntry(v: unknown): v is CustomerIdLinkManifestEntry {
  if (!isObj(v) || !hasOnlyKeys(v, ['docId', 'customerIdBefore', 'customerIdAfter', 'backfillUpdateTime'])) return false;
  const t = v.backfillUpdateTime;
  return (
    isValidDocId(v.docId) &&
    isValidBefore(v.customerIdBefore) &&
    isNonEmptyStr(v.customerIdAfter) &&
    isObj(t) &&
    hasOnlyKeys(t, ['seconds', 'nanoseconds']) &&
    isCount(t.seconds) &&
    isCount(t.nanoseconds)
  );
}

export function isValidCustomerIdLinkManifest(v: unknown): v is CustomerIdLinkManifest {
  if (!isObj(v)) return false;
  if (!hasOnlyKeys(v, ['schemaVersion', 'runId', 'projectId', 'timestamp', 'dryRun', 'entries', 'skipped', 'totalScanned', 'scanIncomplete'])) return false;
  if (v.schemaVersion !== CUSTOMER_ID_LINK_MANIFEST_SCHEMA_VERSION) return false;
  if (!isNonEmptyStr(v.runId) || !isNonEmptyStr(v.projectId) || !isNonEmptyStr(v.timestamp)) return false;
  if (typeof v.dryRun !== 'boolean' || typeof v.scanIncomplete !== 'boolean' || !isCount(v.totalScanned)) return false;
  if (!Array.isArray(v.entries) || !v.entries.every(isValidEntry)) return false;
  const docIds = (v.entries as CustomerIdLinkManifestEntry[]).map((e) => e.docId);
  if (new Set(docIds).size !== docIds.length) return false;
  const s = v.skipped;
  if (!isObj(s) || !hasOnlyKeys(s, SKIP_REASONS)) return false;
  return SKIP_REASONS.every((r) => Array.isArray(s[r]) && (s[r] as unknown[]).every(isValidDocId));
}

// ---------------------------------------------------------------- rollback

export function isRollbackEligibleByUpdateTime(
  entry: CustomerIdLinkManifestEntry,
  liveUpdateTime: { seconds: number; nanoseconds: number }
): boolean {
  return liveUpdateTime.seconds === entry.backfillUpdateTime.seconds && liveUpdateTime.nanoseconds === entry.backfillUpdateTime.nanoseconds;
}

export type RollbackInstruction = { action: 'delete' } | { action: 'set'; value: string };

export function computeCustomerIdRollbackInstruction(entry: CustomerIdLinkManifestEntry): RollbackInstruction {
  switch (entry.customerIdBefore.state) {
    case 'absent':
      return { action: 'delete' };
    case 'empty':
      return { action: 'set', value: '' };
    case 'dangling':
      return { action: 'set', value: entry.customerIdBefore.id };
  }
}
