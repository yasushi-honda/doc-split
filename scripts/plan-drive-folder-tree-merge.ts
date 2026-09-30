#!/usr/bin/env ts-node
/**
 * 同名の兄弟Driveフォルダ2つ(統合元S・統合先D)の再帰統合Plan生成(read-only)
 *
 * `execute-drive-folder-tree-merge.ts`の入力となるPlanを出力する。Drive/Firestoreへ書込みは一切しない。
 * 対象は`settings/drive.rootFolderId`直下の同名フォルダ2つ。統合先Dはルートclaim(divergent /
 * ambiguous-full-scan)のfolderIdと一致している必要がある。
 *
 * PII対策: 出力(ログ・JSON)にフォルダ名・ファイル名は含めない(IDと件数のみ)。
 *
 * 終了コード: Plan生成成功=0(blockersがあっても0。executeが拒否する) / 対象同定・前提条件の不一致=2 / その他=1
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/plan-drive-folder-tree-merge.ts \
 *     --source-id <統合元ID> --target-id <統合先ID> [--out plan-output.json]
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import { planFolderTreeMerge, TreeMergeValidationError } from './lib/folderTreeMerge';
import { buildFirestoreClaimStore } from './lib/firestoreTreeClaimStore';
import { readDriveApiVersionSnapshot } from './lib/driveApiVersionGate';
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

const sourceId = getOpt('--source-id');
const targetId = getOpt('--target-id');
const outFile = getOpt('--out') ?? 'plan-output.json';
if (!sourceId || !targetId) {
  console.error('--source-id <統合元フォルダID> と --target-id <統合先フォルダID> は必須です');
  process.exit(1);
}

admin.initializeApp({ projectId });

async function main(): Promise<void> {
  // driveAuth.tsはトップレベルでadmin.firestore()を評価するため、initializeApp後に動的import。
  const { getDriveSettings, getDriveClient } = await import('../functions/src/utils/driveAuth');
  const claimFns = await import('../functions/src/drive/driveFolderClaim');
  const { isDriveFolderClaimReadEnabled } = await import('../functions/src/utils/featureFlags');
  const { FOLDER_MIME_TYPE } = await import('../functions/src/drive/driveApiConstants');
  const { REQUIRED_DRIVE_SCOPE } = await import('../functions/src/drive/exchangeDriveAuthCode');

  console.log(`プロジェクト: ${projectId}`);
  const settings = await getDriveSettings();
  if (!settings.rootFolderId) {
    console.error('❌ settings/drive.rootFolderId が未設定です。');
    process.exit(2);
  }
  // 旧drive.fileスコープでは人作成フォルダが不可視のまま誤った結果になるためfail-closed。
  if (!(settings.grantedScopes ?? []).includes(REQUIRED_DRIVE_SCOPE)) {
    console.error(`❌ settings/drive.grantedScopesに${REQUIRED_DRIVE_SCOPE}が含まれていません。再連携後に実行してください。`);
    process.exit(2);
  }

  const drive = await getDriveClient();
  const claimStore = buildFirestoreClaimStore(admin.firestore(), {
    FOLDER_LOCKS_COLLECTION: claimFns.FOLDER_LOCKS_COLLECTION,
    buildFolderLockId: claimFns.buildFolderLockId,
    resolveDivergentClaim: claimFns.resolveDivergentClaim,
    isDriveFolderClaimReadEnabled,
  });

  const { lockfileHash, googleapisLockfileVersion } = readDriveApiVersionSnapshot();
  const plan = await planFolderTreeMerge(
    { drive, claimStore, folderMimeType: FOLDER_MIME_TYPE, log: (m) => console.log(m) },
    {
      rootFolderId: settings.rootFolderId,
      sourceFolderId: sourceId as string,
      targetFolderId: targetId as string,
      projectId: projectId as string,
      environment: projectId as string,
      lockfile: { version: googleapisLockfileVersion, hash: lockfileHash },
    }
  );

  fs.writeFileSync(outFile, JSON.stringify(plan, null, 2));
  console.log('---');
  console.log(`Planを書き出しました: ${outFile} (planId=${plan.planId})`);
  console.log(
    `操作: ファイル移動=${plan.summary.fileMoves} / フォルダ再親付け=${plan.summary.folderMoves} / ` +
      `フォルダtrash=${plan.summary.folderTrashes} / 走査した統合元フォルダ=${plan.summary.visitedSourceFolderCount}`
  );
  console.log(`同名ファイルの併存=${plan.summary.sameNameFileCount}件 / 阻害要因=${plan.blockers.length}件`);
  for (const b of plan.blockers) {
    console.log(`  [blocker] ${b.code}${b.id ? ` id=${b.id}` : ''}${b.count !== undefined ? ` count=${b.count}` : ''}`);
  }
  console.log('注意: 統合対象(統合元・統合先のツリー)の外にあるショートカットが統合元フォルダを指していても検知できません。統合後にリンク切れになりえます。');
  if (plan.blockers.length > 0) {
    console.log('::warning::folder-tree-merge planに阻害要因があります。executeは拒否されます。解消してから再planしてください。');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    if (error instanceof TreeMergeValidationError) {
      console.error(`❌ 前提条件の不一致: ${error.code}${error.message.includes('(') ? error.message.slice(error.message.indexOf('(')) : ''}`);
      process.exit(2);
    }
    // Drive APIエラーはリソース名(=利用者名)を含みうるため、無害化した種別のみ出力する。
    console.error('エラー:', describeErrorSafely(error));
    process.exit(1);
  });
