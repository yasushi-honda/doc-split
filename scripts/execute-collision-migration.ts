#!/usr/bin/env ts-node
/**
 * Issue #432 PR-C: classify-collision-docs.ts が出力した migration plan を実行
 *
 * 多重 gate (現在 7 種、Codex セカンドオピニオン反映 + PR-C2 で AC13 algorithm/version 追加):
 *   1. approval.planId === plan.planId
 *   2. operation.operationId が approval.approvedOperationIds に含まれる
 *   3. (destructive 時) operation の sourcePath/destPath が approval.approvedPaths に含まれる
 *   4. runtime env (projectId / storageBucket) が plan の projectId / bucket と一致
 *   5. precondition (expectedCurrentFileUrl / expectedStatus / expectedUpdatedAt) が現状 doc と一致
 *   6. plan.hashAlgorithm === HASH_ALGORITHM (AC13)
 *   7. plan.pdfLibVersion === expectedPdfLibVersion (AC13 拡張 / Codex Important 反映)
 * Gate 0 (defense-in-depth): Ambiguous + suggestedWinner=true の destructive action を reject
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
import {
  buildMigrateUpdatePayload,
  buildRegenerateUpdatePayload,
  buildMarkErrorUpdatePayload,
} from './lib/executeMigrationOps';
// F-C3: classifier の型を import して二重定義 (drift リスク) を解消
import type {
  Classification,
  FingerprintAlgorithm,
  RecommendedAction,
} from './lib/collisionClassifier';
import { HASH_ALGORITHM } from './lib/pdfPageVisualFingerprint';
// AC13 拡張 (Codex Important): plan.pdfLibVersion と execute 側 pdf-lib version の照合
import { version as expectedPdfLibVersion } from 'pdf-lib/package.json';
// PR-C3c (AC-SCHEMA / AC-INVARIANT / AC18 / AC-CC1): 統合 plan schema v3 + 親 PDF
// provenance lib + lockfile gate lib。execute 側で plan を読み込んで複数 gate を評価。
import {
  COLLISION_PLAN_SCHEMA_VERSION,
  verifyActionProvenanceInvariant,
  verifyProvenanceCompleteness,
  type Operation,
  type Plan,
  type Approval,
  type ParentPdfProvenance,
} from './lib/collisionPlanTypes';
import {
  computeParentPdfProvenance,
  verifyParentPdfProvenanceMatch,
} from './lib/parentPdfProvenance';
import { readLockfileSnapshot, verifyLockfileMatch } from './lib/lockfileGate';

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

// PR-C3c: Operation / Plan / Approval は scripts/lib/collisionPlanTypes.ts に統合済。
// 旧インライン定義は削除し、import 済型を使う。v3 必須 fields (schemaVersion / lockfileHash /
// pdfLibLockfileVersion / sourceManifestRef / provenanceRequired / provenance) が型レベルで強制。

const plan: Plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const approval: Approval = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));

// === AC-SCHEMA (PR-C3c, Important I2 反映): plan.schemaVersion gate ===
// 旧 plan (PR-C2 以前で schemaVersion 不在) は明示的に reject。新 schema 強制で
// 改竄 plan / 後方互換 fallback を防ぐ。
if (plan.schemaVersion !== COLLISION_PLAN_SCHEMA_VERSION) {
  console.error(
    `FATAL: unsupported plan schemaVersion (got '${plan.schemaVersion ?? '<missing>'}', expected '${COLLISION_PLAN_SCHEMA_VERSION}'). Re-run classify-collision-docs.ts to regenerate the plan with the current schema (AC-SCHEMA-2).`
  );
  process.exit(2);
}

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

// === AC13: fingerprint algorithm version gate (PR-C2) ===
if (plan.hashAlgorithm !== HASH_ALGORITHM) {
  console.error(
    `FATAL: plan.hashAlgorithm (${plan.hashAlgorithm ?? '<missing>'}) !== execute code's HASH_ALGORITHM (${HASH_ALGORITHM}). Re-run classify-collision-docs.ts to regenerate the plan with the current fingerprint algorithm.`
  );
  process.exit(2);
}
// AC13 拡張 (Codex Important): pdf-lib version mismatch も reject。
if (plan.pdfLibVersion !== expectedPdfLibVersion) {
  console.error(
    `FATAL: plan.pdfLibVersion (${plan.pdfLibVersion ?? '<missing>'}) !== execute runtime pdf-lib version (${expectedPdfLibVersion}). Re-run classify-collision-docs.ts after package version sync.`
  );
  process.exit(2);
}

// === AC-CC1-2 (PR-C3c, Codex Critical 1): plan-side lockfile gate ===
// classify 時に記録した package-lock.json sha256 + pdf-lib resolved version と runtime を
// 照合。dependency 更新検出により、fingerprint 計算結果が classify と execute で乖離する
// シナリオを塞ぐ (Codex Important I1: pdfLibLockfileVersion は package.json でなく
// package-lock.json から読む)。
const runtimeLockfileSnapshot = readLockfileSnapshot();
const lockfileGateResult = verifyLockfileMatch(
  {
    lockfileHash: plan.lockfileHash,
    pdfLibLockfileVersion: plan.pdfLibLockfileVersion,
  },
  runtimeLockfileSnapshot
);
if (!lockfileGateResult.ok) {
  console.error(`FATAL: ${lockfileGateResult.reason} (AC-CC1-2)`);
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

/**
 * F-B2: Storage delete を 404 のみ silent skip し、それ以外は構造化結果として返す。
 * caller は outcome.details.oldDeleteOutcome を見て operator に伝達できる。
 * Issue #432 silent breakage の再演 (delete 失敗の握りつぶし) を防ぐ。
 */
type OldDeleteResult =
  | { outcome: 'deleted' }
  | { outcome: 'already-absent' }
  | { outcome: 'failed'; error: string };

async function deleteStorageSelective(path: string): Promise<OldDeleteResult> {
  try {
    await bucket.file(path).delete();
    return { outcome: 'deleted' };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) return { outcome: 'already-absent' };
    return { outcome: 'failed', error: (err as Error).message };
  }
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

  // Firestore: fileUrl 更新 (Partial update 不変 = fileUrl のみ、F-D2 で testable 化)
  await db.doc(`documents/${op.docId}`).update(buildMigrateUpdatePayload(newFileUrl));

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
        oldDeleteOutcome: 'skipped-sharing',
        residualDocIds: guard.residualDocIds,
      },
    };
  }

  // F-B2: 404 以外の delete 失敗を silent に握り潰さず outcome に残す
  const deleteResult = await deleteStorageSelective(op.sourcePath);
  if (deleteResult.outcome === 'failed') {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'error',
      reason: `migrated but old path delete failed: ${deleteResult.error}`,
      details: { newFileUrl, oldFileUrl, oldDeleteOutcome: 'failed', oldDeleteError: deleteResult.error },
    };
  }

  return {
    operationId: op.operationId,
    docId: op.docId,
    action: op.recommendedAction,
    status: 'executed',
    reason:
      deleteResult.outcome === 'deleted'
        ? 'migrated to docId namespace, old path deleted'
        : 'migrated to docId namespace, old path was already absent',
    details: { newFileUrl, oldFileUrl, oldDeleteOutcome: deleteResult.outcome },
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
  const parentFileUrl = parentSnap.data()?.fileUrl;
  if (typeof parentFileUrl !== 'string') {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'error',
      reason: 'parent fileUrl is missing or not a string',
    };
  }
  // F-B4: parent fileUrl が runtime bucket と一致することを検証 (`.appspot.com` ↔ `.firebasestorage.app` 取り違え防止)
  const parentMatch = parentFileUrl.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!parentMatch || parentMatch[1] !== storageBucket) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'error',
      reason: `parent fileUrl bucket mismatch: ${parentFileUrl} (expected bucket=${storageBucket})`,
    };
  }
  const parentPath = parentMatch[2];
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
  // Partial update 不変: fileUrl + status + lastErrorMessage の deleteField のみ (F-D2)
  await db.doc(`documents/${op.docId}`).update(buildRegenerateUpdatePayload(newFileUrl));

  // 旧 path 後始末 (collision group 敗者の場合): storageGuard で安全確認
  // F-B2: 404 以外の delete 失敗を outcome details に残す (silent failure 防止)
  let oldDeleteRecord: { outcome: string; error?: string; residualDocIds?: string[] } | undefined;
  if (op.sourcePath !== null && op.sourcePath !== op.destPath) {
    const oldFileUrl = `gs://${storageBucket}/${op.sourcePath}`;
    const guard = await isPathSafeToDeleteAfterExcluding(db, oldFileUrl, [op.docId]);
    if (!guard.safe) {
      oldDeleteRecord = {
        outcome: 'skipped-sharing',
        residualDocIds: guard.residualDocIds,
      };
    } else {
      const deleteResult = await deleteStorageSelective(op.sourcePath);
      oldDeleteRecord = deleteResult.outcome === 'failed'
        ? { outcome: 'failed', error: deleteResult.error }
        : { outcome: deleteResult.outcome };
      if (deleteResult.outcome === 'failed') {
        return {
          operationId: op.operationId,
          docId: op.docId,
          action: op.recommendedAction,
          status: 'error',
          reason: `regenerated but old path delete failed: ${deleteResult.error}`,
          details: {
            newFileUrl,
            regeneratedBytes: childBuf.length,
            oldDeleteOutcome: oldDeleteRecord,
          },
        };
      }
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
      ...(oldDeleteRecord ? { oldDeleteOutcome: oldDeleteRecord } : {}),
    },
  };
}

async function executeMarkError(op: Operation): Promise<OperationOutcome> {
  // Partial update 不変 (CLAUDE.md MUST): status + lastErrorMessage のみ更新、他フィールド不変 (F-D2)
  await db.doc(`documents/${op.docId}`).update(buildMarkErrorUpdatePayload(op.reason));
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
    // F-B1: executeRegenerate は op.sourcePath !== destPath の場合 sourcePath を delete し得る。
    // ADR-0008 教訓「per-path 個別認可必須」を守るため、sourcePath も approvedPaths にあることを要求。
    if (
      op.sourcePath &&
      op.sourcePath !== op.destPath &&
      !approvedPaths.has(`gs://${storageBucket}/${op.sourcePath}`)
    ) {
      return {
        ok: false,
        reason: `sourcePath (regenerate-from-parent will delete this) not in approvedPaths: gs://${storageBucket}/${op.sourcePath}`,
      };
    }
  }
  // mark-error は Storage 触らないため path 認可不要 (operationId 認可のみで通す)
  return { ok: true, reason: 'path approved' };
}

/**
 * PR-C3c (AC-PREFLIGHT): processOperation のシグネチャに `currentlyExecuting` を追加。
 *
 *  - main 関数の preflight phase (1 pass) では `currentlyExecuting=false` で呼び、全 gate
 *    評価 + dry-run 相当の結果を集める (Firestore/Storage 書き込みなし)。
 *  - 全 op で gate-rejected/error 0 を確認してから、write phase (2 pass) で
 *    `currentlyExecuting=true` で呼び、実 destructive action を実行する。
 *
 * 旧 global `execute` は --execute 引数判定として残し、main 関数で
 * `execute && allPreflightOk` のときのみ currentlyExecuting=true で 2 pass 目を回す。
 */
async function processOperation(
  op: Operation,
  currentlyExecuting: boolean
): Promise<OperationOutcome> {
  // Gate 0 (defense in depth, F-B5): Codex セカンドオピニオンの Critical を裏付けゲート化。
  // Ambiguous classification は manual-review action 以外で実行不可、suggestedWinner hint は
  // 自動 destructive action の根拠にしない (rotatedAt!=null 唯一は Storage 実体正当性証明ではない)。
  if (op.classification === 'Ambiguous' && op.recommendedAction !== 'manual-review') {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'gate-rejected',
      reason: `defense-in-depth: Ambiguous classification must use manual-review (got ${op.recommendedAction})`,
    };
  }
  if (
    op.suggestedWinner &&
    (op.recommendedAction === 'migrate-to-namespace' ||
      op.recommendedAction === 'regenerate-from-parent')
  ) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'gate-rejected',
      reason:
        'defense-in-depth: suggestedWinner hint must not trigger automatic destructive action (Codex Critical)',
    };
  }

  // === Gate 8 (PR-C3c, AC-INVARIANT / AC18-1, Codex Critical C2 反映): action ↔ provenanceRequired 組合せ強制 ===
  // plan 改竄で「regenerate-from-parent + provenanceRequired:false」を作っても AC18 gate
  // を bypass できないように schema invariant を runtime でも強制する。
  const invariantResult = verifyActionProvenanceInvariant(
    op.recommendedAction,
    op.provenanceRequired
  );
  if (!invariantResult.ok) {
    return {
      operationId: op.operationId,
      docId: op.docId,
      action: op.recommendedAction,
      status: 'gate-rejected',
      reason: invariantResult.reason,
    };
  }

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

  // F-A3: idempotency を precondition より前に評価。
  // copy 成功 → Firestore update 失敗 → 再実行のシナリオで、precondition は旧 fileUrl を期待し
  // 現状は新 fileUrl になっている (もしくはその逆) のドリフト検出になる。idempotency check が
  // 「完了状態 (新 path 存在 + Firestore fileUrl 更新済)」を先に判定することで、
  // 完了済 op は precondition mismatch にせず安全に skip する。
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

  // Gate 5: precondition snapshot (idempotency check 通過後に実行)
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

  // === Gate 9 (PR-C3c, AC18 provenance gate): regenerate-from-parent の親 PDF 整合性確認 ===
  // provenanceRequired === true の op (= regenerate-from-parent) のみ評価。
  //
  // Gate 9a (AC18-1): provenance 6 fields completeness check (plan に欠落していたら reject)
  // Gate 9b (AC18-2): runtime 親 PDF を download → sha256 + metadata 計算 → plan 記録と field 単位で照合
  if (op.provenanceRequired) {
    const completeness = verifyProvenanceCompleteness(op.provenance);
    if (!completeness.ok) {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'gate-rejected',
        reason: `AC18-1: ${completeness.reason}`,
      };
    }
    const planProvenance = op.provenance as ParentPdfProvenance; // narrowed by completeness check
    try {
      const runtimeProvenance = await computeParentPdfProvenance(
        bucket,
        planProvenance.sourcePath,
        planProvenance.derivedObjectPath
      );
      const matchResult = verifyParentPdfProvenanceMatch(planProvenance, runtimeProvenance);
      if (!matchResult.ok) {
        return {
          operationId: op.operationId,
          docId: op.docId,
          action: op.recommendedAction,
          status: 'gate-rejected',
          reason: `AC18-2: ${matchResult.reason}`,
        };
      }
    } catch (err) {
      return {
        operationId: op.operationId,
        docId: op.docId,
        action: op.recommendedAction,
        status: 'gate-rejected',
        reason: `AC18-2 runtime provenance computation failed: ${(err as Error).message}`,
      };
    }
  }

  if (!currentlyExecuting) {
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

const OUTCOME_SYMBOLS: Record<string, string> = {
  executed: '✅',
  'dry-run': '📋',
  skipped: '⏭️ ',
  'gate-rejected': '🚫',
  error: '❌',
};

function summarizeOutcomes(outcomes: OperationOutcome[]): Record<string, number> {
  return outcomes.reduce(
    (acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

function printOutcomes(outcomes: OperationOutcome[], phaseLabel: string): void {
  console.log(`\n--- ${phaseLabel} outcomes ---`);
  for (const outcome of outcomes) {
    const symbol = OUTCOME_SYMBOLS[outcome.status] ?? '?';
    console.log(
      `${symbol} ${outcome.operationId} ${outcome.docId} (${outcome.action}): ${outcome.reason}`
    );
  }
}

async function main(): Promise<void> {
  console.log(`Project: ${projectId}`);
  console.log(`Bucket : ${storageBucket}`);
  console.log(`Plan   : ${planFile} (planId=${plan.planId}, schemaVersion=${plan.schemaVersion})`);
  console.log(`Approval: ${approvalFile}`);
  console.log(`Mode   : ${execute ? 'EXECUTE (preflight + write)' : 'DRY-RUN (preflight only)'}`);
  if (operationsFilter) {
    console.log(`Filter : ${[...operationsFilter].join(', ')}`);
  }
  console.log('');

  const ops = operationsFilter
    ? plan.operations.filter((op) => operationsFilter.has(op.operationId))
    : plan.operations;

  console.log(`Processing ${ops.length}/${plan.operations.length} operations...`);

  // PR-C3c (AC-PREFLIGHT): write-free preflight phase。`--execute` 時も初回はこの phase
  // で全 op を gate 評価し、gate-rejected/error が 1 件でもあれば write phase に進まず exit。
  // `--dry-run` (--execute なし) は preflight のみで終了する。
  console.log('\n[Phase 1/2] Preflight (write-free gate evaluation, AC-PREFLIGHT-1)\n');
  const preflightOutcomes: OperationOutcome[] = [];
  for (const op of ops) {
    const outcome = await processOperation(op, false);
    preflightOutcomes.push(outcome);
  }
  printOutcomes(preflightOutcomes, 'Preflight');
  const preflightSummary = summarizeOutcomes(preflightOutcomes);
  console.log('\n=== Preflight Summary ===');
  console.log(JSON.stringify(preflightSummary, null, 2));

  const hasPreflightFailure =
    (preflightSummary['gate-rejected'] ?? 0) > 0 || (preflightSummary['error'] ?? 0) > 0;

  if (hasPreflightFailure || !execute) {
    // dry-run mode、または preflight で 1 件でも fail → write phase に進まず exit。
    await admin.app().delete();
    if (hasPreflightFailure) {
      console.error(
        '\nFATAL: preflight phase had gate-rejected or error outcomes. Write phase aborted (AC-PREFLIGHT-1).'
      );
      process.exit(1);
    }
    // dry-run mode の正常終了
    process.exit(0);
  }

  // [Phase 2/2] Write phase (AC-PREFLIGHT-2 反映): preflight 全件通過後にのみ書き込み開始。
  console.log('\n[Phase 2/2] Write (preflight passed, executing destructive actions)\n');
  const writeOutcomes: OperationOutcome[] = [];
  for (const op of ops) {
    const outcome = await processOperation(op, true);
    writeOutcomes.push(outcome);
    const symbol = OUTCOME_SYMBOLS[outcome.status] ?? '?';
    console.log(`${symbol} ${outcome.operationId} ${outcome.docId} (${outcome.action}): ${outcome.reason}`);
  }
  const writeSummary = summarizeOutcomes(writeOutcomes);
  console.log('\n=== Write Summary ===');
  console.log(JSON.stringify(writeSummary, null, 2));

  await admin.app().delete();

  // write phase で error が出た場合は exit 1 (gate-rejected は preflight で排除済のはず)
  if ((writeSummary['error'] ?? 0) > 0) {
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
