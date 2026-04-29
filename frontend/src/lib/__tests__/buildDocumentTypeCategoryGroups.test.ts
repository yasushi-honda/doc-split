/**
 * buildDocumentTypeCategoryGroups テスト
 *
 * Acceptance Criteria カバー:
 * - AC-1: カテゴリ階層表示（あいうえお順）
 * - AC-4: 「未分類」末尾フォールバック
 * - AC-5: isAllUncategorized 判定（階層省略フォールバックの前提）
 * - AC-7: マスター取得失敗時のフォールバック（masters=undefined）
 * - AC-8: ソート安定性（件数によらず名前順）
 * - AC-9: マスター名と groupKey が正規化照合で一致
 * - AC-10: category 空文字・空白・undefined → 未分類
 * - AC-11: 同一カテゴリ内の書類種別もあいうえお順
 * - AC-12: 100 件超でもカテゴリ欠落しない
 */

import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { DocumentMaster } from '@shared/types';
import type { DocumentGroup } from '@/hooks/useDocumentGroups';
import {
  buildDocumentTypeCategoryGroups,
  isAllUncategorized,
  summarizeCategoryGroups,
  UNCATEGORIZED_LABEL,
} from '../buildDocumentTypeCategoryGroups';

// ============================================
// Test Helpers
// ============================================

function makeGroup(overrides: Partial<DocumentGroup>): DocumentGroup {
  const ts = Timestamp.fromMillis(0);
  return {
    id: overrides.id ?? `id-${overrides.groupKey ?? 'x'}`,
    groupType: 'documentType',
    groupKey: overrides.groupKey ?? '',
    displayName: overrides.displayName ?? overrides.groupKey ?? '',
    count: overrides.count ?? 1,
    latestAt: ts,
    latestDocs: [],
    updatedAt: ts,
    ...overrides,
  };
}

function makeMaster(name: string, category?: string): DocumentMaster {
  return { name, category };
}

// ============================================
// AC-1, AC-4, AC-8: カテゴリ階層化（基本）
// ============================================

describe('buildDocumentTypeCategoryGroups - 基本階層化', () => {
  it('AC-1: 複数カテゴリが日本語ロケール昇順で並ぶ（ひらがなカテゴリで予測可能）', () => {
    const groups = [
      makeGroup({ groupKey: '請求書', displayName: '請求書' }),
      makeGroup({ groupKey: 'ケアプラン', displayName: 'ケアプラン' }),
    ];
    const masters = [
      makeMaster('請求書', 'いりょう'),
      makeMaster('ケアプラン', 'きょたく'),
    ];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual(['いりょう', 'きょたく']);
  });

  it('AC-4: 「未分類」は末尾に並ぶ', () => {
    const groups = [
      makeGroup({ groupKey: 'a', displayName: 'A' }),
      makeGroup({ groupKey: 'b', displayName: 'B' }),
      makeGroup({ groupKey: 'c', displayName: 'C' }),
    ];
    const masters = [
      makeMaster('A', 'いりょう'),
      makeMaster('B'), // category 未設定
      makeMaster('C', 'きょたく'),
    ];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual([
      'いりょう',
      'きょたく',
      UNCATEGORIZED_LABEL,
    ]);
  });

  it('AC-8: 件数によらずカテゴリ名の日本語ロケール昇順で並ぶ', () => {
    const groups = [
      makeGroup({ groupKey: 'g1', displayName: 'G1', count: 3 }),
      makeGroup({ groupKey: 'g2', displayName: 'G2', count: 5 }),
      makeGroup({ groupKey: 'g3', displayName: 'G3', count: 2 }),
    ];
    const masters = [
      makeMaster('G1', 'いりょう'),
      makeMaster('G2', 'きょたく'),
      makeMaster('G3', 'ほうもん'),
    ];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual([
      'いりょう',
      'きょたく',
      'ほうもん',
    ]);
  });

  it('複数書類種別が同一カテゴリに集約される', () => {
    const groups = [
      makeGroup({ groupKey: '請求書', displayName: '請求書' }),
      makeGroup({ groupKey: '領収書', displayName: '領収書' }),
      makeGroup({ groupKey: '診断書', displayName: '診断書' }),
    ];
    const masters = [
      makeMaster('請求書', 'いりょう'),
      makeMaster('領収書', 'いりょう'),
      makeMaster('診断書', 'いりょう'),
    ];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result).toHaveLength(1);
    expect(result[0]?.categoryName).toBe('いりょう');
    expect(result[0]?.groups).toHaveLength(3);
  });
});

// ============================================
// AC-9: 正規化キー照合
// ============================================

describe('buildDocumentTypeCategoryGroups - 正規化キー照合 (AC-9)', () => {
  it('全角英数字差異があっても master と一致する', () => {
    const groups = [
      // groupKey は backend で正規化済み（"abc123"）
      makeGroup({ groupKey: 'abc123', displayName: 'ＡＢＣ１２３' }),
    ];
    const masters = [
      // master.name は元の表記（全角）
      makeMaster('ＡＢＣ１２３', 'いりょう'),
    ];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual(['いりょう']);
  });

  it('空白差異があっても master と一致する', () => {
    const groups = [makeGroup({ groupKey: 'helloworld', displayName: 'hello world' })];
    const masters = [makeMaster('hello world', 'いりょう')];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual(['いりょう']);
  });

  it('大文字小文字差異があっても master と一致する', () => {
    const groups = [makeGroup({ groupKey: 'documenttype', displayName: 'DocumentType' })];
    const masters = [makeMaster('Document Type', 'いりょう')];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual(['いりょう']);
  });

  it('master に存在しない groupKey は未分類になる', () => {
    const groups = [
      makeGroup({ groupKey: '未登録書類', displayName: '未登録書類' }),
    ];
    const masters = [makeMaster('別の書類', 'いりょう')];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual([UNCATEGORIZED_LABEL]);
  });
});

// ============================================
// AC-10: 未分類フォールバック
// ============================================

describe('buildDocumentTypeCategoryGroups - 未分類フォールバック (AC-10)', () => {
  it('category が undefined の master は未分類になる', () => {
    const groups = [makeGroup({ groupKey: 'a', displayName: 'A' })];
    const masters = [makeMaster('A')]; // category 未指定

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual([UNCATEGORIZED_LABEL]);
  });

  it('category が空文字列の master は未分類になる', () => {
    const groups = [makeGroup({ groupKey: 'a', displayName: 'A' })];
    const masters = [makeMaster('A', '')];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual([UNCATEGORIZED_LABEL]);
  });

  it('category が空白のみの master は未分類になる', () => {
    const groups = [makeGroup({ groupKey: 'a', displayName: 'A' })];
    const masters = [makeMaster('A', '   ')];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual([UNCATEGORIZED_LABEL]);
  });

  it('category が全角空白のみの master は未分類になる', () => {
    const groups = [makeGroup({ groupKey: 'a', displayName: 'A' })];
    const masters = [makeMaster('A', '　　')];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual([UNCATEGORIZED_LABEL]);
  });

  it('category 前後の空白は trim される', () => {
    const groups = [makeGroup({ groupKey: 'a', displayName: 'A' })];
    const masters = [makeMaster('A', '  いりょう  ')];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result.map((c) => c.categoryName)).toEqual(['いりょう']);
  });
});

// ============================================
// AC-11: カテゴリ内ソート
// ============================================

describe('buildDocumentTypeCategoryGroups - カテゴリ内ソート (AC-11)', () => {
  it('同一カテゴリ内の書類種別は displayName の日本語ロケール昇順', () => {
    const groups = [
      makeGroup({ groupKey: 'k1', displayName: 'りょうしゅうしょ' }),
      makeGroup({ groupKey: 'k2', displayName: 'せいきゅうしょ' }),
      makeGroup({ groupKey: 'k3', displayName: 'しんだんしょ' }),
    ];
    const masters = [
      makeMaster('りょうしゅうしょ', 'いりょう'),
      makeMaster('せいきゅうしょ', 'いりょう'),
      makeMaster('しんだんしょ', 'いりょう'),
    ];

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    expect(result[0]?.groups.map((g) => g.displayName)).toEqual([
      'しんだんしょ',
      'せいきゅうしょ',
      'りょうしゅうしょ',
    ]);
  });
});

// ============================================
// AC-7: マスター取得失敗フォールバック
// ============================================

describe('buildDocumentTypeCategoryGroups - マスター取得失敗 (AC-7)', () => {
  it('masters が undefined なら全件「未分類」', () => {
    const groups = [
      makeGroup({ groupKey: 'a', displayName: 'A' }),
      makeGroup({ groupKey: 'b', displayName: 'B' }),
    ];

    const result = buildDocumentTypeCategoryGroups(groups, undefined);

    expect(result).toHaveLength(1);
    expect(result[0]?.categoryName).toBe(UNCATEGORIZED_LABEL);
    expect(result[0]?.groups).toHaveLength(2);
  });

  it('masters が空配列なら全件「未分類」', () => {
    const groups = [
      makeGroup({ groupKey: 'a', displayName: 'A' }),
      makeGroup({ groupKey: 'b', displayName: 'B' }),
    ];

    const result = buildDocumentTypeCategoryGroups(groups, []);

    expect(result).toHaveLength(1);
    expect(result[0]?.categoryName).toBe(UNCATEGORIZED_LABEL);
    expect(result[0]?.groups).toHaveLength(2);
  });

  it('groups が空配列なら結果も空配列', () => {
    const result = buildDocumentTypeCategoryGroups([], [makeMaster('A', '医療')]);
    expect(result).toEqual([]);
  });

  it('groups と masters どちらも空なら結果も空', () => {
    const result = buildDocumentTypeCategoryGroups([], []);
    expect(result).toEqual([]);
  });
});

// ============================================
// AC-12: 大量データでカテゴリ欠落しない
// ============================================

describe('buildDocumentTypeCategoryGroups - 大量データ (AC-12)', () => {
  it('100 件超の書類種別が複数カテゴリに分散しても全件保持される', () => {
    const groups: DocumentGroup[] = [];
    const masters: DocumentMaster[] = [];
    for (let i = 0; i < 150; i++) {
      const name = `doc${String(i).padStart(3, '0')}`;
      groups.push(makeGroup({ groupKey: name, displayName: name }));
      // 3 カテゴリに分散
      const category = ['いりょう', 'きょたく', 'ほうもん'][i % 3]!;
      masters.push(makeMaster(name, category));
    }

    const result = buildDocumentTypeCategoryGroups(groups, masters);

    const totalGroups = result.reduce((sum, c) => sum + c.groups.length, 0);
    expect(totalGroups).toBe(150);
    expect(result.map((c) => c.categoryName)).toEqual([
      'いりょう',
      'きょたく',
      'ほうもん',
    ]);
  });
});

// ============================================
// AC-5: isAllUncategorized 判定
// ============================================

describe('isAllUncategorized - 階層省略判定 (AC-5)', () => {
  it('「未分類」1 つだけなら true', () => {
    const hierarchy = [
      { categoryName: UNCATEGORIZED_LABEL, groups: [makeGroup({ groupKey: 'a' })] },
    ];
    expect(isAllUncategorized(hierarchy)).toBe(true);
  });

  it('「未分類」+ 他カテゴリなら false', () => {
    const hierarchy = [
      { categoryName: 'いりょう', groups: [makeGroup({ groupKey: 'a' })] },
      { categoryName: UNCATEGORIZED_LABEL, groups: [makeGroup({ groupKey: 'b' })] },
    ];
    expect(isAllUncategorized(hierarchy)).toBe(false);
  });

  it('カテゴリ 1 つだけだが「未分類」でないなら false', () => {
    const hierarchy = [
      { categoryName: 'いりょう', groups: [makeGroup({ groupKey: 'a' })] },
    ];
    expect(isAllUncategorized(hierarchy)).toBe(false);
  });

  it('空配列なら false', () => {
    expect(isAllUncategorized([])).toBe(false);
  });
});

// ============================================
// summarizeCategoryGroups（CategoryItem ヘッダー用集計）
// ============================================

describe('summarizeCategoryGroups', () => {
  it('空配列なら totalDocs=0、latestAt=undefined', () => {
    const result = summarizeCategoryGroups([]);
    expect(result).toEqual({ totalDocs: 0, latestAt: undefined });
  });

  it('count を合計する', () => {
    const groups = [
      makeGroup({ groupKey: 'a', count: 3 }),
      makeGroup({ groupKey: 'b', count: 5 }),
      makeGroup({ groupKey: 'c', count: 7 }),
    ];
    expect(summarizeCategoryGroups(groups).totalDocs).toBe(15);
  });

  it('latestAt が全て同じなら、その値を返す', () => {
    const ts = Timestamp.fromMillis(1000);
    const groups = [
      makeGroup({ groupKey: 'a', latestAt: ts }),
      makeGroup({ groupKey: 'b', latestAt: ts }),
    ];
    expect(summarizeCategoryGroups(groups).latestAt?.toMillis()).toBe(1000);
  });

  it('latestAt の最大値を返す', () => {
    const groups = [
      makeGroup({ groupKey: 'a', latestAt: Timestamp.fromMillis(1000) }),
      makeGroup({ groupKey: 'b', latestAt: Timestamp.fromMillis(3000) }),
      makeGroup({ groupKey: 'c', latestAt: Timestamp.fromMillis(2000) }),
    ];
    expect(summarizeCategoryGroups(groups).latestAt?.toMillis()).toBe(3000);
  });

  it('一部 latestAt が undefined でも、有効な最大値を返す', () => {
    const groups = [
      makeGroup({ groupKey: 'a', latestAt: undefined as unknown as Timestamp }),
      makeGroup({ groupKey: 'b', latestAt: Timestamp.fromMillis(2000) }),
      makeGroup({ groupKey: 'c', latestAt: undefined as unknown as Timestamp }),
    ];
    expect(summarizeCategoryGroups(groups).latestAt?.toMillis()).toBe(2000);
  });

  it('全 latestAt が undefined なら latestAt=undefined', () => {
    const groups = [
      makeGroup({ groupKey: 'a', latestAt: undefined as unknown as Timestamp }),
      makeGroup({ groupKey: 'b', latestAt: undefined as unknown as Timestamp }),
    ];
    expect(summarizeCategoryGroups(groups).latestAt).toBeUndefined();
  });

  it('単一 group の場合も正しく集計', () => {
    const groups = [makeGroup({ groupKey: 'a', count: 42, latestAt: Timestamp.fromMillis(5000) })];
    expect(summarizeCategoryGroups(groups)).toEqual({
      totalDocs: 42,
      latestAt: Timestamp.fromMillis(5000),
    });
  });
});
