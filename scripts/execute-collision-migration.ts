#!/usr/bin/env ts-node
/**
 * Issue #432 PR-C: classify-collision-docs.ts が出力した migration plan を実行
 *
 * 4 重 gate (Codex セカンドオピニオン反映):
 *   1. approval.planId === plan.planId
 *   2. operation.operationId が approval.approvedOperationIds に含まれる
 *   3. (destructive 時) operation の sourcePath/destPath が approval.approvedPaths に含まれる
 *   4. runtime env (projectId / storageBucket) が plan の projectId / bucket と一致
 *   5. precondition (expectedCurrentFileUrl / expectedStatus / expectedUpdatedAt) が現状 doc と一致
 *
 * idempotency: 各 operation は再実行可能。既に完了状態 (新 path 存在 + fileUrl 更新済) なら skip。
 * Storage delete は scripts/lib/storageGuard 経由で同 fileUrl 共有 doc が残存しないことを確認。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=<project-id> STORAGE_BUCKET=<bucket> \
 *     npx ts-node scripts/execute-collision-migration.ts \
 *       --plan plan.json --approval approval.json [--execute] [--operations op-0001,op-0002]
 *
 *   --execute なし: dry-run (Firestore/Storage 書き込みゼロ、執行計画 JSON 出力のみ)
 *   --operations: 個別 operation 限定 (テスト/段階実行)
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import { isPathSafeToDeleteAfterExcluding } from './lib/storageGuard';
import { regenerateChildPdf } from './lib/pdfRegenerator';

const projectId = process.env.FIREBASE_PROJECT_ID;
const storageBucket = process.env.STORAGE_BUCKET;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}
if (!storageBucket) {
  console.error('STORAGE_BUCKET を設定してください');
  process.exit(1);
}

function getOpt(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const planFile = getOpt('--plan');
const approvalFile = getOpt('--approval');
const operationsFilterRaw = getOpt('--operations');
const operationsFilter = operationsFilterRaw
  ? new Set(operationsFilterRaw.split(',').map((s) => s.trim()))
  : null;
const execute = process.argv.includes('--execute');

if (!planFile || !approvalFile) {
  console.error('--plan <plan.json> と --approval <approval.json> は必須です');
  process.exit(1);
}

interface Operation {
  operationId: string;
  docId: string;
  classification: 'MatchedByHash' | 'Ambiguous' | 'RepairableMissingFile' | 'LostOrUnrecoverable';
  recommendedAction:
    | 'migrate-to-namespace'
    | 'regenerate-from-parent'
    | 'manual-review'
    | 'mark-error';
  reason: string;
  suggestedWinner: boolean;
  expectedCurrentFileUrl: string | null;
  expectedStatus: string;
  expectedUpdatedAt: string | null;
  sourcePath: string | null;
  destPath: string | null;
  parentDocumentId: string | null;
  splitFromPages: { start: number; end: number } | null;
  fileName: string;
}

interface Plan {
  planId: string;
  createdAt: string;
  environment: string;
  projectId: string;
  bucket: string;
  prefix: string;
  summary: unknown;
  operations: Operation[];
}

interface Approval {
  planId: string;
  approvedOperationIds: string[];
  approvedPaths: string[];
}

const plan: Plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const approval: Approval = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));

// === Gate 1+4: planId + runtime env 一致 ===
if (approval.planId !== plan.planId) {
  console.error(
    `FATAL: approval.planId (${approval.planId}) !== plan.planId (${plan.planId})`
  );
  process.exit(2);
}
if (plan.projectId !== projectId) {
  console.error(
    `FATAL: plan.projectId (${plan.projectId}) !== runtime FIREBASE_PROJECT_ID (${projectId})`
  );
  process.exit(2);
}
if (plan.bucket !== storageBucket) {
  console.error(
    `FATAL: plan.bucket (${plan.bucket}) !== runtime STORAGE_BUCKET (${storageBucket})`
  );
  process.exit(2);
}

const approvedOpIds = new Set(approval.approvedOperationIds);
const approvedPaths = new Set(approval.approvedPaths);

admin.initializeApp({ projectId, storageBucket });
const db = admin.firestore();
const bucket = admin.storage().bucket();

function tsToIso(ts: unknown): string | null {
  if (!ts) return null;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    return (ts as { toDate(): Date }).toDate().toISOString();
  }
  return String(ts);
}

interface OperationOutcome {
  operationId: string;
  docId: string;
  action: Operation['recommendedAction'];
  status: 'executed' | 'dry-run' | 'skipped' | 'gate-rejected' | 'error';
  reason: string;
  details?: Record<string, unknown>;
}

async function checkPrecondition(op: Operation): Promise<{ ok: boolean; reason: string }> {
  const snap = await db.doc(`documents/${op.docId}`).get();
  if (!snap.exists) {
    return { ok: false, reason: 'doc no longer exists' };
  }
  const data = snap.data()!;
  const currentFileUrl = (data.fileUrl as string | undefined) ?? null;
  const currentStatus = data.status as string;
  const currentUpdatedAt = tsToIso(data.updatedAt);

  if (currentFileUrl !== op.expectedCurrentFileUrl) {
    return {
      ok: false,
      reason: `fileUrl drift: expected=${op.expectedCurrentFileUrl} actual=${currentFileUrl}`,
    };
  }
  if (currentStatus !== op.expectedStatus) {
    return {
      ok: false,
      reason: `status drift: expected=${op.expectedStatus} actual=${currentStatus}`,
    };
  }
  if (currentUpdatedAt !== op.expectedUpdatedAt) {
    return {
      ok: false,
      reason: `updatedAt drift: expected=${op.expectedUpdatedAt} actual=${currentUpdatedAt}`,
    };
  }
  return { ok: true, reason: 'precondition matched' };
}

async function isAlreadyMigrated(op: Operation): Promise<boolean> {
  // idempotency: 新 path に実体ありかつ Firestore fileUrl が新 path 指す → 完了済
  if (op.destPath === null) return false;
  const snap = await db.doc(`documents/${op.docId}`).get();
  if (!snap.exists) return false;
  const expectedNewFileUrl = `gs://${storageBucket}/${op.destPath}`;
  if (snap.data()!.fileUrl !== expectedNewFileUrl) return false;
  const [exists] = await bucket.file(op.destPath).exists();
  return exists;
}

async function executeMigrate(op: Operation): Promise<OperationOutcome> {
  // migrate-to-namespace: 旧 Storage path → 新 docId namespace path に copy → Firestore fileUrl 更新 → 旧 path delete
  if (op.sourcePath === null || op.destPath === null) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'error',
      reason: 'sourcePath or destPath is null',
    };
  }

  const newFileUrl = `gs://${storageBucket}/${op.destPath}`;
  const oldFileUrl = `gs://${storageBucket}/${op.sourcePath}`;

  // 旧 → 新 copy (idempotent: copy 失敗時は再実行可)
  const [destExists] = await bucket.file(op.destPath).exists();
  if (!destExists) {
    await bucket.file(op.sourcePath).copy(bucket.file(op.destPath));
  }

  // Firestore: fileUrl 更新 (Partial update 不変 = fileUrl のみ)
  await db.doc(`documents/${op.docId}`).update({ fileUrl: newFileUrl });

  // 旧 path delete (storageGuard で同 fileUrl 共有 doc 残存確認)
  // 今回更新した自分自身は新 fileUrl になっているため共有者から外れる
  const guard = await isPathSafeToDeleteAfterExcluding(db, oldFileUrl, [op.docId]);
  if (!guard.safe) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'executed',
      reason: 'copied + Firestore updated; old path delete skipped (sharing docs remain)',
      details: {
        newFileUrl,
        oldFileUrl,
        residualDocIds: guard.residualDocIds,
      },
    };
  }

  await bucket.file(op.sourcePath).delete().catch(() => {
    /* idempotent: 既に削除済みなら無視 */
  });
  return {
    operationId: op.operationId,
    docId: op.docId,
    action: op.recommendedAction,
    status: 'executed',
    reason: 'migrated to docId namespace, old path deleted',
    details: { newFileUrl, oldFileUrl },
  };
}

async function executeRegenerate(op: Operation): Promise<OperationOutcome> {
  if (op.parentDocumentId === null || op.splitFromPages === null || op.destPath === null) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'error',
      reason: 'missing parentDocumentId / splitFromPages / destPath',
    };
  }

  // parent PDF download
  const parentSnap = await db.doc(`documents/${op.parentDocumentId}`).get();
  if (!parentSnap.exists) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'error',
      reason: 'parent doc disappeared since plan creation',
    };
  }
  const parentFileUrl = parentSnap.data()!.fileUrl as string;
  const parentPath = parentFileUrl.replace(`gs://${storageBucket}/`, '');
  const [parentBuf] = await bucket.file(parentPath).download();

  const childBuf = await regenerateChildPdf(
    parentBuf,
    op.splitFromPages.start,
    op.splitFromPages.end
  );

  // 新 path に upload (idempotent: 既存 destPath は overwrite)
  await bucket.file(op.destPath).save(childBuf, {
    metadata: { contentType: 'application/pdf' },
  });

  const newFileUrl = `gs://${storageBucket}/${op.destPath}`;

  // Firestore: fileUrl 更新 + status を processed に戻す (元々 processed だった想定だが orphan 由来で error 化したケースも回復)
  // Partial update 不変: fileUrl + status + lastErrorMessage の deleteField のみ
  await db.doc(`documents/${op.docId}`).update({
    fileUrl: newFileUrl,
    status: 'processed',
    lastErrorMessage: admin.firestore.FieldValue.delete(),
  });

  // 旧 path 後始末 (collision group 敗者の場合): storageGuard で安全確認
  if (op.sourcePath !== null && op.sourcePath !== op.destPath) {
    const oldFileUrl = `gs://${storageBucket}/${op.sourcePath}`;
    const guard = await isPathSafeToDeleteAfterExcluding(db, oldFileUrl, [op.docId]);
    if (guard.safe) {
      await bucket.file(op.sourcePath).delete().catch(() => undefined);
    }
  }

  return {
    operationId: op.operationId,
    docId: op.docId,
    action: op.recommendedAction,
    status: 'executed',
    reason: 'regenerated from parent and saved to docId namespace',
    details: {
      newFileUrl,
      regeneratedBytes: childBuf.length,
    },
  };
}

async function executeMarkError(op: Operation): Promise<OperationOutcome> {
  // Partial update 不変 (CLAUDE.md MUST): status + lastErrorMessage のみ更新、他フィールド不変
  await db.doc(`documents/${op.docId}`).update({
    status: 'error',
    lastErrorMessage: `Issue #432 PR-C migration: ${op.reason}`,
  });
  return {
    operationId: op.operationId,
    docId: op.docId,
    action: op.recommendedAction,
    status: 'executed',
    reason: 'marked as error for manual repair',
  };
}

function isPathApproved(op: Operation): { ok: boolean; reason: string } {
  // Gate 3: destructive action は path 認可必須
  if (op.recommendedAction === 'migrate-to-namespace') {
    if (op.sourcePath && !approvedPaths.has(`gs://${storageBucket}/${op.sourcePath}`)) {
      return { ok: false, reason: `sourcePath not in approvedPaths: gs://${storageBucket}/${op.sourcePath}` };
    }
    if (op.destPath && !approvedPaths.has(`gs://${storageBucket}/${op.destPath}`)) {
      return { ok: false, reason: `destPath not in approvedPaths: gs://${storageBucket}/${op.destPath}` };
    }
  }
  if (op.recommendedAction === 'regenerate-from-parent') {
    if (op.destPath && !approvedPaths.has(`gs://${storageBucket}/${op.destPath}`)) {
      return { ok: false, reason: `destPath not in approvedPaths: gs://${storageBucket}/${op.destPath}` };
    }
  }
  // mark-error は Storage 触らないため path 認可不要 (operationId 認可のみで通す)
  return { ok: true, reason: 'path approved' };
}

async function processOperation(op: Operation): Promise<OperationOutcome> {
  // Gate 2: operationId 認可
  if (!approvedOpIds.has(op.operationId)) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'gate-rejected',
      reason: 'operationId not in approvedOperationIds',
    };
  }

  // manual-review はそもそも何もしない
  if (op.recommendedAction === 'manual-review') {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'skipped',
      reason: 'manual-review action: no automated execution',
    };
  }

  // Gate 3: path 認可 (destructive のみ)
  const pathGate = isPathApproved(op);
  if (!pathGate.ok) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'gate-rejected',
      reason: pathGate.reason,
    };
  }

  // Gate 5: precondition snapshot
  const pre = await checkPrecondition(op);
  if (!pre.ok) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'skipped',
      reason: `precondition mismatch: ${pre.reason}`,
    };
  }

  // idempotency: migrate / regenerate で既に完了済 → skip
  if (
    (op.recommendedAction === 'migrate-to-namespace' ||
      op.recommendedAction === 'regenerate-from-parent') &&
    (await isAlreadyMigrated(op))
  ) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'skipped',
      reason: 'already migrated (idempotent)',
    };
  }

  if (!execute) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'dry-run',
      reason: 'all gates passed; would execute',
      details: { sourcePath: op.sourcePath, destPath: op.destPath },
    };
  }

  // 実行
  try {
    switch (op.recommendedAction) {
      case 'migrate-to-namespace':
        return await executeMigrate(op);
      case 'regenerate-from-parent':
        return await executeRegenerate(op);
      case 'mark-error':
        return await executeMarkError(op);
      default:
        return {
          operationId: op.operationId,
          docId: op.docId,
          action: op.recommendedAction,
          status: 'error',
          reason: `unhandled action: ${op.recommendedAction}`,
        };
    }
  } catch (err) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'error',
      reason: (err as Error).message,
    };
  }
}

async function main(): Promise<void> {
  console.log(`Project: ${projectId}`);
  console.log(`Bucket : ${storageBucket}`);
  console.log(`Plan   : ${planFile} (planId=${plan.planId})`);
  console.log(`Approval: ${approvalFile}`);
  console.log(`Mode   : ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  if (operationsFilter) {
    console.log(`Filter : ${[...operationsFilter].join(', ')}`);
  }
  console.log('');

  const ops = operationsFilter
    ? plan.operations.filter((op) => operationsFilter.has(op.operationId))
    : plan.operations;

  console.log(`Processing ${ops.length}/${plan.operations.length} operations...\n`);

  const outcomes: OperationOutcome[] = [];
  for (const op of ops) {
    const outcome = await processOperation(op);
    outcomes.push(outcome);
    const symbol = {
      executed: '✅',
      'dry-run': '📋',
      skipped: '⏭️ ',
      'gate-rejected': '🚫',
      error: '❌',
    }[outcome.status];
    console.log(`${symbol} ${outcome.operationId} ${outcome.docId} (${outcome.action}): ${outcome.reason}`);
  }

  const summary = outcomes.reduce(
    (acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  await admin.app().delete();

  // gate-rejected / error がある場合は exit 1 (operator が確認しやすいように)
  if ((summary['gate-rejected'] ?? 0) > 0 || (summary['error'] ?? 0) > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('Failed:', err);
  try {
    await admin.app().delete();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
