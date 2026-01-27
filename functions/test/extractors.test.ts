/**
 * 強化版情報抽出ユーティリティのテスト
 */

import { expect } from 'chai';
import {
  extractDocumentTypeEnhanced,
  extractOfficeNameEnhanced,
  extractCustomerCandidates,
  extractOfficeCandidates,
  aggregateCustomerCandidates,
  aggregateOfficeCandidates,
  extractDateEnhanced,
  ensureCustomerEntry,
  extractAllInformation,
  DocumentMaster,
  OfficeMaster,
  CustomerMaster,
  OfficeExtractionResultWithCandidates,
} from '../src/utils/extractors';

// テスト用マスターデータ
const documentMasters: DocumentMaster[] = [
  { id: 'doc1', name: '介護保険被保険者証', category: '保険証' },
  { id: 'doc2', name: '居宅サービス計画書', category: '計画書', keywords: ['ケアプラン', '計画'] },
  { id: 'doc3', name: '請求書', category: '請求', keywords: ['請求', '金額'] },
  { id: 'doc4', name: '訪問介護記録', category: '記録' },
];

const officeMasters: OfficeMaster[] = [
  { id: 'off1', name: '株式会社テストケア', shortName: 'テストケア', isDuplicate: false },
  { id: 'off2', name: '医療法人社団あおぞら会', shortName: 'あおぞら会', isDuplicate: false },
  { id: 'off3', name: 'デイサービスさくら', isDuplicate: false },
  { id: 'off4', name: '訪問介護センター北', isDuplicate: true },
  { id: 'off5', name: '訪問介護センター北', isDuplicate: true },
];

const customerMasters: CustomerMaster[] = [
  { id: 'cust1', name: '山田太郎', furigana: 'やまだたろう' },
  { id: 'cust2', name: '山田花子', furigana: 'やまだはなこ' },
  { id: 'cust3', name: '鈴木一郎', furigana: 'すずきいちろう' },
  { id: 'cust4', name: '田中太郎', furigana: 'たなかたろう', isDuplicate: true },
  { id: 'cust5', name: '田中太郎', furigana: 'たなかたろう', isDuplicate: true },
];

describe('extractDocumentTypeEnhanced', () => {
  it('完全一致で書類名を抽出', () => {
    const ocrText = '介護保険被保険者証\n被保険者番号: 12345';
    const result = extractDocumentTypeEnhanced(ocrText, documentMasters);

    expect(result.documentType).to.equal('介護保険被保険者証');
    expect(result.score).to.equal(100);
    expect(result.matchType).to.equal('exact');
  });

  it('部分一致で書類名を抽出', () => {
    const ocrText = '居宅サービス計画書（第1表）\n作成日: 令和7年1月';
    const result = extractDocumentTypeEnhanced(ocrText, documentMasters);

    expect(result.documentType).to.equal('居宅サービス計画書');
    expect(result.matchType).to.equal('exact');
  });

  it('キーワードで書類名を抽出', () => {
    const ocrText = 'ケアプラン\n利用者: 山田太郎\n作成日: 2025/01/18';
    const result = extractDocumentTypeEnhanced(ocrText, documentMasters);

    expect(result.documentType).to.equal('居宅サービス計画書');
    expect(result.keywords).to.include('ケアプラン');
  });

  it('マッチしない場合はnullを返す', () => {
    const ocrText = 'これは全く関係ないテキストです';
    const result = extractDocumentTypeEnhanced(ocrText, documentMasters);

    expect(result.documentType).to.be.null;
    expect(result.matchType).to.equal('none');
  });

  it('空のマスターリストではnullを返す', () => {
    const result = extractDocumentTypeEnhanced('何かのテキスト', []);
    expect(result.documentType).to.be.null;
  });
});

describe('extractOfficeNameEnhanced', () => {
  it('完全一致で事業所名を抽出', () => {
    const ocrText = '発行元: 株式会社テストケア\n電話: 03-1234-5678';
    const result = extractOfficeNameEnhanced(ocrText, officeMasters);

    expect(result.officeName).to.equal('株式会社テストケア');
    expect(result.score).to.equal(100);
    expect(result.matchType).to.equal('exact');
  });

  it('短縮名で事業所名を抽出', () => {
    const ocrText = 'テストケア　担当: 佐藤';
    const result = extractOfficeNameEnhanced(ocrText, officeMasters);

    expect(result.officeName).to.equal('株式会社テストケア');
    expect(result.score).to.equal(95);
    expect(result.matchType).to.equal('exact');
  });

  it('全角文字を含むテキストでも抽出', () => {
    const ocrText = 'デイサービスさくら　ご利用明細';
    const result = extractOfficeNameEnhanced(ocrText, officeMasters);

    expect(result.officeName).to.equal('デイサービスさくら');
  });

  it('マッチしない場合はnullを返す', () => {
    const ocrText = '不明な事業所からの書類';
    const result = extractOfficeNameEnhanced(ocrText, officeMasters);

    expect(result.officeName).to.be.null;
    expect(result.matchType).to.equal('none');
  });
});

describe('extractCustomerCandidates', () => {
  it('完全一致で顧客を抽出', () => {
    const ocrText = '利用者: 山田太郎 様\n住所: 東京都';
    const result = extractCustomerCandidates(ocrText, customerMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.name).to.equal('山田太郎');
    expect(result.bestMatch!.matchType).to.equal('exact');
  });

  it('ふりがなで顧客を抽出', () => {
    const ocrText = 'ご利用者様: すずきいちろう';
    const result = extractCustomerCandidates(ocrText, customerMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.name).to.equal('鈴木一郎');
  });

  it('複数候補を返す', () => {
    const ocrText = '山田太郎　山田花子　鈴木一郎';
    const result = extractCustomerCandidates(ocrText, customerMasters);

    expect(result.candidates.length).to.be.greaterThan(1);
    expect(result.hasMultipleCandidates).to.be.true;
  });

  it('同姓同名フラグがある場合は手動選択が必要', () => {
    const ocrText = '田中太郎 様';
    const result = extractCustomerCandidates(ocrText, customerMasters);

    expect(result.needsManualSelection).to.be.true;
    expect(result.candidates.some((c) => c.isDuplicate)).to.be.true;
  });

  it('ページ番号を記録', () => {
    const ocrText = '山田太郎';
    const result = extractCustomerCandidates(ocrText, customerMasters, { pageNumber: 1 });

    expect(result.bestMatch!.pageNumbers).to.deep.equal([1]);
  });

  it('マッチしない場合は空の結果を返す', () => {
    const ocrText = '該当なし';
    const result = extractCustomerCandidates(ocrText, customerMasters);

    expect(result.bestMatch).to.be.null;
    expect(result.candidates.length).to.equal(0);
  });
});

describe('aggregateCustomerCandidates', () => {
  it('複数ページの結果を集約', () => {
    const page1Result = extractCustomerCandidates('山田太郎', customerMasters, { pageNumber: 1 });
    const page2Result = extractCustomerCandidates('山田太郎 山田花子', customerMasters, { pageNumber: 2 });

    const aggregated = aggregateCustomerCandidates([
      { pageNumber: 1, result: page1Result },
      { pageNumber: 2, result: page2Result },
    ]);

    expect(aggregated.bestMatch!.name).to.equal('山田太郎');
    // 山田太郎は両ページに出現
    const taro = aggregated.candidates.find((c) => c.name === '山田太郎');
    expect(taro!.pageNumbers).to.include(1);
    expect(taro!.pageNumbers).to.include(2);
  });

  it('スコアが高い方を優先', () => {
    // 低スコアのページ
    const page1Result = extractCustomerCandidates('山田', customerMasters, { pageNumber: 1 });
    // 高スコアのページ
    const page2Result = extractCustomerCandidates('山田太郎様', customerMasters, { pageNumber: 2 });

    const aggregated = aggregateCustomerCandidates([
      { pageNumber: 1, result: page1Result },
      { pageNumber: 2, result: page2Result },
    ]);

    const taro = aggregated.candidates.find((c) => c.name === '山田太郎');
    expect(taro!.score).to.be.greaterThanOrEqual(90);
  });
});

describe('extractDateEnhanced', () => {
  it('令和形式の日付を抽出', () => {
    const ocrText = '発行日: 令和7年1月18日';
    const result = extractDateEnhanced(ocrText, '発行日');

    expect(result.date).to.not.be.null;
    expect(result.date!.getFullYear()).to.equal(2025);
    expect(result.formattedDate).to.equal('2025/01/18');
  });

  it('西暦形式の日付を抽出', () => {
    const ocrText = '作成日: 2025/01/18';
    const result = extractDateEnhanced(ocrText);

    expect(result.date).to.not.be.null;
    expect(result.formattedDate).to.equal('2025/01/18');
  });

  it('複数日付から最適なものを選択', () => {
    const ocrText = '作成日: 2025/01/01 発行日: 2025/01/18';
    const result = extractDateEnhanced(ocrText, '発行日');

    expect(result.date!.getDate()).to.equal(18);
    expect(result.allCandidates.length).to.equal(2);
  });

  it('全角日付も処理', () => {
    const ocrText = '日付：２０２５年１月１８日';
    const result = extractDateEnhanced(ocrText);

    expect(result.date).to.not.be.null;
    expect(result.date!.getFullYear()).to.equal(2025);
  });

  it('日付がない場合はnullを返す', () => {
    const ocrText = '日付情報なし';
    const result = extractDateEnhanced(ocrText);

    expect(result.date).to.be.null;
    expect(result.formattedDate).to.be.null;
  });
});

describe('ensureCustomerEntry', () => {
  it('有効な抽出結果からエントリを生成', () => {
    const extractionResult = extractCustomerCandidates('山田太郎', customerMasters);
    const entry = ensureCustomerEntry(extractionResult, 'doc123');

    expect(entry).to.not.be.null;
    expect(entry!.customerName).to.equal('山田太郎');
    expect(entry!.isConfirmed).to.be.true;
  });

  it('手動選択が必要な場合はisConfirmed=false', () => {
    const extractionResult = extractCustomerCandidates('田中太郎', customerMasters);
    const entry = ensureCustomerEntry(extractionResult, 'doc123');

    expect(entry).to.not.be.null;
    expect(entry!.isConfirmed).to.be.false;
  });

  it('マッチなしの場合はnullを返す', () => {
    const extractionResult = extractCustomerCandidates('該当なし', customerMasters);
    const entry = ensureCustomerEntry(extractionResult, 'doc123');

    expect(entry).to.be.null;
  });
});

describe('extractAllInformation', () => {
  it('全情報を一括抽出', () => {
    const ocrText = `
      介護保険被保険者証

      被保険者: 山田太郎
      発行元: 株式会社テストケア
      発行日: 令和7年1月18日
    `;

    const result = extractAllInformation(
      ocrText,
      { documents: documentMasters, offices: officeMasters, customers: customerMasters },
      { dateMarker: '発行日' }
    );

    expect(result.document.documentType).to.equal('介護保険被保険者証');
    expect(result.office.officeName).to.equal('株式会社テストケア');
    expect(result.customer.bestMatch!.name).to.equal('山田太郎');
    expect(result.date.formattedDate).to.equal('2025/01/18');
  });
});

describe('extractOfficeCandidates', () => {
  it('事業所候補を複数抽出', () => {
    const ocrText = '株式会社テストケア様 送付先: デイサービスさくら';
    const result = extractOfficeCandidates(ocrText, officeMasters);

    expect(result.candidates.length).to.be.greaterThanOrEqual(2);
    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.name).to.equal('株式会社テストケア');
  });

  it('同名事業所でneedsManualSelectionがtrue', () => {
    const ocrText = '訪問介護センター北';
    const result = extractOfficeCandidates(ocrText, officeMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.isDuplicate).to.be.true;
    expect(result.needsManualSelection).to.be.true;
  });

  it('短縮名でも検出', () => {
    const ocrText = 'テストケア　担当: 佐藤';
    const result = extractOfficeCandidates(ocrText, officeMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.name).to.equal('株式会社テストケア');
  });

  it('マッチなしの場合は空の候補', () => {
    const ocrText = '該当する事業所なし';
    const result = extractOfficeCandidates(ocrText, officeMasters);

    expect(result.candidates.length).to.equal(0);
    expect(result.bestMatch).to.be.null;
  });
});

describe('aggregateOfficeCandidates', () => {
  it('複数ページの事業所候補を集約', () => {
    const pageResults: Array<{ pageNumber: number; result: OfficeExtractionResultWithCandidates }> = [
      {
        pageNumber: 1,
        result: {
          bestMatch: { id: 'off1', name: '株式会社テストケア', score: 90, matchType: 'exact', isDuplicate: false },
          candidates: [
            { id: 'off1', name: '株式会社テストケア', score: 90, matchType: 'exact', isDuplicate: false },
            { id: 'off3', name: 'デイサービスさくら', score: 75, matchType: 'fuzzy', isDuplicate: false },
          ],
          hasMultipleCandidates: true,
          needsManualSelection: false,
        },
      },
      {
        pageNumber: 2,
        result: {
          bestMatch: { id: 'off1', name: '株式会社テストケア', score: 100, matchType: 'exact', isDuplicate: false },
          candidates: [
            { id: 'off1', name: '株式会社テストケア', score: 100, matchType: 'exact', isDuplicate: false },
          ],
          hasMultipleCandidates: false,
          needsManualSelection: false,
        },
      },
    ];

    const result = aggregateOfficeCandidates(pageResults);

    // 最高スコアが採用される
    expect(result.bestMatch!.score).to.equal(100);
    expect(result.bestMatch!.name).to.equal('株式会社テストケア');
    // 複数の候補が集約される
    expect(result.candidates.length).to.equal(2);
    // ページ番号が集約される
    const off1 = result.candidates.find((c) => c.id === 'off1');
    expect(off1!.pageNumbers).to.deep.equal([1, 2]);
  });

  it('同名事業所がある場合needsManualSelection=true', () => {
    const pageResults: Array<{ pageNumber: number; result: OfficeExtractionResultWithCandidates }> = [
      {
        pageNumber: 1,
        result: {
          bestMatch: { id: 'off4', name: '訪問介護センター北', score: 100, matchType: 'exact', isDuplicate: true },
          candidates: [
            { id: 'off4', name: '訪問介護センター北', score: 100, matchType: 'exact', isDuplicate: true },
          ],
          hasMultipleCandidates: false,
          needsManualSelection: true,
        },
      },
    ];

    const result = aggregateOfficeCandidates(pageResults);

    expect(result.needsManualSelection).to.be.true;
  });

  it('スコア差が小さい場合needsManualSelection=true', () => {
    const pageResults: Array<{ pageNumber: number; result: OfficeExtractionResultWithCandidates }> = [
      {
        pageNumber: 1,
        result: {
          bestMatch: { id: 'off1', name: '株式会社テストケア', score: 85, matchType: 'partial', isDuplicate: false },
          candidates: [
            { id: 'off1', name: '株式会社テストケア', score: 85, matchType: 'partial', isDuplicate: false },
            { id: 'off3', name: 'デイサービスさくら', score: 80, matchType: 'partial', isDuplicate: false },
          ],
          hasMultipleCandidates: true,
          needsManualSelection: false,
        },
      },
    ];

    const result = aggregateOfficeCandidates(pageResults);

    // スコア差が10以内なのでneedsManualSelection=true
    expect(result.needsManualSelection).to.be.true;
  });

  it('空の結果を処理', () => {
    const pageResults: Array<{ pageNumber: number; result: OfficeExtractionResultWithCandidates }> = [];

    const result = aggregateOfficeCandidates(pageResults);

    expect(result.bestMatch).to.be.null;
    expect(result.candidates.length).to.equal(0);
    expect(result.needsManualSelection).to.be.false;
  });
});
