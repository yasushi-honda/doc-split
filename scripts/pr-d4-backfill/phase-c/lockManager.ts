/**
 * Issue #445 PR-D4 S1-4: Phase C GCS sentinel object 排他 lock (BF16/BF21).
 *
 * impl-plan §4.3 step 1-2 + §7.3 + Codex 2nd C2 / 3rd I1/I2 反映:
 *   `gs://{env-bucket}/pr-d4-backfill-locks/{env}-phase-c.lock` を `ifGenerationMatch:0`
 *   precondition で create。既存 lock 検出 → abort。release は acquired generation 付き
 *   delete のみ許可 (stale lock 上書き事故防止)。
 *
 * 設計判断:
 * - 依存性逆転: `LockObjectStore` interface 経由で GCS Bucket を受け取り、unit test では
 *   in-memory fake で test 可能 (Phase A/B の Writer pattern と同じ)
 * - lock body は `PhaseCLockBody` を JSON 化、`lockSchemaVersion` 付きで parse 失敗時の
 *   人間判断材料を残す
 * - lease 60 min は本 module では強制しない (impl-plan §4.3 step 2: 自動 takeover 禁止、
 *   解放は runbook 経由の手動のみ)。lease タイムスタンプは body に記録するだけ
 * - lockOwner は caller が指定 ('github-actions-run-{N}' / 'manual-cli' 等)
 */

import type { BackfillEnvName, PhaseCLockBody } from '../types';
import { PR_D4_ARTIFACT_SCHEMA_VERSION } from '../types';

/**
 * GCS object として lock を扱うための interface (依存性逆転)。
 *
 * production 実装は `adapters.ts` で `@google-cloud/storage` Bucket を使う。
 * unit test 用 fake 実装は in-memory map で十分。
 */
export interface LockObjectStore {
  /**
   * `ifGenerationMatch:0` で create を試行。
   * - 成功 → { acquired: true, generation }
   * - 既存 lock 検出 → { acquired: false, existing: { body, generation } } (caller が abort)
   * その他の error (network 等) は throw。
   */
  acquire(input: { path: string; body: string }): Promise<AcquireResult>;
  /**
   * `ifGenerationMatch:<acquiredGeneration>` 付き delete。precondition 失敗 / network error は throw。
   */
  release(input: { path: string; acquiredGeneration: string }): Promise<void>;
}

export type AcquireResult =
  | { acquired: true; generation: string }
  | { acquired: false; existing: { body: string; generation: string } };

/**
 * `gs://{bucket}/pr-d4-backfill-locks/{env}-phase-c.lock` 形式の object path を構築。
 */
export function buildPhaseCLockPath(bucketName: string, env: BackfillEnvName): string {
  return `gs://${bucketName}/pr-d4-backfill-locks/${env}-phase-c.lock`;
}

export interface AcquireLockInput {
  bucketName: string;
  env: BackfillEnvName;
  runId: string;
  jobId: string;
  startedAt: string;
  expectedDurationSec: number;
  lockOwner: string;
}

export interface AcquireLockSuccess {
  lockPath: string;
  acquiredGeneration: string;
  body: PhaseCLockBody;
}

/**
 * Existing lock detection error.
 * Orchestrator が catch して abort + 既存 lock body をログ記録 (人間判断材料)。
 */
export class LockHeldByOthersError extends Error {
  constructor(
    public readonly lockPath: string,
    public readonly existingBody: string,
    public readonly existingGeneration: string,
    public readonly parsedExistingBody: PhaseCLockBody | null
  ) {
    super(
      `Phase C lock held by another runner (path=${lockPath}, generation=${existingGeneration})`
    );
    this.name = 'LockHeldByOthersError';
  }
}

/**
 * Phase C 排他 lock 取得 (impl-plan §4.3 step 1)。
 *
 * 既存 lock 検出時は `LockHeldByOthersError` を throw し、orchestrator が既存 body を
 * ログ出力した上で early abort する。
 */
export async function acquirePhaseCLock(
  input: AcquireLockInput,
  store: LockObjectStore
): Promise<AcquireLockSuccess> {
  const lockPath = buildPhaseCLockPath(input.bucketName, input.env);
  const body: PhaseCLockBody = {
    lockSchemaVersion: PR_D4_ARTIFACT_SCHEMA_VERSION,
    runId: input.runId,
    jobId: input.jobId,
    startedAt: input.startedAt,
    expectedDurationSec: input.expectedDurationSec,
    lockOwner: input.lockOwner,
  };
  const bodyContent = JSON.stringify(body);
  const result = await store.acquire({ path: lockPath, body: bodyContent });
  if (!result.acquired) {
    let parsed: PhaseCLockBody | null = null;
    try {
      parsed = JSON.parse(result.existing.body) as PhaseCLockBody;
    } catch {
      parsed = null;
    }
    throw new LockHeldByOthersError(
      lockPath,
      result.existing.body,
      result.existing.generation,
      parsed
    );
  }
  return { lockPath, acquiredGeneration: result.generation, body };
}

export interface ReleaseLockInput {
  lockPath: string;
  acquiredGeneration: string;
}

/**
 * Phase C 排他 lock 解放 (BF21)。`ifGenerationMatch:<acquiredGeneration>` 必須。
 * stale lock 上書きで他 Job の lock を消す事故を防止。
 */
export async function releasePhaseCLock(
  input: ReleaseLockInput,
  store: LockObjectStore
): Promise<void> {
  await store.release({
    path: input.lockPath,
    acquiredGeneration: input.acquiredGeneration,
  });
}
