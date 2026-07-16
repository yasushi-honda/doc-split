/**
 * buildCustomerFolderGroups テスト（担当CM別タブ 第3階層のカテゴリフォルダ化）
 *
 * Acceptance Criteria カバー:
 * - AC-1: カテゴリ解決された書類はカテゴリ名フォルダに集約され、あいうえお順
 * - AC-2: カテゴリ未解決の書類は種別名フォルダのまま残る（単一「未分類」への混載回帰なし）
 * - AC-3: documentTypeKey 欠損時は normalizeGroupKey(documentType) でフォールバック解決
 * - AC-4: masters=undefined / category 空文字・空白 → 種別名フォルダ（従来表示と一致）
 * - AC-5: フォルダ内の書類は入力順を保持
 * - AC-6: 空配列 → 空結果
 * - AC-7: 種別未確定 doc は「未判定」フォルダで常に末尾
 */

import { describe, it, expect } from 'vitest';
import type { Document, DocumentMaster } from '@shared/types';
import {
  buildCustomerFolderGroups,
  UNKNOWN_DOC_TYPE_LABEL,
} from '../buildCustomerFolderGroups';
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

function typedDoc(documentType: string, id?: string): Document {
  return makeDoc({ id, documentType, documentTypeKey: normalizeGroupKey(documentType) });
}

function makeMaster(name: string, category?: string): DocumentMaster {
  return { name, category };
}

// ============================================
// AC-1: カテゴリ集約とソート
// ============================================

describe('buildCustomerFolderGroups - カテゴリ集約', () => {
  it('AC-1: カテゴリ解決された書類はカテゴリ名フォルダになり、あいうえお順で並ぶ', () => {
    const docs = [typedDoc('請求書'), typedDoc('ケアプラン')];
    const masters = [
      makeMaster('請求書', 'せいきゅう'),
      makeMaster('ケアプラン', 'けあぷらん'),
    ];

    const result = buildCustomerFolderGroups(docs, masters);

    expect(result.map((g) => g.label)).toEqual(['けあぷらん', 'せいきゅう']);
  });

  it('AC-1: 同一カテゴリの複数書類種別が1フォルダに集約される', () => {
    const docs = [typedDoc('ケアプラン1表'), typedDoc('ケアプラン2表')];
    const masters = [
      makeMaster('ケアプラン1表', 'ケアプラン'),
      makeMaster('ケアプラン2表', 'ケアプラン'),
    ];

    const result = buildCustomerFolderGroups(docs, masters);

    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('ケアプラン');
    expect(result[0]?.documents).toHaveLength(2);
  });
});

// ============================================
// AC-2: カテゴリ未解決書類の種別粒度保持（混載回帰防止）
// ============================================

describe('buildCustomerFolderGroups - 部分カテゴリ運用', () => {
  it('AC-2: カテゴリ未解決の複数書類種別は単一フォルダに混載されず、種別名フォルダのまま残る', () => {
    // カテゴリ移行途中: ケアプランのみcategory設定済み、契約書・同意書は未設定
    const docs = [typedDoc('ケアプラン'), typedDoc('契約書'), typedDoc('同意書')];
    const masters = [
      makeMaster('ケアプラン', '計画書類'),
      makeMaster('契約書'), // category未設定
      // 同意書はマスター不在
    ];

    const result = buildCustomerFolderGroups(docs, masters);

    // カテゴリフォルダ1 + 種別フォルダ2（あいうえお順で混在ソート）
    expect(result.map((g) => g.label)).toEqual(['契約書', '計画書類', '同意書']);
    expect(result.find((g) => g.label === '計画書類')?.documents).toHaveLength(1);
  });

  it('AC-4: masters=undefined（取得失敗）では全書類が種別名フォルダ（従来表示と一致）', () => {
    const docs = [typedDoc('請求書'), typedDoc('ケアプラン')];

    const result = buildCustomerFolderGroups(docs, undefined);

    expect(result.map((g) => g.label)).toEqual(['ケアプラン', '請求書']);
  });

  it('AC-4: category が空文字・空白のみの master は種別名フォルダ扱い', () => {
    const docs = [typedDoc('書類A'), typedDoc('書類B')];
    const masters = [makeMaster('書類A', ''), makeMaster('書類B', '   ')];

    const result = buildCustomerFolderGroups(docs, masters);

    expect(result.map((g) => g.label)).toEqual(['書類A', '書類B']);
  });
});

// ============================================
// AC-3: documentTypeKey フォールバック
// ============================================

describe('buildCustomerFolderGroups - キー解決', () => {
  it('AC-3: documentTypeKey 欠損時は normalizeGroupKey(documentType) で解決される', () => {
    // 旧形式 doc（BE 正規化前に作成され documentTypeKey を持たない）
    const docs = [makeDoc({ documentType: 'ケアプラン', documentTypeKey: undefined })];
    const masters = [makeMaster('ケアプラン', '計画書類')];

    const result = buildCustomerFolderGroups(docs, masters);

    expect(result[0]?.label).toBe('計画書類');
  });
});

// ============================================
// AC-7: 未判定の末尾配置
// ============================================

describe('buildCustomerFolderGroups - 未判定', () => {
  it('AC-7: documentType が空の doc は「未判定」フォルダで、カテゴリ・種別フォルダより末尾', () => {
    const docs = [
      makeDoc({ documentType: '', documentTypeKey: undefined }),
      typedDoc('ケアプラン'),
      typedDoc('請求書'),
    ];
    const masters = [makeMaster('ケアプラン', '計画書類')];

    const result = buildCustomerFolderGroups(docs, masters);

    expect(result.map((g) => g.label)).toEqual(['計画書類', '請求書', UNKNOWN_DOC_TYPE_LABEL]);
  });
});

// ============================================
// AC-5/AC-6: 順序保持・空配列
// ============================================

describe('buildCustomerFolderGroups - 順序・境界値', () => {
  it('AC-5: フォルダ内の書類は入力順を保持する', () => {
    const docs = [
      typedDoc('ケアプラン1表', 'doc-1'),
      typedDoc('ケアプラン2表', 'doc-2'),
      typedDoc('ケアプラン1表', 'doc-3'),
    ];
    const masters = [
      makeMaster('ケアプラン1表', 'ケアプラン'),
      makeMaster('ケアプラン2表', 'ケアプラン'),
    ];

    const result = buildCustomerFolderGroups(docs, masters);

    expect(result[0]?.documents.map((d) => d.id)).toEqual(['doc-1', 'doc-2', 'doc-3']);
  });

  it('AC-6: 空配列は空結果を返す', () => {
    expect(buildCustomerFolderGroups([], [])).toEqual([]);
  });
});
