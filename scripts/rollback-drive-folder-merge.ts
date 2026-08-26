#!/usr/bin/env ts-node
/**
 * Issue #811 Phase B: execute-drive-folder-merge.ts の実行結果(manifest)を巻き戻す。
 *
 * PDF/Storage版(`scripts/execute-collision-migration.ts`)はStorageの
 * copy→update→delete構成のためrollbackを意図的に実装しなかった(ADR-0016)。
 * Google Driveのmove/rename/untrashは全て単一APIコールでアトミック・可逆なため、
 * 本スクリプトでは実際に逆操作を実行できる。
 *
 * 安全設計:
 *   - 各fileについて、現在の状態が「移行後に期待される状態(newParentId配下)」と
 *     一致する場合のみ逆操作を行う(移行後に他の理由でさらに動かされたfileは
 *     skipし、盲目的に上書きしない)
 *   - duplicateフォルダのrename復元は、そのフォルダから移動した全fileが今回の
 *     rollback対象に含まれている場合のみ実施する(file単位の部分rollbackでは
 *     folder名を戻さない。中途半端に空でないフォルダの名前だけ戻すと
 *     Part Bのtrashed込み名前検索と再度衝突するため)
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/rollback-drive-folder-merge.ts \
 *     --manifest manifest-output.json [--operations op-0001,op-0002] [--execute]
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import type { drive_v3 } from 'googleapis';
import type { ExecutionManifest } from './lib/folderMergeManifest';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

function getOpt(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const manifestFile = getOpt('--manifest');
if (!manifestFile) {
  console.error('--manifest <manifest.json> は必須です');
  process.exit(1);
}
const operationsFilterRaw = getOpt('--operations');
const operationsFilter = operationsFilterRaw
  ? new Set(operationsFilterRaw.split(',').map((s) => s.trim()))
  : null;
const execute = process.argv.includes('--execute');

const manifest: ExecutionManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

if (manifest.environment !== projectId) {
  console.error(
    `FATAL: manifest.environment (${manifest.environment}) !== runtime FIREBASE_PROJECT_ID (${projectId})`
  );
  process.exit(2);
}

admin.initializeApp({ projectId });

interface RollbackOutcome {
  driveFileId: string;
  operationId: string;
  status: 'reverted' | 'dry-run' | 'skipped' | 'error';
  reason: string;
}

async function main(): Promise<void> {
  const { getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { SUPPORTS_ALL_DRIVES } = await import('../functions/src/drive/driveApiConstants');
  const drive: drive_v3.Drive = await getDriveClient();

  const targetMoves = operationsFilter
    ? manifest.fileMoves.filter((m) => operationsFilter.has(m.operationId))
    : manifest.fileMoves;

  console.log(`Manifest: ${manifestFile} (planId=${manifest.planId})`);
  console.log(`Mode    : ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Rolling back ${targetMoves.length}/${manifest.fileMoves.length} file moves...\n`);

  const outcomes: RollbackOutcome[] = [];
  const revertedOperationIds = new Set<string>();

  for (const entry of targetMoves) {
    try {
      const live = await drive.files.get({
        fileId: entry.driveFileId,
        fields: 'parents, trashed, name',
        ...SUPPORTS_ALL_DRIVES,
      });
      const liveParents = live.data.parents ?? [];
      // codex review P1指摘対応: parentsの一致だけでは、移行後にname変更・再trashed化された
      // fileも無条件でmanifestの値へ上書きしてしまう(正当な事後変更を破壊しうる)。
      // executeが移動時に必ずname不変・trashed:falseにする設計を前提に、その2点も
      // 「移行直後の期待状態」として検証する。
      if (
        !liveParents.includes(entry.newParentId) ||
        live.data.trashed !== false ||
        live.data.name !== entry.oldName
      ) {
        outcomes.push({
          driveFileId: entry.driveFileId,
          operationId: entry.operationId,
          status: 'skipped',
          reason: `current state (parents=${JSON.stringify(liveParents)}, trashed=${live.data.trashed}, name="${live.data.name}") does not match expected post-migration state (parents include ${entry.newParentId}, trashed=false, name="${entry.oldName}"); state changed since migration, not rolling back`,
        });
        continue;
      }

      if (!execute) {
        outcomes.push({
          driveFileId: entry.driveFileId,
          operationId: entry.operationId,
          status: 'dry-run',
          reason: `would revert to parents=${JSON.stringify(entry.oldParents)}, trashed=${entry.oldTrashed}, name="${entry.oldName}"`,
        });
        continue;
      }

      await drive.files.update({
        fileId: entry.driveFileId,
        addParents: entry.oldParents.join(','),
        removeParents: entry.newParentId,
        requestBody: { trashed: entry.oldTrashed, name: entry.oldName },
        fields: 'id',
        ...SUPPORTS_ALL_DRIVES,
      });
      revertedOperationIds.add(entry.operationId);
      outcomes.push({
        driveFileId: entry.driveFileId,
        operationId: entry.operationId,
        status: 'reverted',
        reason: `reverted to parents=${JSON.stringify(entry.oldParents)}`,
      });
    } catch (err) {
      outcomes.push({
        driveFileId: entry.driveFileId,
        operationId: entry.operationId,
        status: 'error',
        reason: (err as Error).message,
      });
    }
  }

  for (const o of outcomes) {
    const symbol = { reverted: '✅', 'dry-run': '📋', skipped: '⏭️ ', error: '❌' }[o.status];
    console.log(`${symbol} ${o.operationId} ${o.driveFileId}: ${o.reason}`);
  }

  // ─── duplicateフォルダ名の復元(そのrootの全fileMovesがrollback対象の場合のみ) ──
  if (execute) {
    for (const rename of manifest.folderRenames) {
      const allMovesForRoot = manifest.fileMoves.filter((m) => m.sourceRootId === rename.folderId);
      // codex review P2指摘対応: allMovesForRoot.length===0(元々空だったフォルダ、
      // classify時点でfile moveが1件も無かったケース)は.every()が空配列でtrueを返すため
      // 本来「全件revert済み(vacuously true)」として復元してよい。以前は0件チェックを
      // 明示的にskip条件へ加えており、空フォルダのリネームが永久に復元不能だった。
      const allIncludedInThisRun = allMovesForRoot.every((m) => revertedOperationIds.has(m.operationId));
      if (!allIncludedInThisRun) {
        console.log(
          `⏭️  folder ${rename.folderId} のname復元をskip(このrunで全${allMovesForRoot.length}件のfile moveをrevertしていない)`
        );
        continue;
      }
      try {
        const live = await drive.files.get({
          fileId: rename.folderId,
          fields: 'name',
          ...SUPPORTS_ALL_DRIVES,
        });
        if (live.data.name !== rename.newName) {
          console.log(
            `⏭️  folder ${rename.folderId} のname復元をskip(現在名="${live.data.name}"が想定"${rename.newName}"と不一致)`
          );
          continue;
        }
        await drive.files.update({
          fileId: rename.folderId,
          requestBody: { name: rename.oldName },
          fields: 'id',
          ...SUPPORTS_ALL_DRIVES,
        });
        console.log(`✅ folder ${rename.folderId} のname復元: "${rename.newName}" → "${rename.oldName}"`);
      } catch (err) {
        console.error(`❌ folder ${rename.folderId} のname復元に失敗: ${(err as Error).message}`);
      }
    }
  }

  // ─── 復元済みtarget folderの再trashed化(codex review P2指摘対応) ────────
  // childFolderResolver.tsがcanonical配下でuntrashしたカテゴリ/顧客フォルダは、
  // rollbackでfileが戻された後もactiveなまま放置されると、rollback前の状態
  // (trashed)を完全には復元できない。空になったfolderのみ、安全側で再trashedにする
  // (他に無関係なfileが後から追加されていれば空ではなくなっているため自然にskipされる)。
  if (execute) {
    for (const folderId of manifest.restoredTargetFolderIds ?? []) {
      try {
        const listRes = await drive.files.list({
          q: `'${folderId}' in parents`,
          fields: 'files(id)',
          includeItemsFromAllDrives: true,
          pageSize: 1,
          ...SUPPORTS_ALL_DRIVES,
        });
        if ((listRes.data.files ?? []).length > 0) {
          console.log(`⏭️  folder ${folderId} の再trashed化をskip(配下に他fileが残存)`);
          continue;
        }
        await drive.files.update({
          fileId: folderId,
          requestBody: { trashed: true },
          fields: 'id',
          ...SUPPORTS_ALL_DRIVES,
        });
        console.log(`✅ folder ${folderId} を再trashed化(rollback前は復元済み状態だった)`);
      } catch (err) {
        console.error(`❌ folder ${folderId} の再trashed化に失敗: ${(err as Error).message}`);
      }
    }
  }

  await admin.app().delete();

  const errorCount = outcomes.filter((o) => o.status === 'error').length;
  if (errorCount > 0) {
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
