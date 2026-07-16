/**
 * 複製コピーを手動分割した場合、生成される子docにdistributionIdが伝播しないことの
 * 契約テスト(kanameone現場要件「複数顧客FAX複製機能」、GOAL.md D4/AC-h)
 *
 * 「配信マーカーの役目は完了、子は顧客固有の精製物」という設計(D4)により、分割で
 * 生成される子ドキュメントにdistributionIdを引き継いではならない。pdfOperations.tsの
 * splitPdf子ドキュメントpayloadは`...docData`(親の生データ)を丸ごとspreadする実装には
 * なっておらず、フィールドを明示列挙して構築している(buildSplitDocumentData + 個別
 * literal fields)ため、distributionIdは構造的に伝播しない。本テストはこの不変条件を
 * ソース文字列レベル+実際の関数呼出しの両方でlock-inし、将来`...docData`スプレッドが
 * 導入される回帰を検知する。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildSplitDocumentData, type SplitSegmentInput } from '../src/pdf/splitDocumentBuilder';

describe('複製コピー分割時のdistributionId非伝播 (GOAL.md D4/AC-h)', () => {
  it('buildSplitDocumentData()の戻り値にdistributionIdキーが含まれない', () => {
    const segment: SplitSegmentInput = {
      startPage: 1,
      endPage: 2,
      documentType: '請求書',
      customerName: '田中太郎',
      customerId: 'cust-a',
      officeName: 'ケアサポートきらり',
      officeId: 'office-1',
    };

    const result = buildSplitDocumentData(segment);
    expect(Object.prototype.hasOwnProperty.call(result, 'distributionId')).to.equal(false);
  });

  it('segment入力にdistributionId相当のプロパティが紛れ込んでいても出力に伝播しない(field allowlist方式であることの確認)', () => {
    const segmentWithStrayField = {
      startPage: 1,
      endPage: 2,
      documentType: '請求書',
      customerName: '田中花子',
      officeName: 'ケアサポートきらり',
      // SplitSegmentInputに存在しないフィールド(将来の呼出元の実装ミスを模擬)
      distributionId: 'orig-doc-1',
    } as unknown as SplitSegmentInput;

    const result = buildSplitDocumentData(segmentWithStrayField);
    expect(Object.prototype.hasOwnProperty.call(result, 'distributionId')).to.equal(false);
  });

  it('pdfOperations.tsのsplitPdf子doc payload構築に`...docData`(親の生データ)の丸ごとspreadが存在しない', () => {
    const absPath = resolve(process.cwd(), 'src/pdf/pdfOperations.ts');
    const source = readFileSync(absPath, 'utf-8');
    expect(
      source,
      '親docDataを丸ごとspreadすると、distributionId等の配信専用フィールドが子docへ意図せず伝播しうる'
    ).to.not.match(/\.\.\.docData,/);
  });

  it('pdfOperations.ts/splitDocumentBuilder.tsのソースにdistributionIdへの参照が存在しない(明示的な伝播コードが書かれていないことの回帰確認)', () => {
    for (const relPath of ['src/pdf/pdfOperations.ts', 'src/pdf/splitDocumentBuilder.ts']) {
      const source = readFileSync(resolve(process.cwd(), relPath), 'utf-8');
      expect(source, `${relPath}にdistributionIdへの参照があってはならない`).to.not.match(/distributionId/);
    }
  });
});
