#!/usr/bin/env ts-node
/**
 * 同名の兄弟Driveフォルダ2つの再帰統合の実行(承認制)
 *
 * `plan-drive-folder-tree-merge.ts`が出力したPlanと承認JSON(planId・期待件数)を読み、
 * 実行直前に事前照合(書込み0件でドリフト検知)してから、ファイル/フォルダ移動 →
 * 空になった統合元フォルダの改名+trash(深い順) → ルートclaimのfinalize(最後)の順で実行する。
 *
 * --execute なし: dry-run(Drive/Firestoreへの書込みゼロ。未適用/適用済みop件数のプレビューのみ)
 *
 * 終了コード: 0=completed/already-completed/dry-run / 2=ゲート不一致(schemaVersion・planId・
 * projectId・driveApiVersion・スコープ・前提条件) / 3=実行を拒否または中断(status参照) / 1=その他
 *
 * PII対策: ログ・manifestにフォルダ名・ファイル名は含めない(IDと件数のみ)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/execute-drive-folder-tree-merge.ts \
 *     --plan plan-output.json --approval approval.json [--execute] [--manifest-out manifest.json] [--actor <run-url>]
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import {
  FOLDER_TREE_MERGE_EXIT_CODE,
  parseFolderTreeMergeApproval,
  parseFolderTreeMergePlan,
  type FolderTreeMergeManifest,
} from './lib/folderTreeMergePlanTypes';
import { executeFolderTreeMerge, TreeMergeValidationError } from './lib/folderTreeMerge';
import { buildFirestoreClaimStore } from './lib/firestoreTreeClaimStore';
import { readDriveApiVersionSnapshot, verifyDriveApiVersionMatch } from './lib/driveApiVersionGate';
import { describeErrorSafely } from './lib/confirmedReplayStats';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

function getOpt(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const planPathArg = getOpt('--plan');
const approvalPathArg = getOpt('--approval');
const manifestOutFile = getOpt('--manifest-out') ?? 'manifest-output.json';
const actor = getOpt('--actor') ?? 'execute-drive-folder-tree-merge';
const shouldExecute = process.argv.includes('--execute');

if (!planPathArg || !approvalPathArg) {
  console.error('--plan <path> と --approval <path> は必須です');
  process.exit(1);
}
const planPath: string = planPathArg;
const approvalPath: string = approvalPathArg;

admin.initializeApp({ projectId });

async function main(): Promise<number> {
  // 手編集・破損したplan/承認は、形の検証で拒否する(schemaVersion不一致もここで弾かれる)
  let plan: ReturnType<typeof parseFolderTreeMergePlan>;
  let approval: ReturnType<typeof parseFolderTreeMergeApproval>;
  try {
    plan = parseFolderTreeMergePlan(JSON.parse(fs.readFileSync(planPath, 'utf8')));
    approval = parseFolderTreeMergeApproval(JSON.parse(fs.readFileSync(approvalPath, 'utf8')));
  } catch (err) {
    console.error(`FATAL: ${(err as Error).message}`);
    return 2;
  }
  if (approval.planId !== plan.planId) {
    console.error(`FATAL: approval.planId(${approval.planId})がplan.planId(${plan.planId})と一致しません`);
    return 2;
  }
  // 別環境向けPlanを誤ったFIREBASE_PROJECT_IDで実行する事故を防ぐ。
  if (plan.projectId !== projectId) {
    console.error(`FATAL: plan.projectId(${plan.projectId}) !== runtime FIREBASE_PROJECT_ID(${projectId})`);
    return 2;
  }
  const versionCheck = verifyDriveApiVersionMatch(
    // 未記録のPlanは空文字にして不一致扱い(fail-closed)
    { lockfileHash: plan.lockfileHash ?? '', googleapisLockfileVersion: plan.googleapisLockfileVersion ?? '' },
    readDriveApiVersionSnapshot()
  );
  if (!versionCheck.ok) {
    console.error(`FATAL: ${versionCheck.reason}`);
    return 2;
  }

  console.log(`プロジェクト: ${projectId}`);
  console.log(`Plan: ${planPath} (planId=${plan.planId}, ops=${plan.ops.length}件)`);
  console.log(`モード: ${shouldExecute ? '実行(--execute)' : 'dry-run(プレビューのみ)'}`);
  console.log('---');

  const { getDriveSettings, getDriveClient } = await import('../functions/src/utils/driveAuth');
  const claimFns = await import('../functions/src/drive/driveFolderClaim');
  const { isDriveFolderClaimReadEnabled } = await import('../functions/src/utils/featureFlags');
  const { FOLDER_MIME_TYPE } = await import('../functions/src/drive/driveApiConstants');
  const { REQUIRED_DRIVE_SCOPE } = await import('../functions/src/drive/exchangeDriveAuthCode');

  const settings = await getDriveSettings();
  if (!(settings.grantedScopes ?? []).includes(REQUIRED_DRIVE_SCOPE)) {
    console.error(`FATAL: settings/drive.grantedScopesに${REQUIRED_DRIVE_SCOPE}が含まれていません。再連携後に実行してください。`);
    return 2;
  }
  if (settings.rootFolderId !== plan.rootFolderId) {
    console.error('FATAL: plan.rootFolderIdがsettings/drive.rootFolderIdと一致しません');
    return 2;
  }

  const drive = await getDriveClient();
  const claimStore = buildFirestoreClaimStore(admin.firestore(), {
    FOLDER_LOCKS_COLLECTION: claimFns.FOLDER_LOCKS_COLLECTION,
    buildFolderLockId: claimFns.buildFolderLockId,
    resolveDivergentClaim: claimFns.resolveDivergentClaim,
    isDriveFolderClaimReadEnabled,
  });

  const { status, manifest, pendingOps, appliedOps } = await executeFolderTreeMerge(
    { drive, claimStore, folderMimeType: FOLDER_MIME_TYPE },
    plan,
    approval,
    {
      execute: shouldExecute,
      actor,
      log: (m) => console.log(m),
      logError: (m) => console.error(m),
      // op単位でmanifestを永続化(プロセスが落ちても適用済みopの記録を失わない)。
      onProgress: (m: FolderTreeMergeManifest) => fs.writeFileSync(manifestOutFile, JSON.stringify(m, null, 2)),
    }
  );

  if (shouldExecute) {
    fs.writeFileSync(manifestOutFile, JSON.stringify(manifest, null, 2));
    console.log(`Manifestを書き出しました: ${manifestOutFile}`);
  }
  console.log('---');
  console.log(`結果: status=${status} / 未適用op=${pendingOps} / 適用済みop=${appliedOps} / finalize=${manifest.finalize.outcome}`);

  return FOLDER_TREE_MERGE_EXIT_CODE[status];
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    if (error instanceof TreeMergeValidationError) {
      console.error(`FATAL: 前提条件の不一致: ${error.code}`);
      process.exit(2);
    }
    console.error('エラー:', describeErrorSafely(error));
    process.exit(1);
  });
