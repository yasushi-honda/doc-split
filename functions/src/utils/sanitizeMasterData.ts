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
 *
 * #501: 短文字列の office マスター ("ケア" / "ニック" 等、CSV import 由来の汚染) は
 *       classifier の substring match で score 100 を取って正規マスターを駆逐する。
 *       sanitize 段で `office.name.length >= DEFAULT_MIN_OFFICE_NAME_LENGTH` ガードで drop する。
 */

import type { CustomerMaster, OfficeMaster, DocumentMaster } from './extractors';

/**
 * 事業所マスター name の最小許容長 (sanitize 段で drop する閾値)。
 *
 * #501: kanameone 本番マスターに「ケア」(2) / 「ニック」(3) が混入し、
 *       classifier の `matchingText.includes(normalizedOfficeName)` が任意文書で
 *       score 100 を取り 675 件の document が誤分類された経緯から導入。
 *       通常の事業所名は 4 文字以上 (例: 「○○ケア」「○○クリニック」のような屋号付き形式)。
 *       それ以下の正規マスターがあれば droppedIds + safeLogError で観測可能。
 */
export const DEFAULT_MIN_OFFICE_NAME_LENGTH = 4;

/** サニタイズ結果 envelope (items + drop された id 一覧) */
export interface SanitizeResult<T> {
  items: T[];
  droppedIds: string[];
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

export function sanitizeCustomerMasters(
  raw: CustomerMaster[]
): SanitizeResult<CustomerMaster> {
  const items: CustomerMaster[] = [];
  const droppedIds: string[] = [];
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
      droppedIds.push(safeId(c));
    }
  }
  return { items, droppedIds };
}

export function sanitizeOfficeMasters(
  raw: OfficeMaster[],
  options: { minNameLength?: number } = {},
): SanitizeResult<OfficeMaster> {
  const minNameLength = options.minNameLength ?? DEFAULT_MIN_OFFICE_NAME_LENGTH;
  const items: OfficeMaster[] = [];
  const droppedIds: string[] = [];
  for (const o of raw) {
    if (typeof o.name === 'string' && o.name.length >= minNameLength) {
      items.push({
        id: o.id,
        name: o.name,
        shortName: toOptionalString(o.shortName),
        isDuplicate: toOptionalBoolean(o.isDuplicate),
        aliases: toOptionalStringArray(o.aliases),
      });
    } else {
      droppedIds.push(safeId(o));
    }
  }
  return { items, droppedIds };
}

export function sanitizeDocumentMasters(
  raw: DocumentMaster[]
): SanitizeResult<DocumentMaster> {
  const items: DocumentMaster[] = [];
  const droppedIds: string[] = [];
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
      droppedIds.push(safeId(d));
    }
  }
  return { items, droppedIds };
}
