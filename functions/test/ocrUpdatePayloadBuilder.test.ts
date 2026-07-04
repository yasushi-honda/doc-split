/**
 * ocrUpdatePayloadBuilder.ts のテスト (Issue #526 D1)
 *
 * processDocument()から切り出した純粋関数。既存 processDocument() の
 * Firestore update payload構築ロジックと出力が一致すること(挙動不変)をlock-inする。
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import {
  buildOcrExtractionUpdatePayload,
  type OcrUpdatePayloadInputs,
} from '../src/ocr/ocrUpdatePayloadBuilder';
import type { RawPageOcrResult } from '../src/ocr/buildPageResult';

const FIXED_EXTRACTED_AT = admin.firestore.FieldValue.serverTimestamp();

function makeInputs(overrides: Partial<OcrUpdatePayloadInputs> = {}): OcrUpdatePayloadInputs {
  const pageResults: RawPageOcrResult[] = [
    { text: 'page1 text', truncated: false, pageNumber: 1, inputTokens: 10, outputTokens: 5 },
  ];

  return {
    documentTypeResult: {
      documentType: '請求書',
      category: 'billing',
      score: 90,
      matchType: 'exact',
      keywords: ['請求'],
    },
    customerResult: {
      bestMatch: {
        id: 'cust-1',
        name: '山田太郎',
        score: 95,
        matchType: 'exact',
        isDuplicate: false,
        careManagerName: '佐藤ケアマネ',
      },
      candidates: [
        {
          id: 'cust-1',
          name: '山田太郎',
          score: 95,
          matchType: 'exact',
          isDuplicate: false,
          careManagerName: '佐藤ケアマネ',
        },
      ],
      hasMultipleCandidates: false,
      needsManualSelection: false,
    },
    officeResult: {
      bestMatch: {
        id: 'office-1',
        name: 'テスト事業所',
        shortName: 'テスト',
        score: 88,
        matchType: 'exact',
        isDuplicate: false,
      },
      candidates: [
        {
          id: 'office-1',
          name: 'テスト事業所',
          shortName: 'テスト',
          score: 88,
          matchType: 'exact',
          isDuplicate: false,
        },
      ],
      hasMultipleCandidates: false,
      needsManualSelection: false,
    },
    dateResult: {
      date: new Date('2026-01-15T00:00:00Z'),
      formattedDate: '2026-01-15',
      source: 'ocr',
      pattern: 'yyyy-mm-dd',
      confidence: 80,
      allCandidates: [],
    },
    displayFileName: '請求書_山田太郎_20260115.pdf',
    savedOcrResult: 'page1 text',
    ocrResultUrl: null,
    pageResults,
    totalPages: 1,
    suggestedNewOffice: null,
    modelId: 'gemini-test-model',
    extractedAt: FIXED_EXTRACTED_AT,
    ...overrides,
  };
}

describe('buildOcrExtractionUpdatePayload', () => {
  it('抽出結果が正常な場合、全フィールドを期待通りに構築する', () => {
    const payload = buildOcrExtractionUpdatePayload(makeInputs());

    expect(payload.displayFileName).to.equal('請求書_山田太郎_20260115.pdf');
    expect(payload.ocrResult).to.equal('page1 text');
    expect(payload.ocrResultUrl).to.equal(null);
    expect(payload.pageResults).to.have.lengthOf(1);
    expect(payload.documentType).to.equal('請求書');
    expect(payload.customerName).to.equal('山田太郎');
    expect(payload.customerId).to.equal('cust-1');
    expect(payload.careManager).to.equal('佐藤ケアマネ');
    expect(payload.officeName).to.equal('テスト事業所');
    expect(payload.officeId).to.equal('office-1');
    expect(payload.fileDate).to.deep.equal(new Date('2026-01-15T00:00:00Z'));
    expect(payload.fileDateFormatted).to.equal('2026-01-15');
    expect(payload.isDuplicateCustomer).to.equal(false);
    expect(payload.needsManualCustomerSelection).to.equal(false);
    expect(payload.customerConfirmed).to.equal(true);
    expect(payload.confirmedBy).to.equal(null);
    expect(payload.confirmedAt).to.equal(null);
    expect(payload.allCustomerCandidates).to.equal('山田太郎');
    expect(payload.customerCandidates).to.deep.equal([
      {
        customerId: 'cust-1',
        customerName: '山田太郎',
        isDuplicate: false,
        score: 95,
        matchType: 'exact',
        careManagerName: '佐藤ケアマネ',
      },
    ]);
    expect(payload.officeConfirmed).to.equal(true);
    expect(payload.officeConfirmedBy).to.equal(null);
    expect(payload.officeConfirmedAt).to.equal(null);
    expect(payload.officeCandidates).to.deep.equal([
      {
        officeId: 'office-1',
        officeName: 'テスト事業所',
        shortName: 'テスト',
        isDuplicate: false,
        score: 88,
        matchType: 'exact',
      },
    ]);
    expect(payload.suggestedNewOffice).to.equal(null);
    expect(payload.totalPages).to.equal(1);
    expect(payload.category).to.equal('billing');
    expect(payload.extractionScores).to.deep.equal({
      documentType: 90,
      customerName: 95,
      officeName: 88,
      date: 80,
    });
    expect(payload.extractionDetails).to.deep.equal({
      documentMatchType: 'exact',
      documentKeywords: ['請求'],
      customerMatchType: 'exact',
      officeMatchType: 'exact',
      datePattern: 'yyyy-mm-dd',
      dateSource: 'ocr',
    });
    expect(payload.ocrExtraction).to.deep.equal({
      version: 'gemini-test-model',
      extractedAt: FIXED_EXTRACTED_AT,
      customer: {
        suggestedValue: '山田太郎',
        suggestedId: 'cust-1',
        confidence: 95,
        matchType: 'exact',
      },
      office: {
        suggestedValue: 'テスト事業所',
        suggestedId: 'office-1',
        confidence: 88,
        matchType: 'exact',
      },
      documentType: {
        suggestedValue: '請求書',
        suggestedId: null,
        confidence: 90,
        matchType: 'exact',
      },
    });
  });

  it('displayFileNameがnullの場合、フィールド自体を含めない', () => {
    const payload = buildOcrExtractionUpdatePayload(makeInputs({ displayFileName: null }));
    expect(payload).to.not.have.property('displayFileName');
  });

  it('customerResult.bestMatchがnullの場合、デフォルト値(不明顧客/null)にフォールバックする', () => {
    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({
        customerResult: {
          bestMatch: null,
          candidates: [],
          hasMultipleCandidates: false,
          needsManualSelection: true,
        },
      })
    );

    expect(payload.customerName).to.equal('不明顧客');
    expect(payload.customerId).to.equal(null);
    expect(payload.careManager).to.equal(null);
    expect(payload.isDuplicateCustomer).to.equal(false);
    expect(payload.customerConfirmed).to.equal(false);
    expect(payload.needsManualCustomerSelection).to.equal(true);
    expect(payload.allCustomerCandidates).to.equal('');
    expect(payload.customerCandidates).to.deep.equal([]);
    expect(payload.extractionScores.customerName).to.equal(0);
    expect(payload.extractionDetails.customerMatchType).to.equal('none');
    expect(payload.ocrExtraction.customer).to.deep.equal({
      suggestedValue: '不明顧客',
      suggestedId: null,
      confidence: 0,
      matchType: 'none',
    });
  });

  it('officeResult.bestMatchがnullの場合、デフォルト値(未判定/null)にフォールバックする', () => {
    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({
        officeResult: {
          bestMatch: null,
          candidates: [],
          hasMultipleCandidates: false,
          needsManualSelection: true,
        },
      })
    );

    expect(payload.officeName).to.equal('未判定');
    expect(payload.officeId).to.equal(null);
    expect(payload.officeConfirmed).to.equal(false);
    expect(payload.officeCandidates).to.deep.equal([]);
    expect(payload.extractionScores.officeName).to.equal(0);
    expect(payload.extractionDetails.officeMatchType).to.equal('none');
  });

  it('documentTypeResult.documentTypeがnullの場合、"未判定"にフォールバックする', () => {
    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({
        documentTypeResult: {
          documentType: null,
          category: null,
          score: 0,
          matchType: 'none',
          keywords: [],
        },
      })
    );

    expect(payload.documentType).to.equal('未判定');
    expect(payload.category).to.equal(null);
    expect(payload.ocrExtraction.documentType.suggestedValue).to.equal('未判定');
  });

  it('bestMatchは存在するがcareManagerName/shortNameが未設定の場合、nullにフォールバックする', () => {
    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({
        customerResult: {
          bestMatch: {
            id: 'cust-2',
            name: '鈴木花子',
            score: 90,
            matchType: 'exact',
            isDuplicate: false,
            // careManagerName未設定 (ケアマネ未割当の顧客)
          },
          candidates: [
            {
              id: 'cust-2',
              name: '鈴木花子',
              score: 90,
              matchType: 'exact',
              isDuplicate: false,
            },
          ],
          hasMultipleCandidates: false,
          needsManualSelection: false,
        },
        officeResult: {
          bestMatch: {
            id: 'office-2',
            name: '第二事業所',
            score: 85,
            matchType: 'exact',
            isDuplicate: false,
            // shortName未設定
          },
          candidates: [
            {
              id: 'office-2',
              name: '第二事業所',
              score: 85,
              matchType: 'exact',
              isDuplicate: false,
            },
          ],
          hasMultipleCandidates: false,
          needsManualSelection: false,
        },
      })
    );

    expect(payload.careManager).to.equal(null);
    expect(payload.customerCandidates[0]?.careManagerName).to.equal(null);
    expect(payload.officeCandidates[0]?.shortName).to.equal(null);
  });

  it('isDuplicate=trueが顧客/事業所の両方で正しく伝播する', () => {
    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({
        customerResult: {
          bestMatch: {
            id: 'cust-3',
            name: '同姓同名太郎',
            score: 70,
            matchType: 'fuzzy',
            isDuplicate: true,
          },
          candidates: [
            { id: 'cust-3', name: '同姓同名太郎', score: 70, matchType: 'fuzzy', isDuplicate: true },
          ],
          hasMultipleCandidates: true,
          needsManualSelection: true,
        },
        officeResult: {
          bestMatch: {
            id: 'office-3',
            name: '重複事業所',
            score: 70,
            matchType: 'fuzzy',
            isDuplicate: true,
          },
          candidates: [
            { id: 'office-3', name: '重複事業所', score: 70, matchType: 'fuzzy', isDuplicate: true },
          ],
          hasMultipleCandidates: true,
          needsManualSelection: true,
        },
      })
    );

    expect(payload.isDuplicateCustomer).to.equal(true);
    expect(payload.customerCandidates[0]?.isDuplicate).to.equal(true);
    expect(payload.officeCandidates[0]?.isDuplicate).to.equal(true);
  });

  it('dateResultのdate/formattedDateがnullでも他の抽出結果には影響しない', () => {
    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({
        dateResult: {
          date: null,
          formattedDate: null,
          source: null,
          pattern: null,
          confidence: 0,
          allCandidates: [],
        },
      })
    );

    expect(payload.fileDate).to.equal(null);
    expect(payload.fileDateFormatted).to.equal(null);
    expect(payload.extractionScores.date).to.equal(0);
    expect(payload.extractionDetails.datePattern).to.equal(null);
    expect(payload.extractionDetails.dateSource).to.equal(null);
    // 日付以外の抽出結果は影響を受けない
    expect(payload.customerName).to.equal('山田太郎');
    expect(payload.officeName).to.equal('テスト事業所');
    expect(payload.documentType).to.equal('請求書');
  });

  function makeManyCandidates(
    count: number,
    prefix: string
  ): Array<{ id: string; name: string; score: number; matchType: 'fuzzy'; isDuplicate: boolean }> {
    return Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${i}`,
      name: `${prefix}候補${i}`,
      score: 50,
      matchType: 'fuzzy' as const,
      isDuplicate: false,
    }));
  }

  it('customerCandidates/officeCandidatesがちょうど5件の場合は切り詰めない', () => {
    const fiveCustomers = makeManyCandidates(5, 'cust');
    const fiveOffices = makeManyCandidates(5, 'office');

    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({
        customerResult: {
          bestMatch: fiveCustomers[0] ?? null,
          candidates: fiveCustomers,
          hasMultipleCandidates: true,
          needsManualSelection: true,
        },
        officeResult: {
          bestMatch: fiveOffices[0] ?? null,
          candidates: fiveOffices,
          hasMultipleCandidates: true,
          needsManualSelection: true,
        },
      })
    );

    expect(payload.customerCandidates).to.have.lengthOf(5);
    expect(payload.customerCandidates.map((c) => c.customerId)).to.deep.equal([
      'cust-0',
      'cust-1',
      'cust-2',
      'cust-3',
      'cust-4',
    ]);
    expect(payload.officeCandidates).to.have.lengthOf(5);
  });

  it('customerCandidates/officeCandidatesが6件(5件+1件)の場合、先頭5件のみ残す', () => {
    const sixCustomers = makeManyCandidates(6, 'cust');
    const sixOffices = makeManyCandidates(6, 'office');

    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({
        customerResult: {
          bestMatch: sixCustomers[0] ?? null,
          candidates: sixCustomers,
          hasMultipleCandidates: true,
          needsManualSelection: true,
        },
        officeResult: {
          bestMatch: sixOffices[0] ?? null,
          candidates: sixOffices,
          hasMultipleCandidates: true,
          needsManualSelection: true,
        },
      })
    );

    expect(payload.customerCandidates.map((c) => c.customerId)).to.deep.equal([
      'cust-0',
      'cust-1',
      'cust-2',
      'cust-3',
      'cust-4',
    ]);
    expect(payload.officeCandidates.map((o) => o.officeId)).to.deep.equal([
      'office-0',
      'office-1',
      'office-2',
      'office-3',
      'office-4',
    ]);
  });

  it('customerCandidates/officeCandidatesは7件(5件超過)でも先頭5件かつ順序を保って切り詰められる', () => {
    const manyCustomers = makeManyCandidates(7, 'cust');
    const manyOffices = makeManyCandidates(7, 'office');

    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({
        customerResult: {
          bestMatch: manyCustomers[0] ?? null,
          candidates: manyCustomers,
          hasMultipleCandidates: true,
          needsManualSelection: true,
        },
        officeResult: {
          bestMatch: manyOffices[0] ?? null,
          candidates: manyOffices,
          hasMultipleCandidates: true,
          needsManualSelection: true,
        },
      })
    );

    expect(payload.customerCandidates).to.have.lengthOf(5);
    expect(payload.customerCandidates.map((c) => c.customerId)).to.deep.equal([
      'cust-0',
      'cust-1',
      'cust-2',
      'cust-3',
      'cust-4',
    ]);
    expect(payload.allCustomerCandidates.split(',')).to.have.lengthOf(5);
    expect(payload.officeCandidates).to.have.lengthOf(5);
    expect(payload.officeCandidates.map((o) => o.officeId)).to.deep.equal([
      'office-0',
      'office-1',
      'office-2',
      'office-3',
      'office-4',
    ]);
  });

  it('suggestedNewOfficeがundefinedの場合、nullにフォールバックする', () => {
    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({ suggestedNewOffice: undefined as unknown as null })
    );
    expect(payload.suggestedNewOffice).to.equal(null);
  });

  it('ocrResultUrl/suggestedNewOfficeが値ありの場合、そのまま透過する', () => {
    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({
        ocrResultUrl: 'gs://bucket/ocr-results/doc-1.txt',
        suggestedNewOffice: '新規事業所候補',
      })
    );
    expect(payload.ocrResultUrl).to.equal('gs://bucket/ocr-results/doc-1.txt');
    expect(payload.suggestedNewOffice).to.equal('新規事業所候補');
  });

  it('extractedAtがそのままocrExtraction.extractedAtに透過する', () => {
    const customExtractedAt = admin.firestore.FieldValue.serverTimestamp();
    const payload = buildOcrExtractionUpdatePayload(
      makeInputs({ extractedAt: customExtractedAt })
    );
    expect(payload.ocrExtraction.extractedAt).to.deep.equal(customExtractedAt);
  });
});
