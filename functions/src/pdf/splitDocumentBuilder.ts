/**
 * PDF分割時のFirestoreドキュメントデータ構築
 *
 * pdfOperations.tsから純粋なデータ構築ロジックを抽出し、テスト可能にする。
 * Firestore依存（serverTimestamp等）を含まない部分のみ。
 */

export interface SplitSegmentInput {
  startPage: number;
  endPage: number;
  documentType: string;
  customerName: string;
  customerId?: string | null;
  officeName: string;
  officeId?: string | null;
  customerCandidates?: Array<{
    id: string;
    name: string;
    score: number;
    isDuplicate: boolean;
    careManagerName?: string;
  }>;
  officeCandidates?: Array<{
    id: string;
    name: string;
    score: number;
    isDuplicate: boolean;
  }>;
  isDuplicateCustomer?: boolean;
  careManagerName?: string | null;
}

/**
 * 分割セグメントからFirestoreドキュメントの静的フィールドを構築する。
 *
 * careManagerNameフィールドをcareManager + careManagerKeyに正しくマッピングする。
 */
export function buildSplitDocumentData(segment: SplitSegmentInput): Record<string, unknown> {
  const careManager = segment.careManagerName || null;

  return {
    documentType: segment.documentType,
    customerName: segment.customerName,
    customerId: segment.customerId || null,
    customerCandidates: segment.customerCandidates || [],
    customerConfirmed: true,
    needsManualCustomerSelection: false,
    isDuplicateCustomer: segment.isDuplicateCustomer || false,
    careManager: careManager,
    careManagerKey: careManager || '',
    officeName: segment.officeName,
    officeId: segment.officeId || null,
    officeCandidates: segment.officeCandidates || [],
    officeConfirmed: true,
  };
}
