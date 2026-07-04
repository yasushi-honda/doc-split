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
  /**
   * 確定フラグ（Issue #526）: 分割画面でユーザーが実際に選択した値かどうか。
   * サーバー側ではID有無から推測しない（自動検出候補にもIDが付くため誤判定しうる、
   * Codexセカンドオピニオン反映）。フロントエンドの明示送信値をそのまま使う。
   * 未送信（旧クライアント想定）時は false にフォールバックする。
   */
  customerConfirmed?: boolean;
  officeConfirmed?: boolean;
  documentTypeConfirmed?: boolean;
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
    // Issue #526: 従来は無条件 true 固定（分割時点で全フィールドを確定済み扱い）だったが、
    // OCR再処理連携で「未確認フィールドをOCRが補完する」設計にするため、フロントエンドが
    // 明示送信した値をそのまま反映する（サーバー側でID有無から推測しない）。
    customerConfirmed: segment.customerConfirmed ?? false,
    needsManualCustomerSelection: false,
    isDuplicateCustomer: segment.isDuplicateCustomer || false,
    careManager: careManager,
    careManagerKey: careManager || '',
    officeName: segment.officeName,
    officeId: segment.officeId || null,
    officeCandidates: segment.officeCandidates || [],
    officeConfirmed: segment.officeConfirmed ?? false,
    documentTypeConfirmed: segment.documentTypeConfirmed ?? false,
  };
}
