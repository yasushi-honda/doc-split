/**
 * PDF分割時のcareManagerフィールド伝播テスト
 *
 * TDD: #172 PDF分割時にcareManagerNameが正しく伝播されない
 *
 * 根本原因: pdfOperations.tsでFirestoreに書き込む際、
 * フィールド名が「careManagerName」になっているが、
 * Documentスキーマでは「careManager」+「careManagerKey」が正しい。
 */

import { expect } from 'chai';

/**
 * pdfOperations.tsのFirestore書き込みデータを構築するロジックを
 * 純粋関数として抽出し、テスト可能にする。
 *
 * 実際のFirestore書き込みはCloud Function内で行われるため、
 * ここではデータ構築ロジックの正しさを検証する。
 */
import { buildSplitDocumentData } from '../src/pdf/splitDocumentBuilder';

describe('PDF分割 - careManagerフィールド伝播 (#172)', () => {
  const baseSegment = {
    startPage: 1,
    endPage: 3,
    documentType: '請求書',
    customerName: '田村 勝義',
    customerId: 'cust-001',
    officeName: 'テスト事業所',
    officeId: 'office-001',
    customerCandidates: [],
    officeCandidates: [],
    isDuplicateCustomer: false,
    careManagerName: '長谷川 由紀',
  };

  describe('careManagerフィールドの正しいマッピング', () => {
    it('careManagerNameがcareManagerフィールドとして保存される', () => {
      const data = buildSplitDocumentData(baseSegment);
      expect(data.careManager).to.equal('長谷川 由紀');
    });

    it('careManagerKeyがcareManagerから派生して設定される', () => {
      const data = buildSplitDocumentData(baseSegment);
      expect(data.careManagerKey).to.equal('長谷川 由紀');
    });

    it('careManagerNameフィールドはFirestoreに保存されない', () => {
      const data = buildSplitDocumentData(baseSegment);
      expect(data).to.not.have.property('careManagerName');
    });
  });

  describe('careManagerNameが未設定の場合', () => {
    it('careManagerNameがnullの場合、careManagerはnullになる', () => {
      const segment = { ...baseSegment, careManagerName: null };
      const data = buildSplitDocumentData(segment);
      expect(data.careManager).to.be.null;
      expect(data.careManagerKey).to.equal('');
    });

    it('careManagerNameがundefinedの場合、careManagerはnullになる', () => {
      const segment = { ...baseSegment, careManagerName: undefined };
      const data = buildSplitDocumentData(segment);
      expect(data.careManager).to.be.null;
      expect(data.careManagerKey).to.equal('');
    });

    it('careManagerNameが空文字の場合、careManagerはnullになる', () => {
      const segment = { ...baseSegment, careManagerName: '' };
      const data = buildSplitDocumentData(segment);
      expect(data.careManager).to.be.null;
      expect(data.careManagerKey).to.equal('');
    });
  });

  describe('他のフィールドとの整合性', () => {
    it('customerName, documentType等は正しく含まれる', () => {
      const data = buildSplitDocumentData(baseSegment);
      expect(data.customerName).to.equal('田村 勝義');
      expect(data.documentType).to.equal('請求書');
      expect(data.customerId).to.equal('cust-001');
      expect(data.officeName).to.equal('テスト事業所');
      expect(data.customerConfirmed).to.be.true;
    });
  });
});
