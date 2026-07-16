/**
 * 生 Document[] のカテゴリ集約ロジック（担当CM別タブ 第3階層用）
 *
 * 書類種別タブの buildDocumentTypeCategoryGroups は DocumentGroup[]（集計済み）を
 * 入力とするため、担当CM別タブの生 Document[] コンテキストではそのまま使えない
 * (#527 で確認済み)。本モジュールは同一のカテゴリ解決規則
 * (buildMasterCategoryMap / 未分類フォールバック / あいうえお順・未分類末尾) を
 * Document[] 入力に適用する薄いアダプタ。
 *
 * - doc.documentTypeKey（BE 正規化済み）を優先し、欠損時は
 *   normalizeGroupKey(documentType) でフォールバック解決
 * - category 未設定 / master 不在 → 「未分類」
 * - カテゴリ内の書類順は入力順を保持（呼び出し側のソートを尊重）
 */

import type { Document } from '@shared/types';
import type { DocumentMaster } from '@shared/types';
import {
  buildMasterCategoryMap,
  UNCATEGORIZED_LABEL,
} from './buildDocumentTypeCategoryGroups';
import { normalizeGroupKey } from './normalizeGroupKey';

export interface CategoryDocGroup {
  readonly categoryName: string;
  readonly documents: readonly Document[];
}

export function groupDocumentsByCategory(
  documents: readonly Document[],
  masters: readonly DocumentMaster[] | undefined,
): CategoryDocGroup[] {
  const keyToCategory = buildMasterCategoryMap(masters);

  const categoryMap = new Map<string, Document[]>();
  for (const doc of documents) {
    const key = doc.documentTypeKey || normalizeGroupKey(doc.documentType || '');
    const categoryName = (key && keyToCategory.get(key)) || UNCATEGORIZED_LABEL;
    const list = categoryMap.get(categoryName);
    if (list) {
      list.push(doc);
    } else {
      categoryMap.set(categoryName, [doc]);
    }
  }

  return [...categoryMap.entries()]
    .sort(([a], [b]) => compareCategoryName(a, b))
    .map(([categoryName, docs]) => ({ categoryName, documents: docs }));
}

/**
 * 集約結果が「未分類」1 つだけかを判定する。
 * カテゴリ未運用環境で従来の書類種別フォルダ表示にフォールバックするために使用
 * (書類種別タブの isAllUncategorized と同一規則)。
 *
 * 注: 空配列は false を返す（呼び出し側の `length > 0` ガードと併用前提）。
 */
export function isAllUncategorizedDocs(
  groups: readonly CategoryDocGroup[],
): boolean {
  return groups.length === 1 && groups[0]?.categoryName === UNCATEGORIZED_LABEL;
}

function compareCategoryName(a: string, b: string): number {
  if (a === UNCATEGORIZED_LABEL) return 1;
  if (b === UNCATEGORIZED_LABEL) return -1;
  return a.localeCompare(b, 'ja');
}
