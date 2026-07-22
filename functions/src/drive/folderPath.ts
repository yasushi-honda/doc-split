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

/**
 * careManagerセグメント解決時、`careManagerName`が空文字/空白のみの場合にthrow。
 * `FuriganaMissingError`と同じくfail-visible優先（空白のみのフォルダ名を黙って
 * 生成しない）。呼び出し元（トリガー）はこれを捕捉し `driveExportStatus: 'error'` に遷移させる。
 */
export class CareManagerMissingError extends Error {
  constructor() {
    super('ケアマネージャー名が未設定のためフォルダ名を解決できません');
    this.name = 'CareManagerMissingError';
  }
}

/**
 * documentCategoryセグメント解決時、値が空文字/空白のみの場合にthrow。
 * customerセグメントの`FuriganaMissingError`と非対称だった保護を揃える。
 */
export class DocumentCategoryMissingError extends Error {
  constructor() {
    super('書類カテゴリが未設定のためフォルダ名を解決できません');
    this.name = 'DocumentCategoryMissingError';
  }
}

/**
 * customerセグメント解決時、`customerName`が空文字/空白のみの場合にthrow
 * (code-review xhigh指摘#6対応)。`CareManagerMissingError`/`DocumentCategoryMissingError`
 * と対をなす、fail-visible優先のガード。
 */
export class CustomerNameMissingError extends Error {
  constructor() {
    super('利用者名が未設定のためフォルダ名を解決できません');
    this.name = 'CustomerNameMissingError';
  }
}

/**
 * dateセグメント解決時（`onlyForCategories`該当時のみ）、`fileDate`が未設定(null)の
 * 場合にthrow。UIから書類日付をクリア保存する経路が実在するため、`.getFullYear()`等の
 * 呼び出しで無防備にクラッシュさせず、fail-visibleに倒す。
 */
export class FileDateMissingError extends Error {
  constructor() {
    super('書類日付が未設定のため年月フォルダ名を解決できません');
    this.name = 'FileDateMissingError';
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
  /** `Document.fileDate`。UIから書類日付をクリア保存する経路が実在するためnull許容。 */
  fileDate: Date | null;
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
  // trim済みの値を以降すべてで使う(code-review xhigh指摘#5対応、2026-07-22): 元は
  // untrimmedの careManagerName でガード判定した後もuntrimmedのまま使っていたため、
  // 先頭/末尾に空白のみを含む値(例:" 田中")がガードを通過しつつ空白始まりの
  // 壊れたフォルダ名を生成していた。
  const careManagerName = doc.careManagerName.trim();
  if (!careManagerName) {
    throw new CareManagerMissingError();
  }
  if (segment.format === 'nameOnly') {
    return careManagerName;
  }
  const initial = careManagerName.charAt(0);
  return joinInitialAndName(initial, careManagerName, segment.separator ?? DRIVE_SEGMENT_SEPARATOR_DEFAULT.careManager);
}

function resolveCustomerSegment(
  doc: FolderPathDocInput,
  segment: Extract<DriveFolderSegment, { type: 'customer' }>,
  opts: FolderPathOptions
): string {
  // customerName自体の空/空白チェック(code-review xhigh指摘#6対応、2026-07-22):
  // 元はfuriganaのみガードしておりcustomerNameが空文字/空白のみでも素通りしていた
  // (careManager/documentCategoryの同種ガードと非対称だった)。
  const customerName = doc.customerName.trim();
  if (!customerName) {
    throw new CustomerNameMissingError();
  }

  if (segment.format === 'nameOnly') {
    return customerName;
  }

  const furigana = doc.customerFurigana?.trim();
  let initial: string;
  if (furigana) {
    initial = furigana.charAt(0);
  } else if ((opts.furiganaFallback ?? 'stop') === 'useNameInitial') {
    initial = customerName.charAt(0);
  } else {
    throw new FuriganaMissingError(customerName);
  }

  return joinInitialAndName(initial, customerName, segment.separator ?? DRIVE_SEGMENT_SEPARATOR_DEFAULT.customer);
}

function resolveDateSegment(
  doc: FolderPathDocInput,
  segment: Extract<DriveFolderSegment, { type: 'date' }>
): string | null {
  if (!segment.onlyForCategories.includes(doc.documentCategory)) {
    return null;
  }
  if (doc.fileDate === null) {
    throw new FileDateMissingError();
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
        if (!doc.documentCategory.trim()) {
          throw new DocumentCategoryMissingError();
        }
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
