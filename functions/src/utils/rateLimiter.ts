/**
 * Gemini APIレート制限ユーティリティ
 *
 * gemini-rate-limiting.md に基づくトークンバケットアルゴリズム実装
 */

import * as admin from 'firebase-admin';

const db = admin.firestore();

/** レート制限設定 */
export interface RateLimiterConfig {
  maxTokens: number; // バケット最大容量（RPM相当）
  refillRate: number; // 秒あたりのリフィルレート
  minInterval: number; // リクエスト間の最小間隔（ms）
}

/** デフォルト設定（Gemini 2.5 Flash向け） */
export const GEMINI_RATE_LIMIT_CONFIG: RateLimiterConfig = {
  maxTokens: 100, // 安全マージンを持たせた値（実際は1000 RPM）
  refillRate: 1.67, // 100/60秒
  minInterval: 600, // 最小600ms間隔
};

/** バケット状態 */
interface BucketState {
  tokens: number;
  lastRefill: number;
}

/**
 * Geminiレート制限クラス
 *
 * トークンバケットアルゴリズムでAPIコールを制限
 */
export class GeminiRateLimiter {
  private bucket: BucketState;
  private config: RateLimiterConfig;
  private lastRequestTime: number = 0;

  constructor(config: RateLimiterConfig = GEMINI_RATE_LIMIT_CONFIG) {
    this.config = config;
    this.bucket = {
      tokens: config.maxTokens,
      lastRefill: Date.now(),
    };
  }

  /**
   * リクエスト権を取得（必要に応じて待機）
   *
   * @param cost リクエストのコスト（デフォルト1）
   */
  async acquire(cost: number = 1): Promise<void> {
    this.refill();

    // 最小間隔の確保
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.config.minInterval) {
      const waitTime = this.config.minInterval - timeSinceLastRequest;
      await this.sleep(waitTime);
    }

    // トークンが足りない場合は待機
    if (this.bucket.tokens < cost) {
      const waitTime = ((cost - this.bucket.tokens) / this.config.refillRate) * 1000;
      console.log(`Rate limit: waiting ${Math.round(waitTime)}ms for ${cost} tokens`);
      await this.sleep(waitTime);
      this.refill();
    }

    this.bucket.tokens -= cost;
    this.lastRequestTime = Date.now();
  }

  /**
   * バケットをリフィル
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.bucket.lastRefill) / 1000;
    this.bucket.tokens = Math.min(
      this.config.maxTokens,
      this.bucket.tokens + elapsed * this.config.refillRate
    );
    this.bucket.lastRefill = now;
  }

  /**
   * 現在のトークン数を取得
   */
  getAvailableTokens(): number {
    this.refill();
    return this.bucket.tokens;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Gemini使用統計 */
export interface GeminiUsageStats {
  date: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  estimatedCostUsd: number;
}

/** 料金定数（2026年1月時点） */
const GEMINI_PRICING = {
  inputPer1MTokens: 0.075, // $0.075
  outputPer1MTokens: 0.3, // $0.30
};

/**
 * Gemini API使用量を追跡
 */
export async function trackGeminiUsage(
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const statsRef = db.doc(`stats/gemini/daily/${today}`);

  const inputCost = (inputTokens * GEMINI_PRICING.inputPer1MTokens) / 1000000;
  const outputCost = (outputTokens * GEMINI_PRICING.outputPer1MTokens) / 1000000;

  try {
    await statsRef.set(
      {
        date: today,
        inputTokens: admin.firestore.FieldValue.increment(inputTokens),
        outputTokens: admin.firestore.FieldValue.increment(outputTokens),
        requestCount: admin.firestore.FieldValue.increment(1),
        estimatedCostUsd: admin.firestore.FieldValue.increment(inputCost + outputCost),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    // 統計記録失敗は警告のみ
    console.warn('Failed to track Gemini usage:', error);
  }
}

/**
 * 今日の使用量を取得
 */
export async function getTodayUsage(): Promise<GeminiUsageStats | null> {
  const today = new Date().toISOString().split('T')[0];
  const statsDoc = await db.doc(`stats/gemini/daily/${today}`).get();

  if (!statsDoc.exists) {
    return null;
  }

  return statsDoc.data() as GeminiUsageStats;
}

/**
 * 月間使用量を取得
 */
export async function getMonthlyUsage(): Promise<GeminiUsageStats> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `${year}-${month}`;

  const snapshot = await db
    .collection('stats/gemini/daily')
    .where('date', '>=', `${prefix}-01`)
    .where('date', '<=', `${prefix}-31`)
    .get();

  let totalStats: GeminiUsageStats = {
    date: prefix,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
    estimatedCostUsd: 0,
  };

  snapshot.forEach((doc) => {
    const data = doc.data() as GeminiUsageStats;
    totalStats.inputTokens += data.inputTokens || 0;
    totalStats.outputTokens += data.outputTokens || 0;
    totalStats.requestCount += data.requestCount || 0;
    totalStats.estimatedCostUsd += data.estimatedCostUsd || 0;
  });

  return totalStats;
}

// シングルトンインスタンス（Function内で共有）
let rateLimiterInstance: GeminiRateLimiter | null = null;

/**
 * レート制限インスタンスを取得
 */
export function getRateLimiter(): GeminiRateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new GeminiRateLimiter();
  }
  return rateLimiterInstance;
}
