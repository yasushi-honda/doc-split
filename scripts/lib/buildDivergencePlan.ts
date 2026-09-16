/**
 * Issue #871 恒久対応: `classify-drive-claim-divergence.ts`のコアロジック(Drive/Firestore
 * とのやり取り)を、fake Driveクライアントを注入してテストできる形に切り出したもの
 * (`functions/src/drive/driveExportScheduled.ts`の`sweepStuckDriveExports`と同型パターン:
 * CLIエントリポイント/CloudEvent配管から独立させる)。
 */

import { randomUUID } from 'crypto';
import type { drive_v3 } from 'googleapis';
import type * as admin from 'firebase-admin';
import {
  DIVERGENCE_PLAN_SCHEMA_VERSION,
  OUT_OF_SCOPE_DIVERGENT_REASONS,
  determineResolution,
  evaluatePreflight,
  type DivergenceOperation,
  type DivergencePlan,
  type DivergencePlanDriveApiVersion,
  type DriveEntitySnapshot,
  type ClaimGraphConflict,
} from './divergenceResolutionPlan';

interface DriveFile {
  id: string;
  name: string;
  parents: string[];
  trashed: boolean;
}

interface DriveDeps {
  drive: drive_v3.Drive;
  supportsAllDrives: Record<string, unknown>;
  folderMimeType: string;
  escapeQueryValue: (value: string) => string;
}

async function listAll(deps: DriveDeps, q: string): Promise<DriveFile[]> {
  const results: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await deps.drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name, parents, trashed)',
      includeItemsFromAllDrives: true,
      pageSize: 100,
      pageToken,
      ...deps.supportsAllDrives,
    });
    for (const f of res.data.files ?? []) {
      if (!f.id || f.name === undefined || f.name === null) continue;
      results.push({ id: f.id, name: f.name, parents: f.parents ?? [], trashed: !!f.trashed });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return results;
}

function isNotFoundError(err: unknown): boolean {
  const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
  return status === 404;
}

export interface BuildDivergencePlanOptions {
  firestore: admin.firestore.Firestore;
  driveApiVersion: DivergencePlanDriveApiVersion;
  environment: string;
  projectId: string;
  /** テストで決定的なplanIdを注入するため。省略時はrandomUUID()。 */
  planIdFactory?: () => string;
  log?: (message: string) => void;
}

export async function buildDivergencePlan(
  deps: DriveDeps,
  options: BuildDivergencePlanOptions
): Promise<DivergencePlan> {
  const db = options.firestore;
  const log = options.log ?? (() => {});

  const divergentSnapshot = await db.collection('driveFolderLocks').where('state', '==', 'divergent').get();
  const errorDocsSnapshot = await db.collection('documents').where('driveExportStatus', '==', 'error').get();

  const operations: DivergenceOperation[] = [];

  for (const doc of divergentSnapshot.docs) {
    const data = doc.data();
    const parentId = data.parentId as string;
    const name = data.name as string;
    const divergentReason = (data.divergentReason as string | undefined) ?? '(不明)';
    const divergentAtMs = (data.divergentAtMs as number | undefined) ?? null;
    const claimFolderId = (data.folderId as string | undefined) ?? null;
    const claimUpdateTimeMs = doc.updateTime.toMillis();
    const operationId = `op-${String(operations.length + 1).padStart(4, '0')}`;

    log(`--- ${operationId}: "${name}"（親フォルダ: ${parentId}、reason=${divergentReason}） ---`);

    let actual: DriveEntitySnapshot | null = null;
    let actualUnreachable = false;
    let canMoveItemWithinDrive: boolean | null = null;
    let canRename: boolean | null = null;

    // out-of-scope理由(ambiguous-full-scan等)はdivergentReasonだけで即座にblockedが
    // 確定するため、claim.folderIdの健全性そのものに意味が無い(複数マッチの一意性が
    // 崩れている状態でfolderIdを信用すること自体が本質的に危うい)。Drive API呼び出しを
    // 省略する。
    const outOfScope = OUT_OF_SCOPE_DIVERGENT_REASONS.has(divergentReason);

    if (claimFolderId !== null && !outOfScope) {
      try {
        const res = await deps.drive.files.get({
          fileId: claimFolderId,
          fields: 'id, name, parents, trashed, modifiedTime, capabilities(canMoveItemWithinDrive, canRename)',
          ...deps.supportsAllDrives,
        });
        const d = res.data;
        actual = {
          id: d.id ?? claimFolderId,
          name: d.name ?? '',
          parents: d.parents ?? [],
          trashed: !!d.trashed,
          modifiedTime: d.modifiedTime ?? '',
        };
        canMoveItemWithinDrive = d.capabilities?.canMoveItemWithinDrive ?? false;
        canRename = d.capabilities?.canRename ?? false;
      } catch (err) {
        if (isNotFoundError(err)) {
          actualUnreachable = true;
        } else {
          throw err;
        }
      }
    }

    const nameDiffers = actual !== null && actual.name !== name;
    const parentsDiffer = actual !== null && !actual.parents.includes(parentId);

    const resolution = determineResolution({
      divergentReason,
      claimFolderId,
      actualUnreachable,
      nameDiffers,
      parentsDiffer,
    });

    // ─── claimグラフ掃引: 別parentIdをキーに持つ別claimが同じ物理フォルダを指していないか ───
    const claimGraphConflicts: ClaimGraphConflict[] = [];
    if (claimFolderId !== null) {
      const conflictSnapshot = await db
        .collection('driveFolderLocks')
        .where('folderId', '==', claimFolderId)
        .where('state', 'in', ['resolved', 'divergent'])
        .get();
      for (const other of conflictSnapshot.docs) {
        if (other.id === doc.id) continue;
        const otherData = other.data();
        claimGraphConflicts.push({
          otherParentId: otherData.parentId as string,
          otherName: otherData.name as string,
          otherState: otherData.state as 'resolved' | 'divergent',
        });
      }
    }

    // ─── 影響書類: driveExportErrorにclaimFolderIdを含むもの ───
    const affectedDocIds: string[] = [];
    if (claimFolderId !== null) {
      for (const errDoc of errorDocsSnapshot.docs) {
        const errText = errDoc.data().driveExportError as string | undefined;
        if (errText && errText.includes(claimFolderId)) {
          affectedDocIds.push(errDoc.id);
        }
      }
    }

    if (resolution.mode === null) {
      operations.push({
        operationId,
        parentId,
        name,
        divergentReason,
        divergentAtMs,
        claimFolderId,
        claimUpdateTimeMs,
        actual,
        expectedName: name,
        expectedParentId: parentId,
        nameDiffers,
        parentsDiffer,
        recommendedMode: null,
        blockedReasons: resolution.blockedReasons,
        directChildCount: null,
        affectedDocIds,
        claimGraphConflicts,
      });
      log(`  → 本ワークフロー対象外(${resolution.blockedReasons.join(',')})`);
      continue;
    }

    let directChildCount: number | null = null;
    if (claimFolderId !== null) {
      const children = await listAll(deps, `'${claimFolderId}' in parents`);
      directChildCount = children.length;
    }

    let expectedParent: { found: boolean; canAddChildren: boolean } | null = null;
    let duplicateNameAtTarget = false;
    if (resolution.mode === 'restore-expected') {
      try {
        const res = await deps.drive.files.get({
          fileId: parentId,
          fields: 'id, trashed, capabilities(canAddChildren)',
          ...deps.supportsAllDrives,
        });
        expectedParent = { found: true, canAddChildren: res.data.capabilities?.canAddChildren ?? false };
      } catch (err) {
        if (isNotFoundError(err)) {
          expectedParent = { found: false, canAddChildren: false };
        } else {
          throw err;
        }
      }

      if (expectedParent.found) {
        const q = `'${parentId}' in parents and name='${deps.escapeQueryValue(name)}' and mimeType='${deps.folderMimeType}'`;
        const matches = await listAll(deps, q);
        duplicateNameAtTarget = matches.some((m) => m.id !== claimFolderId);
      }
    }

    const preflight = evaluatePreflight({
      approvedMode: resolution.mode,
      actual,
      expectedParent: resolution.mode === 'restore-expected' && parentsDiffer ? expectedParent : null,
      canMoveItemWithinDrive: resolution.mode === 'restore-expected' && parentsDiffer ? canMoveItemWithinDrive : null,
      canRename: resolution.mode === 'restore-expected' && nameDiffers ? canRename : null,
      duplicateNameAtTarget,
      claimGraphConflicts,
      directChildCount: null,
      acknowledgedStrandedCount: null,
    });

    operations.push({
      operationId,
      parentId,
      name,
      divergentReason,
      divergentAtMs,
      claimFolderId,
      claimUpdateTimeMs,
      actual,
      expectedName: name,
      expectedParentId: parentId,
      nameDiffers,
      parentsDiffer,
      recommendedMode: preflight.blocked ? null : resolution.mode,
      blockedReasons: preflight.reasons,
      directChildCount,
      affectedDocIds,
      claimGraphConflicts,
    });

    if (preflight.blocked) {
      log(`  → ${resolution.mode}(推奨) だが blocked(${preflight.reasons.join(',')})`);
    } else {
      log(`  → 推奨: ${resolution.mode}(直接の子entry: ${directChildCount}件、影響書類: ${affectedDocIds.length}件)`);
    }
  }

  return {
    schemaVersion: DIVERGENCE_PLAN_SCHEMA_VERSION,
    planId: (options.planIdFactory ?? randomUUID)(),
    createdAt: new Date().toISOString(),
    environment: options.environment,
    projectId: options.projectId,
    driveApiVersion: options.driveApiVersion,
    summary: {
      totalDivergent: operations.length,
      autoResolvable: operations.filter((o) => o.recommendedMode !== null).length,
      blocked: operations.filter((o) => o.recommendedMode === null).length,
    },
    operations,
  };
}
