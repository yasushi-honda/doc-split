/**
 * PDF分析ユーティリティのテスト
 */

import { expect } from 'chai';
import {
  analyzePageOcr,
  detectPageChanges,
  generateSplitSuggestions,
  generateSegments,
  analyzePdf,
  generateSplitSummary,
  PageOcrData,
  PageAnalysisResult,
  MasterData,
} from '../src/utils/pdfAnalyzer';

// テスト用マスターデータ
const masterData: MasterData = {
  customers: [
    { id: 'cust1', name: '山田太郎', furigana: 'やまだたろう' },
    { id: 'cust2', name: '鈴木花子', furigana: 'すずきはなこ' },
    { id: 'cust3', name: '田中一郎', furigana: 'たなかいちろう' },
  ],
  documents: [
    { id: 'doc1', name: '介護保険被保険者証', category: '保険証' },
    { id: 'doc2', name: '請求書', category: '請求', keywords: ['請求', '金額'] },
    { id: 'doc3', name: '居宅サービス計画書', category: '計画書' },
  ],
  offices: [
    { id: 'off1', name: '株式会社テストケア', shortName: 'テストケア' },
    { id: 'off2', name: 'デイサービスさくら' },
  ],
};

// テスト用ページデータ
const page1: PageOcrData = {
  pageNumber: 1,
  text: '介護保険被保険者証\n被保険者: 山田太郎\n発行元: テストケア\n発行日: 2025/01/18',
};

const page2: PageOcrData = {
  pageNumber: 2,
  text: '介護保険被保険者証\n被保険者: 山田太郎\n（続き）',
};

const page3: PageOcrData = {
  pageNumber: 3,
  text: '請求書\n顧客: 鈴木花子\n発行元: デイサービスさくら\n金額: 10,000円',
};

const page4: PageOcrData = {
  pageNumber: 4,
  text: '請求書\n顧客: 鈴木花子\n（続き）',
};

describe('analyzePageOcr', () => {
  it('ページのOCR結果を分析', () => {
    const result = analyzePageOcr(page1, masterData);

    expect(result.pageNumber).to.equal(1);
    expect(result.documentType).to.equal('介護保険被保険者証');
    expect(result.primaryCustomer).to.not.be.null;
    expect(result.primaryCustomer!.name).to.equal('山田太郎');
    expect(result.officeName).to.equal('株式会社テストケア');
    expect(result.date).to.equal('2025/01/18');
  });

  it('顧客候補を複数検出', () => {
    const pageWithMultiple: PageOcrData = {
      pageNumber: 1,
      text: '山田太郎 鈴木花子',
    };
    const result = analyzePageOcr(pageWithMultiple, masterData);

    expect(result.customerCandidates.length).to.be.greaterThan(1);
  });

  it('情報がないページも処理', () => {
    const emptyPage: PageOcrData = {
      pageNumber: 1,
      text: 'これは関係ないテキストです',
    };
    const result = analyzePageOcr(emptyPage, masterData);

    expect(result.documentType).to.be.null;
    expect(result.primaryCustomer).to.be.null;
  });
});

describe('detectPageChanges', () => {
  it('顧客変更を検出', () => {
    const prev: PageAnalysisResult = {
      pageNumber: 1,
      documentType: '請求書',
      documentTypeScore: 100,
      customerCandidates: [],
      primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
      officeName: 'テストケア',
      officeScore: 100,
      date: null,
      changes: [],
    };

    const current: PageAnalysisResult = {
      pageNumber: 2,
      documentType: '請求書',
      documentTypeScore: 100,
      customerCandidates: [],
      primaryCustomer: { id: 'cust2', name: '鈴木花子', score: 95, matchType: 'exact', isDuplicate: false },
      officeName: 'テストケア',
      officeScore: 100,
      date: null,
      changes: [],
    };

    const changes = detectPageChanges(prev, current);

    expect(changes.length).to.equal(1);
    expect(changes[0]!.type).to.equal('customer');
    expect(changes[0]!.previousValue).to.equal('山田太郎');
    expect(changes[0]!.newValue).to.equal('鈴木花子');
  });

  it('書類タイプ変更を検出', () => {
    const prev: PageAnalysisResult = {
      pageNumber: 1,
      documentType: '介護保険被保険者証',
      documentTypeScore: 100,
      customerCandidates: [],
      primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
      officeName: null,
      officeScore: 0,
      date: null,
      changes: [],
    };

    const current: PageAnalysisResult = {
      pageNumber: 2,
      documentType: '請求書',
      documentTypeScore: 90,
      customerCandidates: [],
      primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
      officeName: null,
      officeScore: 0,
      date: null,
      changes: [],
    };

    const changes = detectPageChanges(prev, current);

    expect(changes.length).to.equal(1);
    expect(changes[0]!.type).to.equal('document_type');
  });

  it('複数の変更を検出', () => {
    const prev: PageAnalysisResult = {
      pageNumber: 1,
      documentType: '介護保険被保険者証',
      documentTypeScore: 100,
      customerCandidates: [],
      primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
      officeName: 'テストケア',
      officeScore: 100,
      date: null,
      changes: [],
    };

    const current: PageAnalysisResult = {
      pageNumber: 2,
      documentType: '請求書',
      documentTypeScore: 90,
      customerCandidates: [],
      primaryCustomer: { id: 'cust2', name: '鈴木花子', score: 95, matchType: 'exact', isDuplicate: false },
      officeName: 'デイサービスさくら',
      officeScore: 100,
      date: null,
      changes: [],
    };

    const changes = detectPageChanges(prev, current);

    expect(changes.length).to.equal(3);
    expect(changes.some((c) => c.type === 'customer')).to.be.true;
    expect(changes.some((c) => c.type === 'document_type')).to.be.true;
    expect(changes.some((c) => c.type === 'office')).to.be.true;
  });

  it('変更なしの場合は空配列', () => {
    const prev: PageAnalysisResult = {
      pageNumber: 1,
      documentType: '請求書',
      documentTypeScore: 100,
      customerCandidates: [],
      primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
      officeName: null,
      officeScore: 0,
      date: null,
      changes: [],
    };

    const current: PageAnalysisResult = {
      pageNumber: 2,
      documentType: '請求書',
      documentTypeScore: 100,
      customerCandidates: [],
      primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
      officeName: null,
      officeScore: 0,
      date: null,
      changes: [],
    };

    const changes = detectPageChanges(prev, current);
    expect(changes.length).to.equal(0);
  });

  it('前ページがnullの場合は空配列', () => {
    const current: PageAnalysisResult = {
      pageNumber: 1,
      documentType: '請求書',
      documentTypeScore: 100,
      customerCandidates: [],
      primaryCustomer: null,
      officeName: null,
      officeScore: 0,
      date: null,
      changes: [],
    };

    const changes = detectPageChanges(null, current);
    expect(changes.length).to.equal(0);
  });
});

describe('generateSplitSuggestions', () => {
  it('顧客変更時に分割候補を生成', () => {
    const pageAnalysis: PageAnalysisResult[] = [
      {
        pageNumber: 1,
        documentType: '請求書',
        documentTypeScore: 100,
        customerCandidates: [],
        primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
        officeName: null,
        officeScore: 0,
        date: null,
        changes: [],
      },
      {
        pageNumber: 2,
        documentType: '請求書',
        documentTypeScore: 100,
        customerCandidates: [],
        primaryCustomer: { id: 'cust2', name: '鈴木花子', score: 95, matchType: 'exact', isDuplicate: false },
        officeName: null,
        officeScore: 0,
        date: null,
        changes: [],
      },
    ];

    const suggestions = generateSplitSuggestions(pageAnalysis);

    expect(suggestions.length).to.equal(1);
    expect(suggestions[0]!.afterPageNumber).to.equal(1);
    expect(suggestions[0]!.reason).to.equal('customer_change');
    expect(suggestions[0]!.nextSegment.customerName).to.equal('鈴木花子');
  });

  it('信頼度が低い場合は候補を生成しない', () => {
    const pageAnalysis: PageAnalysisResult[] = [
      {
        pageNumber: 1,
        documentType: null,
        documentTypeScore: 0,
        customerCandidates: [],
        primaryCustomer: { id: 'cust1', name: '山田太郎', score: 50, matchType: 'fuzzy', isDuplicate: false },
        officeName: null,
        officeScore: 0,
        date: null,
        changes: [],
      },
      {
        pageNumber: 2,
        documentType: null,
        documentTypeScore: 0,
        customerCandidates: [],
        primaryCustomer: { id: 'cust2', name: '鈴木花子', score: 50, matchType: 'fuzzy', isDuplicate: false },
        officeName: null,
        officeScore: 0,
        date: null,
        changes: [],
      },
    ];

    const suggestions = generateSplitSuggestions(pageAnalysis, 70);

    expect(suggestions.length).to.equal(0);
  });
});

describe('generateSegments', () => {
  it('分割候補に基づいてセグメントを生成', () => {
    const pageAnalysis: PageAnalysisResult[] = [
      {
        pageNumber: 1,
        documentType: '介護保険被保険者証',
        documentTypeScore: 100,
        customerCandidates: [{ id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false }],
        primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
        officeName: 'テストケア',
        officeScore: 100,
        date: '2025/01/18',
        changes: [],
      },
      {
        pageNumber: 2,
        documentType: '介護保険被保険者証',
        documentTypeScore: 100,
        customerCandidates: [{ id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false }],
        primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
        officeName: 'テストケア',
        officeScore: 100,
        date: null,
        changes: [],
      },
      {
        pageNumber: 3,
        documentType: '請求書',
        documentTypeScore: 90,
        customerCandidates: [{ id: 'cust2', name: '鈴木花子', score: 95, matchType: 'exact', isDuplicate: false }],
        primaryCustomer: { id: 'cust2', name: '鈴木花子', score: 95, matchType: 'exact', isDuplicate: false },
        officeName: 'デイサービスさくら',
        officeScore: 100,
        date: null,
        changes: [],
      },
    ];

    const splitSuggestions = [
      {
        afterPageNumber: 2,
        reason: 'customer_change' as const,
        confidence: 95,
        changes: [{ type: 'customer' as const, previousValue: '山田太郎', newValue: '鈴木花子', confidence: 95 }],
        nextSegment: { documentType: '請求書', customerName: '鈴木花子', officeName: 'デイサービスさくら', date: null },
      },
    ];

    const segments = generateSegments(pageAnalysis, splitSuggestions);

    expect(segments.length).to.equal(2);

    // 最初のセグメント
    expect(segments[0]!.startPage).to.equal(1);
    expect(segments[0]!.endPage).to.equal(2);
    expect(segments[0]!.customerName).to.equal('山田太郎');
    expect(segments[0]!.documentType).to.equal('介護保険被保険者証');

    // 2番目のセグメント
    expect(segments[1]!.startPage).to.equal(3);
    expect(segments[1]!.endPage).to.equal(3);
    expect(segments[1]!.customerName).to.equal('鈴木花子');
    expect(segments[1]!.documentType).to.equal('請求書');
  });

  it('分割なしの場合は1セグメント', () => {
    const pageAnalysis: PageAnalysisResult[] = [
      {
        pageNumber: 1,
        documentType: '請求書',
        documentTypeScore: 100,
        customerCandidates: [{ id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false }],
        primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
        officeName: null,
        officeScore: 0,
        date: null,
        changes: [],
      },
      {
        pageNumber: 2,
        documentType: '請求書',
        documentTypeScore: 100,
        customerCandidates: [{ id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false }],
        primaryCustomer: { id: 'cust1', name: '山田太郎', score: 100, matchType: 'exact', isDuplicate: false },
        officeName: null,
        officeScore: 0,
        date: null,
        changes: [],
      },
    ];

    const segments = generateSegments(pageAnalysis, []);

    expect(segments.length).to.equal(1);
    expect(segments[0]!.startPage).to.equal(1);
    expect(segments[0]!.endPage).to.equal(2);
    expect(segments[0]!.pageCount).to.equal(2);
  });
});

describe('analyzePdf', () => {
  it('PDFを全体的に分析', () => {
    const pages: PageOcrData[] = [page1, page2, page3, page4];
    const result = analyzePdf(pages, masterData);

    expect(result.totalPages).to.equal(4);
    expect(result.pageAnalysis.length).to.equal(4);
    expect(result.shouldSplit).to.be.true;
    expect(result.segments.length).to.be.greaterThan(1);
  });

  it('空のページ配列を処理', () => {
    const result = analyzePdf([], masterData);

    expect(result.totalPages).to.equal(0);
    expect(result.shouldSplit).to.be.false;
    expect(result.segments.length).to.equal(0);
  });

  it('単一ページを処理', () => {
    const result = analyzePdf([page1], masterData);

    expect(result.totalPages).to.equal(1);
    expect(result.shouldSplit).to.be.false;
    expect(result.segments.length).to.equal(1);
  });
});

describe('generateSplitSummary', () => {
  it('分割サマリーを生成', () => {
    const pages: PageOcrData[] = [page1, page2, page3];
    const analysisResult = analyzePdf(pages, masterData);
    const summary = generateSplitSummary(analysisResult);

    expect(summary.shouldSplit).to.equal(analysisResult.shouldSplit);
    expect(summary.segmentCount).to.equal(analysisResult.segments.length);
    expect(summary.segmentDetails.length).to.equal(analysisResult.segments.length);
  });

  it('分割不要の場合のサマリー', () => {
    const pages: PageOcrData[] = [page1, page2];
    const analysisResult = analyzePdf(pages, masterData);
    const summary = generateSplitSummary(analysisResult);

    if (!analysisResult.shouldSplit) {
      expect(summary.reason).to.equal('分割不要');
    }
  });
});
