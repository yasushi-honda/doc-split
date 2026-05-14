/**
 * Issue #445 PR-D4 S1-4: Phase C token bucket rate limiter (BF23, Codex 3rd I4 反映).
 *
 * impl-plan §4.3 step 5 + §4.2 rate limit:
 *   batch update / individual update が **同一 global token bucket** を通過し、
 *   突発書込 rate 増加を防止する (Firestore write 100-200/sec 上限を守る)。
 *
 * 設計判断:
 * - 並行 caller (batch worker + individual retry worker が同時に呼ぶケース) を
 *   chained promise でシリアル化し、token 二重消費の race を排除
 * - clock を inject (test 用 fake clock + 本番用 system clock を切替可能)
 * - sleep ms は deficit / tokensPerSecond で正確算出 (Codex L2 反映の正確性)
 *
 * 配置: scripts/pr-d4-backfill/phase-c/。Phase A/B と異なり caller 注入型ではなく
 * single class export (state を持つため、orchestrator が 1 instance を共有して全 writer 経由)
 */

import type { PhaseCRateLimiterConfig } from '../types';

export interface RateLimiterClock {
  /** monotonic ms (Date.now ベースでも可、但し test では fake clock 推奨) */
  now(): number;
  /** ms 単位 sleep (テストでは fake clock の advance + resolve で代替) */
  sleep(ms: number): Promise<void>;
}

/**
 * 本番用 system clock (Date.now + setTimeout)。
 */
export const SYSTEM_CLOCK: RateLimiterClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Phase C 内 caller (batchWriter / individualRetryWriter) が依存する rate limiter interface。
 * unit test では fake 実装を渡せる (Phase A/B Writer pattern と同じ依存性逆転)。
 */
export interface RateLimiter {
  acquire(tokens?: number): Promise<void>;
}

export class TokenBucketRateLimiter implements RateLimiter {
  private currentTokens: number;
  private lastRefillTimeMs: number;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: PhaseCRateLimiterConfig,
    private readonly clock: RateLimiterClock = SYSTEM_CLOCK
  ) {
    if (config.tokensPerSecond <= 0) {
      throw new Error('tokensPerSecond must be positive');
    }
    if (config.burstCapacity <= 0) {
      throw new Error('burstCapacity must be positive');
    }
    this.currentTokens = config.burstCapacity;
    this.lastRefillTimeMs = clock.now();
  }

  /**
   * 必要 tokens を acquire (不足時は自動 sleep + refill)。
   * 並行 caller は内部 chain で順次処理されるため、token race は発生しない。
   */
  acquire(tokens: number = 1): Promise<void> {
    if (tokens <= 0) {
      return Promise.reject(new Error('tokens must be positive'));
    }
    if (tokens > this.config.burstCapacity) {
      return Promise.reject(
        new Error(`tokens (${tokens}) exceeds burstCapacity (${this.config.burstCapacity})`)
      );
    }
    const result = this.chain.then(() => this.acquireOnce(tokens));
    this.chain = result.catch(() => {
      /* swallow to keep chain alive for subsequent callers */
    });
    return result;
  }

  private async acquireOnce(tokens: number): Promise<void> {
    this.refill();
    while (this.currentTokens < tokens) {
      const deficit = tokens - this.currentTokens;
      const waitMs = Math.ceil((deficit / this.config.tokensPerSecond) * 1000);
      await this.clock.sleep(waitMs);
      this.refill();
    }
    this.currentTokens -= tokens;
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsedMs = now - this.lastRefillTimeMs;
    if (elapsedMs <= 0) return;
    const refilled = (elapsedMs / 1000) * this.config.tokensPerSecond;
    this.currentTokens = Math.min(this.config.burstCapacity, this.currentTokens + refilled);
    this.lastRefillTimeMs = now;
  }
}
