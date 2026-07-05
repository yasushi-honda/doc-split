/**
 * リトライユーティリティ
 *
 * error-handling-policy.md に基づく Exponential Backoff 実装
 */

import { RETRY_DELAYS_429_MS, RETRY_JITTER_FACTOR } from '../ocr/constants';

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
  gemini: { ...DEFAULT_RETRY_CONFIG, maxRetries: 3, initialDelayMs: 5000 },
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
  // Issue #546: @google/genai(fetch実装)移行後のDNS解決失敗系。.cause.codeに現れる。
  'ENOTFOUND',
  'EAI_AGAIN',
];

const TRANSIENT_STATUS_CODES = [429, 500, 502, 503, 504];

/**
 * gRPC ABORTED (Firestore transaction書込競合)。HTTPステータスとは体系が異なる
 * ため TRANSIENT_STATUS_CODES とは別定数として明示する (Issue #526)。
 */
const GRPC_ABORTED_CODE = 10;

/**
 * エラーが一時的（リトライ可能）かどうか判定
 */
export function isTransientError(error: unknown): boolean {
  if (!error) return false;

  // Error オブジェクトの場合
  if (error instanceof Error) {
    const errorWithCode = error as Error & {
      code?: string | number;
      status?: number;
      cause?: unknown;
    };

    // エラーコードでチェック
    if (errorWithCode.code) {
      if (typeof errorWithCode.code === 'string') {
        if (TRANSIENT_ERROR_CODES.includes(errorWithCode.code)) {
          return true;
        }
      }
      if (typeof errorWithCode.code === 'number') {
        if (
          TRANSIENT_STATUS_CODES.includes(errorWithCode.code) ||
          errorWithCode.code === GRPC_ABORTED_CODE
        ) {
          return true;
        }
      }
    }

    // Issue #546: @google/genai(fetch実装)はDNS失敗/接続拒否/リセット等のネットワーク層エラーを
    // `TypeError: fetch failed` として投げ、実際のerrno(ECONNREFUSED等)はトップレベルの`.code`
    // ではなく`.cause.code`にネストされる。ここを見ないとネットワーク瞬断がterminal errorに
    // 即確定し、withRetryのbackoffが機能しない。
    const causeCode = (errorWithCode.cause as { code?: string } | undefined)?.code;
    if (typeof causeCode === 'string' && TRANSIENT_ERROR_CODES.includes(causeCode)) {
      return true;
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
      message.includes('temporarily unavailable') ||
      message.includes('too many requests') ||
      message.includes('resource exhausted') ||
      message.includes('resource_exhausted') ||
      message.includes('exception posting request') ||
      // Issue #546: @google/genaiのfetch失敗時の汎用メッセージ。.cause.codeが取れない
      // (未知のerrno等)場合のfallbackとして許容する。
      message.includes('fetch failed') ||
      // Issue #526: db.runTransaction()の書込競合(gRPC ABORTED)は一時的エラー。検知しないと、
      // 本来自動リトライ可能な競合がstatus:'error'に即確定してしまう。数値codeが取れないSDK/
      // テストダブル向けのfallbackとして、Firestoreの実メッセージ形式("10 ABORTED: ...")に
      // 近い「数字+aborted」のみ許容し、AbortController等の無関係な中断エラーと区別する。
      /\d+\s*aborted/.test(message)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * 429/RESOURCE_EXHAUSTED 系の message キーワード集合。
 *
 * `is429Error` (Error 引数) と `isQuotaErrorMessage` (string 引数) で共通利用。
 * 片方の追加時に他方が drift しないよう単一定義 (DRY)。
 * すべて lowercase で記述すること (両関数とも入力を toLowerCase してから match)。
 */
const QUOTA_ERROR_MESSAGE_KEYWORDS: readonly string[] = [
  '429',
  'too many requests',
  'resource exhausted',
  'resource_exhausted',
  'quota exceeded',
];

/**
 * 429/RESOURCE_EXHAUSTEDエラー（配額超過）かどうか判定
 *
 * retryAfter待機時間の決定に使用（429系は長めに待機）
 */
export function is429Error(error: unknown): boolean {
  if (!error || !(error instanceof Error)) return false;

  const errorWithCode = error as Error & { code?: string | number; status?: number };
  const message = error.message.toLowerCase();

  // HTTPステータス429
  if (errorWithCode.status === 429) return true;
  if (errorWithCode.code === 429) return true;

  // gRPCコード RESOURCE_EXHAUSTED
  if (errorWithCode.code === 'RESOURCE_EXHAUSTED') return true;

  // メッセージベース検出 (QUOTA_ERROR_MESSAGE_KEYWORDS を共有)
  return QUOTA_ERROR_MESSAGE_KEYWORDS.some((kw) => message.includes(kw));
}

/**
 * lastErrorMessage 文字列に 429/RESOURCE_EXHAUSTED 系のキーワードが含まれるか判定。
 *
 * `is429Error` は Error オブジェクト引数 (status/code/message の多経路チェック) だが、
 * 本関数は Firestore に保存された `lastErrorMessage` (string) を判定する用途。
 * rescueErroredDocuments で「処理時の 429 が原因の error 状態 doc のみ rescue」判定に使用。
 *
 * `is429Error` の message ベース判定と同じ QUOTA_ERROR_MESSAGE_KEYWORDS を共有。
 */
export function isQuotaErrorMessage(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return QUOTA_ERROR_MESSAGE_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * 429/RESOURCE_EXHAUSTED 専用 retry delay 計算 (jitter 込み)。
 *
 * retryCount に応じて RETRY_DELAYS_429_MS から base 値を選び、
 * ±RETRY_JITTER_FACTOR の範囲で jitter を加える (thundering herd 対策)。
 *
 * @param retryCount 1-indexed の retry attempt 数
 * @param rng [0,1) を返す乱数生成器 (テスト時に inject 可)
 * @returns retry 待機時間 (ms)
 */
export function calculateRetryDelay429Ms(
  retryCount: number,
  rng: () => number = Math.random
): number {
  const safeAttempt = Math.max(1, retryCount);
  const idx = Math.min(safeAttempt - 1, RETRY_DELAYS_429_MS.length - 1);
  const baseMs = RETRY_DELAYS_429_MS[idx];
  // jitter: rng() ∈ [0,1) → (rng()*2 - 1) ∈ [-1,1) → factor 倍で ±RETRY_JITTER_FACTOR
  const jitterMultiplier = 1 + (rng() * 2 - 1) * RETRY_JITTER_FACTOR;
  return Math.round(baseMs * jitterMultiplier);
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
