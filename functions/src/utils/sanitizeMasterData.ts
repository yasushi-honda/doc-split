/**
 * マスターデータ正規化ユーティリティ
 *
 * Firestoreから読み込んだマスターデータの型崩れを防ぐ。
 * 背景: INVALID_ARGUMENT: Property array contains an invalid nested entity
 *       マスターデータに配列やオブジェクトが混入していると、
 *       candidates配列経由でFirestore書き込み時にエラーとなる。
 */

import type { CustomerMaster, OfficeMaster, DocumentMaster } from './extractors';

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

export function sanitizeCustomerMasters(
  raw: CustomerMaster[]
): CustomerMaster[] {
  return raw
    .filter((c) => typeof c.name === 'string' && c.name.length > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      furigana: toOptionalString(c.furigana),
      isDuplicate: toOptionalBoolean(c.isDuplicate),
      careManagerName: toOptionalString(c.careManagerName),
      aliases: toOptionalStringArray(c.aliases),
    }));
}

export function sanitizeOfficeMasters(
  raw: OfficeMaster[]
): OfficeMaster[] {
  return raw
    .filter((o) => typeof o.name === 'string' && o.name.length > 0)
    .map((o) => ({
      id: o.id,
      name: o.name,
      shortName: toOptionalString(o.shortName),
      isDuplicate: toOptionalBoolean(o.isDuplicate),
      aliases: toOptionalStringArray(o.aliases),
    }));
}

export function sanitizeDocumentMasters(
  raw: DocumentMaster[]
): DocumentMaster[] {
  return raw
    .filter((d) => typeof d.name === 'string' && d.name.length > 0)
    .map((d) => ({
      id: d.id,
      name: d.name,
      category: toOptionalString(d.category),
      keywords: toOptionalStringArray(d.keywords),
      aliases: toOptionalStringArray(d.aliases),
      dateMarker: toOptionalNonEmptyString(d.dateMarker),
    }));
}
