/**
 * 強化版情報抽出ユーティリティ
 *
 * Phase 6B: 情報抽出精度向上
 * - 書類名抽出強化（getBestMatchingDocumentName相当）
 * - 事業所名抽出強化（getBestMatchingOffice相当）
 * - 複数顧客候補抽出（getBestMatchingCustomerCandidates相当）
 * - 顧客エントリ保証（ensureCustomerEntries相当）
 *
 * 元GASの対応関数:
 * - getBestMatchingDocumentName_()
 * - getBestMatchingOffice_()
 * - getBestMatchingCustomerCandidates_()
 * - ensureCustomerEntries_()
 */

import {
  normalizeForMatching,
  normalizeTextEnhanced,
  convertFullWidthToHalfWidth,
  extractDateCandidates,
  selectMostReasonableDate,
  DateCandidate,
} from './textNormalizer';
import { similarityScore, SIMILARITY_THRESHOLDS } from './similarity';

/** 候補の最大数 */
const MAX_CANDIDATES = 10;

/** 最小スコア閾値 */
const MIN_SCORE_THRESHOLD = 70;

/** マッチタイプ */
export type MatchType = 'exact' | 'partial' | 'fuzzy' | 'none';

/** 顧客候補 */
export interface CustomerCandidate {
  id: string;
  name: string;
  furigana?: string;
  score: number;
  matchType: MatchType;
  isDuplicate: boolean;
  pageNumbers?: number[];
  careManagerName?: string;
}

/** 書類抽出結果 */
export interface DocumentExtractionResult {
  documentType: string | null;
  category: string | null;
  score: number;
  matchType: MatchType;
  keywords: string[];
}

/** 事業所抽出結果 */
export interface OfficeExtractionResult {
  officeName: string | null;
  officeId?: string;
  score: number;
  matchType: MatchType;
}

/** 顧客抽出結果（複数候補対応） */
export interface CustomerExtractionResult {
  bestMatch: CustomerCandidate | null;
  candidates: CustomerCandidate[];
  hasMultipleCandidates: boolean;
  needsManualSelection: boolean;
}

/** 事業所候補 */
export interface OfficeCandidate {
  id: string;
  name: string;
  shortName?: string;
  score: number;
  matchType: MatchType;
  isDuplicate: boolean;
  pageNumbers?: number[];
}

/** 事業所抽出結果（複数候補対応） */
export interface OfficeExtractionResultWithCandidates {
  bestMatch: OfficeCandidate | null;
  candidates: OfficeCandidate[];
  hasMultipleCandidates: boolean;
  needsManualSelection: boolean;
}

/** 日付抽出結果 */
export interface DateExtractionResult {
  date: Date | null;
  formattedDate: string | null;
  source: string | null;
  pattern: string | null;
  confidence: number;
  allCandidates: DateCandidate[];
}

/** ファイル名から抽出した情報 */
export interface FilenameInfo {
  /** ファイル名のプレフィックス部分（-L1-などの前） */
  prefix: string;
  /** プレフィックスの種別 */
  prefixType: 'office_name' | 'phone_number' | 'document_id' | 'unknown';
  /** 正規化済みプレフィックス（マッチング用） */
  normalizedPrefix: string;
  /** 元のファイル名 */
  originalFilename: string;
}

/**
 * マスターデータ型定義
 */
export interface CustomerMaster {
  id: string;
  name: string;
  furigana?: string;
  isDuplicate?: boolean;
  careManagerName?: string;
}

export interface OfficeMaster {
  id: string;
  name: string;
  shortName?: string;
  isDuplicate?: boolean;
}

export interface DocumentMaster {
  id: string;
  name: string;
  category?: string;
  keywords?: string[];
}

/**
 * ファイル名から情報を抽出
 *
 * ファイル名パターン例:
 * - 西春内科在宅クリニック-L1-20260122101727.pdf → 事業所名
 * - 0529088423-L1-20260122104653.pdf → 電話/FAX番号
 * - DOC260122-L1-20260122101412.pdf → ドキュメントID
 *
 * @param filename ファイル名
 * @returns 抽出されたファイル名情報
 */
export function extractFilenameInfo(filename: string): FilenameInfo {
  if (!filename) {
    return {
      prefix: '',
      prefixType: 'unknown',
      normalizedPrefix: '',
      originalFilename: filename,
    };
  }

  // 拡張子を除去
  const baseName = filename.replace(/\.[^.]+$/, '');

  // -L1-, -L2- などのパターンを検出してプレフィックスを抽出
  const match = baseName.match(/^(.+?)-L\d+-/);
  let prefix = match ? match[1] : baseName;

  // 半角カナを全角に、全角数字を半角に正規化
  const normalizedPrefix = normalizeForMatching(prefix);

  // プレフィックスの種別を判定
  let prefixType: FilenameInfo['prefixType'] = 'unknown';

  // 数字のみの場合は電話/FAX番号
  if (/^[0-9]+$/.test(normalizedPrefix)) {
    prefixType = 'phone_number';
  }
  // DOCで始まる場合はドキュメントID
  else if (/^doc\d/i.test(normalizedPrefix)) {
    prefixType = 'document_id';
  }
  // 日本語を含む場合は事業所名
  else if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(prefix)) {
    prefixType = 'office_name';
  }

  return {
    prefix,
    prefixType,
    normalizedPrefix,
    originalFilename: filename,
  };
}

/**
 * 書類名を抽出（強化版）
 *
 * 元GAS: getBestMatchingDocumentName_()
 *
 * 改善点:
 * - 前処理にtextNormalizerを使用
 * - キーワードベースのマッチング追加
 * - 先頭部分優先の重み付け
 *
 * @param ocrText OCR結果テキスト
 * @param documentMasters 書類マスターリスト
 * @param options オプション
 */
export function extractDocumentTypeEnhanced(
  ocrText: string,
  documentMasters: DocumentMaster[],
  options: {
    searchRange?: number;
    minScore?: number;
  } = {}
): DocumentExtractionResult {
  const { searchRange = 300, minScore = SIMILARITY_THRESHOLDS.DOCUMENT_THRESHOLD } = options;

  if (!ocrText || documentMasters.length === 0) {
    return { documentType: null, category: null, score: 0, matchType: 'none', keywords: [] };
  }

  // 前処理: 全角→半角、正規化
  const normalizedText = normalizeTextEnhanced(ocrText);
  const searchText = normalizedText.slice(0, searchRange);
  const matchingText = normalizeForMatching(searchText);

  let bestResult: DocumentExtractionResult = {
    documentType: null,
    category: null,
    score: 0,
    matchType: 'none',
    keywords: [],
  };

  for (const doc of documentMasters) {
    const normalizedDocName = normalizeForMatching(doc.name);
    const matchedKeywords: string[] = [];
    let score = 0;
    let matchType: MatchType = 'none';

    // 1. 完全一致チェック
    if (matchingText.includes(normalizedDocName)) {
      score = 100;
      matchType = 'exact';
    }
    // 2. 部分一致チェック（書類名が3文字以上の場合）
    else if (normalizedDocName.length >= 3) {
      // 前方部分一致
      const prefixLength = Math.min(normalizedDocName.length, Math.floor(normalizedDocName.length * 0.8));
      if (matchingText.includes(normalizedDocName.slice(0, prefixLength))) {
        score = 90;
        matchType = 'partial';
      }
    }

    // 3. キーワードマッチング
    if (doc.keywords && doc.keywords.length > 0) {
      for (const keyword of doc.keywords) {
        const normalizedKeyword = normalizeForMatching(keyword);
        if (matchingText.includes(normalizedKeyword)) {
          matchedKeywords.push(keyword);
        }
      }
      // キーワードマッチによるスコア加算（キーワードは強いシグナル）
      if (matchedKeywords.length > 0 && score < 90) {
        const keywordScore = Math.min(90, 75 + matchedKeywords.length * 10);
        if (keywordScore > score) {
          score = keywordScore;
          matchType = 'partial';
        }
      }
    }

    // 4. ファジーマッチ（上記でマッチしなかった場合）
    if (matchType === 'none' && normalizedDocName.length >= 2) {
      const fuzzyScore = similarityScore(matchingText.slice(0, normalizedDocName.length + 10), normalizedDocName);
      if (fuzzyScore >= minScore) {
        score = fuzzyScore;
        matchType = 'fuzzy';
      }
    }

    // ベストスコア更新
    if (score > bestResult.score) {
      bestResult = {
        documentType: doc.name,
        category: doc.category || null,
        score,
        matchType,
        keywords: matchedKeywords,
      };
    }
  }

  // 閾値チェック
  if (bestResult.score < minScore) {
    return { documentType: null, category: null, score: 0, matchType: 'none', keywords: [] };
  }

  return bestResult;
}

/**
 * 事業所名を抽出（強化版）
 *
 * 元GAS: getBestMatchingOffice_()
 *
 * 改善点:
 * - 前処理にtextNormalizerを使用
 * - 短縮名対応
 * - 住所・電話番号周辺の優先検索
 *
 * @param ocrText OCR結果テキスト
 * @param officeMasters 事業所マスターリスト
 * @param options オプション
 */
export function extractOfficeNameEnhanced(
  ocrText: string,
  officeMasters: OfficeMaster[],
  options: {
    minScore?: number;
  } = {}
): OfficeExtractionResult {
  const { minScore = SIMILARITY_THRESHOLDS.OFFICE_THRESHOLD } = options;

  if (!ocrText || officeMasters.length === 0) {
    return { officeName: null, score: 0, matchType: 'none' };
  }

  // 前処理
  const normalizedText = normalizeTextEnhanced(ocrText);
  const matchingText = normalizeForMatching(normalizedText);

  let bestResult: OfficeExtractionResult = {
    officeName: null,
    score: 0,
    matchType: 'none',
  };

  for (const office of officeMasters) {
    // 正式名称でチェック
    const normalizedOfficeName = normalizeForMatching(office.name);
    let score = 0;
    let matchType: MatchType = 'none';

    // 完全一致
    if (matchingText.includes(normalizedOfficeName)) {
      score = 100;
      matchType = 'exact';
    }
    // 短縮名での一致
    else if (office.shortName) {
      const normalizedShortName = normalizeForMatching(office.shortName);
      if (matchingText.includes(normalizedShortName)) {
        score = 95;
        matchType = 'exact';
      }
    }

    // 部分一致（事業所名が4文字以上の場合）
    if (matchType === 'none' && normalizedOfficeName.length >= 4) {
      const prefixLength = Math.floor(normalizedOfficeName.length * 0.75);
      if (matchingText.includes(normalizedOfficeName.slice(0, prefixLength))) {
        score = 85;
        matchType = 'partial';
      }
    }

    // ファジーマッチ
    if (matchType === 'none') {
      // スライディングウィンドウで最良マッチを探す
      const windowSize = Math.min(normalizedOfficeName.length + 5, matchingText.length);
      for (let i = 0; i <= matchingText.length - windowSize; i++) {
        const window = matchingText.slice(i, i + windowSize);
        const fuzzyScore = similarityScore(window, normalizedOfficeName);
        if (fuzzyScore > score && fuzzyScore >= minScore) {
          score = fuzzyScore;
          matchType = 'fuzzy';
        }
      }
    }

    if (score > bestResult.score) {
      bestResult = {
        officeName: office.name,
        officeId: office.id,
        score,
        matchType,
      };
    }
  }

  // 閾値チェック
  if (bestResult.score < minScore) {
    return { officeName: null, score: 0, matchType: 'none' };
  }

  return bestResult;
}

/**
 * 複数顧客候補を抽出（強化版）
 *
 * 元GAS: getBestMatchingCustomerCandidates_()
 *
 * 改善点:
 * - 常に複数候補を返す（最大10件）
 * - ページ番号との紐付け
 * - マッチタイプの詳細記録
 * - 同姓同名フラグ考慮
 *
 * @param ocrText OCR結果テキスト
 * @param customerMasters 顧客マスターリスト
 * @param options オプション
 */
export function extractCustomerCandidates(
  ocrText: string,
  customerMasters: CustomerMaster[],
  options: {
    minScore?: number;
    maxCandidates?: number;
    pageNumber?: number;
  } = {}
): CustomerExtractionResult {
  const {
    minScore = MIN_SCORE_THRESHOLD,
    maxCandidates = MAX_CANDIDATES,
    pageNumber,
  } = options;

  if (!ocrText || customerMasters.length === 0) {
    return {
      bestMatch: null,
      candidates: [],
      hasMultipleCandidates: false,
      needsManualSelection: false,
    };
  }

  // 前処理
  const normalizedText = normalizeTextEnhanced(ocrText);
  const matchingText = normalizeForMatching(normalizedText);

  const candidates: CustomerCandidate[] = [];

  for (const customer of customerMasters) {
    const normalizedName = normalizeForMatching(customer.name);
    let score = 0;
    let matchType: MatchType = 'none';

    // 1. 完全一致
    if (matchingText.includes(normalizedName)) {
      score = 100;
      matchType = 'exact';
    }
    // 2. ふりがなでの一致
    else if (customer.furigana) {
      const normalizedFurigana = normalizeForMatching(customer.furigana);
      if (matchingText.includes(normalizedFurigana)) {
        score = 95;
        matchType = 'exact';
      }
    }

    // 3. ファジーマッチ（類似度検索）
    // GAS版と同様：完全一致・ふりがな一致がない場合のみ類似度で判定
    if (matchType === 'none') {
      const windowSize = Math.min(normalizedName.length + 3, matchingText.length);
      for (let i = 0; i <= matchingText.length - windowSize; i++) {
        const window = matchingText.slice(i, i + windowSize);
        const fuzzyScore = similarityScore(window, normalizedName);
        if (fuzzyScore > score) {
          score = fuzzyScore;
          matchType = 'fuzzy';
        }
      }
    }

    // 閾値以上の場合、候補に追加
    if (score >= minScore) {
      candidates.push({
        id: customer.id,
        name: customer.name,
        furigana: customer.furigana,
        score,
        matchType,
        isDuplicate: customer.isDuplicate || false,
        pageNumbers: pageNumber !== undefined ? [pageNumber] : undefined,
        careManagerName: customer.careManagerName,
      });
    }
  }

  // スコア順にソート
  candidates.sort((a, b) => b.score - a.score);

  // 候補数制限
  const limitedCandidates = candidates.slice(0, maxCandidates);

  // 結果を構築
  const bestMatch = limitedCandidates.length > 0 ? limitedCandidates[0]! : null;
  const hasMultipleCandidates = limitedCandidates.length > 1;

  // 手動選択が必要かどうかの判定
  // - 同姓同名フラグがある場合
  // - 上位2件のスコア差が小さい場合（10ポイント以内）
  let needsManualSelection = false;
  if (bestMatch?.isDuplicate) {
    needsManualSelection = true;
  } else if (hasMultipleCandidates && limitedCandidates[1]) {
    const scoreDiff = bestMatch!.score - limitedCandidates[1].score;
    if (scoreDiff <= 10) {
      needsManualSelection = true;
    }
  }

  return {
    bestMatch,
    candidates: limitedCandidates,
    hasMultipleCandidates,
    needsManualSelection,
  };
}

/**
 * ページごとの顧客候補を集約
 *
 * 複数ページからの候補を統合し、重複を除去
 *
 * @param pageResults ページごとの抽出結果
 */
export function aggregateCustomerCandidates(
  pageResults: Array<{ pageNumber: number; result: CustomerExtractionResult }>
): CustomerExtractionResult {
  const aggregated = new Map<string, CustomerCandidate>();

  for (const { pageNumber, result } of pageResults) {
    for (const candidate of result.candidates) {
      const existing = aggregated.get(candidate.id);

      if (existing) {
        // 既存候補がある場合、スコアを比較して更新
        if (candidate.score > existing.score) {
          existing.score = candidate.score;
          existing.matchType = candidate.matchType;
        }
        // ページ番号を追加
        if (existing.pageNumbers && !existing.pageNumbers.includes(pageNumber)) {
          existing.pageNumbers.push(pageNumber);
        }
      } else {
        // 新規候補
        aggregated.set(candidate.id, {
          ...candidate,
          pageNumbers: [pageNumber],
        });
      }
    }
  }

  // スコア順にソート
  const candidates = Array.from(aggregated.values()).sort((a, b) => b.score - a.score);
  const limitedCandidates = candidates.slice(0, MAX_CANDIDATES);

  const bestMatch = limitedCandidates.length > 0 ? limitedCandidates[0]! : null;
  const hasMultipleCandidates = limitedCandidates.length > 1;

  let needsManualSelection = false;
  if (bestMatch?.isDuplicate) {
    needsManualSelection = true;
  } else if (hasMultipleCandidates && limitedCandidates[1]) {
    const scoreDiff = bestMatch!.score - limitedCandidates[1].score;
    if (scoreDiff <= 10) {
      needsManualSelection = true;
    }
  }

  return {
    bestMatch,
    candidates: limitedCandidates,
    hasMultipleCandidates,
    needsManualSelection,
  };
}

/**
 * 事業所候補を抽出（複数候補対応）
 *
 * 顧客同姓同名対応と同じパターンで事業所同名を処理
 * ファイル名情報も参考にしてマッチング精度を向上
 *
 * @param ocrText OCR結果テキスト
 * @param officeMasters 事業所マスターリスト
 * @param options オプション
 */
export function extractOfficeCandidates(
  ocrText: string,
  officeMasters: OfficeMaster[],
  options: {
    minScore?: number;
    maxCandidates?: number;
    pageNumber?: number;
    filenameInfo?: FilenameInfo;
  } = {}
): OfficeExtractionResultWithCandidates {
  const {
    minScore = SIMILARITY_THRESHOLDS.OFFICE_THRESHOLD,
    maxCandidates = MAX_CANDIDATES,
    pageNumber,
    filenameInfo,
  } = options;

  if (!ocrText || officeMasters.length === 0) {
    return {
      bestMatch: null,
      candidates: [],
      hasMultipleCandidates: false,
      needsManualSelection: false,
    };
  }

  // 前処理
  const normalizedText = normalizeTextEnhanced(ocrText);
  const matchingText = normalizeForMatching(normalizedText);

  // ファイル名プレフィックスの正規化（事業所名タイプの場合のみ使用）
  const useFilenameForMatching = filenameInfo && filenameInfo.prefixType === 'office_name';
  const filenamePrefix = useFilenameForMatching ? filenameInfo.normalizedPrefix : '';

  const candidates: OfficeCandidate[] = [];

  for (const office of officeMasters) {
    const normalizedOfficeName = normalizeForMatching(office.name);
    let score = 0;
    let matchType: MatchType = 'none';
    let filenameBoost = 0;

    // ファイル名マッチング（事業所名がファイル名に含まれる場合にボーナス）
    if (useFilenameForMatching && filenamePrefix) {
      // ファイル名プレフィックスと事業所名の類似度をチェック
      const filenameSimilarity = similarityScore(filenamePrefix, normalizedOfficeName);

      // ファイル名に事業所名が完全一致
      if (filenamePrefix.includes(normalizedOfficeName) || normalizedOfficeName.includes(filenamePrefix)) {
        filenameBoost = 15; // 大きなボーナス
      }
      // ファイル名と事業所名が高い類似度
      else if (filenameSimilarity >= 80) {
        filenameBoost = 10;
      }
      // 短縮名がファイル名に含まれる
      else if (office.shortName) {
        const normalizedShortName = normalizeForMatching(office.shortName);
        if (filenamePrefix.includes(normalizedShortName) || normalizedShortName.includes(filenamePrefix)) {
          filenameBoost = 12;
        }
      }
    }

    // 1. 完全一致（正式名称）
    if (matchingText.includes(normalizedOfficeName)) {
      score = 100;
      matchType = 'exact';
    }
    // 2. 短縮名での一致
    else if (office.shortName) {
      const normalizedShortName = normalizeForMatching(office.shortName);
      if (matchingText.includes(normalizedShortName)) {
        score = 95;
        matchType = 'exact';
      }
    }

    // 3. 部分一致（事業所名が4文字以上の場合）
    if (matchType === 'none' && normalizedOfficeName.length >= 4) {
      const prefixLength = Math.floor(normalizedOfficeName.length * 0.75);
      if (matchingText.includes(normalizedOfficeName.slice(0, prefixLength))) {
        score = 85;
        matchType = 'partial';
      }
    }

    // 4. ファジーマッチ
    if (matchType === 'none') {
      const windowSize = Math.min(normalizedOfficeName.length + 5, matchingText.length);
      for (let i = 0; i <= matchingText.length - windowSize; i++) {
        const window = matchingText.slice(i, i + windowSize);
        const fuzzyScore = similarityScore(window, normalizedOfficeName);
        if (fuzzyScore > score) {
          score = fuzzyScore;
          matchType = 'fuzzy';
        }
      }
    }

    // ファイル名ボーナスを適用（スコアが閾値以上の場合のみ）
    // ファイル名だけでのマッチは避け、OCRでもある程度マッチした場合にブーストする
    if (score >= minScore - 10 && filenameBoost > 0) {
      score = Math.min(100, score + filenameBoost);
      // ファイル名ブーストでスコアが閾値を超えた場合のみ候補に
    }

    // 閾値以上の場合、候補に追加
    if (score >= minScore) {
      candidates.push({
        id: office.id,
        name: office.name,
        shortName: office.shortName,
        score,
        matchType,
        isDuplicate: office.isDuplicate || false,
        pageNumbers: pageNumber !== undefined ? [pageNumber] : undefined,
      });
    }
  }

  // スコア順にソート
  candidates.sort((a, b) => b.score - a.score);

  // 候補数制限
  const limitedCandidates = candidates.slice(0, maxCandidates);

  // 結果を構築
  const bestMatch = limitedCandidates.length > 0 ? limitedCandidates[0]! : null;
  const hasMultipleCandidates = limitedCandidates.length > 1;

  // 手動選択が必要かどうかの判定
  // - 同名フラグがある場合
  // - 上位2件のスコア差が小さい場合（10ポイント以内）
  let needsManualSelection = false;
  if (bestMatch?.isDuplicate) {
    needsManualSelection = true;
  } else if (hasMultipleCandidates && limitedCandidates[1]) {
    const scoreDiff = bestMatch!.score - limitedCandidates[1].score;
    if (scoreDiff <= 10) {
      needsManualSelection = true;
    }
  }

  return {
    bestMatch,
    candidates: limitedCandidates,
    hasMultipleCandidates,
    needsManualSelection,
  };
}

/**
 * 日付を抽出（強化版）
 *
 * Phase 6Aで実装したtextNormalizerを活用
 *
 * @param ocrText OCR結果テキスト
 * @param dateMarker 日付マーカー（例: "発行日"）
 */
export function extractDateEnhanced(
  ocrText: string,
  dateMarker?: string
): DateExtractionResult {
  if (!ocrText) {
    return {
      date: null,
      formattedDate: null,
      source: null,
      pattern: null,
      confidence: 0,
      allCandidates: [],
    };
  }

  // 前処理
  const normalizedText = convertFullWidthToHalfWidth(ocrText);

  // 日付候補を抽出
  const candidates = extractDateCandidates(normalizedText);

  if (candidates.length === 0) {
    return {
      date: null,
      formattedDate: null,
      source: null,
      pattern: null,
      confidence: 0,
      allCandidates: [],
    };
  }

  // 最適な日付を選択
  const bestCandidate = selectMostReasonableDate(candidates, dateMarker, normalizedText);

  if (!bestCandidate) {
    return {
      date: null,
      formattedDate: null,
      source: null,
      pattern: null,
      confidence: 0,
      allCandidates: candidates,
    };
  }

  // フォーマット
  const year = bestCandidate.date.getFullYear();
  const month = String(bestCandidate.date.getMonth() + 1).padStart(2, '0');
  const day = String(bestCandidate.date.getDate()).padStart(2, '0');
  const formattedDate = `${year}/${month}/${day}`;

  return {
    date: bestCandidate.date,
    formattedDate,
    source: bestCandidate.source,
    pattern: bestCandidate.pattern,
    confidence: bestCandidate.confidence,
    allCandidates: candidates,
  };
}

/**
 * 顧客エントリ情報（Firestoreに保存される形式）
 */
export interface CustomerEntry {
  customerId: string;
  customerName: string;
  score: number;
  matchType: MatchType;
  isConfirmed: boolean;
  confirmedBy?: string;
  confirmedAt?: Date;
}

/**
 * 顧客エントリを保証
 *
 * 元GAS: ensureCustomerEntries_()
 *
 * 抽出結果からFirestoreに保存する顧客エントリを生成
 * - ベストマッチがあればそれを使用
 * - なければ「未確定」エントリを生成
 *
 * @param extractionResult 顧客抽出結果
 * @param documentId 対象ドキュメントID
 */
export function ensureCustomerEntry(
  extractionResult: CustomerExtractionResult,
  documentId: string
): CustomerEntry | null {
  const { bestMatch } = extractionResult;

  if (bestMatch && bestMatch.score >= MIN_SCORE_THRESHOLD) {
    return {
      customerId: bestMatch.id,
      customerName: bestMatch.name,
      score: bestMatch.score,
      matchType: bestMatch.matchType,
      isConfirmed: !extractionResult.needsManualSelection,
    };
  }

  // マッチなしの場合はnullを返す（ドキュメント側で「未確定」として処理）
  return null;
}

/**
 * 全情報を一括抽出
 *
 * OCRテキストから書類名・事業所名・顧客名・日付を一括で抽出
 *
 * @param ocrText OCR結果テキスト
 * @param masters マスターデータ
 * @param options オプション
 */
export function extractAllInformation(
  ocrText: string,
  masters: {
    documents: DocumentMaster[];
    offices: OfficeMaster[];
    customers: CustomerMaster[];
  },
  options: {
    dateMarker?: string;
    pageNumber?: number;
  } = {}
): {
  document: DocumentExtractionResult;
  office: OfficeExtractionResult;
  customer: CustomerExtractionResult;
  date: DateExtractionResult;
} {
  return {
    document: extractDocumentTypeEnhanced(ocrText, masters.documents),
    office: extractOfficeNameEnhanced(ocrText, masters.offices),
    customer: extractCustomerCandidates(ocrText, masters.customers, {
      pageNumber: options.pageNumber,
    }),
    date: extractDateEnhanced(ocrText, options.dateMarker),
  };
}
