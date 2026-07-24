/**
 * filterGroupsByName / normalizeForNameFilter 単体テスト
 *
 * グループビュー（事業所別・書類種別・担当CM別）でグループ名をフリーテキストで
 * 絞り込む機能（#⑤要望対応）。全角/半角・大文字小文字の差異を吸収する。
 */

import { describe, it, expect } from 'vitest';
import { filterGroupsByName, filterCategoryHierarchyByName, normalizeForNameFilter } from '../filterGroupsByName';
import type { DocumentGroup } from '@/hooks/useDocumentGroups';
import type { CategoryHierarchy } from '../buildDocumentTypeCategoryGroups';
import { Timestamp } from 'firebase/firestore';

function makeGroup(displayName: string): DocumentGroup {
  return {
    id: displayName,
    groupType: 'office',
    groupKey: displayName,
    displayName,
    count: 1,
    latestAt: Timestamp.now(),
    latestDocs: [],
    updatedAt: Timestamp.now(),
  };
}

describe('normalizeForNameFilter', () => {
  it('全角英数字を半角に正規化する', () => {
    expect(normalizeForNameFilter('ＤＡＣＨＯ')).toBe('dacho');
  });

  it('大文字小文字を区別しない', () => {
    expect(normalizeForNameFilter('Helper')).toBe('helper');
  });

  it('旧字体(外字)を新字体に正規化する', () => {
    expect(normalizeForNameFilter('髙橋')).toBe('高橋');
  });

  it('undefined/nullを渡してもクラッシュせず空文字を返す', () => {
    expect(normalizeForNameFilter(undefined as unknown as string)).toBe('');
    expect(normalizeForNameFilter(null as unknown as string)).toBe('');
  });
});

describe('filterGroupsByName', () => {
  const groups = [
    makeGroup('ヘルパーステーションダチョウ'),
    makeGroup('テスト第一事業所'),
    makeGroup('テスト事業所'),
  ];

  it('部分一致するグループのみ返す', () => {
    const result = filterGroupsByName(groups, 'ダチョウ');
    expect(result.map((g) => g.displayName)).toEqual(['ヘルパーステーションダチョウ']);
  });

  it('空文字の場合は全件返す（絞り込み未適用）', () => {
    expect(filterGroupsByName(groups, '')).toHaveLength(3);
  });

  it('前後の空白は無視される', () => {
    const result = filterGroupsByName(groups, '  ダチョウ  ');
    expect(result).toHaveLength(1);
  });

  it('一致しない場合は空配列を返す', () => {
    expect(filterGroupsByName(groups, '存在しない事業所')).toEqual([]);
  });

  it('displayNameがundefinedのグループが混在していてもクラッシュしない（異常系）', () => {
    const withMissingName = [...groups, makeGroup(undefined as unknown as string)];
    expect(() => filterGroupsByName(withMissingName, 'ダチョウ')).not.toThrow();
    const result = filterGroupsByName(withMissingName, 'ダチョウ');
    expect(result.map((g) => g.displayName)).toEqual(['ヘルパーステーションダチョウ']);
  });
});

describe('filterCategoryHierarchyByName', () => {
  const hierarchy: CategoryHierarchy[] = [
    {
      categoryName: '報告書',
      groups: [makeGroup('FAX送り状'), makeGroup('FAX送信確認')],
    },
    {
      categoryName: 'アセスメント',
      groups: [makeGroup('アセスメントシート')],
    },
  ];

  it('カテゴリ内のグループを絞り込み、一致するグループがないカテゴリは除外する', () => {
    const result = filterCategoryHierarchyByName(hierarchy, 'FAX送り状');
    expect(result).toHaveLength(1);
    expect(result.at(0)?.categoryName).toBe('報告書');
    expect(result.at(0)?.groups.map((g) => g.displayName)).toEqual(['FAX送り状']);
  });

  it('カテゴリをまたいで一致する場合は両カテゴリとも残る', () => {
    const result = filterCategoryHierarchyByName(hierarchy, 'FAX');
    expect(result).toHaveLength(1);
    expect(result.at(0)?.groups).toHaveLength(2);
  });

  it('空文字の場合は元の階層をそのまま返す', () => {
    const result = filterCategoryHierarchyByName(hierarchy, '');
    expect(result).toEqual(hierarchy);
  });

  it('一致しない場合は空配列を返す（全カテゴリが除外される）', () => {
    expect(filterCategoryHierarchyByName(hierarchy, '存在しない書類種別')).toEqual([]);
  });
});
