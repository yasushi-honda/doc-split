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
 *
 * Issue #787: DPの漸化式は直前の1行しか参照しないため、O(a.length×b.length)の
 * 2次元配列(行列)をO(min(a.length,b.length))の2行バッファに縮小した(rolling row)。
 * 編集距離は対称(ed(a,b)=ed(b,a)。挿入と削除が互いに逆操作、置換は自己対称なため、
 * 編集スクリプトを反転すれば同じコストの逆向きスクリプトになる)なので、短い方を
 * バッファ長に使うため必要なら入れ替える。戻り値は旧実装と数学的に完全に同一。
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // 対称性より、短い方をバッファ長(内側次元)にする
  if (a.length > b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }
  const n = a.length; // n <= b.length

  let prev = new Int32Array(n + 1);
  let cur = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= b.length; i++) {
    cur[0] = i;
    const bChar = b.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      if (bChar === a.charCodeAt(j - 1)) {
        cur[j] = prev[j - 1]!;
      } else {
        cur[j] = Math.min(
          prev[j - 1]! + 1, // 置換
          cur[j - 1]! + 1, // 挿入
          prev[j]! + 1 // 削除
        );
      }
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }

  return prev[n]!;
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
 * テキスト中の固定幅スライディングウィンドウについて、needleとの最良ファジーマッチ
 * スコアを探索する(Issue #787)。
 *
 * 素朴な実装(各ウィンドウ位置でtext.slice()して毎回similarityScore()を呼ぶ)と
 * 数学的に完全に同一の結果を返す。等価性の根拠:
 *
 * 1. windowSize = min(needle.length + windowPad, text.length) はneedleごとに一定。
 *    M = max(windowSize, needle.length) も一定であり、window(常にwindowSize文字)と
 *    needleの類似度スコアは score(d) = round((1 - d/M) * 100) (d=編集距離) という
 *    dについて単調非増加な関数になる(similarityScoreと同一式)。
 * 2. bag distance(文字多重集合差分の下界) bag(window,needle) は編集距離の厳密な下界
 *    (bag <= d が常に成立。1回の編集操作で文字の多重集合差分は高々1しか縮まらないため)。
 *    windowの文字数は一定(windowSize)なので P-N(=文字超過数-文字不足数)は
 *    windowSize-needle.lengthで一定となり、bag = N + max(windowSize-needle.length, 0)
 *    (N=needleの文字のうちwindowに含まれない文字数)としてNだけを追跡すれば十分。
 * 3. bagから決まるscoreの上界がこれまでの最良スコアを超えられないウィンドウは、
 *    フルLevenshtein計算を行っても最良スコアを更新し得ない(scoreはdについて単調
 *    非増加、bag<=dより score(bag)>=score(d))。よってこれらはスキップしてよい。
 *
 * @param text 探索対象の正規化済みテキスト
 * @param needle 探索する正規化済み文字列(事業所名・顧客名等)
 * @param windowPad ウィンドウ幅 = needle.length + windowPad (元実装のスライディング窓幅)
 * @param minAcceptableScore この値未満のスコアは0として扱ってよい場合に指定する
 *   (呼び出し元でその範囲のスコアが観測不可能であることを呼び出し元が保証すること)。
 *   既定0は完全等価モード(素朴な実装と1件も違わない、needle自体が空の場合や
 *   text.length<windowSizeとなる退化ケースも含めて元の`similarityScore`の特別扱いと
 *   一致する)。
 * @returns 最良スコア(0-100)。マッチなし、またはminAcceptableScore未満の場合は0
 */
export function bestFuzzyWindowScore(
  text: string,
  needle: string,
  windowPad: number,
  minAcceptableScore = 0
): number {
  const windowSize = Math.min(needle.length + windowPad, text.length);

  // 元実装のfor条件 `i <= text.length - windowSize` が1回も回らないケース
  if (windowSize > text.length) return 0;

  // 退化ケース: ウィンドウが空文字列(このときi=0の1回のみ)。M=0でのゼロ除算を避けるため
  // similarityScoreの特別扱い(a===b等)にそのまま委譲する。
  if (windowSize === 0) {
    const s = similarityScore('', needle);
    return s > 0 ? s : 0;
  }

  const L = needle.length;
  const M = Math.max(windowSize, L);

  // 距離→スコアの変換テーブル。similarityScoreと同一式で丸めの一致を保証する。
  const scoreByDist = new Int32Array(M + 1);
  for (let d = 0; d <= M; d++) {
    scoreByDist[d] = Math.round((1 - d / M) * 100);
  }

  let best = Math.max(0, minAcceptableScore - 1);
  let updated = false;

  // needleの文字ヒストグラム(needleに含まれる文字コードのみ追跡)
  const needleCount = new Map<number, number>();
  for (let k = 0; k < L; k++) {
    const c = needle.charCodeAt(k);
    needleCount.set(c, (needleCount.get(c) ?? 0) + 1);
  }
  // delta[c] = (windowでのcの出現数) - (needleでのcの出現数)。needleに出現する文字のみ管理。
  const delta = new Map<number, number>();
  for (const [c, cnt] of needleCount) delta.set(c, -cnt);
  let n = L; // ウィンドウ未構築時点では全文字が不足 → N = L

  const addChar = (c: number): void => {
    if (!needleCount.has(c)) return;
    const before = delta.get(c) ?? 0;
    delta.set(c, before + 1);
    if (before < 0) n--;
  };
  const removeChar = (c: number): void => {
    if (!needleCount.has(c)) return;
    const before = delta.get(c) ?? 0;
    delta.set(c, before - 1);
    if (before <= 0) n++;
  };

  // 初期ウィンドウ [0, windowSize) を構築
  for (let k = 0; k < windowSize; k++) addChar(text.charCodeAt(k));

  const wMinusL = Math.max(windowSize - L, 0);
  const lastStart = text.length - windowSize;

  for (let i = 0; i <= lastStart; i++) {
    if (i > 0) {
      removeChar(text.charCodeAt(i - 1));
      addChar(text.charCodeAt(i + windowSize - 1));
    }
    const bag = n + wMinusL; // 常に 0 <= bag <= M (証明はコメント冒頭参照)
    const upperBoundScore = scoreByDist[bag]!;
    if (upperBoundScore > best) {
      const window = text.slice(i, i + windowSize);
      const d = levenshteinDistance(window, needle);
      const s = scoreByDist[d]!;
      if (s > best) {
        best = s;
        updated = true;
      }
    }
  }

  return updated ? best : 0;
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
