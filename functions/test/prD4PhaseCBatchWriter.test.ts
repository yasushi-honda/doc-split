/**
 * Issue #445 PR-D4 S1-4: processBatch (Phase C BF10/BF11/BF14/BF18/BF23) テスト.
 *
 * 20 docs/batch + lastUpdateTime precondition + immutable skip + rate limiter 通過の
 * 統合挙動を検証。Firestore SDK / GCS は fake adapter で in-memory 模擬。
 */

import { expect } from 'chai';
import { Timestamp } from 'firebase-admin/firestore';
import {
  processBatch,
  type BatchReReadResult,
  type BatchUpdateEntry,
  type CommitBatchResult,
  type FirestoreBatchAdapter,
} from '../../scripts/pr-d4-backfill/phase-c/batchWriter';
import type { RateLimiter } from '../../scripts/pr-d4-backfill/phase-c/rateLimiter';
import type { PhaseBRevalidatedCandidate } from '../../scripts/pr-d4-backfill/types';

class FakeRateLimiter implements RateLimiter {
  public acquireCalls: number[] = [];
  async acquire(tokens: number = 1): Promise<void> {
    this.acquireCalls.push(tokens);
  }
}

class FakeBatchAdapter implements FirestoreBatchAdapter {
  public reReadCalls: string[][] = [];
  public commitCalls: BatchUpdateEntry[][] = [];
  public snapshots = new Map<string, BatchReReadResult>();
  public commitBehavior: 'ok' | 'precondition-fail' | 'transient-fail' = 'ok';
  /** commit 後の updateTime 固定値 */
  public commitUpdateTime = '2026-05-15T01:00:00.000Z';

  async reReadForBatch(docIds: string[]): Promise<Map<string, BatchReReadResult>> {
    this.reReadCalls.push([...docIds]);
    const result = new Map<string, BatchReReadResult>();
    for (const docId of docIds) {
      const snap = this.snapshots.get(docId);
      if (snap) result.set(docId, snap);
    }
    return result;
  }

  async commitBatch(entries: BatchUpdateEntry[]): Promise<CommitBatchResult> {
    this.commitCalls.push(entries);
    if (this.commitBehavior === 'precondition-fail') {
      return {
        kind: 'batch-failed',
        reason: 'precondition',
        message: 'lastUpdateTime drift in at least one doc',
      };
    }
    if (this.commitBehavior === 'transient-fail') {
      return {
        kind: 'batch-failed',
        reason: 'transient',
        message: 'network timeout',
      };
    }
    return {
      kind: 'ok',
      writeResults: entries.map((e) => ({
        docId: e.docId,
        updateTime: this.commitUpdateTime,
      })),
    };
  }
}

function buildCandidate(
  docId: string,
  overrides: Partial<PhaseBRevalidatedCandidate> = {}
): PhaseBRevalidatedCandidate {
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
    ...overrides,
  };
}

function freshDeps() {
  const rateLimiter = new FakeRateLimiter();
  const adapter = new FakeBatchAdapter();
  return { rateLimiter, adapter };
}

const BACKFILL_SCRIPT_VERSION = 'pr-d4-v1.0';

describe('processBatch (PR-D4 S1-4 Phase C BF10/BF11/BF14/BF18/BF23)', () => {
  describe('happy path (BF10/BF11)', () => {
    it('20 docs 全部 batch 成功 → writtenDocs 完備', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const candidates = Array.from({ length: 20 }, (_, i) => buildCandidate(`doc-${i}`));
      for (const c of candidates) {
        adapter.snapshots.set(c.docId, {
          exists: true,
          updateTime: '2026-05-14T22:00:00.000Z',
          provenance: undefined,
          provenanceBackfill: undefined,
        });
      }

      const result = await processBatch(
        {
          candidates,
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );

      expect(result.outcome).to.equal('all-committed');
      if (result.outcome !== 'all-committed') throw new Error('unreachable');
      expect(result.writtenDocs).to.have.length(20);
      expect(result.immutableSkippedDocs).to.deep.equal([]);
      expect(result.unprocessableDocs).to.deep.equal([]);
      expect(result.outOfScopeDocs).to.deep.equal([]);
      // 全 writtenDoc が writeStatus=ok + sha256 + lastUpdateTimeAfter
      for (const w of result.writtenDocs) {
        expect(w.writeStatus).to.equal('ok');
        expect(w.newProvenanceBackfillSha256).to.match(/^[0-9a-f]{64}$/);
        expect(w.lastUpdateTimeAfter).to.equal('2026-05-15T01:00:00.000Z');
      }
    });

    it('commitBatch entries に lastUpdateTimePrecondition (Phase B 再読込値) が渡される', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const candidates = [buildCandidate('d1'), buildCandidate('d2')];
      adapter.snapshots.set('d1', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });
      adapter.snapshots.set('d2', {
        exists: true,
        updateTime: '2026-05-14T22:01:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });
      await processBatch(
        {
          candidates,
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(adapter.commitCalls.length).to.equal(1);
      const entries = adapter.commitCalls[0];
      expect(entries.find((e) => e.docId === 'd1')!.lastUpdateTimePrecondition).to.equal(
        '2026-05-14T22:00:00.000Z'
      );
      expect(entries.find((e) => e.docId === 'd2')!.lastUpdateTimePrecondition).to.equal(
        '2026-05-14T22:01:00.000Z'
      );
    });
  });

  describe('immutable skip (BF14)', () => {
    it('provenance 存在 + provenanceBackfill 不在 doc は batch から除外', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const candidates = [buildCandidate('verified'), buildCandidate('new')];
      adapter.snapshots.set('verified', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: { sourceSha256: 'x' }, // 既存 verified
        provenanceBackfill: undefined,
      });
      adapter.snapshots.set('new', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });

      const result = await processBatch(
        {
          candidates,
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );

      expect(result.outcome).to.equal('all-committed');
      if (result.outcome !== 'all-committed') throw new Error('unreachable');
      expect(result.writtenDocs).to.have.length(1);
      expect(result.writtenDocs[0].docId).to.equal('new');
      expect(result.immutableSkippedDocs).to.have.length(1);
      expect(result.immutableSkippedDocs[0].docId).to.equal('verified');
      expect(adapter.commitCalls[0].map((e) => e.docId)).to.deep.equal(['new']);
    });

    it('全 doc が immutable skip → commitBatch 呼ばれず all-committed(writtenDocs=[]) で返る', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const candidates = [buildCandidate('v1'), buildCandidate('v2')];
      for (const c of candidates) {
        adapter.snapshots.set(c.docId, {
          exists: true,
          updateTime: '2026-05-14T22:00:00.000Z',
          provenance: { sourceSha256: 'x' },
          provenanceBackfill: undefined,
        });
      }
      const result = await processBatch(
        {
          candidates,
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(result.outcome).to.equal('all-committed');
      if (result.outcome !== 'all-committed') throw new Error('unreachable');
      expect(result.writtenDocs).to.have.length(0);
      expect(result.immutableSkippedDocs).to.have.length(2);
      expect(adapter.commitCalls).to.have.length(0);
    });
  });

  describe('unprocessable doc handling (Codex 5th C2)', () => {
    it('doc 不在 (re-read で exists=false) → unprocessableDocs.reason="missing" に記録', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const candidates = [buildCandidate('found'), buildCandidate('missing')];
      adapter.snapshots.set('found', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });
      adapter.snapshots.set('missing', {
        exists: false,
        provenance: undefined,
        provenanceBackfill: undefined,
      });
      const result = await processBatch(
        {
          candidates,
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(result.outcome).to.equal('all-committed');
      if (result.outcome !== 'all-committed') throw new Error('unreachable');
      expect(result.writtenDocs.map((w) => w.docId)).to.deep.equal(['found']);
      expect(result.unprocessableDocs).to.deep.equal([{ docId: 'missing', reason: 'missing' }]);
    });

    it('provenance fields に invalid sha256 が含まれる → unprocessableDocs.reason="validation"', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const broken = buildCandidate('broken');
      broken.computedProvenance.derivedSha256 = 'not-a-sha256'; // ProvenanceValidationError 誘発
      adapter.snapshots.set('broken', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });
      const result = await processBatch(
        {
          candidates: [broken],
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(result.outcome).to.equal('all-committed');
      if (result.outcome !== 'all-committed') throw new Error('unreachable');
      expect(result.writtenDocs).to.have.length(0);
      expect(result.unprocessableDocs).to.have.length(1);
      expect(result.unprocessableDocs[0].docId).to.equal('broken');
      expect(result.unprocessableDocs[0].reason).to.equal('validation');
      expect(result.unprocessableDocs[0].message).to.match(/derivedSha256/);
    });
  });

  describe('out-of-scope hard-gate (Codex 5th C1、impl-plan §4.0)', () => {
    it('category !== MatchedByHash → outOfScopeDocs に分類 (書込なし)', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const c = buildCandidate('amb');
      c.category = 'Ambiguous';
      c.computedConfidence = 'child-snapshot-only';
      adapter.snapshots.set('amb', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });
      const result = await processBatch(
        {
          candidates: [c],
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(result.outcome).to.equal('all-committed');
      if (result.outcome !== 'all-committed') throw new Error('unreachable');
      expect(result.writtenDocs).to.have.length(0);
      expect(result.outOfScopeDocs).to.deep.equal([
        {
          docId: 'amb',
          reason: 'category not MatchedByHash',
          observedCategory: 'Ambiguous',
          observedConfidence: 'child-snapshot-only',
        },
      ]);
      // hard-gate で commit / reReadForBatch すら呼ばれない
      expect(adapter.commitCalls).to.have.length(0);
      expect(adapter.reReadCalls).to.have.length(0);
    });

    it('MatchedByHash + confidence !== derived-bytes-verified → outOfScopeDocs に分類', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const c = buildCandidate('snapshot');
      c.computedConfidence = 'child-snapshot-only'; // MatchedByHash のままだが confidence 違い
      const result = await processBatch(
        {
          candidates: [c],
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(result.outcome).to.equal('all-committed');
      if (result.outcome !== 'all-committed') throw new Error('unreachable');
      expect(result.outOfScopeDocs[0].reason).to.equal('confidence not derived-bytes-verified');
      expect(result.outOfScopeDocs[0].observedConfidence).to.equal('child-snapshot-only');
    });
  });

  describe('batch failure (BF18 caller fallback 用)', () => {
    it('precondition 失敗 → outcome=batch-failed + candidatesForFallback (skip/missing 除外)', async () => {
      const { rateLimiter, adapter } = freshDeps();
      adapter.commitBehavior = 'precondition-fail';
      const candidates = [
        buildCandidate('a'),
        buildCandidate('b'),
        buildCandidate('verified'),
        buildCandidate('missing'),
      ];
      adapter.snapshots.set('a', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });
      adapter.snapshots.set('b', {
        exists: true,
        updateTime: '2026-05-14T22:01:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });
      adapter.snapshots.set('verified', {
        exists: true,
        updateTime: '2026-05-14T22:02:00.000Z',
        provenance: { sourceSha256: 'x' },
        provenanceBackfill: undefined,
      });
      adapter.snapshots.set('missing', {
        exists: false,
        provenance: undefined,
        provenanceBackfill: undefined,
      });

      const result = await processBatch(
        {
          candidates,
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(result.outcome).to.equal('batch-failed');
      if (result.outcome !== 'batch-failed') throw new Error('unreachable');
      expect(result.candidatesForFallback.map((c) => c.docId)).to.deep.equal(['a', 'b']);
      expect(result.immutableSkippedDocs.map((s) => s.docId)).to.deep.equal(['verified']);
      expect(result.unprocessableDocs).to.deep.equal([{ docId: 'missing', reason: 'missing' }]);
      expect(result.lastUpdateTimePreconditions.get('a')).to.equal('2026-05-14T22:00:00.000Z');
      expect(result.lastUpdateTimePreconditions.get('b')).to.equal('2026-05-14T22:01:00.000Z');
      expect(result.failureReason).to.match(/precondition/);
    });

    it('transient 失敗 → outcome=batch-failed + reason=transient', async () => {
      const { rateLimiter, adapter } = freshDeps();
      adapter.commitBehavior = 'transient-fail';
      const candidates = [buildCandidate('a')];
      adapter.snapshots.set('a', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });
      const result = await processBatch(
        {
          candidates,
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(result.outcome).to.equal('batch-failed');
      if (result.outcome !== 'batch-failed') throw new Error('unreachable');
      expect(result.failureReason).to.match(/transient/);
    });
  });

  describe('rate limiter (BF23)', () => {
    it('rateLimiter.acquire が eligible 数 (=10) で 1 度呼ばれる (batch 内 1 acquire)', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const candidates = Array.from({ length: 10 }, (_, i) => buildCandidate(`doc-${i}`));
      for (const c of candidates) {
        adapter.snapshots.set(c.docId, {
          exists: true,
          updateTime: '2026-05-14T22:00:00.000Z',
          provenance: undefined,
          provenanceBackfill: undefined,
        });
      }
      await processBatch(
        {
          candidates,
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(rateLimiter.acquireCalls).to.deep.equal([10]);
    });

    it('immutable skip 除外後の eligible 数のみ rate limiter token 消費', async () => {
      const { rateLimiter, adapter } = freshDeps();
      // 全 6 doc を verified (skip) + 1 doc 通常
      const candidates = [
        ...Array.from({ length: 6 }, (_, i) => buildCandidate(`v-${i}`)),
        buildCandidate('new-1'),
      ];
      for (let i = 0; i < 6; i++) {
        adapter.snapshots.set(`v-${i}`, {
          exists: true,
          updateTime: '2026-05-14T22:00:00.000Z',
          provenance: { sourceSha256: 'x' },
          provenanceBackfill: undefined,
        });
      }
      adapter.snapshots.set('new-1', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: undefined,
        provenanceBackfill: undefined,
      });
      await processBatch(
        {
          candidates,
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      // eligible 1 件のみ acquire される (skip 分は token 消費しない)
      expect(rateLimiter.acquireCalls).to.deep.equal([1]);
    });

    it('全 doc が immutable skip → rateLimiter.acquire は呼ばれない (commit 不要)', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const candidates = [buildCandidate('v1')];
      adapter.snapshots.set('v1', {
        exists: true,
        updateTime: '2026-05-14T22:00:00.000Z',
        provenance: { sourceSha256: 'x' },
        provenanceBackfill: undefined,
      });
      await processBatch(
        {
          candidates,
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(rateLimiter.acquireCalls).to.deep.equal([]);
    });
  });

  describe('empty input', () => {
    it('candidates=[] → outcome=all-committed (writtenDocs=[]) で returnreReadForBatch も commit も呼ばない', async () => {
      const { rateLimiter, adapter } = freshDeps();
      const result = await processBatch(
        {
          candidates: [],
          backfillScriptVersion: BACKFILL_SCRIPT_VERSION,
          backfilledAt: Timestamp.fromDate(new Date('2026-05-15T00:00:00.000Z')),
        },
        adapter,
        rateLimiter
      );
      expect(result.outcome).to.equal('all-committed');
      if (result.outcome !== 'all-committed') throw new Error('unreachable');
      expect(result.writtenDocs).to.deep.equal([]);
      expect(adapter.reReadCalls).to.have.length(0);
      expect(adapter.commitCalls).to.have.length(0);
    });
  });
});
