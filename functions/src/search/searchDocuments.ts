/**
 * ドキュメント検索 Callable Function
 *
 * 逆引きインデックス（search_index/{tokenId}）を使用した検索API
 * - トークンマッチング
 * - スコアリング（フィールド重み付け）
 * - インメモリキャッシュ（10分TTL）
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import {
  tokenizeQueryByWords,
  generateTokenId,
  FIELD_WEIGHTS,
  type TokenField,
} from '../utils/tokenizer';

const db = getFirestore();

// ============================================
// 型定義
// ============================================

/** 検索リクエスト */
interface SearchRequest {
  query: string;
  limit?: number;
  offset?: number;
}

/** 検索結果 */
interface SearchResult {
  documents: SearchResultDocument[];
  total: number;
  hasMore: boolean;
}

/** 検索結果ドキュメント */
interface SearchResultDocument {
  id: string;
  fileName: string;
  customerName: string;
  officeName: string;
  documentType: string;
  fileDate: string | null;
  score: number;
}

/** 逆引きインデックスのポスティング */
interface Posting {
  score: number;
  fieldsMask: number;
  updatedAt: Timestamp;
}

/** 逆引きインデックスドキュメント */
interface SearchIndex {
  token: string;
  df: number;  // Document Frequency
  updatedAt: Timestamp;
  postings: Record<string, Posting>;
}

// ============================================
// キャッシュ
// ============================================

interface CacheEntry {
  result: SearchResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;  // 10分
const cache = new Map<string, CacheEntry>();

function getCacheKey(query: string, limit: number, offset: number): string {
  return `${query}:${limit}:${offset}`;
}

function getFromCache(key: string): SearchResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key: string, result: SearchResult): void {
  // キャッシュサイズ制限（100エントリ）
  if (cache.size >= 100) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ============================================
// 検索ロジック
// ============================================

/** フィールドマスクからフィールドを取得 */
function getFieldsFromMask(mask: number): TokenField[] {
  const fields: TokenField[] = [];
  if (mask & 1) fields.push('customer');
  if (mask & 2) fields.push('office');
  if (mask & 4) fields.push('documentType');
  if (mask & 8) fields.push('fileName');
  if (mask & 16) fields.push('date');
  return fields;
}

/** IDF（逆文書頻度）を計算 */
function calculateIdf(df: number, totalDocs: number): number {
  return Math.log((totalDocs + 1) / (df + 1));
}

/**
 * ドキュメント検索 Callable Function
 */
export const searchDocuments = onCall<SearchRequest>(
  {
    region: 'asia-northeast1',
    memory: '256MiB',
    timeoutSeconds: 30,
    cors: true,
  },
  async (request): Promise<SearchResult> => {
    // 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '認証が必要です');
    }

    const { query, limit = 20, offset = 0 } = request.data;

    // 入力検証
    if (!query || typeof query !== 'string') {
      throw new HttpsError('invalid-argument', '検索クエリが必要です');
    }

    if (query.length > 100) {
      throw new HttpsError('invalid-argument', '検索クエリが長すぎます（最大100文字）');
    }

    if (limit < 1 || limit > 50) {
      throw new HttpsError('invalid-argument', 'limitは1-50の範囲で指定してください');
    }

    // キャッシュチェック
    const cacheKey = getCacheKey(query, limit, offset);
    const cached = getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    // クエリを単語ごとにトークン化（AND検索用）
    const wordTokenGroups = tokenizeQueryByWords(query);
    if (wordTokenGroups.length === 0) {
      return { documents: [], total: 0, hasMore: false };
    }

    // 全トークンのIDを収集
    const allTokenIds: string[] = [];
    const tokenIdToWordIndex = new Map<string, number[]>(); // tokenId -> どの単語に属するか

    for (let wordIndex = 0; wordIndex < wordTokenGroups.length; wordIndex++) {
      const tokens = wordTokenGroups[wordIndex]!;
      for (const token of tokens) {
        const tokenId = generateTokenId(token);
        allTokenIds.push(tokenId);
        const existing = tokenIdToWordIndex.get(tokenId) || [];
        existing.push(wordIndex);
        tokenIdToWordIndex.set(tokenId, existing);
      }
    }

    // 重複除去
    const uniqueTokenIds = [...new Set(allTokenIds)];

    // 逆引きインデックスを取得
    const indexRefs = uniqueTokenIds.map(id => db.collection('search_index').doc(id));
    const indexSnapshots = await db.getAll(...indexRefs);

    // ドキュメントごとにマッチした単語とスコアを追跡
    const docMatchInfo = new Map<string, {
      score: number;
      matchedWords: Set<number>; // マッチした単語のインデックス
    }>();
    let totalDocs = 0;

    for (let i = 0; i < indexSnapshots.length; i++) {
      const snapshot = indexSnapshots[i];
      if (!snapshot.exists) continue;

      const indexData = snapshot.data() as SearchIndex;
      totalDocs = Math.max(totalDocs, indexData.df);
      const idf = calculateIdf(indexData.df, totalDocs || 1000);

      // このトークンがどの単語に属するか
      const tokenId = uniqueTokenIds[i]!;
      const wordIndices = tokenIdToWordIndex.get(tokenId) || [];

      // postingsを処理する関数
      const processPosting = (docId: string, posting: Posting) => {
        const fields = getFieldsFromMask(posting.fieldsMask);
        const fieldWeight = Math.max(...fields.map(f => FIELD_WEIGHTS[f]));
        const tokenScore = posting.score * idf * fieldWeight;

        const existing = docMatchInfo.get(docId);
        if (existing) {
          existing.score += tokenScore;
          for (const wi of wordIndices) {
            existing.matchedWords.add(wi);
          }
        } else {
          const matchedWords = new Set<number>();
          for (const wi of wordIndices) {
            matchedWords.add(wi);
          }
          docMatchInfo.set(docId, { score: tokenScore, matchedWords });
        }
      };

      // postingsオブジェクトがある場合（正規のフォーマット）
      if (indexData.postings) {
        for (const [docId, posting] of Object.entries(indexData.postings)) {
          processPosting(docId, posting);
        }
      }

      // ルートレベルの postings.docId 形式にも対応（互換性対応）
      const rawData = snapshot.data() as Record<string, unknown>;
      for (const [key, value] of Object.entries(rawData)) {
        if (key.startsWith('postings.') && typeof value === 'object' && value !== null) {
          const docId = key.replace('postings.', '');
          processPosting(docId, value as Posting);
        }
      }
    }

    // AND検索: すべての単語にマッチしたドキュメントのみを結果に含める
    const requiredWordCount = wordTokenGroups.length;
    const filteredDocs = Array.from(docMatchInfo.entries())
      .filter(([, data]) => data.matchedWords.size === requiredWordCount)
      .map(([docId, data]) => ({ docId, score: data.score }));

    // スコア順にソート
    filteredDocs.sort((a, b) => b.score - a.score);

    // ページネーション
    const total = filteredDocs.length;
    const paginatedDocs = filteredDocs.slice(offset, offset + limit);

    if (paginatedDocs.length === 0) {
      const result: SearchResult = { documents: [], total: 0, hasMore: false };
      setCache(cacheKey, result);
      return result;
    }

    // ドキュメント情報を取得
    const docRefs = paginatedDocs.map(d => db.collection('documents').doc(d.docId));
    const docSnapshots = await db.getAll(...docRefs);

    const documents: SearchResultDocument[] = [];
    for (let i = 0; i < docSnapshots.length; i++) {
      const snapshot = docSnapshots[i];
      if (!snapshot.exists) continue;

      const data = snapshot.data()!;
      const score = paginatedDocs[i]!.score;

      documents.push({
        id: snapshot.id,
        fileName: data.fileName || '',
        customerName: data.customerName || '',
        officeName: data.officeName || '',
        documentType: data.documentType || '',
        fileDate: data.fileDate?.toDate?.()?.toISOString?.().split('T')[0] || null,
        score: Math.round(score * 100) / 100,
      });
    }

    const result: SearchResult = {
      documents,
      total,
      hasMore: offset + limit < total,
    };

    setCache(cacheKey, result);
    return result;
  }
);

// ============================================
// インデックス更新ユーティリティ
// ============================================

/**
 * ドキュメントの検索インデックスを更新
 *
 * @param docId ドキュメントID
 * @param tokens トークン情報配列
 */
export async function updateSearchIndex(
  docId: string,
  tokens: Array<{ token: string; field: TokenField; weight: number }>
): Promise<void> {
  const batch = db.batch();
  const now = Timestamp.now();

  // フィールドをマスクに変換
  const fieldToMask: Record<TokenField, number> = {
    customer: 1,
    office: 2,
    documentType: 4,
    fileName: 8,
    date: 16,
  };

  // トークンごとにインデックスを更新
  const tokenMap = new Map<string, { score: number; fieldsMask: number }>();

  for (const { token, field, weight } of tokens) {
    const tokenId = generateTokenId(token);
    const existing = tokenMap.get(tokenId);
    if (existing) {
      existing.score += weight;
      existing.fieldsMask |= fieldToMask[field];
    } else {
      tokenMap.set(tokenId, {
        score: weight,
        fieldsMask: fieldToMask[field],
      });
    }
  }

  for (const [tokenId, data] of tokenMap) {
    const indexRef = db.collection('search_index').doc(tokenId);
    batch.set(
      indexRef,
      {
        updatedAt: now,
        [`postings.${docId}`]: {
          score: data.score,
          fieldsMask: data.fieldsMask,
          updatedAt: now,
        },
        df: FieldValue.increment(0),  // 初回作成時のみカウント
      },
      { merge: true }
    );
  }

  await batch.commit();
}

/**
 * ドキュメントの検索インデックスを削除
 *
 * @param docId ドキュメントID
 * @param tokenIds 削除するトークンIDのリスト
 */
export async function removeFromSearchIndex(
  docId: string,
  tokenIds: string[]
): Promise<void> {
  const batch = db.batch();

  for (const tokenId of tokenIds) {
    const indexRef = db.collection('search_index').doc(tokenId);
    batch.update(indexRef, {
      [`postings.${docId}`]: FieldValue.delete(),
      df: FieldValue.increment(-1),
    });
  }

  await batch.commit();
}
