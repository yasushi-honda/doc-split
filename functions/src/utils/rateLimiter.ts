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

/** Gemini呼び出しの用途区分 (Issue #546: OCR転記 / 要約生成でコストを分離計測) */
export type GeminiUsageSource = 'ocr' | 'summary';

/** 用途別 (source別) のGemini使用統計 */
export interface GeminiSourceUsageStats {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  requestCount: number;
  estimatedCostUsd: number;
}

/** Gemini使用統計 */
export interface GeminiUsageStats {
  date: string;
  inputTokens: number;
  outputTokens: number;
  /** thinkingトークン (Issue #546: usageMetadata.thoughtsTokenCount。output単価で課金されるが可視化のため分離集計) */
  thinkingTokens: number;
  requestCount: number;
  estimatedCostUsd: number;
  bySource: Record<GeminiUsageSource, GeminiSourceUsageStats>;
}

/**
 * 料金定数（2026年7月時点、gemini-2.5-flash実単価）
 *
 * Issue #546: 旧値($0.075/$0.30)はgemini-1.5-flash相当の単価が残置されており、
 * アプリ内コスト表示が実請求の約1/8に過小評価されていた。
 */
export const GEMINI_PRICING = Object.freeze({
  inputPer1MTokens: 0.3, // $0.30
  outputPer1MTokens: 2.5, // $2.50（thinkingトークンも同単価で課金される）
});

/**
 * Gemini API使用量を追跡
 *
 * Issue #546: thinkingTokens は output と同単価で課金されるため estimatedCostUsd には
 * output と合算して算入するが、可視化のため inputTokens/outputTokens とは分離して記録する。
 * source (ocr/summary) 別の内訳は bySource 以下にも同じ値を積み上げる。
 */
export async function trackGeminiUsage(
  inputTokens: number,
  outputTokens: number,
  thinkingTokens: number,
  source: GeminiUsageSource
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const statsRef = db.doc(`stats/gemini/daily/${today}`);

  const billableOutputTokens = outputTokens + thinkingTokens;
  const inputCost = (inputTokens * GEMINI_PRICING.inputPer1MTokens) / 1000000;
  const outputCost = (billableOutputTokens * GEMINI_PRICING.outputPer1MTokens) / 1000000;
  const cost = inputCost + outputCost;
  const increment = admin.firestore.FieldValue.increment;

  try {
    await statsRef.set(
      {
        date: today,
        inputTokens: increment(inputTokens),
        outputTokens: increment(outputTokens),
        thinkingTokens: increment(thinkingTokens),
        requestCount: increment(1),
        estimatedCostUsd: increment(cost),
        bySource: {
          [source]: {
            inputTokens: increment(inputTokens),
            outputTokens: increment(outputTokens),
            thinkingTokens: increment(thinkingTokens),
            requestCount: increment(1),
            estimatedCostUsd: increment(cost),
          },
        },
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

  const emptySourceStats = (): GeminiSourceUsageStats => ({
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    requestCount: 0,
    estimatedCostUsd: 0,
  });

  const totalStats: GeminiUsageStats = {
    date: prefix,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    requestCount: 0,
    estimatedCostUsd: 0,
    bySource: { ocr: emptySourceStats(), summary: emptySourceStats() },
  };

  snapshot.forEach((doc) => {
    const data = doc.data() as GeminiUsageStats;
    totalStats.inputTokens += data.inputTokens || 0;
    totalStats.outputTokens += data.outputTokens || 0;
    totalStats.thinkingTokens += data.thinkingTokens || 0;
    totalStats.requestCount += data.requestCount || 0;
    totalStats.estimatedCostUsd += data.estimatedCostUsd || 0;

    (Object.keys(totalStats.bySource) as GeminiUsageSource[]).forEach((source) => {
      const sourceData = data.bySource?.[source];
      if (!sourceData) return;
      totalStats.bySource[source].inputTokens += sourceData.inputTokens || 0;
      totalStats.bySource[source].outputTokens += sourceData.outputTokens || 0;
      totalStats.bySource[source].thinkingTokens += sourceData.thinkingTokens || 0;
      totalStats.bySource[source].requestCount += sourceData.requestCount || 0;
      totalStats.bySource[source].estimatedCostUsd += sourceData.estimatedCostUsd || 0;
    });
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
