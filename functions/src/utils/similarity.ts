/**
 * 類似度マッチングユーティリティ
 *
 * OCR結果から顧客名・事業所名を抽出する際の
 * ファジーマッチングを提供
 */

/** マッチ結果 */
export interface MatchResult {
  value: string;
  score: number; // 0-100
  matchType: 'exact' | 'partial' | 'fuzzy' | 'none';
}

/** 閾値定数 */
export const SIMILARITY_THRESHOLDS = {
  /** 顧客名の最小類似度（0-100） */
  CUSTOMER_THRESHOLD: 70,
  /** 事業所名の最小類似度（0-100） */
  OFFICE_THRESHOLD: 70,
  /** 書類名の最小類似度（0-100） */
  DOCUMENT_THRESHOLD: 80,
} as const;

/**
 * レーベンシュタイン距離を計算
 *
 * 2つの文字列間の編集距離を計算
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // 行列を初期化
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  // 行列を埋める
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // 置換
          matrix[i]![j - 1]! + 1, // 挿入
          matrix[i - 1]![j]! + 1 // 削除
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * 類似度スコアを計算（0-100）
 *
 * レーベンシュタイン距離を正規化したスコア
 */
export function similarityScore(a: string, b: string): number {
  if (a === b) return 100;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return Math.round((1 - distance / maxLength) * 100);
}

/**
 * テキストを正規化
 *
 * 比較前に空白・記号を統一
 */
export function normalizeText(text: string): string {
  return text
    .replace(/[\s\u3000]+/g, '') // 空白除去
    .replace(/[　]/g, '') // 全角スペース除去
    .replace(/[・．.]/g, '') // 中黒・ピリオド除去
    .toLowerCase();
}

/**
 * テキスト内で最もマッチする値を検索
 *
 * @param text 検索対象テキスト
 * @param candidates 候補リスト
 * @param threshold 最小類似度（0-100）
 * @returns マッチ結果（見つからない場合はnone）
 */
export function findBestMatch(
  text: string,
  candidates: string[],
  threshold: number = 70
): MatchResult {
  if (!text || candidates.length === 0) {
    return { value: '', score: 0, matchType: 'none' };
  }

  const normalizedText = normalizeText(text);
  let bestMatch: MatchResult = { value: '', score: 0, matchType: 'none' };

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);

    // 完全一致チェック
    if (normalizedText.includes(normalizedCandidate)) {
      return { value: candidate, score: 100, matchType: 'exact' };
    }

    // 部分一致チェック（候補がテキストに含まれる）
    if (normalizedText.includes(normalizedCandidate.slice(0, Math.max(3, normalizedCandidate.length - 2)))) {
      const score = 90;
      if (score > bestMatch.score) {
        bestMatch = { value: candidate, score, matchType: 'partial' };
      }
      continue;
    }

    // ファジーマッチ（スライディングウィンドウ）
    const windowSize = Math.min(normalizedCandidate.length + 5, normalizedText.length);
    for (let i = 0; i <= normalizedText.length - windowSize; i++) {
      const window = normalizedText.slice(i, i + windowSize);
      const score = similarityScore(window, normalizedCandidate);

      if (score > bestMatch.score && score >= threshold) {
        bestMatch = { value: candidate, score, matchType: 'fuzzy' };
      }
    }
  }

  return bestMatch;
}

/**
 * 顧客名を抽出
 *
 * @param ocrText OCR結果テキスト
 * @param customerMasters 顧客マスターリスト
 * @returns マッチした顧客名と同姓同名フラグ
 */
export function extractCustomerName(
  ocrText: string,
  customerMasters: Array<{ name: string; isDuplicate?: boolean; furigana?: string }>
): { customerName: string | null; isDuplicate: boolean; score: number; allCandidates: string[] } {
  const names = customerMasters.map((c) => c.name);
  const result = findBestMatch(ocrText, names, SIMILARITY_THRESHOLDS.CUSTOMER_THRESHOLD);

  if (result.matchType === 'none') {
    return { customerName: null, isDuplicate: false, score: 0, allCandidates: [] };
  }

  // 同姓同名チェック
  const matchedCustomer = customerMasters.find((c) => c.name === result.value);
  const isDuplicate = matchedCustomer?.isDuplicate || false;

  // 同じスコア以上の全候補を収集
  const allCandidates: string[] = [];
  if (isDuplicate) {
    for (const customer of customerMasters) {
      const score = similarityScore(normalizeText(ocrText), normalizeText(customer.name));
      if (score >= result.score - 10) {
        allCandidates.push(customer.name);
      }
    }
  }

  return {
    customerName: result.value,
    isDuplicate,
    score: result.score,
    allCandidates,
  };
}

/**
 * 事業所名を抽出
 *
 * @param ocrText OCR結果テキスト
 * @param officeMasters 事業所マスターリスト
 * @returns マッチした事業所名
 */
export function extractOfficeName(
  ocrText: string,
  officeMasters: Array<{ name: string }>
): { officeName: string | null; score: number } {
  const names = officeMasters.map((o) => o.name);
  const result = findBestMatch(ocrText, names, SIMILARITY_THRESHOLDS.OFFICE_THRESHOLD);

  if (result.matchType === 'none') {
    return { officeName: null, score: 0 };
  }

  return { officeName: result.value, score: result.score };
}

/**
 * 書類名を抽出
 *
 * OCR結果の先頭部分から書類種別を判定
 *
 * @param ocrText OCR結果テキスト
 * @param documentMasters 書類マスターリスト
 * @param searchRange 検索範囲（先頭から何文字）
 * @returns マッチした書類名
 */
export function extractDocumentType(
  ocrText: string,
  documentMasters: Array<{ name: string; category?: string }>,
  searchRange: number = 200
): { documentType: string | null; category: string | null; score: number } {
  const searchText = ocrText.slice(0, searchRange);
  const names = documentMasters.map((d) => d.name);
  const result = findBestMatch(searchText, names, SIMILARITY_THRESHOLDS.DOCUMENT_THRESHOLD);

  if (result.matchType === 'none') {
    return { documentType: null, category: null, score: 0 };
  }

  const matchedDoc = documentMasters.find((d) => d.name === result.value);

  return {
    documentType: result.value,
    category: matchedDoc?.category || null,
    score: result.score,
  };
}

/**
 * 日付を抽出
 *
 * @param ocrText OCR結果テキスト
 * @param dateMarker 日付の目印文字列（例: "発行日"）
 * @param searchRange マーカーからの検索範囲
 * @returns 抽出した日付
 */
export function extractDate(
  ocrText: string,
  dateMarker?: string,
  searchRange: number = 50
): Date | null {
  // 日付パターン（複数形式対応）
  const datePatterns = [
    /(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})[日]?/,
    /令和(\d{1,2})[年](\d{1,2})[月](\d{1,2})[日]?/,
    /平成(\d{1,2})[年](\d{1,2})[月](\d{1,2})[日]?/,
    /R(\d{1,2})\.(\d{1,2})\.(\d{1,2})/,
  ];

  let searchText = ocrText;

  // マーカーが指定されている場合、その周辺を検索
  if (dateMarker) {
    const markerIndex = ocrText.indexOf(dateMarker);
    if (markerIndex !== -1) {
      searchText = ocrText.slice(markerIndex, markerIndex + searchRange);
    }
  }

  // 西暦パターン
  const westernMatch = searchText.match(datePatterns[0]!);
  if (westernMatch) {
    return new Date(
      parseInt(westernMatch[1]!),
      parseInt(westernMatch[2]!) - 1,
      parseInt(westernMatch[3]!)
    );
  }

  // 令和パターン
  const reiwaMatch = searchText.match(datePatterns[1]!);
  if (reiwaMatch) {
    const year = 2018 + parseInt(reiwaMatch[1]!);
    return new Date(year, parseInt(reiwaMatch[2]!) - 1, parseInt(reiwaMatch[3]!));
  }

  // 平成パターン
  const heiseiMatch = searchText.match(datePatterns[2]!);
  if (heiseiMatch) {
    const year = 1988 + parseInt(heiseiMatch[1]!);
    return new Date(year, parseInt(heiseiMatch[2]!) - 1, parseInt(heiseiMatch[3]!));
  }

  // R形式（令和略記）
  const rMatch = searchText.match(datePatterns[3]!);
  if (rMatch) {
    const year = 2018 + parseInt(rMatch[1]!);
    return new Date(year, parseInt(rMatch[2]!) - 1, parseInt(rMatch[3]!));
  }

  return null;
}
