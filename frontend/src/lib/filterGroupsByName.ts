/**
 * グループ名フリーテキスト絞り込み
 *
 * 事業所別・書類種別・担当CM別・顧客別ビューで、グループ名（displayName）を
 * フリーテキストで絞り込むための純粋関数。
 */

import type { DocumentGroup } from '@/hooks/useDocumentGroups';

/** 全角/半角・大文字小文字の差異を吸収して比較するための正規化 */
export function normalizeForNameFilter(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

export function filterGroupsByName(groups: DocumentGroup[], filterText: string): DocumentGroup[] {
  const normalized = normalizeForNameFilter(filterText.trim());
  if (!normalized) return groups;
  return groups.filter((g) => normalizeForNameFilter(g.displayName).includes(normalized));
}
