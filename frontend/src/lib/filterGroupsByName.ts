/**
 * グループ名フリーテキスト絞り込み
 *
 * 事業所別・書類種別・担当CM別・顧客別ビューで、グループ名（displayName）を
 * フリーテキストで絞り込むための純粋関数。
 */

import type { DocumentGroup } from '@/hooks/useDocumentGroups';
import type { CategoryHierarchy } from '@/lib/buildDocumentTypeCategoryGroups';
import { normalizeName } from '@/lib/textNormalizer';

/**
 * 全角/半角・大文字小文字・旧字体(外字)の差異を吸収して比較するための正規化。
 * normalizeName内部が `text || ''` で null/undefined を安全に空文字化するため、
 * displayName が欠損したドキュメントを渡してもクラッシュしない。
 */
export function normalizeForNameFilter(value: string): string {
  return normalizeName(value).toLowerCase();
}

export function filterGroupsByName(groups: readonly DocumentGroup[], filterText: string): DocumentGroup[] {
  const normalized = normalizeForNameFilter(filterText.trim());
  if (!normalized) return [...groups];
  return groups.filter((g) => normalizeForNameFilter(g.displayName).includes(normalized));
}

/**
 * カテゴリ階層表示（書類種別タブでカテゴリマスターが運用されているテナント）向けの
 * フリーテキスト絞り込み。各カテゴリ内のグループを絞り込み、一致するグループが
 * 0件になったカテゴリは結果から除外する。
 */
export function filterCategoryHierarchyByName(
  hierarchy: readonly CategoryHierarchy[],
  filterText: string,
): CategoryHierarchy[] {
  if (!filterText.trim()) return [...hierarchy];
  return hierarchy
    .map((category) => ({
      ...category,
      groups: filterGroupsByName(category.groups, filterText),
    }))
    .filter((category) => category.groups.length > 0);
}
