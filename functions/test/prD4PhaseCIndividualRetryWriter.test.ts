/**
 * Issue #445 PR-D4 S1-4: processFallback (Phase C BF18/BF23) テスト.
 *
 * batch 失敗時の doc 単位 fallback。precondition-failed / transient retry max / 隔離挙動。
 */

import { expect } from 'chai';
import { Timestamp } from 'firebase-admin/firestore';
import {
  processFallback,
  type FirestoreIndividualAdapter,
  type IndividualUpdateInput,
  type IndividualUpdateResult,
} from '../../scripts/pr-d4-backfill/phase-c/individualRetryWriter';
import type { RateLimiter } from '../../scripts/pr-d4-backfill/phase-c/rateLimiter';
import type { PhaseBRevalidatedCandidate } from '../../scripts/pr-d4-backfill/types';

class FakeRateLimiter implements RateLimiter {
  public acquireCalls: number[] = [];
  async acquire(tokens: number = 1): Promise<void> {
    this.acquireCalls.push(tokens);
  }
}

class FakeIndividualAdapter implements FirestoreIndividualAdapter {
  public updateCalls: IndividualUpdateInput[] = [];
  /** docId → 各 attempt の結果 (順次消費)。`[ok, ok]` ならどの attempt も ok */
  public behavior = new Map<string, IndividualUpdateResult[]>();
  /** behavior の現在 index */
  private attemptIndex = new Map<string, number>();

  async updateOne(input: IndividualUpdateInput): Promise<IndividualUpdateResult> {
    this.updateCalls.push(input);
    const scenarios = this.behavior.get(input.docId) ?? [
      { kind: 'ok', updateTime: '2026-05-15T01:00:00.000Z' },
    ];
    const idx = this.attemptIndex.get(input.docId) ?? 0;
    const scenario = scenarios[Math.min(idx, scenarios.length - 1)];
    this.attemptIndex.set(input.docId, idx + 1);
    return scenario;
  }
}

function buildCandidate(docId: string): PhaseBRevalidatedCandidate {
  return {
    docId,
    category: 'MatchedByHash',
    computedConfidence: 'derived-bytes-verified',
    computedProvenance: {
      sourceGeneration: '1000',
      sourceMetageneration: '1',
      sourceSha256: 'a'.repeat(64),
      sourcePath: 'original/parent.pdf',
      sourceBucket: 'docsplit-dev-storage',
      derivedObjectPath: `processed/${docId}.pdf`,
      derivedGeneration: '2000',
      derivedMetageneration: '1',
      derivedSha256: 'b'.repeat(64),
      createdAt: '2026-05-13T10:00:00.000Z',
    },
    evidence: {
      parentExists: true,
      parentSha256MatchedAtBackfill: true,
      childSha256ComputedAtBackfill: true,
    },
  };
}

function preconditionMap(docIds: string[]): Map<string, string> {
  return new Map(docIds.map((d) => [d, '2026-05-14T22:00:00.000Z']));
}

const BASE_INPUT = {
  backfillScriptVersion: 'pr-d4-v1.0',
  backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
};

describe('processFallback (PR-D4 S1-4 Phase C BF18/BF23)', () => {
  describe('happy path', () => {
    it('全 doc 1 attempt で成功 → writtenDocs 完備、preconditionFailedDocs 空', async () => {
      const adapter = new FakeIndividualAdapter();
      const rl = new FakeRateLimiter();
      const candidates = [buildCandidate('a'), buildCandidate('b')];
      const result = await processFallback(
        {
          ...BASE_INPUT,
          candidates,
          lastUpdateTimePreconditions: preconditionMap(['a', 'b']),
        },
        adapter,
        rl
      );
      expect(result.writtenDocs).to.have.length(2);
      expect(result.preconditionFailedDocs).to.deep.equal([]);
      expect(adapter.updateCalls).to.have.length(2);
      expect(rl.acquireCalls).to.deep.equal([1, 1]);
    });
  });

  describe('precondition-failed handling (BF18 drift 隔離)', () => {
    it('precondition-failed は即終了 + preconditionFailedDocs に隔離 (retry なし)', async () => {
      const adapter = new FakeIndividualAdapter();
      adapter.behavior.set('drift', [{ kind: 'precondition-failed' }]);
      const rl = new FakeRateLimiter();
      const candidates = [buildCandidate('drift'), buildCandidate('ok')];
      const result = await processFallback(
        {
          ...BASE_INPUT,
          candidates,
          lastUpdateTimePreconditions: preconditionMap(['drift', 'ok']),
        },
        adapter,
        rl
      );
      expect(result.writtenDocs.map((w) => w.docId)).to.deep.equal(['ok']);
      expect(result.preconditionFailedDocs).to.deep.equal([
        { docId: 'drift', reason: 'lastUpdateTime drift', retryCount: 1 },
      ]);
      // drift doc は 1 attempt のみ (retry なし)、ok doc は 1 attempt = 合計 2 update
      expect(adapter.updateCalls).to.have.length(2);
    });
  });

  describe('transient retry (max=3、BF23 rate limiter 通過)', () => {
    it('transient 2 回 → 3 回目で ok → writtenDocs 1 件 + retryCount 反映なし (成功時は retryCount は記録対象外)', async () => {
      const adapter = new FakeIndividualAdapter();
      adapter.behavior.set('retry', [
        { kind: 'transient', message: 'net 1' },
        { kind: 'transient', message: 'net 2' },
        { kind: 'ok', updateTime: '2026-05-15T01:00:00.000Z' },
      ]);
      const rl = new FakeRateLimiter();
      const result = await processFallback(
        {
          ...BASE_INPUT,
          candidates: [buildCandidate('retry')],
          lastUpdateTimePreconditions: preconditionMap(['retry']),
        },
        adapter,
        rl
      );
      expect(result.writtenDocs).to.have.length(1);
      expect(result.preconditionFailedDocs).to.deep.equal([]);
      expect(adapter.updateCalls).to.have.length(3);
      expect(rl.acquireCalls).to.deep.equal([1, 1, 1]);
    });

    it('transient 3 回連続 → retry exhausted で隔離 (retryCount=3)', async () => {
      const adapter = new FakeIndividualAdapter();
      adapter.behavior.set('flaky', [
        { kind: 'transient', message: 'net 1' },
        { kind: 'transient', message: 'net 2' },
        { kind: 'transient', message: 'net 3' },
      ]);
      const rl = new FakeRateLimiter();
      const result = await processFallback(
        {
          ...BASE_INPUT,
          candidates: [buildCandidate('flaky')],
          lastUpdateTimePreconditions: preconditionMap(['flaky']),
        },
        adapter,
        rl
      );
      expect(result.writtenDocs).to.deep.equal([]);
      expect(result.preconditionFailedDocs).to.deep.equal([
        { docId: 'flaky', reason: 'transient retry exhausted', retryCount: 3 },
      ]);
      expect(adapter.updateCalls).to.have.length(3);
    });

    it('retryMax を override 可能 (test 用、default=3)', async () => {
      const adapter = new FakeIndividualAdapter();
      adapter.behavior.set('flaky', [
        { kind: 'transient', message: 'net 1' },
        { kind: 'transient', message: 'net 2' },
      ]);
      const rl = new FakeRateLimiter();
      const result = await processFallback(
        {
          ...BASE_INPUT,
          candidates: [buildCandidate('flaky')],
          lastUpdateTimePreconditions: preconditionMap(['flaky']),
          retryMax: 2,
        },
        adapter,
        rl
      );
      expect(result.preconditionFailedDocs[0].retryCount).to.equal(2);
    });
  });

  describe('precondition Map 不在 (defense in depth)', () => {
    it('lastUpdateTimePreconditions に entry 不在 → 隔離 retryCount=0 (silent fail させない)', async () => {
      const adapter = new FakeIndividualAdapter();
      const rl = new FakeRateLimiter();
      const result = await processFallback(
        {
          ...BASE_INPUT,
          candidates: [buildCandidate('orphan')],
          lastUpdateTimePreconditions: new Map(),
        },
        adapter,
        rl
      );
      expect(result.preconditionFailedDocs).to.deep.equal([
        { docId: 'orphan', reason: 'lastUpdateTime drift', retryCount: 0 },
      ]);
      expect(adapter.updateCalls).to.have.length(0);
    });
  });

  describe('rate limiter 1 token / attempt (BF23 lock-in)', () => {
    it('複数 doc + 複数 retry でも 各 attempt = 1 token 消費', async () => {
      const adapter = new FakeIndividualAdapter();
      // a: 2 attempts (transient→ok), b: 1 attempt (ok)
      adapter.behavior.set('a', [
        { kind: 'transient', message: 'x' },
        { kind: 'ok', updateTime: '2026-05-15T01:00:00.000Z' },
      ]);
      const rl = new FakeRateLimiter();
      await processFallback(
        {
          ...BASE_INPUT,
          candidates: [buildCandidate('a'), buildCandidate('b')],
          lastUpdateTimePreconditions: preconditionMap(['a', 'b']),
        },
        adapter,
        rl
      );
      // a: 2 attempts → 2 tokens, b: 1 attempt → 1 token, 合計 3
      expect(rl.acquireCalls).to.deep.equal([1, 1, 1]);
    });
  });
});
