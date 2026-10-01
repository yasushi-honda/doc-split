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

import { findSameNameCollisionNames, isValidCustomerSelection, stripInternalSpaces } from '../../shared/customerIdentity';

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
export type CustomerIdBefore = { state: 'absent' } | { state: 'null' } | { state: 'empty' } | { state: 'dangling'; id: string };

/** 紐づけの種類。`link`はcustomerIdのみ、`link-rename`(空白違いのみ)はcustomerIdとcustomerName(マスター表記)を書く。 */
export type LinkKind = 'link' | 'link-rename';

export type LinkClassification =
  | { kind: 'link'; masterId: string; before: CustomerIdBefore }
  | { kind: 'link-rename'; masterId: string; before: CustomerIdBefore; newCustomerName: string }
  | { kind: 'skip'; reason: SkipReason }
  | { kind: 'not-applicable' };

export interface ClassifyOptions {
  /**
   * 空白の違いだけ(内部空白の有無)で一致するマスターがちょうど1件の書類も、`link-rename`として対象にする。
   * フラグなしは第1段と同じ挙動(完全一致のみ)。
   */
  allowWhitespaceVariant?: boolean;
}

export interface LinkCandidateDoc {
  customerId?: unknown;
  customerName?: unknown;
  verified?: unknown;
  customerConfirmed?: unknown;
}

export interface MasterIndex {
  /** マスターの生の`name`(trimしない)→ ID一覧。エクスポートの乖離チェック(書類名trim済み vs マスター名の生)と揃える。 */
  idsByExactName: Map<string, string[]>;
  /** マスターID → 生の`name`(`link-rename`で揃える名前の取得用。書類ごとの全走査を避ける)。 */
  nameById: Map<string, string>;
  /** マスターの`name`をtrim+内部空白除去したキー → ID一覧(空白違いだけの書類の照合用)。 */
  idsByStrippedName: Map<string, string[]>;
  ids: Set<string>;
  /** 同名衝突(trim+内部空白除去、またはNFKC正規化後に2件以上)の生のtrim済み名の集合。 */
  collisionNames: Set<string>;
  /** `furigana`が無い/空のマスターID(紐づけてもフォルダ名のフリガナが取れないため、dry-runで警告する)。 */
  idsWithoutFurigana: Set<string>;
  /** `name`が文字列でないマスターの件数(データ破損の検知用。名前索引から外れ、該当書類はno-masterになる)。 */
  nonStringNameCount: number;
}

export function buildMasterIndex(masters: Array<{ id: string; name: unknown; furigana?: unknown }>): MasterIndex {
  const idsByExactName = new Map<string, string[]>();
  const idsByStrippedName = new Map<string, string[]>();
  const nameById = new Map<string, string>();
  const ids = new Set<string>();
  const named: Array<{ name: string }> = [];
  let nonStringNameCount = 0;
  const idsWithoutFurigana = new Set<string>();
  for (const m of masters) {
    ids.add(m.id);
    if (typeof m.furigana !== 'string' || m.furigana.trim() === '') idsWithoutFurigana.add(m.id);
    if (typeof m.name !== 'string') {
      nonStringNameCount++;
      continue;
    }
    named.push({ name: m.name });
    const list = idsByExactName.get(m.name) ?? [];
    list.push(m.id);
    idsByExactName.set(m.name, list);
    nameById.set(m.id, m.name);
    const strippedKey = stripInternalSpaces(m.name.trim());
    idsByStrippedName.set(strippedKey, [...(idsByStrippedName.get(strippedKey) ?? []), m.id]);
  }
  // 既存の同名衝突判定(trim+内部空白除去)に加え、NFKC正規化(濁点の分解・半角カナ・互換文字)で同一になる別表記も
  // 衝突とみなす。書類名が片方に完全一致しても、同一人物の別表記マスターが並存する場合は自動で紐づけない
  const collisionNames = findSameNameCollisionNames(named);
  const rawByNfkcKey = new Map<string, string[]>();
  for (const m of named) {
    const trimmed = m.name.trim();
    const key = stripInternalSpaces(trimmed.normalize('NFKC'));
    rawByNfkcKey.set(key, [...(rawByNfkcKey.get(key) ?? []), trimmed]);
  }
  for (const group of rawByNfkcKey.values()) {
    if (group.length > 1) for (const raw of group) collisionNames.add(raw);
  }
  return { idsByExactName, idsByStrippedName, nameById, ids, collisionNames, idsWithoutFurigana, nonStringNameCount };
}

/**
 * 1書類を分類する。紐づけ不備(customerIdが無い・空・存在しないマスターを指す)でなければ
 * `not-applicable`(既に有効に紐づいている)。不備があっても、確認済みでない・顧客名が無効・
 * 同名が曖昧/不在の場合は`skip`(理由付き)。
 */
export function classifyCustomerIdLink(doc: LinkCandidateDoc, index: MasterIndex, opts: ClassifyOptions = {}): LinkClassification {
  const id = doc.customerId;
  let before: CustomerIdBefore;
  if (id === undefined) {
    before = { state: 'absent' };
  } else if (id === null) {
    before = { state: 'null' }; // 明示的なnull。rollbackで元のnullへ戻す(フィールド削除と区別する)
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
  if (matches.length === 1) return { kind: 'link', masterId: matches[0], before };

  // 完全一致が無い。フラグ指定時のみ、空白の違いだけで一致するマスターがちょうど1件の書類を、顧客名もマスター表記へ揃えて紐づける
  // (顧客名がマスター名と食い違うと、エクスポートの顧客確認が「顧客未確定」に落とすため、名前も揃える必要がある)
  if (opts.allowWhitespaceVariant) {
    const stripped = index.idsByStrippedName.get(stripInternalSpaces(name)) ?? [];
    if (stripped.length >= 2) return { kind: 'skip', reason: 'ambiguous-same-name' };
    if (stripped.length === 1) {
      const masterName = index.nameById.get(stripped[0]);
      // 候補マスターがNFKC表記違いの同姓同名と衝突している場合は、自動では紐づけない
      if (masterName === undefined) return { kind: 'skip', reason: 'no-master' };
      // マスター名の前後に空白がある場合、エクスポートの顧客確認(trim済みの書類名 vs 生のマスター名)はどう揃えても一致しない。
      // 揃えても「顧客未確定」に落ちるだけなので、対象外にする(マスター側の名前の整理が先)
      if (masterName !== masterName.trim()) return { kind: 'skip', reason: 'no-master' };
      if (index.collisionNames.has(masterName.trim())) return { kind: 'skip', reason: 'ambiguous-same-name' };
      return { kind: 'link-rename', masterId: stripped[0], before, newCustomerName: masterName };
    }
  }
  return { kind: 'skip', reason: 'no-master' };
}

// ---------------------------------------------------------------- manifest

export interface CustomerIdLinkManifestEntry {
  docId: string;
  /** 紐づけの種類(第1段の旧manifestには無い)。名前は含めない。 */
  kind?: LinkKind;
  customerIdBefore: CustomerIdBefore;
  customerIdAfter: string;
  /** 書込み結果の`writeTime`(rollbackで「backfill後に誰も書いていない」ことを確認する)。 */
  backfillUpdateTime: { seconds: number; nanoseconds: number };
}

export interface CustomerIdLinkPlannedEntry {
  docId: string;
  kind?: LinkKind;
  masterId: string;
  customerIdBefore: CustomerIdBefore;
}

export interface CustomerIdLinkManifest {
  schemaVersion: typeof CUSTOMER_ID_LINK_MANIFEST_SCHEMA_VERSION;
  runId: string;
  projectId: string;
  timestamp: string;
  dryRun: boolean;
  /** 実行が途中で止まった(または完走前に書き出された)場合はtrue。完走時にfalseで書き直す。 */
  aborted: boolean;
  /** 紐づけ予定の一覧(dry-runでも出力。承認者が「どの書類をどのマスターへ」を事前に確認できる)。 */
  planned: CustomerIdLinkPlannedEntry[];
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
  if (v.state === 'absent' || v.state === 'null' || v.state === 'empty') return hasOnlyKeys(v, ['state']);
  if (v.state === 'dangling') return hasOnlyKeys(v, ['state', 'id']) && isNonEmptyStr(v.id);
  return false;
}

function isValidEntry(v: unknown): v is CustomerIdLinkManifestEntry {
  if (!isObj(v) || !hasOnlyKeys(v, ['docId', 'kind', 'customerIdBefore', 'customerIdAfter', 'backfillUpdateTime'])) return false;
  const t = v.backfillUpdateTime;
  return (
    isValidKind(v.kind) &&
    isValidDocId(v.docId) &&
    isValidBefore(v.customerIdBefore) &&
    isNonEmptyStr(v.customerIdAfter) &&
    isObj(t) &&
    hasOnlyKeys(t, ['seconds', 'nanoseconds']) &&
    isCount(t.seconds) &&
    isCount(t.nanoseconds)
  );
}

const isValidKind = (v: unknown): boolean => v === undefined || v === 'link' || v === 'link-rename';

function isValidPlanned(v: unknown): v is CustomerIdLinkPlannedEntry {
  return (
    isObj(v) &&
    hasOnlyKeys(v, ['docId', 'kind', 'masterId', 'customerIdBefore']) &&
    isValidKind(v.kind) &&
    isValidDocId(v.docId) &&
    isNonEmptyStr(v.masterId) &&
    isValidBefore(v.customerIdBefore)
  );
}

export function isValidCustomerIdLinkManifest(v: unknown): v is CustomerIdLinkManifest {
  if (!isObj(v)) return false;
  if (!hasOnlyKeys(v, ['schemaVersion', 'runId', 'projectId', 'timestamp', 'dryRun', 'aborted', 'planned', 'entries', 'skipped', 'totalScanned', 'scanIncomplete'])) return false;
  if (v.schemaVersion !== CUSTOMER_ID_LINK_MANIFEST_SCHEMA_VERSION) return false;
  if (!isNonEmptyStr(v.runId) || !isNonEmptyStr(v.projectId) || !isNonEmptyStr(v.timestamp)) return false;
  if (typeof v.dryRun !== 'boolean' || typeof v.aborted !== 'boolean' || typeof v.scanIncomplete !== 'boolean' || !isCount(v.totalScanned)) return false;
  if (!Array.isArray(v.planned) || !v.planned.every(isValidPlanned)) return false;
  if (!Array.isArray(v.entries) || !v.entries.every(isValidEntry)) return false;
  const docIds = (v.entries as CustomerIdLinkManifestEntry[]).map((e) => e.docId);
  if (new Set(docIds).size !== docIds.length) return false;
  const s = v.skipped;
  if (!isObj(s) || !hasOnlyKeys(s, SKIP_REASONS)) return false;
  return SKIP_REASONS.every((r) => Array.isArray(s[r]) && (s[r] as unknown[]).every(isValidDocId));
}

/**
 * 走査後にマスターが変化していないか確認する。再読込したマスター索引で各対象を分類し直し、
 * 「同じマスターへ紐づける」判定でなくなったもの(マスターの削除・改名・同名追加など)を返す。
 * 1件でもあれば、呼び出し側は書込みを一切行わず中断する。
 */
export function findDriftedTargets<T extends { masterId: string; kind?: LinkKind; newCustomerName?: string; data: LinkCandidateDoc }>(
  targets: readonly T[],
  freshIndex: MasterIndex,
  opts: ClassifyOptions = {}
): T[] {
  return targets.filter((t) => {
    const r = classifyCustomerIdLink(t.data, freshIndex, opts);
    if (r.kind !== 'link' && r.kind !== 'link-rename') return true;
    // 分類の種類・マスターID・揃える名前のすべてが、走査時と同じであること
    return !(r.kind === (t.kind ?? 'link') && r.masterId === t.masterId && (r.kind === 'link' || r.newCustomerName === t.newCustomerName));
  });
}

// ---------------------------------------------------------------- 書込み(I/Oは呼び出し側が注入)

export interface LinkWriteTarget {
  id: string;
  kind?: LinkKind;
  masterId: string;
  before: CustomerIdBefore;
  /** `link-rename`のときに書く顧客名(マスターの生のname)。manifestには入れない。 */
  newCustomerName?: string;
}

export interface ExecuteLinksResult {
  written: number;
  /** 読取後に別の書込みがあった(precondition不一致、code 9)ためスキップした件数。 */
  skippedPrecondition: number;
  /** 書込み時点で書類が削除済み(code 5)だったためスキップした件数。 */
  skippedNotFound: number;
}

export interface ExecuteLinksHooks {
  /** entriesへ1件追加した直後に呼ぶ(manifestの逐次保存用。プロセスが強制終了しても記録が残るようにする)。 */
  onEntry?: (entry: CustomerIdLinkManifestEntry) => void;
  onSkip?: (docId: string, reason: 'precondition' | 'not-found') => void;
}

/**
 * 紐づけを1件ずつ書く。`write`は書込み結果の`writeTime`を返す(読取後に別の更新があれば
 * Firestoreのprecondition不一致=code 9を投げる)。code 9はその書類だけスキップして続行し、
 * それ以外のエラーは再throwする。書込み済みの記録は呼び出し側が渡す`entries`へ1件ずつ追加するため、
 * 途中で例外停止しても、それまでの記録(rollbackの入力)は`entries`に残る。
 */
export async function executeLinks(
  targets: readonly LinkWriteTarget[],
  write: (target: LinkWriteTarget) => Promise<{ seconds: number; nanoseconds: number }>,
  entries: CustomerIdLinkManifestEntry[],
  hooks: ExecuteLinksHooks = {}
): Promise<ExecuteLinksResult> {
  let written = 0;
  let skippedPrecondition = 0;
  let skippedNotFound = 0;
  for (const t of targets) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const writeTime = await write(t);
      const entry: CustomerIdLinkManifestEntry = { docId: t.id, kind: t.kind ?? 'link', customerIdBefore: t.before, customerIdAfter: t.masterId, backfillUpdateTime: writeTime };
      entries.push(entry);
      written++;
      hooks.onEntry?.(entry);
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 9) {
        skippedPrecondition++;
        hooks.onSkip?.(t.id, 'precondition');
        continue;
      }
      if (code === 5) {
        skippedNotFound++;
        hooks.onSkip?.(t.id, 'not-found');
        continue;
      }
      throw err;
    }
  }
  return { written, skippedPrecondition, skippedNotFound };
}

// ---------------------------------------------------------------- rollback

export function isRollbackEligibleByUpdateTime(
  entry: CustomerIdLinkManifestEntry,
  liveUpdateTime: { seconds: number; nanoseconds: number }
): boolean {
  return liveUpdateTime.seconds === entry.backfillUpdateTime.seconds && liveUpdateTime.nanoseconds === entry.backfillUpdateTime.nanoseconds;
}

export type RollbackInstruction = { action: 'delete' } | { action: 'set'; value: string | null };

export function computeCustomerIdRollbackInstruction(entry: CustomerIdLinkManifestEntry): RollbackInstruction {
  switch (entry.customerIdBefore.state) {
    case 'absent':
      return { action: 'delete' };
    case 'null':
      return { action: 'set', value: null };
    case 'empty':
      return { action: 'set', value: '' };
    case 'dangling':
      return { action: 'set', value: entry.customerIdBefore.id };
  }
}
