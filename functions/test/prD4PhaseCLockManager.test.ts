/**
 * Issue #445 PR-D4 S1-4: Phase C lockManager (BF16/BF21) テスト.
 *
 * GCS sentinel object 排他 lock の取得 / 解放 / 並走検出 / generation mismatch 検証。
 */

import { expect } from 'chai';
import {
  acquirePhaseCLock,
  buildPhaseCLockPath,
  LockHeldByOthersError,
  releasePhaseCLock,
  type AcquireResult,
  type LockObjectStore,
} from '../../scripts/pr-d4-backfill/phase-c/lockManager';

/**
 * In-memory fake: 1 path につき 1 object。generation は increment。
 */
class FakeLockStore implements LockObjectStore {
  private objects = new Map<string, { body: string; generation: number }>();
  private nextGeneration = 1;
  public acquireCalls: { path: string; body: string }[] = [];
  public releaseCalls: { path: string; acquiredGeneration: string }[] = [];

  async acquire(input: { path: string; body: string }): Promise<AcquireResult> {
    this.acquireCalls.push(input);
    const existing = this.objects.get(input.path);
    if (existing) {
      return {
        acquired: false,
        existing: { body: existing.body, generation: String(existing.generation) },
      };
    }
    const generation = this.nextGeneration++;
    this.objects.set(input.path, { body: input.body, generation });
    return { acquired: true, generation: String(generation) };
  }

  async release(input: { path: string; acquiredGeneration: string }): Promise<void> {
    this.releaseCalls.push(input);
    const existing = this.objects.get(input.path);
    if (!existing) {
      throw new Error(`lock not found: ${input.path}`);
    }
    if (String(existing.generation) !== input.acquiredGeneration) {
      throw new Error(
        `generation mismatch: expected=${input.acquiredGeneration}, actual=${existing.generation}`
      );
    }
    this.objects.delete(input.path);
  }

  // 試験用 helper
  seedExistingLock(path: string, body: string): string {
    const generation = this.nextGeneration++;
    this.objects.set(path, { body, generation });
    return String(generation);
  }
}

function baseInput() {
  return {
    bucketName: 'docsplit-dev-pr-d4-artifacts',
    env: 'dev' as const,
    runId: '20260515T000000Z-dev-pr-d4-v1',
    jobId: 'job-abc-001',
    startedAt: '2026-05-15T00:00:00.000Z',
    expectedDurationSec: 3600,
    lockOwner: 'github-actions-run-100',
  };
}

describe('lockManager (PR-D4 S1-4 Phase C BF16/BF21)', () => {
  describe('buildPhaseCLockPath', () => {
    it('expected GCS path 形式 (gs://{bucket}/pr-d4-backfill-locks/{env}-phase-c.lock)', () => {
      const path = buildPhaseCLockPath('docsplit-dev-pr-d4-artifacts', 'dev');
      expect(path).to.equal(
        'gs://docsplit-dev-pr-d4-artifacts/pr-d4-backfill-locks/dev-phase-c.lock'
      );
    });
    it('env が cocoro / kanameone でも path が正しく生成される', () => {
      expect(buildPhaseCLockPath('b1', 'cocoro')).to.equal(
        'gs://b1/pr-d4-backfill-locks/cocoro-phase-c.lock'
      );
      expect(buildPhaseCLockPath('b2', 'kanameone')).to.equal(
        'gs://b2/pr-d4-backfill-locks/kanameone-phase-c.lock'
      );
    });
  });

  describe('acquirePhaseCLock', () => {
    it('既存 lock なし → acquired=true + body 完備', async () => {
      const store = new FakeLockStore();
      const result = await acquirePhaseCLock(baseInput(), store);
      expect(result.lockPath).to.equal(
        'gs://docsplit-dev-pr-d4-artifacts/pr-d4-backfill-locks/dev-phase-c.lock'
      );
      expect(result.acquiredGeneration).to.equal('1');
      expect(result.body.runId).to.equal('20260515T000000Z-dev-pr-d4-v1');
      expect(result.body.lockOwner).to.equal('github-actions-run-100');
      expect(result.body.lockSchemaVersion).to.equal('pr-d4-v1.0');
    });

    it('store に投げる body は JSON 文字列で PhaseCLockBody 全 field を含む', async () => {
      const store = new FakeLockStore();
      await acquirePhaseCLock(baseInput(), store);
      expect(store.acquireCalls.length).to.equal(1);
      const parsed = JSON.parse(store.acquireCalls[0].body);
      expect(parsed).to.deep.equal({
        lockSchemaVersion: 'pr-d4-v1.0',
        runId: '20260515T000000Z-dev-pr-d4-v1',
        jobId: 'job-abc-001',
        startedAt: '2026-05-15T00:00:00.000Z',
        expectedDurationSec: 3600,
        lockOwner: 'github-actions-run-100',
      });
    });

    it('既存 lock あり → LockHeldByOthersError throw + 既存 body / generation / parsed body を保持', async () => {
      const store = new FakeLockStore();
      const lockPath = buildPhaseCLockPath('docsplit-dev-pr-d4-artifacts', 'dev');
      const existingBody = JSON.stringify({
        lockSchemaVersion: 'pr-d4-v1.0',
        runId: 'old-run-id',
        jobId: 'old-job',
        startedAt: '2026-05-14T00:00:00.000Z',
        expectedDurationSec: 3600,
        lockOwner: 'github-actions-run-99',
      });
      store.seedExistingLock(lockPath, existingBody);

      let err: LockHeldByOthersError | null = null;
      try {
        await acquirePhaseCLock(baseInput(), store);
      } catch (e) {
        err = e as LockHeldByOthersError;
      }
      expect(err).to.be.instanceOf(LockHeldByOthersError);
      expect(err!.lockPath).to.equal(lockPath);
      expect(err!.existingBody).to.equal(existingBody);
      expect(err!.existingGeneration).to.equal('1');
      expect(err!.parsedExistingBody?.runId).to.equal('old-run-id');
    });

    it('既存 lock body が JSON parse 失敗 → parsedExistingBody=null (人間判断材料)', async () => {
      const store = new FakeLockStore();
      const lockPath = buildPhaseCLockPath('docsplit-dev-pr-d4-artifacts', 'dev');
      store.seedExistingLock(lockPath, 'not a json {');

      let err: LockHeldByOthersError | null = null;
      try {
        await acquirePhaseCLock(baseInput(), store);
      } catch (e) {
        err = e as LockHeldByOthersError;
      }
      expect(err).to.be.instanceOf(LockHeldByOthersError);
      expect(err!.existingBody).to.equal('not a json {');
      expect(err!.parsedExistingBody).to.be.null;
    });
  });

  describe('releasePhaseCLock', () => {
    it('acquire → release で lock 解放成功 (object 不在になる)', async () => {
      const store = new FakeLockStore();
      const acquired = await acquirePhaseCLock(baseInput(), store);
      await releasePhaseCLock(
        { lockPath: acquired.lockPath, acquiredGeneration: acquired.acquiredGeneration },
        store
      );
      expect(store.releaseCalls.length).to.equal(1);
      // 解放後は再 acquire 可能 (object 削除確認)
      const reacquired = await acquirePhaseCLock(baseInput(), store);
      expect(reacquired.acquiredGeneration).to.equal('2');
    });

    it('release で generation mismatch → error throw (stale lock 上書き事故防止 BF21)', async () => {
      const store = new FakeLockStore();
      const acquired = await acquirePhaseCLock(baseInput(), store);
      let err: Error | null = null;
      try {
        await releasePhaseCLock(
          { lockPath: acquired.lockPath, acquiredGeneration: '999' },
          store
        );
      } catch (e) {
        err = e as Error;
      }
      expect(err).to.be.instanceOf(Error);
      expect(err!.message).to.match(/generation mismatch/);
    });

    it('release で lock 不在 → error throw (二重 release / 既に release 済の検出)', async () => {
      const store = new FakeLockStore();
      const acquired = await acquirePhaseCLock(baseInput(), store);
      await releasePhaseCLock(
        { lockPath: acquired.lockPath, acquiredGeneration: acquired.acquiredGeneration },
        store
      );
      let err: Error | null = null;
      try {
        await releasePhaseCLock(
          { lockPath: acquired.lockPath, acquiredGeneration: acquired.acquiredGeneration },
          store
        );
      } catch (e) {
        err = e as Error;
      }
      expect(err).to.be.instanceOf(Error);
      expect(err!.message).to.match(/lock not found/);
    });
  });
});
