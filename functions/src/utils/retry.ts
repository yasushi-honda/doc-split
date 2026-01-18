/**
 * リトライユーティリティ
 *
 * error-handling-policy.md に基づく Exponential Backoff 実装
 */

/** リトライ設定 */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/** デフォルト設定 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/** 処理別のリトライ設定 */
export const RETRY_CONFIGS = {
  gmail: { ...DEFAULT_RETRY_CONFIG, initialDelayMs: 1000 },
  gemini: { ...DEFAULT_RETRY_CONFIG, maxRetries: 2, initialDelayMs: 2000 },
  storage: { ...DEFAULT_RETRY_CONFIG, initialDelayMs: 500 },
  firestore: { ...DEFAULT_RETRY_CONFIG, initialDelayMs: 500 },
} as const;

/** 一時的エラー（リトライ対象）のコード */
const TRANSIENT_ERROR_CODES = [
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE',
];

const TRANSIENT_STATUS_CODES = [429, 500, 502, 503, 504];

/**
 * エラーが一時的（リトライ可能）かどうか判定
 */
export function isTransientError(error: unknown): boolean {
  if (!error) return false;

  // Error オブジェクトの場合
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string | number; status?: number };

    // エラーコードでチェック
    if (errorWithCode.code) {
      if (typeof errorWithCode.code === 'string') {
        if (TRANSIENT_ERROR_CODES.includes(errorWithCode.code)) {
          return true;
        }
      }
      if (typeof errorWithCode.code === 'number') {
        if (TRANSIENT_STATUS_CODES.includes(errorWithCode.code)) {
          return true;
        }
      }
    }

    // HTTP ステータスコードでチェック
    if (errorWithCode.status && TRANSIENT_STATUS_CODES.includes(errorWithCode.status)) {
      return true;
    }

    // メッセージに含まれるキーワードでチェック
    const message = error.message.toLowerCase();
    if (
      message.includes('rate limit') ||
      message.includes('quota exceeded') ||
      message.includes('timeout') ||
      message.includes('temporarily unavailable')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * 指定時間スリープ
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * リトライ結果
 */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
}

/**
 * Exponential Backoff でリトライ実行
 *
 * @param fn 実行する非同期関数
 * @param config リトライ設定
 * @returns 結果またはエラー
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | undefined;
  let delay = config.initialDelayMs;

  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 最終試行またはリトライ不可能なエラーの場合は即座にthrow
      if (attempt > config.maxRetries || !isTransientError(error)) {
        throw lastError;
      }

      console.log(
        `Attempt ${attempt}/${config.maxRetries + 1} failed, retrying in ${delay}ms...`,
        lastError.message
      );

      await sleep(Math.min(delay, config.maxDelayMs));
      delay *= config.backoffMultiplier;
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * リトライ実行（結果オブジェクト返却版）
 *
 * エラーをthrowせず結果オブジェクトで返す
 */
export async function withRetryResult<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<RetryResult<T>> {
  let attempts = 0;

  try {
    const data = await withRetry(fn, config);
    attempts = 1; // 成功時は最低1回
    return { success: true, data, attempts };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      attempts: config.maxRetries + 1,
    };
  }
}
