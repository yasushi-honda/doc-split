/**
 * Google Drive フォルダ階層パス解決(ADR-0022)
 *
 * `DriveFolderTemplate`（セグメント配列）と1件のdocument相当の入力から、
 * find-or-createで辿るフォルダ名の配列を導出する純粋関数。Firestore/Drive APIへの
 * アクセスは行わない(呼び出し元がCustomerMaster等の結合済みデータを渡す)。
 */

import { DriveFolderSegment, DriveFolderTemplate, DRIVE_SEGMENT_SEPARATOR_DEFAULT } from '../../../shared/types';

/**
 * フリガナ欠損時のフォールバック挙動(`DriveSettings.furiganaFallback`)。
 * デフォルトは 'stop'（fail-visible）。
 */
export interface FolderPathOptions {
  furiganaFallback?: 'stop' | 'useNameInitial';
}

/**
 * `furiganaFallback: 'stop'`（デフォルト）で customer セグメントの
 * `furiganaInitialSpaceName` を解決しようとした際、フリガナが未設定/空文字の場合にthrow。
 * 呼び出し元（トリガー）はこれを捕捉し `driveExportStatus: 'error'` に遷移させる。
 */
export class FuriganaMissingError extends Error {
  constructor(customerName: string) {
    super(`フリガナが未設定のため利用者フォルダ名を解決できません: ${customerName}`);
    this.name = 'FuriganaMissingError';
  }
}

/** `resolveFolderSegments` への入力。表示名は呼び出し元が解決済みの値を渡す。 */
export interface FolderPathDocInput {
  careManagerName: string;
  customerName: string;
  /** `CustomerMaster.furigana`。欠損ケースあり(#338)。 */
  customerFurigana?: string;
  /** `Document.documentType`（書類カテゴリ、masters/documents/items参照）。 */
  documentCategory: string;
  fileDate: Date;
}

function joinInitialAndName(
  initial: string,
  name: string,
  separator: 'half' | 'full'
): string {
  const separatorChar = separator === 'full' ? '　' : ' ';
  return `${initial}${separatorChar}${name}`;
}

function resolveCareManagerSegment(
  doc: FolderPathDocInput,
  segment: Extract<DriveFolderSegment, { type: 'careManager' }>
): string {
  if (segment.format === 'nameOnly') {
    return doc.careManagerName;
  }
  const initial = doc.careManagerName.charAt(0);
  return joinInitialAndName(initial, doc.careManagerName, segment.separator ?? DRIVE_SEGMENT_SEPARATOR_DEFAULT.careManager);
}

function resolveCustomerSegment(
  doc: FolderPathDocInput,
  segment: Extract<DriveFolderSegment, { type: 'customer' }>,
  opts: FolderPathOptions
): string {
  if (segment.format === 'nameOnly') {
    return doc.customerName;
  }

  const furigana = doc.customerFurigana?.trim();
  let initial: string;
  if (furigana) {
    initial = furigana.charAt(0);
  } else if ((opts.furiganaFallback ?? 'stop') === 'useNameInitial') {
    initial = doc.customerName.charAt(0);
  } else {
    throw new FuriganaMissingError(doc.customerName);
  }

  return joinInitialAndName(initial, doc.customerName, segment.separator ?? DRIVE_SEGMENT_SEPARATOR_DEFAULT.customer);
}

function resolveDateSegment(
  doc: FolderPathDocInput,
  segment: Extract<DriveFolderSegment, { type: 'date' }>
): string | null {
  if (!segment.onlyForCategories.includes(doc.documentCategory)) {
    return null;
  }
  const year = doc.fileDate.getFullYear();
  const month = String(doc.fileDate.getMonth() + 1).padStart(2, '0');
  return `${year}年${month}月`;
}

/**
 * `DriveFolderTemplate` の各セグメントを解決し、find-or-createで辿るフォルダ名配列を返す。
 * `date` セグメントは `onlyForCategories` に非該当の場合、その階層自体を持たない
 * （配列から除外、空文字列にはしない）。
 */
export function resolveFolderSegments(
  doc: FolderPathDocInput,
  template: DriveFolderTemplate,
  opts: FolderPathOptions = {}
): string[] {
  const segments: string[] = [];

  for (const segment of template) {
    switch (segment.type) {
      case 'fixed':
        segments.push(segment.value);
        break;
      case 'careManager':
        segments.push(resolveCareManagerSegment(doc, segment));
        break;
      case 'customer':
        segments.push(resolveCustomerSegment(doc, segment, opts));
        break;
      case 'documentCategory':
        segments.push(doc.documentCategory);
        break;
      case 'date': {
        const resolved = resolveDateSegment(doc, segment);
        if (resolved !== null) segments.push(resolved);
        break;
      }
    }
  }

  return segments;
}
