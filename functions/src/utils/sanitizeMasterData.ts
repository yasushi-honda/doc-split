/**
 * マスターデータ正規化ユーティリティ
 *
 * Firestoreから読み込んだマスターデータの型崩れを防ぐ。
 * 背景: INVALID_ARGUMENT: Property array contains an invalid nested entity
 *       マスターデータに配列やオブジェクトが混入していると、
 *       candidates配列経由でFirestore書き込み時にエラーとなる。
 *
 * #344: silent drop を observable にするため、戻り値に droppedIds を含める。
 *       caller 側 (loadMasterData) が drop 件数に応じて safeLogError を発火する契約。
 * #503: drop 理由 (型崩れ vs 空文字) を区別できるよう droppedEntries を追加。
 *       droppedIds は droppedEntries から導出される後方互換フィールド (既存 caller 無改修)。
 */

import type { CustomerMaster, OfficeMaster, DocumentMaster } from './extractors';

/** name が非文字列 (invalid-type) か空文字 (empty-name) かの drop 理由 */
export type DropReason = 'invalid-type' | 'empty-name';

/** drop されたレコードの id と理由 */
export interface SanitizeDropEntry {
  id: string;
  reason: DropReason;
}

/** サニタイズ結果 envelope (items + drop された id 一覧 + drop 理由付き明細) */
export interface SanitizeResult<T> {
  items: T[];
  droppedIds: string[];
  droppedEntries: SanitizeDropEntry[];
}

/** 値が文字列であればそのまま、配列なら先頭要素、それ以外はundefined */
function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** 空文字もundefinedとして扱う。dateMarkerのように「空=指定なし」と解釈したい用途専用 */
function toOptionalNonEmptyString(value: unknown): string | undefined {
  const s = toOptionalString(value);
  return s === '' ? undefined : s;
}

/** 値がbooleanであればそのまま、それ以外はundefined */
function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

/** 値がstring[]であれば正規化、文字列なら配列化、それ以外はundefined */
function toOptionalStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return undefined;
}

/** id 欠落レコードでも drop trace に含めるための plug (id が string でない場合 '(unknown)' を採用) */
function safeId(raw: { id?: unknown }): string {
  return typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : '(unknown)';
}

/** name の drop 理由を判定する (空文字は empty-name、それ以外の非文字列は invalid-type) */
function dropReasonForName(name: unknown): DropReason {
  return name === '' ? 'empty-name' : 'invalid-type';
}

export function sanitizeCustomerMasters(
  raw: CustomerMaster[]
): SanitizeResult<CustomerMaster> {
  const items: CustomerMaster[] = [];
  const droppedEntries: SanitizeDropEntry[] = [];
  for (const c of raw) {
    if (typeof c.name === 'string' && c.name.length > 0) {
      items.push({
        id: c.id,
        name: c.name,
        furigana: toOptionalString(c.furigana),
        isDuplicate: toOptionalBoolean(c.isDuplicate),
        careManagerName: toOptionalString(c.careManagerName),
        aliases: toOptionalStringArray(c.aliases),
      });
    } else {
      droppedEntries.push({ id: safeId(c), reason: dropReasonForName(c.name) });
    }
  }
  return { items, droppedIds: droppedEntries.map((e) => e.id), droppedEntries };
}

export function sanitizeOfficeMasters(
  raw: OfficeMaster[]
): SanitizeResult<OfficeMaster> {
  const items: OfficeMaster[] = [];
  const droppedEntries: SanitizeDropEntry[] = [];
  for (const o of raw) {
    if (typeof o.name === 'string' && o.name.length > 0) {
      items.push({
        id: o.id,
        name: o.name,
        shortName: toOptionalString(o.shortName),
        isDuplicate: toOptionalBoolean(o.isDuplicate),
        aliases: toOptionalStringArray(o.aliases),
      });
    } else {
      droppedEntries.push({ id: safeId(o), reason: dropReasonForName(o.name) });
    }
  }
  return { items, droppedIds: droppedEntries.map((e) => e.id), droppedEntries };
}

export function sanitizeDocumentMasters(
  raw: DocumentMaster[]
): SanitizeResult<DocumentMaster> {
  const items: DocumentMaster[] = [];
  const droppedEntries: SanitizeDropEntry[] = [];
  for (const d of raw) {
    if (typeof d.name === 'string' && d.name.length > 0) {
      items.push({
        id: d.id,
        name: d.name,
        category: toOptionalString(d.category),
        keywords: toOptionalStringArray(d.keywords),
        aliases: toOptionalStringArray(d.aliases),
        dateMarker: toOptionalNonEmptyString(d.dateMarker),
      });
    } else {
      droppedEntries.push({ id: safeId(d), reason: dropReasonForName(d.name) });
    }
  }
  return { items, droppedIds: droppedEntries.map((e) => e.id), droppedEntries };
}
