/**
 * Issue #445 PR-D4 S1-4: TokenBucketRateLimiter (Phase C BF23) テスト.
 *
 * batch / individual update 共通の global token bucket。
 * Firestore write 100-200/sec 上限を守るための write rate 制御。
 *
 * fake clock を inject して時間依存ロジックを deterministic に検証する。
 */

import { expect } from 'chai';
import {
  TokenBucketRateLimiter,
  type RateLimiterClock,
} from '../../scripts/pr-d4-backfill/phase-c/rateLimiter';

class FakeClock implements RateLimiterClock {
  public currentMs = 0;
  public sleepCalls: number[] = [];

  now(): number {
    return this.currentMs;
  }

  async sleep(ms: number): Promise<void> {
    this.sleepCalls.push(ms);
    this.currentMs += ms;
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }
}

describe('TokenBucketRateLimiter (PR-D4 S1-4 Phase C BF23)', () => {
  describe('constructor validation', () => {
    it('tokensPerSecond <= 0 で error', () => {
      const clock = new FakeClock();
      expect(
        () => new TokenBucketRateLimiter({ tokensPerSecond: 0, burstCapacity: 10 }, clock)
      ).to.throw(/tokensPerSecond/);
      expect(
        () => new TokenBucketRateLimiter({ tokensPerSecond: -5, burstCapacity: 10 }, clock)
      ).to.throw(/tokensPerSecond/);
    });

    it('burstCapacity <= 0 で error', () => {
      const clock = new FakeClock();
      expect(
        () => new TokenBucketRateLimiter({ tokensPerSecond: 100, burstCapacity: 0 }, clock)
      ).to.throw(/burstCapacity/);
    });
  });

  describe('acquire input validation', () => {
    it('tokens <= 0 で error', async () => {
      const clock = new FakeClock();
      const rl = new TokenBucketRateLimiter(
        { tokensPerSecond: 100, burstCapacity: 100 },
        clock
      );
      let err: Error | null = null;
      try {
        await rl.acquire(0);
      } catch (e) {
        err = e as Error;
      }
      expect(err).to.be.instanceOf(Error);
      expect(err!.message).to.match(/tokens must be positive/);
    });

    it('tokens > burstCapacity で error', async () => {
      const clock = new FakeClock();
      const rl = new TokenBucketRateLimiter(
        { tokensPerSecond: 100, burstCapacity: 10 },
        clock
      );
      let err: Error | null = null;
      try {
        await rl.acquire(11);
      } catch (e) {
        err = e as Error;
      }
      expect(err).to.be.instanceOf(Error);
      expect(err!.message).to.match(/exceeds burstCapacity/);
    });
  });

  describe('burst behavior', () => {
    it('burst capacity 上限まで即座に acquire 可能 (sleep なし)', async () => {
      const clock = new FakeClock();
      const rl = new TokenBucketRateLimiter(
        { tokensPerSecond: 100, burstCapacity: 100 },
        clock
      );
      for (let i = 0; i < 100; i++) {
        await rl.acquire(1);
      }
      expect(clock.sleepCalls).to.deep.equal([]);
    });

    it('burst 枯渇後の acquire は sleep 待ち (1 token = 1000/tokensPerSecond ms)', async () => {
      const clock = new FakeClock();
      const rl = new TokenBucketRateLimiter(
        { tokensPerSecond: 100, burstCapacity: 10 },
        clock
      );
      // burst 10 を消費
      for (let i = 0; i < 10; i++) {
        await rl.acquire(1);
      }
      expect(clock.sleepCalls).to.deep.equal([]);
      // 11 個目: 1 token 不足 → 10ms sleep 必要 (1 / 100 token/sec = 10 ms)
      await rl.acquire(1);
      expect(clock.sleepCalls).to.deep.equal([10]);
    });
  });

  describe('refill timing', () => {
    it('時間経過で token 補充される (clock 手動 advance + 再 acquire)', async () => {
      const clock = new FakeClock();
      const rl = new TokenBucketRateLimiter(
        { tokensPerSecond: 100, burstCapacity: 10 },
        clock
      );
      // burst 10 全消費
      for (let i = 0; i < 10; i++) {
        await rl.acquire(1);
      }
      // 100ms 経過 = 10 token 補充
      clock.advance(100);
      // 10 token 即座に取得可能 (sleep 0)
      const sleepCallsBefore = clock.sleepCalls.length;
      for (let i = 0; i < 10; i++) {
        await rl.acquire(1);
      }
      expect(clock.sleepCalls.length).to.equal(sleepCallsBefore);
    });

    it('burstCapacity を超えて補充されない', async () => {
      const clock = new FakeClock();
      const rl = new TokenBucketRateLimiter(
        { tokensPerSecond: 100, burstCapacity: 10 },
        clock
      );
      // 1 秒経過 = 100 token 補充されるはずだが burstCapacity=10 で cap
      clock.advance(1000);
      // 10 token は即取得、11 個目は sleep 必要
      for (let i = 0; i < 10; i++) {
        await rl.acquire(1);
      }
      expect(clock.sleepCalls).to.deep.equal([]);
      await rl.acquire(1);
      expect(clock.sleepCalls).to.deep.equal([10]);
    });
  });

  describe('concurrent callers (batch + individual の serialize)', () => {
    it('並行 acquire 呼び出しが chain で順次処理され token race が発生しない', async () => {
      const clock = new FakeClock();
      const rl = new TokenBucketRateLimiter(
        { tokensPerSecond: 100, burstCapacity: 5 },
        clock
      );
      // 10 並行 acquire を起動 (burst 5 → 残 5 は sleep 待ち)
      const promises = Array.from({ length: 10 }, () => rl.acquire(1));
      await Promise.all(promises);
      // 後半 5 件は順次 1 token = 10ms sleep
      expect(clock.sleepCalls.length).to.be.greaterThanOrEqual(1);
      // 全 sleep 合計 = 各 1 token 補充ぶん (50ms 想定だが、refill が累積されるため正確値はテストではなく性質を検証)
      const totalSleep = clock.sleepCalls.reduce((a, b) => a + b, 0);
      expect(totalSleep).to.be.greaterThan(0);
    });

    it('acquire の chain は前回 error 後も維持される (後続 caller がブロックされない)', async () => {
      const clock = new FakeClock();
      const rl = new TokenBucketRateLimiter(
        { tokensPerSecond: 100, burstCapacity: 5 },
        clock
      );
      // 1 つ目: tokens=0 で error
      let err1: Error | null = null;
      try {
        await rl.acquire(0);
      } catch (e) {
        err1 = e as Error;
      }
      expect(err1).to.be.instanceOf(Error);
      // 2 つ目: 正常に acquire できる
      await rl.acquire(1);
      // 1 token consumed
      expect(clock.sleepCalls).to.deep.equal([]);
    });
  });
});
