/**
 * splitDocumentBuilder テスト (Issue #526)
 *
 * buildSplitDocumentData の customerConfirmed/officeConfirmed/documentTypeConfirmed は
 * 従来無条件 true 固定だったが、Issue #526 のOCR再処理連携で「未確認フィールドを
 * OCRが補完する」設計にするため、フロントエンドから明示送信された値をそのまま
 * 反映するよう変更する（サーバー側でID有無から推測しない、Codexセカンドオピニオン反映）。
 */

import { expect } from 'chai';
import { buildSplitDocumentData, SplitSegmentInput } from '../src/pdf/splitDocumentBuilder';

const baseSegment: SplitSegmentInput = {
  startPage: 1,
  endPage: 3,
  documentType: '請求書',
  customerName: '田中太郎',
  customerId: 'cust_tanaka',
  officeName: 'ケアサポートきらり',
  officeId: 'office_kirari',
};

describe('buildSplitDocumentData confirmed フラグ (#526)', () => {
  it('customerConfirmed=true を送信 → そのまま true が反映される', () => {
    const result = buildSplitDocumentData({ ...baseSegment, customerConfirmed: true });
    expect(result.customerConfirmed).to.equal(true);
  });

  it('customerConfirmed=false を送信 → そのまま false が反映される（従来の無条件 true 固定からの変更点）', () => {
    const result = buildSplitDocumentData({ ...baseSegment, customerConfirmed: false });
    expect(result.customerConfirmed).to.equal(false);
  });

  it('customerConfirmed 未送信（旧クライアント想定）→ false にフォールバックする', () => {
    // baseSegment は customerConfirmed を含まない（旧クライアントのリクエスト相当）
    const result = buildSplitDocumentData(baseSegment);
    expect(result.customerConfirmed).to.equal(false);
  });

  it('officeConfirmed=true を送信 → そのまま true が反映される', () => {
    const result = buildSplitDocumentData({ ...baseSegment, officeConfirmed: true });
    expect(result.officeConfirmed).to.equal(true);
  });

  it('officeConfirmed=false を送信 → そのまま false が反映される', () => {
    const result = buildSplitDocumentData({ ...baseSegment, officeConfirmed: false });
    expect(result.officeConfirmed).to.equal(false);
  });

  it('documentTypeConfirmed=true を送信 → そのまま true が反映される', () => {
    const result = buildSplitDocumentData({ ...baseSegment, documentTypeConfirmed: true });
    expect(result.documentTypeConfirmed).to.equal(true);
  });

  it('documentTypeConfirmed=false を送信 → そのまま false が反映される', () => {
    const result = buildSplitDocumentData({ ...baseSegment, documentTypeConfirmed: false });
    expect(result.documentTypeConfirmed).to.equal(false);
  });

  it('3フラグとも未送信 → 全て false にフォールバックする（安全側デフォルト）', () => {
    const result = buildSplitDocumentData(baseSegment);
    expect(result.customerConfirmed).to.equal(false);
    expect(result.officeConfirmed).to.equal(false);
    expect(result.documentTypeConfirmed).to.equal(false);
  });
});

describe('buildSplitDocumentData 既存フィールド (回帰確認)', () => {
  it('careManagerName が careManager/careManagerKey に反映される', () => {
    const result = buildSplitDocumentData({ ...baseSegment, careManagerName: '五十嵐恵' });
    expect(result.careManager).to.equal('五十嵐恵');
    expect(result.careManagerKey).to.equal('五十嵐恵');
  });

  it('customerId/officeId が反映される', () => {
    const result = buildSplitDocumentData(baseSegment);
    expect(result.customerId).to.equal('cust_tanaka');
    expect(result.officeId).to.equal('office_kirari');
  });

  it('documentType/customerName/officeName がそのまま反映される', () => {
    const result = buildSplitDocumentData(baseSegment);
    expect(result.documentType).to.equal('請求書');
    expect(result.customerName).to.equal('田中太郎');
    expect(result.officeName).to.equal('ケアサポートきらり');
  });
});
