/**
 * filterGroupsByName / normalizeForNameFilter 単体テスト
 *
 * グループビュー（事業所別・書類種別・担当CM別）でグループ名をフリーテキストで
 * 絞り込む機能（#⑤要望対応）。全角/半角・大文字小文字の差異を吸収する。
 */

import { describe, it, expect } from 'vitest';
import { filterGroupsByName, normalizeForNameFilter } from '../filterGroupsByName';
import type { DocumentGroup } from '@/hooks/useDocumentGroups';
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
});
