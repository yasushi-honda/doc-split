/**
 * グループ名フリーテキスト絞り込み
 *
 * 事業所別・書類種別・担当CM別・顧客別ビューで、グループ名（displayName）を
 * フリーテキストで絞り込むための純粋関数。
 */

import type { DocumentGroup } from '@/hooks/useDocumentGroups';
import { normalizeName } from '@/lib/textNormalizer';

/**
 * 全角/半角・大文字小文字・旧字体(外字)の差異を吸収して比較するための正規化。
 * normalizeName内部が `text || ''` で null/undefined を安全に空文字化するため、
 * displayName が欠損したドキュメントを渡してもクラッシュしない。
 */
export function normalizeForNameFilter(value: string): string {
  return normalizeName(value).toLowerCase();
}

export function filterGroupsByName(groups: DocumentGroup[], filterText: string): DocumentGroup[] {
  const normalized = normalizeForNameFilter(filterText.trim());
  if (!normalized) return groups;
  return groups.filter((g) => normalizeForNameFilter(g.displayName).includes(normalized));
}
