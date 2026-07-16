/**
 * 担当CM別タブ 第3階層のフォルダ集約ロジック
 *
 * 生 Document[] をフォルダ単位に集約する純粋関数。フォルダの単位は
 * 書類種別のカテゴリ（master.category、kaname要望 2026-07-16）。
 *
 * - doc.documentTypeKey（BE 正規化済み）を優先し、欠損時は
 *   normalizeGroupKey(documentType) でフォールバック解決
 * - カテゴリ解決できない書類（master 不在 / category 未設定）は
 *   書類種別名のフォルダのまま残す。これにより:
 *   - カテゴリ未運用環境では従来の書類種別フォルダ表示と完全一致
 *   - カテゴリ移行途中の環境でも異なる書類種別が単一「未分類」に
 *     混載されず、種別単位の区別が保たれる（書類種別タブが未分類
 *     カテゴリ内でも種別サブグループを保つのと同じ粒度保証）
 * - 並びはあいうえお順、「未判定」（種別未確定 doc）のみ末尾
 * - フォルダ内の書類順は入力順を保持（呼び出し側のソートを尊重）
 *
 * 書類種別タブの buildDocumentTypeCategoryGroups は DocumentGroup[]
 * （集計済み）入力のためここでは使えず(#527)、カテゴリ解決規則
 * (buildMasterCategoryMap) のみを共有する。
 */

import type { Document, DocumentMaster } from '@shared/types';
import { buildMasterCategoryMap } from './buildDocumentTypeCategoryGroups';
import { normalizeGroupKey } from './normalizeGroupKey';

export interface FolderGroup {
  readonly label: string;
  readonly documents: readonly Document[];
}

/** 書類種別が未確定の doc のフォルダラベル（常に末尾） */
export const UNKNOWN_DOC_TYPE_LABEL = '未判定';

export function buildCustomerFolderGroups(
  documents: readonly Document[],
  masters: readonly DocumentMaster[] | undefined,
): FolderGroup[] {
  const keyToCategory = buildMasterCategoryMap(masters);

  const folderMap = new Map<string, Document[]>();
  for (const doc of documents) {
    const key = doc.documentTypeKey || normalizeGroupKey(doc.documentType || '');
    const label =
      (key && keyToCategory.get(key)) || doc.documentType || UNKNOWN_DOC_TYPE_LABEL;
    const list = folderMap.get(label);
    if (list) {
      list.push(doc);
    } else {
      folderMap.set(label, [doc]);
    }
  }

  return [...folderMap.entries()]
    .sort(([a], [b]) => compareFolderLabel(a, b))
    .map(([label, docs]) => ({ label, documents: docs }));
}

function compareFolderLabel(a: string, b: string): number {
  if (a === UNKNOWN_DOC_TYPE_LABEL) return 1;
  if (b === UNKNOWN_DOC_TYPE_LABEL) return -1;
  return a.localeCompare(b, 'ja');
}
