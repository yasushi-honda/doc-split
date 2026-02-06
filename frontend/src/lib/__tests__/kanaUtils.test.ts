/**
 * kanaUtils テスト
 * あかさたな分類・ふりがなソートのユーティリティ
 */

import { describe, it, expect } from 'vitest';
import {
  KANA_ROWS,
  getKanaRow,
  buildFuriganaMap,
  sortGroupsByFurigana,
  filterGroupsByKanaRow,
} from '../kanaUtils';
import type { CustomerMaster } from '@shared/types';

// ============================================
// getKanaRow
// ============================================

describe('getKanaRow', () => {
  it('ひらがな「あ」行を正しく分類', () => {
    expect(getKanaRow('あ')).toBe('あ');
    expect(getKanaRow('い')).toBe('あ');
    expect(getKanaRow('う')).toBe('あ');
    expect(getKanaRow('え')).toBe('あ');
    expect(getKanaRow('お')).toBe('あ');
  });

  it('ひらがな「か」行を正しく分類', () => {
    expect(getKanaRow('か')).toBe('か');
    expect(getKanaRow('き')).toBe('か');
    expect(getKanaRow('く')).toBe('か');
    expect(getKanaRow('け')).toBe('か');
    expect(getKanaRow('こ')).toBe('か');
  });

  it('ひらがな「さ」行を正しく分類', () => {
    expect(getKanaRow('さ')).toBe('さ');
    expect(getKanaRow('し')).toBe('さ');
    expect(getKanaRow('す')).toBe('さ');
    expect(getKanaRow('せ')).toBe('さ');
    expect(getKanaRow('そ')).toBe('さ');
  });

  it('ひらがな「た」行を正しく分類', () => {
    expect(getKanaRow('た')).toBe('た');
    expect(getKanaRow('ち')).toBe('た');
    expect(getKanaRow('つ')).toBe('た');
    expect(getKanaRow('て')).toBe('た');
    expect(getKanaRow('と')).toBe('た');
  });

  it('ひらがな「な」行を正しく分類', () => {
    expect(getKanaRow('な')).toBe('な');
    expect(getKanaRow('に')).toBe('な');
    expect(getKanaRow('ぬ')).toBe('な');
    expect(getKanaRow('ね')).toBe('な');
    expect(getKanaRow('の')).toBe('な');
  });

  it('ひらがな「は」行を正しく分類', () => {
    expect(getKanaRow('は')).toBe('は');
    expect(getKanaRow('ひ')).toBe('は');
    expect(getKanaRow('ふ')).toBe('は');
    expect(getKanaRow('へ')).toBe('は');
    expect(getKanaRow('ほ')).toBe('は');
  });

  it('ひらがな「ま」行を正しく分類', () => {
    expect(getKanaRow('ま')).toBe('ま');
    expect(getKanaRow('み')).toBe('ま');
    expect(getKanaRow('む')).toBe('ま');
    expect(getKanaRow('め')).toBe('ま');
    expect(getKanaRow('も')).toBe('ま');
  });

  it('ひらがな「や」行を正しく分類', () => {
    expect(getKanaRow('や')).toBe('や');
    expect(getKanaRow('ゆ')).toBe('や');
    expect(getKanaRow('よ')).toBe('や');
  });

  it('ひらがな「ら」行を正しく分類', () => {
    expect(getKanaRow('ら')).toBe('ら');
    expect(getKanaRow('り')).toBe('ら');
    expect(getKanaRow('る')).toBe('ら');
    expect(getKanaRow('れ')).toBe('ら');
    expect(getKanaRow('ろ')).toBe('ら');
  });

  it('ひらがな「わ」行を正しく分類', () => {
    expect(getKanaRow('わ')).toBe('わ');
    expect(getKanaRow('を')).toBe('わ');
    expect(getKanaRow('ん')).toBe('わ');
  });

  it('カタカナをひらがなに変換して分類', () => {
    expect(getKanaRow('ア')).toBe('あ');
    expect(getKanaRow('カ')).toBe('か');
    expect(getKanaRow('サ')).toBe('さ');
    expect(getKanaRow('タ')).toBe('た');
    expect(getKanaRow('ナ')).toBe('な');
    expect(getKanaRow('ハ')).toBe('は');
    expect(getKanaRow('マ')).toBe('ま');
    expect(getKanaRow('ヤ')).toBe('や');
    expect(getKanaRow('ラ')).toBe('ら');
    expect(getKanaRow('ワ')).toBe('わ');
    expect(getKanaRow('ン')).toBe('わ');
  });

  it('濁音・半濁音を清音として分類', () => {
    expect(getKanaRow('が')).toBe('か');
    expect(getKanaRow('ざ')).toBe('さ');
    expect(getKanaRow('だ')).toBe('た');
    expect(getKanaRow('ば')).toBe('は');
    expect(getKanaRow('ぱ')).toBe('は');
    // カタカナ濁音
    expect(getKanaRow('ガ')).toBe('か');
    expect(getKanaRow('ザ')).toBe('さ');
    expect(getKanaRow('ダ')).toBe('た');
    expect(getKanaRow('バ')).toBe('は');
    expect(getKanaRow('パ')).toBe('は');
  });

  it('小文字かなを正しく分類', () => {
    expect(getKanaRow('ぁ')).toBe('あ');
    expect(getKanaRow('ぃ')).toBe('あ');
    expect(getKanaRow('ぅ')).toBe('あ');
    expect(getKanaRow('ぇ')).toBe('あ');
    expect(getKanaRow('ぉ')).toBe('あ');
    expect(getKanaRow('っ')).toBe('た');
    expect(getKanaRow('ゃ')).toBe('や');
    expect(getKanaRow('ゅ')).toBe('や');
    expect(getKanaRow('ょ')).toBe('や');
  });

  it('かな以外はnullを返す', () => {
    expect(getKanaRow('田')).toBeNull();
    expect(getKanaRow('A')).toBeNull();
    expect(getKanaRow('1')).toBeNull();
    expect(getKanaRow('')).toBeNull();
  });
});

// ============================================
// KANA_ROWS
// ============================================

describe('KANA_ROWS', () => {
  it('10行が定義されている', () => {
    expect(KANA_ROWS).toEqual(['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ']);
  });
});

// ============================================
// buildFuriganaMap
// ============================================

describe('buildFuriganaMap', () => {
  const customers: CustomerMaster[] = [
    { id: '1', name: '田中太郎', furigana: 'たなかたろう', isDuplicate: false },
    { id: '2', name: '鈴木花子', furigana: 'すずきはなこ', isDuplicate: false },
    { id: '3', name: '佐藤一郎', furigana: 'さとういちろう', isDuplicate: false },
  ];

  it('顧客名→ふりがなのMapを構築', () => {
    const map = buildFuriganaMap(customers);
    expect(map.get('田中太郎')).toBe('たなかたろう');
    expect(map.get('鈴木花子')).toBe('すずきはなこ');
    expect(map.get('佐藤一郎')).toBe('さとういちろう');
  });

  it('存在しない名前はundefined', () => {
    const map = buildFuriganaMap(customers);
    expect(map.get('山田次郎')).toBeUndefined();
  });

  it('空配列でも動作', () => {
    const map = buildFuriganaMap([]);
    expect(map.size).toBe(0);
  });

  it('furiganaが空文字の場合もマップに含まれる', () => {
    const customersWithEmpty: CustomerMaster[] = [
      { id: '1', name: '不明者', furigana: '', isDuplicate: false },
    ];
    const map = buildFuriganaMap(customersWithEmpty);
    expect(map.get('不明者')).toBe('');
  });
});

// ============================================
// sortGroupsByFurigana
// ============================================

describe('sortGroupsByFurigana', () => {
  const furiganaMap = new Map([
    ['田中太郎', 'たなかたろう'],
    ['鈴木花子', 'すずきはなこ'],
    ['佐藤一郎', 'さとういちろう'],
    ['安藤美咲', 'あんどうみさき'],
    ['渡辺健太', 'わたなべけんた'],
  ]);

  const groups = [
    { id: '1', displayName: '渡辺健太' },
    { id: '2', displayName: '田中太郎' },
    { id: '3', displayName: '鈴木花子' },
    { id: '4', displayName: '佐藤一郎' },
    { id: '5', displayName: '安藤美咲' },
  ];

  it('ふりがな順（あいうえお順）にソートされる', () => {
    const sorted = sortGroupsByFurigana(groups, furiganaMap);
    expect(sorted.map((g) => g.displayName)).toEqual([
      '安藤美咲',   // あんどうみさき
      '佐藤一郎',   // さとういちろう
      '鈴木花子',   // すずきはなこ
      '田中太郎',   // たなかたろう
      '渡辺健太',   // わたなべけんた
    ]);
  });

  it('ふりがながないグループは末尾に配置', () => {
    const groupsWithUnknown = [
      ...groups,
      { id: '6', displayName: '未登録者' },
    ];
    const sorted = sortGroupsByFurigana(groupsWithUnknown, furiganaMap);
    expect(sorted[sorted.length - 1].displayName).toBe('未登録者');
  });

  it('元の配列を変更しない（イミュータブル）', () => {
    const original = [...groups];
    sortGroupsByFurigana(groups, furiganaMap);
    expect(groups).toEqual(original);
  });

  it('空配列でも動作', () => {
    expect(sortGroupsByFurigana([], furiganaMap)).toEqual([]);
  });

  it('空のふりがなマップでもクラッシュしない', () => {
    const sorted = sortGroupsByFurigana(groups, new Map());
    expect(sorted).toHaveLength(groups.length);
  });
});

// ============================================
// filterGroupsByKanaRow
// ============================================

describe('filterGroupsByKanaRow', () => {
  const furiganaMap = new Map([
    ['田中太郎', 'たなかたろう'],
    ['鈴木花子', 'すずきはなこ'],
    ['佐藤一郎', 'さとういちろう'],
    ['安藤美咲', 'あんどうみさき'],
    ['高橋裕子', 'たかはしゆうこ'],
  ]);

  const groups = [
    { id: '1', displayName: '田中太郎' },
    { id: '2', displayName: '鈴木花子' },
    { id: '3', displayName: '佐藤一郎' },
    { id: '4', displayName: '安藤美咲' },
    { id: '5', displayName: '高橋裕子' },
  ];

  it('null（全て）を指定すると全グループを返す', () => {
    const result = filterGroupsByKanaRow(groups, null, furiganaMap);
    expect(result).toHaveLength(5);
  });

  it('「た」行でフィルター → た行の顧客のみ', () => {
    const result = filterGroupsByKanaRow(groups, 'た', furiganaMap);
    expect(result.map((g) => g.displayName)).toEqual(['田中太郎', '高橋裕子']);
  });

  it('「さ」行でフィルター → さ行の顧客のみ', () => {
    const result = filterGroupsByKanaRow(groups, 'さ', furiganaMap);
    expect(result.map((g) => g.displayName)).toEqual(['鈴木花子', '佐藤一郎']);
  });

  it('「あ」行でフィルター → あ行の顧客のみ', () => {
    const result = filterGroupsByKanaRow(groups, 'あ', furiganaMap);
    expect(result.map((g) => g.displayName)).toEqual(['安藤美咲']);
  });

  it('該当なしの行は空配列を返す', () => {
    const result = filterGroupsByKanaRow(groups, 'ま', furiganaMap);
    expect(result).toEqual([]);
  });

  it('ふりがながないグループはフィルターに含まれない', () => {
    const groupsWithUnknown = [
      ...groups,
      { id: '6', displayName: '未登録者' },
    ];
    const result = filterGroupsByKanaRow(groupsWithUnknown, 'た', furiganaMap);
    expect(result.map((g) => g.displayName)).toEqual(['田中太郎', '高橋裕子']);
  });
});
