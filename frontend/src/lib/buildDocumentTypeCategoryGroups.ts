/**
 * 書類種別グループのカテゴリ階層化ロジック
 *
 * useDocumentGroups で取得した書類種別グループを、
 * 書類マスター (DocumentMaster) の category フィールドで階層化する純粋関数。
 *
 * - master.name → normalizeGroupKey でキー化し、group.groupKey と照合
 * - category 未設定 / master 不在 → 「未分類」フォールバック
 * - カテゴリ名: あいうえお順、「未分類」は末尾
 * - 同一カテゴリ内の書類種別: displayName のあいうえお順
 */

import type { DocumentMaster } from '@shared/types';
import type { DocumentGroup } from '@/hooks/useDocumentGroups';
import { normalizeGroupKey } from './normalizeGroupKey';

export const UNCATEGORIZED_LABEL = '未分類';

export interface CategoryHierarchy {
  categoryName: string;
  groups: DocumentGroup[];
}

export function buildDocumentTypeCategoryGroups(
  groups: readonly DocumentGroup[],
  masters: readonly DocumentMaster[] | undefined,
): CategoryHierarchy[] {
  const keyToCategory = buildMasterCategoryMap(masters);

  const categoryMap = new Map<string, DocumentGroup[]>();
  for (const group of groups) {
    const categoryName = resolveCategoryName(group.groupKey, keyToCategory);
    const list = categoryMap.get(categoryName);
    if (list) {
      list.push(group);
    } else {
      categoryMap.set(categoryName, [group]);
    }
  }

  for (const list of categoryMap.values()) {
    list.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
  }

  return [...categoryMap.entries()]
    .sort(([a], [b]) => compareCategoryName(a, b))
    .map(([categoryName, groupList]) => ({
      categoryName,
      groups: groupList,
    }));
}

/**
 * 階層化結果が「未分類」1 つだけかを判定する。
 * カテゴリ未運用環境で階層を省略して従来表示にフォールバックするために使用。
 *
 * 注: 空配列は false を返す（呼び出し側の `length > 0` ガードと併用前提）。
 */
export function isAllUncategorized(hierarchy: readonly CategoryHierarchy[]): boolean {
  return hierarchy.length === 1 && hierarchy[0]?.categoryName === UNCATEGORIZED_LABEL;
}

function buildMasterCategoryMap(
  masters: readonly DocumentMaster[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!masters) return map;
  for (const master of masters) {
    const key = normalizeGroupKey(master.name);
    if (!key) continue;
    const category = master.category?.trim();
    if (!category) continue;
    map.set(key, category);
  }
  return map;
}

function resolveCategoryName(
  groupKey: string,
  keyToCategory: Map<string, string>,
): string {
  return keyToCategory.get(groupKey) ?? UNCATEGORIZED_LABEL;
}

function compareCategoryName(a: string, b: string): number {
  if (a === UNCATEGORIZED_LABEL) return 1;
  if (b === UNCATEGORIZED_LABEL) return -1;
  return a.localeCompare(b, 'ja');
}
