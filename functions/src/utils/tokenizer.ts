/**
 * 検索トークナイザー
 *
 * メタデータ検索用のトークン生成ユーティリティ
 * - bi-gram生成
 * - キーワード抽出
 * - 日付トークン生成
 * - 正規化処理
 */

import { convertFullWidthToHalfWidth } from './textNormalizer';

/** トークン情報 */
export interface TokenInfo {
  token: string;
  field: TokenField;
  weight: number;
}

/** トークンのフィールド種別 */
export type TokenField = 'customer' | 'office' | 'documentType' | 'date' | 'fileName';

/** フィールド別の重み（検索スコア計算用） */
export const FIELD_WEIGHTS: Record<TokenField, number> = {
  customer: 3,
  office: 2,
  documentType: 2,
  date: 2,
  fileName: 1,
};

/** ストップワード（検索対象外の一般的な単語） */
const STOP_WORDS = new Set([
  'の', 'に', 'は', 'を', 'が', 'と', 'で', 'て', 'から', 'まで',
  'です', 'ます', 'ある', 'いる', 'する', 'なる',
  '様', '殿', '御中',
  'pdf', 'PDF',
]);

/** 最小トークン長 */
const MIN_TOKEN_LENGTH = 2;

/** 最大トークン数（1フィールドあたり） */
const MAX_TOKENS_PER_FIELD = 20;

/**
 * テキストを検索用に正規化
 *
 * @param text 正規化対象テキスト
 * @returns 正規化後のテキスト
 */
export function normalizeForSearch(text: string): string {
  if (!text) return '';

  let normalized = convertFullWidthToHalfWidth(text);

  // 空白・記号を正規化
  normalized = normalized
    .replace(/[\s\u3000]+/g, ' ')  // 連続空白を1つに
    .replace(/[・．.。、，,]/g, ' ')  // 句読点をスペースに
    .replace(/[-－ー]/g, '')  // ハイフン・長音除去
    .replace(/[「」『』【】（）()[\]]/g, ' ')  // 括弧をスペースに
    .toLowerCase()
    .trim();

  return normalized;
}

/**
 * bi-gramトークンを生成
 *
 * @param text 対象テキスト
 * @returns bi-gramトークン配列
 */
export function generateBigrams(text: string): string[] {
  const normalized = normalizeForSearch(text);
  if (normalized.length < MIN_TOKEN_LENGTH) return [];

  const bigrams: string[] = [];
  const chars = [...normalized].filter(c => c !== ' ');  // 空白を除去

  for (let i = 0; i < chars.length - 1; i++) {
    const bigram = chars[i] + chars[i + 1];
    if (!STOP_WORDS.has(bigram)) {
      bigrams.push(bigram);
    }
  }

  // 重複除去
  return [...new Set(bigrams)];
}

/**
 * キーワードトークンを生成（単語単位）
 *
 * @param text 対象テキスト
 * @returns キーワードトークン配列
 */
export function generateKeywords(text: string): string[] {
  const normalized = normalizeForSearch(text);
  if (!normalized) return [];

  // スペースで分割
  const words = normalized.split(/\s+/).filter(w => w.length >= MIN_TOKEN_LENGTH);

  // ストップワード除去
  const keywords = words.filter(w => !STOP_WORDS.has(w));

  // 重複除去
  return [...new Set(keywords)];
}

/**
 * 日付トークンを生成
 *
 * @param date 日付オブジェクト
 * @returns 日付トークン配列（YYYY, YYYY-MM, YYYY-MM-DD）
 */
export function generateDateTokens(date: Date | null): string[] {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return [];
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return [
    String(year),  // YYYY
    `${year}-${month}`,  // YYYY-MM
    `${year}-${month}-${day}`,  // YYYY-MM-DD
  ];
}

/**
 * 日付文字列からトークンを生成
 *
 * @param dateStr 日付文字列（YYYY/MM/DD, YYYY-MM-DD, YYYY年MM月, YYYY年MM月DD日 など）
 * @returns 日付トークン配列
 */
export function generateDateTokensFromString(dateStr: string | null): string[] {
  if (!dateStr) return [];

  // YYYY/MM/DD または YYYY-MM-DD 形式を解析
  const match = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match) {
    const year = parseInt(match[1]!, 10);
    const month = parseInt(match[2]!, 10);
    const day = parseInt(match[3]!, 10);
    return generateDateTokens(new Date(year, month - 1, day));
  }

  // YYYY年MM月DD日 形式
  const jpFullMatch = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (jpFullMatch) {
    const year = parseInt(jpFullMatch[1]!, 10);
    const month = parseInt(jpFullMatch[2]!, 10);
    const day = parseInt(jpFullMatch[3]!, 10);
    return generateDateTokens(new Date(year, month - 1, day));
  }

  // YYYY年MM月 形式（日なし）- 月の最初の日として扱う
  const jpMonthMatch = dateStr.match(/(\d{4})年(\d{1,2})月/);
  if (jpMonthMatch) {
    const year = parseInt(jpMonthMatch[1]!, 10);
    const month = parseInt(jpMonthMatch[2]!, 10);
    // 年月トークンを直接生成（日は含まない）
    const monthStr = String(month).padStart(2, '0');
    return [
      String(year),  // YYYY
      `${year}-${monthStr}`,  // YYYY-MM
    ];
  }

  // YYYY/MM 形式（日なし）
  const slashMonthMatch = dateStr.match(/(\d{4})\/(\d{1,2})(?!\/\d)/);
  if (slashMonthMatch) {
    const year = parseInt(slashMonthMatch[1]!, 10);
    const month = parseInt(slashMonthMatch[2]!, 10);
    const monthStr = String(month).padStart(2, '0');
    return [
      String(year),  // YYYY
      `${year}-${monthStr}`,  // YYYY-MM
    ];
  }

  return [];
}

/**
 * ドキュメントメタデータからトークンを生成
 *
 * @param metadata ドキュメントメタデータ
 * @returns トークン情報配列
 */
export interface DocumentMetadata {
  customerName?: string | null;
  officeName?: string | null;
  documentType?: string | null;
  fileDate?: Date | null;
  fileName?: string | null;
}

export function generateDocumentTokens(metadata: DocumentMetadata): TokenInfo[] {
  const tokens: TokenInfo[] = [];

  // 顧客名トークン
  if (metadata.customerName) {
    const customerTokens = generateFieldTokens(metadata.customerName, 'customer');
    tokens.push(...customerTokens.slice(0, MAX_TOKENS_PER_FIELD));
  }

  // 事業所名トークン
  if (metadata.officeName) {
    const officeTokens = generateFieldTokens(metadata.officeName, 'office');
    tokens.push(...officeTokens.slice(0, MAX_TOKENS_PER_FIELD));
  }

  // 書類種別トークン
  if (metadata.documentType) {
    const docTypeTokens = generateFieldTokens(metadata.documentType, 'documentType');
    tokens.push(...docTypeTokens.slice(0, MAX_TOKENS_PER_FIELD));
  }

  // 日付トークン
  if (metadata.fileDate) {
    const dateTokens = generateDateTokens(metadata.fileDate);
    for (const token of dateTokens) {
      tokens.push({
        token,
        field: 'date',
        weight: FIELD_WEIGHTS.date,
      });
    }
  }

  // ファイル名トークン（拡張子除去）
  if (metadata.fileName) {
    const fileNameWithoutExt = metadata.fileName.replace(/\.[^.]+$/, '');
    const fileNameTokens = generateFieldTokens(fileNameWithoutExt, 'fileName');
    tokens.push(...fileNameTokens.slice(0, MAX_TOKENS_PER_FIELD));
  }

  return tokens;
}

/**
 * フィールド値からトークンを生成（bi-gram + キーワード）
 *
 * @param value フィールド値
 * @param field フィールド種別
 * @returns トークン情報配列
 */
function generateFieldTokens(value: string, field: TokenField): TokenInfo[] {
  const tokens: TokenInfo[] = [];
  const weight = FIELD_WEIGHTS[field];

  // キーワードトークン
  const keywords = generateKeywords(value);
  for (const keyword of keywords) {
    tokens.push({ token: keyword, field, weight });
  }

  // bi-gramトークン（キーワードより低い重み）
  const bigrams = generateBigrams(value);
  for (const bigram of bigrams) {
    tokens.push({ token: bigram, field, weight: weight * 0.5 });
  }

  return tokens;
}

/**
 * 検索クエリからトークンを生成
 *
 * @param query 検索クエリ
 * @returns トークン配列
 */
export function tokenizeQuery(query: string): string[] {
  if (!query) return [];

  const normalized = normalizeForSearch(query);
  const tokens: string[] = [];

  // キーワードトークン
  const keywords = generateKeywords(normalized);
  tokens.push(...keywords);

  // bi-gramトークン
  const bigrams = generateBigrams(normalized);
  tokens.push(...bigrams);

  // 日付トークン（クエリに日付が含まれる場合）
  const dateTokens = generateDateTokensFromString(query);
  tokens.push(...dateTokens);

  // 重複除去
  return [...new Set(tokens)];
}

/**
 * 検索クエリを単語ごとにトークン化（AND検索用）
 *
 * @param query 検索クエリ
 * @returns 単語ごとのトークン配列（外側配列=単語、内側配列=その単語のトークン）
 */
export function tokenizeQueryByWords(query: string): string[][] {
  if (!query) return [];

  const normalized = normalizeForSearch(query);
  if (!normalized) return [];

  // スペースで分割して単語を取得
  const words = normalized.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];

  const result: string[][] = [];

  for (const word of words) {
    const wordTokens: string[] = [];

    // 単語自体（2文字以上）
    if (word.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(word)) {
      wordTokens.push(word);
    }

    // bi-gramトークン
    const bigrams = generateBigrams(word);
    wordTokens.push(...bigrams);

    // 日付トークン（単語が日付形式の場合）
    const dateTokens = generateDateTokensFromString(word);
    wordTokens.push(...dateTokens);

    // 重複除去
    const uniqueTokens = [...new Set(wordTokens)];
    if (uniqueTokens.length > 0) {
      result.push(uniqueTokens);
    }
  }

  return result;
}

/**
 * トークンIDを生成（FirestoreドキュメントID用）
 *
 * @param token トークン文字列
 * @returns トークンID（ハッシュ）
 */
export function generateTokenId(token: string): string {
  // シンプルなハッシュ関数（本番ではcrypto.createHashを使用可能）
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;  // 32bit整数に変換
  }
  // 負の値を正の値に変換してhex文字列に
  const positiveHash = hash >>> 0;
  return positiveHash.toString(16).padStart(8, '0');
}

/**
 * トークン配列からハッシュを生成（idempotent用）
 *
 * @param tokens トークン配列
 * @returns ハッシュ文字列
 */
export function generateTokensHash(tokens: TokenInfo[]): string {
  const sortedTokens = tokens
    .map(t => t.token)
    .sort()
    .join('|');
  return generateTokenId(sortedTokens);
}
