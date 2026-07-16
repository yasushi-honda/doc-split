/**
 * groupDocumentsByCategory テスト（担当CM別タブ 第3階層のカテゴリ化）
 *
 * Acceptance Criteria カバー:
 * - AC-1: カテゴリ名で集約され、あいうえお順・「未分類」末尾
 * - AC-2: 全書類が未分類 → isAllUncategorizedDocs=true（従来表示フォールバックの前提）
 * - AC-3: documentTypeKey 欠損時は normalizeGroupKey(documentType) でフォールバック解決
 * - AC-4: masters=undefined / category 空文字・空白 → 未分類
 * - AC-5: カテゴリ内の書類は入力順を保持
 * - AC-6: 空配列 → 空結果かつ isAllUncategorizedDocs=false
 */

import { describe, it, expect } from 'vitest';
import type { Document, DocumentMaster } from '@shared/types';
import {
  groupDocumentsByCategory,
  isAllUncategorizedDocs,
} from '../groupDocumentsByCategory';
import { UNCATEGORIZED_LABEL } from '../buildDocumentTypeCategoryGroups';
import { normalizeGroupKey } from '../normalizeGroupKey';

// ============================================
// Test Helpers
// ============================================

function makeDoc(overrides: Partial<Document>): Document {
  return {
    id: overrides.id ?? `doc-${Math.random().toString(36).slice(2, 8)}`,
    fileName: 'test.pdf',
    status: 'processed',
    ...overrides,
  } as Document;
}

function makeMaster(name: string, category?: string): DocumentMaster {
  return { name, category };
}

// ============================================
// AC-1: 基本集約とソート
// ============================================

describe('groupDocumentsByCategory - 基本集約', () => {
  it('AC-1: カテゴリ名で集約され、あいうえお順・「未分類」末尾に並ぶ', () => {
    const docs = [
      makeDoc({ documentType: '請求書', documentTypeKey: normalizeGroupKey('請求書') }),
      makeDoc({ documentType: 'ケアプラン', documentTypeKey: normalizeGroupKey('ケアプラン') }),
      makeDoc({ documentType: '謎の書類', documentTypeKey: normalizeGroupKey('謎の書類') }),
    ];
    const masters = [
      makeMaster('請求書', 'せいきゅう'),
      makeMaster('ケアプラン', 'けあぷらん'),
      // 謎の書類はマスター不在 → 未分類
    ];

    const result = groupDocumentsByCategory(docs, masters);

    expect(result.map((g) => g.categoryName)).toEqual([
      'けあぷらん',
      'せいきゅう',
      UNCATEGORIZED_LABEL,
    ]);
    expect(result[0]?.documents).toHaveLength(1);
    expect(result[2]?.documents[0]?.documentType).toBe('謎の書類');
  });

  it('AC-1: 同一カテゴリの複数書類種別が1フォルダに集約される', () => {
    const docs = [
      makeDoc({ documentType: 'ケアプラン1表', documentTypeKey: normalizeGroupKey('ケアプラン1表') }),
      makeDoc({ documentType: 'ケアプラン2表', documentTypeKey: normalizeGroupKey('ケアプラン2表') }),
    ];
    const masters = [
      makeMaster('ケアプラン1表', 'ケアプラン'),
      makeMaster('ケアプラン2表', 'ケアプラン'),
    ];

    const result = groupDocumentsByCategory(docs, masters);

    expect(result).toHaveLength(1);
    expect(result[0]?.categoryName).toBe('ケアプラン');
    expect(result[0]?.documents).toHaveLength(2);
  });
});

// ============================================
// AC-2: 全未分類フォールバック判定
// ============================================

describe('isAllUncategorizedDocs', () => {
  it('AC-2: 全書類がカテゴリ未解決なら true（従来表示フォールバックの前提）', () => {
    const docs = [
      makeDoc({ documentType: '書類A', documentTypeKey: normalizeGroupKey('書類A') }),
      makeDoc({ documentType: '書類B', documentTypeKey: normalizeGroupKey('書類B') }),
    ];
    const result = groupDocumentsByCategory(docs, []);

    expect(isAllUncategorizedDocs(result)).toBe(true);
  });

  it('AC-2: 1件でもカテゴリ解決されれば false', () => {
    const docs = [
      makeDoc({ documentType: 'ケアプラン', documentTypeKey: normalizeGroupKey('ケアプラン') }),
      makeDoc({ documentType: '書類B', documentTypeKey: normalizeGroupKey('書類B') }),
    ];
    const masters = [makeMaster('ケアプラン', 'ケアプラン')];
    const result = groupDocumentsByCategory(docs, masters);

    expect(isAllUncategorizedDocs(result)).toBe(false);
  });

  it('AC-6: 空配列は空結果を返し isAllUncategorizedDocs=false', () => {
    const result = groupDocumentsByCategory([], []);

    expect(result).toEqual([]);
    expect(isAllUncategorizedDocs(result)).toBe(false);
  });
});

// ============================================
// AC-3: documentTypeKey フォールバック
// ============================================

describe('groupDocumentsByCategory - キー解決', () => {
  it('AC-3: documentTypeKey 欠損時は normalizeGroupKey(documentType) で解決される', () => {
    // 旧形式 doc（BE 正規化前に作成され documentTypeKey を持たない）
    const docs = [makeDoc({ documentType: 'ケアプラン', documentTypeKey: undefined })];
    const masters = [makeMaster('ケアプラン', 'ケアプラン')];

    const result = groupDocumentsByCategory(docs, masters);

    expect(result[0]?.categoryName).toBe('ケアプラン');
  });

  it('AC-3: documentType も空の doc は未分類に入る', () => {
    const docs = [makeDoc({ documentType: '', documentTypeKey: undefined })];
    const masters = [makeMaster('ケアプラン', 'ケアプラン')];

    const result = groupDocumentsByCategory(docs, masters);

    expect(result).toHaveLength(1);
    expect(result[0]?.categoryName).toBe(UNCATEGORIZED_LABEL);
  });
});

// ============================================
// AC-4: masters 欠損・category 空
// ============================================

describe('groupDocumentsByCategory - masters/category 欠損', () => {
  it('AC-4: masters=undefined（取得失敗）でも全件未分類として動作する', () => {
    const docs = [makeDoc({ documentType: 'ケアプラン', documentTypeKey: normalizeGroupKey('ケアプラン') })];

    const result = groupDocumentsByCategory(docs, undefined);

    expect(result).toHaveLength(1);
    expect(result[0]?.categoryName).toBe(UNCATEGORIZED_LABEL);
    expect(isAllUncategorizedDocs(result)).toBe(true);
  });

  it('AC-4: category が空文字・空白のみの master は未分類扱い', () => {
    const docs = [
      makeDoc({ documentType: '書類A', documentTypeKey: normalizeGroupKey('書類A') }),
      makeDoc({ documentType: '書類B', documentTypeKey: normalizeGroupKey('書類B') }),
    ];
    const masters = [makeMaster('書類A', ''), makeMaster('書類B', '   ')];

    const result = groupDocumentsByCategory(docs, masters);

    expect(result).toHaveLength(1);
    expect(result[0]?.categoryName).toBe(UNCATEGORIZED_LABEL);
  });
});

// ============================================
// AC-5: カテゴリ内の順序保持
// ============================================

describe('groupDocumentsByCategory - 順序保持', () => {
  it('AC-5: カテゴリ内の書類は入力順を保持する', () => {
    const docs = [
      makeDoc({ id: 'doc-1', documentType: 'ケアプラン1表', documentTypeKey: normalizeGroupKey('ケアプラン1表') }),
      makeDoc({ id: 'doc-2', documentType: 'ケアプラン2表', documentTypeKey: normalizeGroupKey('ケアプラン2表') }),
      makeDoc({ id: 'doc-3', documentType: 'ケアプラン1表', documentTypeKey: normalizeGroupKey('ケアプラン1表') }),
    ];
    const masters = [
      makeMaster('ケアプラン1表', 'ケアプラン'),
      makeMaster('ケアプラン2表', 'ケアプラン'),
    ];

    const result = groupDocumentsByCategory(docs, masters);

    expect(result[0]?.documents.map((d) => d.id)).toEqual(['doc-1', 'doc-2', 'doc-3']);
  });
});
