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

import type { Timestamp } from 'firebase/firestore';
import type { DocumentMaster } from '@shared/types';
import type { DocumentGroup } from '@/hooks/useDocumentGroups';
import { normalizeGroupKey } from './normalizeGroupKey';

export const UNCATEGORIZED_LABEL = '未分類';

export interface CategoryHierarchy {
  readonly categoryName: string;
  readonly groups: readonly DocumentGroup[];
}

export interface CategorySummary {
  totalDocs: number;
  latestAt: Timestamp | undefined;
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
 * カテゴリ内グループの総件数 + 最新更新日時を集計する純関数。
 * CategoryItem ヘッダーのバッジ・最終更新日表示で使用する。
 */
export function summarizeCategoryGroups(
  groups: readonly DocumentGroup[],
): CategorySummary {
  let totalDocs = 0;
  let latestAt: Timestamp | undefined;
  for (const group of groups) {
    totalDocs += group.count;
    if (group.latestAt && (!latestAt || group.latestAt.toMillis() > latestAt.toMillis())) {
      latestAt = group.latestAt;
    }
  }
  return { totalDocs, latestAt };
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
