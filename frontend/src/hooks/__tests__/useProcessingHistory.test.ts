/**
 * useProcessingHistory 単体テスト (Issue #273, PR #272 follow-up)
 *
 * 目的: PR #272 (#253) で firestoreToDocument を useDocuments に集約した refactor に対する
 * 回帰テストネットと、isCustomerConfirmed デュアルリード経路 (Phase 6/7 データ) の lock-in。
 *
 * スコープ:
 * - isCustomerConfirmed: customerConfirmed vs needsManualCustomerSelection の優先度
 * - normalizeCandidate: 新旧スキーマ互換 (customerId/id, customerName/name 等)
 * - applyConfirmedFilter: 'all' / 'confirmed' / 'unconfirmed' フィルターの挙動
 * - 統合: Firestore raw data → firestoreToDocument → isCustomerConfirmed の end-to-end
 *
 * 方式: pure function の unit test。hook 本体 (useProcessingHistory) は scope 外 (React Hook test は別 Issue)。
 */

import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  isCustomerConfirmed,
  normalizeCandidate,
  applyConfirmedFilter,
} from '../useProcessingHistory';
import { firestoreToDocument } from '../useDocuments';
import type { Document } from '@shared/types';

// Document 最小 fixture factory。必要フィールドのみ上書きする。
function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-000',
    fileId: 'file-000',
    fileName: 'test.pdf',
    mimeType: 'application/pdf',
    fileUrl: 'gs://bucket/test.pdf',
    processedAt: new Date(),
    status: 'processed',
    totalPages: 1,
    ...overrides,
  } as Document;
}

describe('isCustomerConfirmed (デュアルリード #273)', () => {
  it('customerConfirmed: true → true を返す (Phase 7 データ、最優先)', () => {
    const doc = makeDoc({ customerConfirmed: true, needsManualCustomerSelection: true });
    expect(isCustomerConfirmed(doc)).to.equal(true);
  });

  it('customerConfirmed: false → false を返す (Phase 7 データ、最優先)', () => {
    const doc = makeDoc({ customerConfirmed: false, needsManualCustomerSelection: false });
    expect(isCustomerConfirmed(doc)).to.equal(false);
  });

  it('customerConfirmed: undefined + needsManualCustomerSelection: true → false を返す (反転)', () => {
    const doc = makeDoc({ customerConfirmed: undefined, needsManualCustomerSelection: true });
    expect(isCustomerConfirmed(doc)).to.equal(false);
  });

  it('customerConfirmed: undefined + needsManualCustomerSelection: false → true を返す (反転)', () => {
    const doc = makeDoc({ customerConfirmed: undefined, needsManualCustomerSelection: false });
    expect(isCustomerConfirmed(doc)).to.equal(true);
  });

  it('両方 undefined → true を返す (Phase 6 以前デフォルト)', () => {
    const doc = makeDoc({ customerConfirmed: undefined, needsManualCustomerSelection: undefined });
    expect(isCustomerConfirmed(doc)).to.equal(true);
  });

  // #273 review 対応: 矛盾状態で customerConfirmed が needsManualCustomerSelection に優先されることを
  // 独立テストとして明示的に lock-in する。将来「needs を優先する」誤リファクタで fail するテスト intent を明確化。
  it('矛盾: customerConfirmed=true + needs=true → true (customerConfirmed が優先)', () => {
    const doc = makeDoc({ customerConfirmed: true, needsManualCustomerSelection: true });
    expect(isCustomerConfirmed(doc)).to.equal(true);
  });

  it('矛盾: customerConfirmed=false + needs=false → false (customerConfirmed が優先)', () => {
    const doc = makeDoc({ customerConfirmed: false, needsManualCustomerSelection: false });
    expect(isCustomerConfirmed(doc)).to.equal(false);
  });
});

describe('normalizeCandidate (新旧スキーマ互換 #273)', () => {
  it('新スキーマ (customerId/customerName) を保持する', () => {
    const raw = {
      customerId: 'cust-001',
      customerName: '山田太郎',
      isDuplicate: false,
      score: 95,
      matchType: 'exact' as const,
    };
    const result = normalizeCandidate(raw);
    expect(result).to.deep.equal({
      customerId: 'cust-001',
      customerName: '山田太郎',
      isDuplicate: false,
      score: 95,
      matchType: 'exact',
    });
  });

  it('旧スキーマ (id/name) を新スキーマに変換する', () => {
    const raw = {
      id: 'cust-002',
      name: '鈴木花子',
      score: 80,
      matchType: 'fuzzy' as const,
    };
    const result = normalizeCandidate(raw);
    expect(result.customerId).to.equal('cust-002');
    expect(result.customerName).to.equal('鈴木花子');
    expect(result.score).to.equal(80);
    expect(result.matchType).to.equal('fuzzy');
    expect(result.isDuplicate).to.equal(false); // デフォルト
  });

  it('部分欠落時は空文字/デフォルト値でフォールバック', () => {
    const raw = { customerId: 'cust-003' };
    const result = normalizeCandidate(raw);
    expect(result.customerId).to.equal('cust-003');
    expect(result.customerName).to.equal(''); // 欠落時は空文字
    expect(result.isDuplicate).to.equal(false);
    expect(result.score).to.equal(0);
    expect(result.matchType).to.equal('fuzzy'); // デフォルト
  });

  it('完全空オブジェクト → 全フィールド デフォルト値', () => {
    const result = normalizeCandidate({});
    expect(result).to.deep.equal({
      customerId: '',
      customerName: '',
      isDuplicate: false,
      score: 0,
      matchType: 'fuzzy',
    });
  });
});

describe('applyConfirmedFilter (#273)', () => {
  const confirmedDoc = makeDoc({ id: 'c1', customerConfirmed: true });
  const unconfirmedDoc = makeDoc({ id: 'u1', customerConfirmed: false });
  const phase6Doc = makeDoc({ id: 'p6' }); // 両方 undefined → confirmed 扱い
  // #273 review 対応: migration 期の mixed state (Phase 6 needs=true と Phase 7 customerConfirmed=false が混在)
  const phase6UnconfirmedDoc = makeDoc({
    id: 'p6u',
    customerConfirmed: undefined,
    needsManualCustomerSelection: true,
  });
  const docs = [confirmedDoc, unconfirmedDoc, phase6Doc, phase6UnconfirmedDoc];

  it("filter='all' → 全件返す", () => {
    const result = applyConfirmedFilter(docs, 'all');
    expect(result).to.have.length(4);
  });

  it("filter='confirmed' → customerConfirmed=true + Phase 6 デフォルトのみ返す", () => {
    const result = applyConfirmedFilter(docs, 'confirmed');
    expect(result.map(d => d.id)).to.deep.equal(['c1', 'p6']);
  });

  it("filter='unconfirmed' → customerConfirmed=false + Phase 6 needs=true を返す", () => {
    const result = applyConfirmedFilter(docs, 'unconfirmed');
    expect(result.map(d => d.id)).to.deep.equal(['u1', 'p6u']);
  });

  it('空配列は filter に関わらず空配列を返す', () => {
    expect(applyConfirmedFilter([], 'all')).to.deep.equal([]);
    expect(applyConfirmedFilter([], 'confirmed')).to.deep.equal([]);
    expect(applyConfirmedFilter([], 'unconfirmed')).to.deep.equal([]);
  });
});

describe('firestoreToDocument → isCustomerConfirmed 統合 (#273)', () => {
  // 本統合テストは PR #272 で集約した firestoreToDocument が
  // デュアルリードの各 variant を正しく保持して isCustomerConfirmed に渡せることを検証する。
  const baseData = {
    processedAt: Timestamp.now(),
    fileId: 'f',
    fileName: 'x.pdf',
    mimeType: 'application/pdf',
    fileUrl: 'gs://b/x.pdf',
    status: 'processed',
    totalPages: 1,
  };

  it('Phase 7 データ (customerConfirmed: true) → isCustomerConfirmed: true', () => {
    const doc = firestoreToDocument('d1', { ...baseData, customerConfirmed: true });
    expect(isCustomerConfirmed(doc)).to.equal(true);
  });

  it('Phase 6 データ (needsManualCustomerSelection: true, customerConfirmed 欠落) → isCustomerConfirmed: false', () => {
    const doc = firestoreToDocument('d2', { ...baseData, needsManualCustomerSelection: true });
    expect(isCustomerConfirmed(doc)).to.equal(false);
  });

  it('Phase 6 以前データ (両フィールド欠落) → isCustomerConfirmed: true (デフォルト)', () => {
    const doc = firestoreToDocument('d3', baseData);
    expect(isCustomerConfirmed(doc)).to.equal(true);
  });
});
