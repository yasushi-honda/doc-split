#!/usr/bin/env ts-node
/**
 * Issue #1028(ADR-0028): 兄弟重複(同一parent+nameのactiveフォルダ2件以上)の棚卸し(read-only)
 *
 * drive.file→driveフルスコープ拡張(ADR-0028)の再連携後、`settings/drive.rootFolderId`
 * 配下の全階層を走査し、人が手動作成したフォルダ(docSplitFolderClaimタグ無し)とappが
 * 作成したフォルダ(タグ有り)が同一parent+nameで並存しているグループを検出する。
 *
 * Firestore/Driveへの書き込みは一切行わない。分類ロジックは`scripts/lib/
 * siblingDuplicateClassifier.ts`(純粋関数、単体テスト済み)に委譲し、本ファイルは
 * Drive API呼び出し(BFS走査)とPlan JSON出力のみを担う。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/audit-drive-sibling-duplicates.ts \
 *     --out plan-output.json
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import {
  SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION,
  type SiblingDuplicatePlan,
  type SiblingGroupAction,
} from './lib/siblingDuplicatePlanTypes';
import { readDriveApiVersionSnapshot } from './lib/driveApiVersionGate';
import { scanSiblingDuplicates } from './lib/auditSiblingDuplicates';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

function getOpt(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const outFile = getOpt('--out') ?? 'plan-output.json';

admin.initializeApp({ projectId });

async function main(): Promise<void> {
  // driveAuth.tsはモジュールトップレベルでadmin.firestore()を評価するため、
  // admin.initializeApp()より前に静的importするとFirebaseAppError(no-app)になる
  // (既存の investigate-drive-folder-duplicate-by-name.ts と同型の対策)。
  const { getDriveSettings, getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { FOLDER_MIME_TYPE, DOCSPLIT_FOLDER_CLAIM_KEY } = await import(
    '../functions/src/drive/driveApiConstants'
  );
  const { REQUIRED_DRIVE_SCOPE } = await import('../functions/src/drive/exchangeDriveAuthCode');

  console.log(`プロジェクト: ${projectId}`);

  const settings = await getDriveSettings();
  const { rootFolderId } = settings;
  if (!rootFolderId) {
    console.error('❌ settings/drive.rootFolderId が未設定です。');
    process.exit(1);
  }

  // fable-reviewセカンドオピニオン指摘(High#3): 旧drive.fileスコープのままだと
  // 人作成フォルダが不可視のため「重複0件」と誤って完走してしまう(本Issueの原因を
  // 監査ツール自身が再演する)。再連携未実施のまま誤って実行するのをfail-closedで防ぐ。
  const grantedScopes = settings.grantedScopes ?? [];
  if (!grantedScopes.includes(REQUIRED_DRIVE_SCOPE)) {
    console.error(
      `❌ settings/drive.grantedScopesに${REQUIRED_DRIVE_SCOPE}が含まれていません。` +
        '再連携(Drive設定画面で「再連携する」)が完了してから実行してください。' +
        '未連携のまま実行すると、人作成フォルダが不可視のため「重複0件」という誤った結果になります。'
    );
    process.exit(2);
  }

  const drive = await getDriveClient();

  const rootMeta = await drive.files.get({
    fileId: rootFolderId,
    fields: 'id,name,trashed',
    supportsAllDrives: true,
  });
  if (rootMeta.data.trashed) {
    console.error('❌ rootFolderIdがtrashed状態です。');
    process.exit(1);
  }
  const rootName = rootMeta.data.name ?? '(rootFolder)';

  console.log(`rootFolderId: ${rootFolderId} ("${rootName}")`);
  console.log('全階層をBFSで走査します(件数が多い場合、時間がかかることがあります)。');
  console.log('---');

  const { scannedFolderCount, groups } = await scanSiblingDuplicates({
    drive,
    rootFolderId,
    rootName,
    folderMimeType: FOLDER_MIME_TYPE,
    claimKey: DOCSPLIT_FOLDER_CLAIM_KEY,
  });

  console.log(`走査完了: フォルダ${scannedFolderCount}件`);
  console.log('---');

  const byAction = { merge: 0, 'manual-review': 0 } as Record<SiblingGroupAction, number>;
  for (const g of groups) byAction[g.action] += 1;

  console.log(`兄弟重複グループ: ${groups.length}件 (merge候補=${byAction.merge}件 / manual-review=${byAction['manual-review']}件)`);
  for (const g of groups) {
    console.log(
      `  [${g.action}] "${g.parentPath}/${g.name}" (${g.folders.length}件): ${g.reason}`
    );
  }
  console.log('---');

  const { lockfileHash, googleapisLockfileVersion } = readDriveApiVersionSnapshot();

  const plan: SiblingDuplicatePlan = {
    schemaVersion: SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION,
    planId: `sibling-duplicate-${Date.now()}`,
    createdAt: new Date().toISOString(),
    environment: projectId as string,
    projectId: projectId as string,
    rootFolderId,
    googleapisLockfileVersion,
    lockfileHash,
    summary: {
      scannedFolderCount,
      groupCount: groups.length,
      byAction,
    },
    groups,
  };

  fs.writeFileSync(outFile, JSON.stringify(plan, null, 2));
  console.log(`Planを書き出しました: ${outFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('エラー:', error);
    process.exit(1);
  });
