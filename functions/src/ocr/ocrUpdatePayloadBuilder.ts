/**
 * OCR抽出結果からFirestoreドキュメント更新payloadを組み立てる純粋関数。(Issue #526 D1)
 *
 * processDocument()の後段処理（抽出結果の集約→Firestore update payload生成）を
 * Firestore/Storage/VertexAIの副作用から切り離すことで、直接ユニットテスト可能にする。
 * splitDocumentBuilder.ts と同じ規約: serverTimestamp()/delete() 等のFieldValueは
 * 含めず、呼出元(ocrProcessor.ts)がこの戻り値に対して層を重ねる。
 *
 * `summary` フィールドは意図的に含まない: summaryWritePayloadContract.test.ts が、要約の
 * discriminated union 変換呼出と `summaryTruncated`/`summaryOriginalLength` の
 * FieldValue.delete() が同一update()ブロック内で隣接することを契約テストしており、
 * 呼出元(ocrProcessor.ts)のupdate()呼出に直接書く必要があるため。
 *
 * Issue #526 PR3で、この戻り値を元にconfirmed保護マージロジック（transactionベース）を
 * 追加する予定（本PRでは抽出のみを切り出し、挙動は変更しない）。
 */

import type {
  DocumentExtractionResult,
  CustomerExtractionResult,
  OfficeExtractionResultWithCandidates,
  DateExtractionResult,
} from '../utils/extractors';
import type { RawPageOcrResult } from './buildPageResult';

export interface OcrUpdatePayloadInputs {
  documentTypeResult: DocumentExtractionResult;
  customerResult: CustomerExtractionResult;
  officeResult: OfficeExtractionResultWithCandidates;
  dateResult: DateExtractionResult;
  displayFileName: string | null;
  savedOcrResult: string;
  ocrResultUrl: string | null;
  pageResults: RawPageOcrResult[];
  totalPages: number;
  suggestedNewOffice: string | null;
  /** ocrExtraction.version に書き込むモデルID (呼出元のGEMINI_CONFIG.modelId) */
  modelId: string;
}

/** ocrExtraction.extractedAt を含まない (呼出元がFieldValue.serverTimestamp()を追加する) */
export interface OcrExtractionMeta {
  version: string;
  customer: {
    suggestedValue: string;
    suggestedId: string | null;
    confidence: number;
    matchType: string;
  };
  office: {
    suggestedValue: string;
    suggestedId: string | null;
    confidence: number;
    matchType: string;
  };
  documentType: {
    suggestedValue: string;
    suggestedId: string | null;
    confidence: number;
    matchType: string;
  };
}

/**
 * summary/summaryTruncated/summaryOriginalLength/updatedAt/ocrExtraction.extractedAt は含まない
 * (呼出元がFieldValueおよびbuildSummaryFields()経由のsummaryを追加する)
 */
export interface OcrExtractionUpdateFields {
  displayFileName?: string;
  ocrResult: string;
  ocrResultUrl: string | null;
  pageResults: RawPageOcrResult[];
  documentType: string;
  customerName: string;
  customerId: string | null;
  careManager: string | null;
  officeName: string;
  officeId: string | null;
  fileDate: Date | null;
  fileDateFormatted: string | null;
  isDuplicateCustomer: boolean;
  needsManualCustomerSelection: boolean;
  customerConfirmed: boolean;
  confirmedBy: null;
  confirmedAt: null;
  allCustomerCandidates: string;
  customerCandidates: Array<{
    customerId: string | null;
    customerName: string;
    isDuplicate: boolean;
    score: number;
    matchType: string;
    careManagerName: string | null;
  }>;
  officeConfirmed: boolean;
  officeConfirmedBy: null;
  officeConfirmedAt: null;
  officeCandidates: Array<{
    officeId: string | null;
    officeName: string;
    shortName: string | null;
    isDuplicate: boolean;
    score: number;
    matchType: string;
  }>;
  suggestedNewOffice: string | null;
  totalPages: number;
  category: string | null;
  extractionScores: {
    documentType: number;
    customerName: number;
    officeName: number;
    date: number;
  };
  extractionDetails: {
    documentMatchType: string;
    documentKeywords: string[];
    customerMatchType: string;
    officeMatchType: string;
    datePattern: string | null;
    dateSource: string | null;
  };
  ocrExtraction: OcrExtractionMeta;
}

export function buildOcrExtractionUpdatePayload(
  inputs: OcrUpdatePayloadInputs
): OcrExtractionUpdateFields {
  const {
    documentTypeResult,
    customerResult,
    officeResult,
    dateResult,
    displayFileName,
    savedOcrResult,
    ocrResultUrl,
    pageResults,
    totalPages,
    suggestedNewOffice,
    modelId,
  } = inputs;

  const customerCandidateNames = customerResult.candidates.slice(0, 5).map((c) => c.name);

  return {
    ...(displayFileName ? { displayFileName } : {}),
    ocrResult: savedOcrResult,
    ocrResultUrl: ocrResultUrl ?? null,
    pageResults,
    documentType: documentTypeResult.documentType || '未判定',
    customerName: customerResult.bestMatch?.name || '不明顧客',
    customerId: customerResult.bestMatch?.id ?? null,
    careManager: customerResult.bestMatch?.careManagerName ?? null,
    officeName: officeResult.bestMatch?.name || '未判定',
    officeId: officeResult.bestMatch?.id ?? null,
    fileDate: dateResult.date ?? null,
    fileDateFormatted: dateResult.formattedDate ?? null,
    isDuplicateCustomer: customerResult.bestMatch?.isDuplicate || false,
    needsManualCustomerSelection: customerResult.needsManualSelection ?? false,
    customerConfirmed: !customerResult.needsManualSelection,
    confirmedBy: null,
    confirmedAt: null,
    allCustomerCandidates: customerCandidateNames.join(','),
    customerCandidates: customerResult.candidates.slice(0, 5).map((c) => ({
      customerId: c.id ?? null,
      customerName: c.name ?? '',
      isDuplicate: c.isDuplicate || false,
      score: c.score ?? 0,
      matchType: c.matchType ?? 'none',
      careManagerName: c.careManagerName ?? null,
    })),
    officeConfirmed: !officeResult.needsManualSelection,
    officeConfirmedBy: null,
    officeConfirmedAt: null,
    officeCandidates: officeResult.candidates.slice(0, 5).map((o) => ({
      officeId: o.id ?? null,
      officeName: o.name ?? '',
      shortName: o.shortName ?? null,
      isDuplicate: o.isDuplicate || false,
      score: o.score ?? 0,
      matchType: o.matchType ?? 'none',
    })),
    suggestedNewOffice: suggestedNewOffice ?? null,
    totalPages,
    category: documentTypeResult.category ?? null,
    extractionScores: {
      documentType: documentTypeResult.score ?? 0,
      customerName: customerResult.bestMatch?.score ?? 0,
      officeName: officeResult.bestMatch?.score ?? 0,
      date: dateResult.confidence ?? 0,
    },
    extractionDetails: {
      documentMatchType: documentTypeResult.matchType ?? 'none',
      documentKeywords: documentTypeResult.keywords ?? [],
      customerMatchType: customerResult.bestMatch?.matchType ?? 'none',
      officeMatchType: officeResult.bestMatch?.matchType ?? 'none',
      datePattern: dateResult.pattern ?? null,
      dateSource: dateResult.source ?? null,
    },
    ocrExtraction: {
      version: modelId,
      customer: {
        suggestedValue: customerResult.bestMatch?.name || '不明顧客',
        suggestedId: customerResult.bestMatch?.id ?? null,
        confidence: customerResult.bestMatch?.score ?? 0,
        matchType: customerResult.bestMatch?.matchType ?? 'none',
      },
      office: {
        suggestedValue: officeResult.bestMatch?.name || '未判定',
        suggestedId: officeResult.bestMatch?.id ?? null,
        confidence: officeResult.bestMatch?.score ?? 0,
        matchType: officeResult.bestMatch?.matchType ?? 'none',
      },
      documentType: {
        suggestedValue: documentTypeResult.documentType || '未判定',
        suggestedId: null,
        confidence: documentTypeResult.score ?? 0,
        matchType: documentTypeResult.matchType ?? 'none',
      },
    },
  };
}
