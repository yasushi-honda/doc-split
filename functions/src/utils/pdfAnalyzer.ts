/**
 * PDF分析ユーティリティ
 *
 * Phase 6D: PDF分割強化
 * - 顧客変更点検出（ページ間での顧客変化を検出）
 * - 分割候補精度向上（Phase 6B/6Cの結果を活用）
 * - セグメント分析（連続ページのグルーピング）
 *
 * 6B/6Cとの連携:
 * - extractors.ts: 顧客・書類・事業所の抽出
 * - fileNaming.ts: ファイル名生成・顧客分析
 */

import {
  extractCustomerCandidates,
  extractDocumentTypeEnhanced,
  extractOfficeNameEnhanced,
  extractDateEnhanced,
  aggregateCustomerCandidates,
  CustomerMaster,
  DocumentMaster,
  OfficeMaster,
  CustomerCandidate,
  CustomerExtractionResult,
} from './extractors';
import {
  generateOptimalFileName,
  CustomerAttribute,
  FileNameResult,
} from './fileNaming';

/** ページごとのOCR結果 */
export interface PageOcrData {
  pageNumber: number;
  text: string;
  /** 既存の検出結果（あれば） */
  detectedDocumentType?: string | null;
  detectedCustomerName?: string | null;
  detectedOfficeName?: string | null;
  detectedDate?: string | null;
}

/** ページ分析結果 */
export interface PageAnalysisResult {
  pageNumber: number;
  /** 検出された書類タイプ */
  documentType: string | null;
  documentTypeScore: number;
  /** 検出された顧客候補 */
  customerCandidates: CustomerCandidate[];
  primaryCustomer: CustomerCandidate | null;
  /** 検出された事業所 */
  officeName: string | null;
  officeScore: number;
  /** 検出された日付 */
  date: string | null;
  /** 前ページからの変化 */
  changes: PageChange[];
}

/** ページ間の変化 */
export interface PageChange {
  type: 'customer' | 'document_type' | 'office' | 'date';
  previousValue: string | null;
  newValue: string | null;
  confidence: number;
}

/** 分割候補（強化版） */
export interface EnhancedSplitSuggestion {
  /** 分割位置（このページの後で分割） */
  afterPageNumber: number;
  /** 分割理由 */
  reason: 'customer_change' | 'document_change' | 'office_change' | 'multiple_changes';
  /** 信頼度（0-100） */
  confidence: number;
  /** 変化の詳細 */
  changes: PageChange[];
  /** 次セグメントの情報 */
  nextSegment: {
    documentType: string | null;
    customerName: string | null;
    officeName: string | null;
    date: string | null;
  };
}

/** セグメント（分割単位） */
export interface PdfSegment {
  /** セグメントID */
  id: string;
  /** 開始ページ */
  startPage: number;
  /** 終了ページ */
  endPage: number;
  /** ページ数 */
  pageCount: number;
  /** 検出された情報 */
  documentType: string | null;
  customerName: string | null;
  customerId: string | null;
  officeName: string | null;
  date: string | null;
  /** 顧客候補（複数） */
  customerCandidates: CustomerCandidate[];
  /** 推奨ファイル名 */
  suggestedFileName: FileNameResult;
  /** 信頼度 */
  confidence: number;
}

/** PDF分析結果 */
export interface PdfAnalysisResult {
  /** 総ページ数 */
  totalPages: number;
  /** ページごとの分析結果 */
  pageAnalysis: PageAnalysisResult[];
  /** 分割候補 */
  splitSuggestions: EnhancedSplitSuggestion[];
  /** セグメント（分割案） */
  segments: PdfSegment[];
  /** 分割推奨かどうか */
  shouldSplit: boolean;
  /** 分割推奨理由 */
  splitReason?: string;
}

/** マスターデータ */
export interface MasterData {
  customers: CustomerMaster[];
  documents: DocumentMaster[];
  offices: OfficeMaster[];
}

/**
 * ページごとにOCR結果を分析
 *
 * @param pageData ページのOCRデータ
 * @param masters マスターデータ
 */
export function analyzePageOcr(
  pageData: PageOcrData,
  masters: MasterData
): PageAnalysisResult {
  const { pageNumber, text } = pageData;

  // 書類タイプ抽出
  const docResult = extractDocumentTypeEnhanced(text, masters.documents);

  // 顧客候補抽出
  const customerResult = extractCustomerCandidates(text, masters.customers, {
    pageNumber,
  });

  // 事業所抽出
  const officeResult = extractOfficeNameEnhanced(text, masters.offices);

  // 日付抽出
  const dateResult = extractDateEnhanced(text);

  return {
    pageNumber,
    documentType: docResult.documentType,
    documentTypeScore: docResult.score,
    customerCandidates: customerResult.candidates,
    primaryCustomer: customerResult.bestMatch,
    officeName: officeResult.officeName,
    officeScore: officeResult.score,
    date: dateResult.formattedDate,
    changes: [], // 後で計算
  };
}

/**
 * ページ間の変化を検出
 *
 * @param prevPage 前ページの分析結果
 * @param currentPage 現在ページの分析結果
 */
export function detectPageChanges(
  prevPage: PageAnalysisResult | null,
  currentPage: PageAnalysisResult
): PageChange[] {
  if (!prevPage) return [];

  const changes: PageChange[] = [];

  // 顧客変化の検出
  const prevCustomer = prevPage.primaryCustomer?.name || null;
  const currentCustomer = currentPage.primaryCustomer?.name || null;

  if (currentCustomer && prevCustomer !== currentCustomer) {
    changes.push({
      type: 'customer',
      previousValue: prevCustomer,
      newValue: currentCustomer,
      confidence: currentPage.primaryCustomer?.score || 0,
    });
  }

  // 書類タイプ変化の検出
  if (currentPage.documentType && prevPage.documentType !== currentPage.documentType) {
    changes.push({
      type: 'document_type',
      previousValue: prevPage.documentType,
      newValue: currentPage.documentType,
      confidence: currentPage.documentTypeScore,
    });
  }

  // 事業所変化の検出
  if (currentPage.officeName && prevPage.officeName !== currentPage.officeName) {
    changes.push({
      type: 'office',
      previousValue: prevPage.officeName,
      newValue: currentPage.officeName,
      confidence: currentPage.officeScore,
    });
  }

  return changes;
}

/**
 * 分割候補を生成
 *
 * @param pageAnalysis ページ分析結果の配列
 * @param minConfidence 最小信頼度（デフォルト: 70）
 */
export function generateSplitSuggestions(
  pageAnalysis: PageAnalysisResult[],
  minConfidence: number = 70
): EnhancedSplitSuggestion[] {
  const suggestions: EnhancedSplitSuggestion[] = [];

  for (let i = 1; i < pageAnalysis.length; i++) {
    const prevPage = pageAnalysis[i - 1]!;
    const currentPage = pageAnalysis[i]!;

    // 変化を検出
    const changes = detectPageChanges(prevPage, currentPage);
    currentPage.changes = changes;

    if (changes.length === 0) continue;

    // 信頼度の計算（変化の信頼度の平均）
    const avgConfidence = changes.reduce((sum, c) => sum + c.confidence, 0) / changes.length;

    if (avgConfidence < minConfidence) continue;

    // 分割理由の決定
    let reason: EnhancedSplitSuggestion['reason'];
    if (changes.some((c) => c.type === 'customer')) {
      reason = changes.length > 1 ? 'multiple_changes' : 'customer_change';
    } else if (changes.some((c) => c.type === 'document_type')) {
      reason = changes.length > 1 ? 'multiple_changes' : 'document_change';
    } else {
      reason = 'office_change';
    }

    suggestions.push({
      afterPageNumber: prevPage.pageNumber,
      reason,
      confidence: Math.round(avgConfidence),
      changes,
      nextSegment: {
        documentType: currentPage.documentType,
        customerName: currentPage.primaryCustomer?.name || null,
        officeName: currentPage.officeName,
        date: currentPage.date,
      },
    });
  }

  return suggestions;
}

/**
 * セグメントを生成
 *
 * 分割候補に基づいてPDFをセグメントに分割
 *
 * @param pageAnalysis ページ分析結果
 * @param splitSuggestions 分割候補
 */
export function generateSegments(
  pageAnalysis: PageAnalysisResult[],
  splitSuggestions: EnhancedSplitSuggestion[]
): PdfSegment[] {
  if (pageAnalysis.length === 0) return [];

  const segments: PdfSegment[] = [];
  const splitPoints = splitSuggestions.map((s) => s.afterPageNumber);

  let segmentStart = 1;
  let segmentId = 1;

  // 分割ポイントごとにセグメントを生成
  for (let i = 0; i <= splitPoints.length; i++) {
    const segmentEnd = i < splitPoints.length ? splitPoints[i]! : pageAnalysis.length;

    // セグメント内のページ分析結果を取得
    const segmentPages = pageAnalysis.filter(
      (p) => p.pageNumber >= segmentStart && p.pageNumber <= segmentEnd
    );

    if (segmentPages.length === 0) {
      segmentStart = segmentEnd + 1;
      continue;
    }

    // セグメント内で最も信頼度の高い情報を採用
    const bestDocType = findBestValue(segmentPages, 'documentType', 'documentTypeScore');
    const bestOffice = findBestValue(segmentPages, 'officeName', 'officeScore');

    // 顧客候補を集約
    const customerResults: Array<{ pageNumber: number; result: CustomerExtractionResult }> =
      segmentPages.map((p) => ({
        pageNumber: p.pageNumber,
        result: {
          bestMatch: p.primaryCustomer,
          candidates: p.customerCandidates,
          hasMultipleCandidates: p.customerCandidates.length > 1,
          needsManualSelection: false,
        },
      }));

    const aggregatedCustomers = aggregateCustomerCandidates(customerResults);

    // 日付（最初に見つかったものを採用）
    const firstDate = segmentPages.find((p) => p.date)?.date || null;

    // 顧客属性を構築
    const customerAttributes: CustomerAttribute[] = aggregatedCustomers.candidates.map((c) => ({
      id: c.id,
      name: c.name,
    }));

    // ファイル名を生成
    const fileNameResult = generateOptimalFileName({
      documentType: bestDocType.value || undefined,
      officeName: bestOffice.value || undefined,
      date: firstDate || undefined,
      customers: customerAttributes,
    });

    // 信頼度の計算
    const confidence = Math.round(
      (bestDocType.score + bestOffice.score + (aggregatedCustomers.bestMatch?.score || 0)) / 3
    );

    segments.push({
      id: `seg_${segmentId}`,
      startPage: segmentStart,
      endPage: segmentEnd,
      pageCount: segmentEnd - segmentStart + 1,
      documentType: bestDocType.value,
      customerName: aggregatedCustomers.bestMatch?.name || null,
      customerId: aggregatedCustomers.bestMatch?.id || null,
      officeName: bestOffice.value,
      date: firstDate,
      customerCandidates: aggregatedCustomers.candidates,
      suggestedFileName: fileNameResult,
      confidence,
    });

    segmentStart = segmentEnd + 1;
    segmentId++;
  }

  return segments;
}

/**
 * ヘルパー: セグメント内で最も信頼度の高い値を取得
 */
function findBestValue<K extends keyof PageAnalysisResult>(
  pages: PageAnalysisResult[],
  valueKey: K,
  scoreKey: keyof PageAnalysisResult
): { value: PageAnalysisResult[K] | null; score: number } {
  let bestValue: PageAnalysisResult[K] | null = null;
  let bestScore = 0;

  for (const page of pages) {
    const value = page[valueKey];
    const score = page[scoreKey] as number;

    if (value && score > bestScore) {
      bestValue = value;
      bestScore = score;
    }
  }

  return { value: bestValue, score: bestScore };
}

/**
 * PDFを全体的に分析
 *
 * @param pages ページのOCRデータ配列
 * @param masters マスターデータ
 * @param options オプション
 */
export function analyzePdf(
  pages: PageOcrData[],
  masters: MasterData,
  options: {
    minConfidence?: number;
  } = {}
): PdfAnalysisResult {
  const { minConfidence = 70 } = options;

  if (pages.length === 0) {
    return {
      totalPages: 0,
      pageAnalysis: [],
      splitSuggestions: [],
      segments: [],
      shouldSplit: false,
    };
  }

  // 1. 各ページを分析
  const pageAnalysis: PageAnalysisResult[] = pages.map((page) =>
    analyzePageOcr(page, masters)
  );

  // 2. 分割候補を生成
  const splitSuggestions = generateSplitSuggestions(pageAnalysis, minConfidence);

  // 3. セグメントを生成
  const segments = generateSegments(pageAnalysis, splitSuggestions);

  // 4. 分割推奨の判定
  let shouldSplit = false;
  let splitReason: string | undefined;

  if (splitSuggestions.length > 0) {
    shouldSplit = true;

    // 理由を集約
    const customerChanges = splitSuggestions.filter(
      (s) => s.reason === 'customer_change' || s.reason === 'multiple_changes'
    );
    const docChanges = splitSuggestions.filter((s) => s.reason === 'document_change');

    if (customerChanges.length > 0 && docChanges.length > 0) {
      splitReason = `顧客変更${customerChanges.length}件、書類変更${docChanges.length}件を検出`;
    } else if (customerChanges.length > 0) {
      splitReason = `顧客変更${customerChanges.length}件を検出`;
    } else if (docChanges.length > 0) {
      splitReason = `書類変更${docChanges.length}件を検出`;
    } else {
      splitReason = `分割候補${splitSuggestions.length}件を検出`;
    }
  }

  return {
    totalPages: pages.length,
    pageAnalysis,
    splitSuggestions,
    segments,
    shouldSplit,
    splitReason,
  };
}

/**
 * 分割確認用のサマリーを生成
 *
 * @param analysisResult PDF分析結果
 */
export function generateSplitSummary(
  analysisResult: PdfAnalysisResult
): {
  shouldSplit: boolean;
  reason: string;
  segmentCount: number;
  segmentDetails: Array<{
    id: string;
    pages: string;
    customer: string | null;
    document: string | null;
    fileName: string;
  }>;
} {
  const { shouldSplit, splitReason, segments } = analysisResult;

  return {
    shouldSplit,
    reason: splitReason || '分割不要',
    segmentCount: segments.length,
    segmentDetails: segments.map((seg) => ({
      id: seg.id,
      pages: seg.startPage === seg.endPage
        ? `P${seg.startPage}`
        : `P${seg.startPage}-${seg.endPage}`,
      customer: seg.customerName,
      document: seg.documentType,
      fileName: seg.suggestedFileName.fileName,
    })),
  };
}
