#!/usr/bin/env ts-node
/**
 * Issue #1028(ADR-0028): 兄弟重複(人が作った側 vs appが作った側)の統合実行(承認制)
 *
 * `scripts/audit-drive-sibling-duplicates.ts`が出力したPlanを読み、承認されたgroupの
 * みを実行直前に再照合(fencing、codex High#8対応)してから実行する。
 *
 * 実行順序はcodex High#5指摘対応で固定している:
 *   1. duplicate(app作成)フォルダ配下の全ファイルをcanonical(人作成)フォルダへ移動
 *   2. 全ファイル移動の成功を確認(1件でも失敗があれば以降は実行せず次のgroupへ)
 *   3. duplicateフォルダのresolved claimをフェンシング付きで無効化し、成功件数を確認
 *   4. 上記が全て完了した後にのみ、空になったduplicateフォルダをtrashする
 * (逆順で実行すると、claim無効化に失敗した状態でtrashした場合、残ったresolved claim
 * が次回exportでuntrashしてしまう事故が起きうるため)
 *
 * 冪等性: 再実行時、duplicateフォルダが既に404または既にtrashed済みのgroupは
 * 「既に統合済み」としてskipする(部分成功からの再開を、専用rollbackスクリプトを
 * 設けずに同一スクリプトの再実行で完結させる設計、codex Medium指摘対応)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/execute-drive-sibling-merge.ts \
 *     --plan plan-output.json --approval approval.json [--execute] [--manifest-out manifest-output.json]
 *
 *   --execute なし: dry-run (Drive/Firestoreへの書込みゼロ、再照合結果とmoveされる予定の
 *   ファイル件数のプレビューのみ)
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import {
  SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION,
  type SiblingDuplicateApproval,
  type SiblingDuplicatePlan,
} from './lib/siblingDuplicatePlanTypes';
import type { SiblingMergeManifest } from './lib/siblingMergeManifest';
import { readDriveApiVersionSnapshot, verifyDriveApiVersionMatch } from './lib/driveApiVersionGate';
import { executeSiblingMerge } from './lib/executeSiblingMerge';

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
const shouldExecute = process.argv.includes('--execute');

if (!planPathArg || !approvalPathArg) {
  console.error('--plan <path> と --approval <path> は必須です');
  process.exit(1);
}
const planPath: string = planPathArg;
const approvalPath: string = approvalPathArg;

admin.initializeApp({ projectId });

async function main(): Promise<void> {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as SiblingDuplicatePlan;
  if (plan.schemaVersion !== SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION) {
    console.error(
      `FATAL: schemaVersion不一致(plan=${plan.schemaVersion}, expected=${SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION})`
    );
    process.exit(2);
  }

  const approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8')) as SiblingDuplicateApproval;
  if (approval.planId !== plan.planId) {
    console.error(
      `FATAL: approval.planId(${approval.planId})がplan.planId(${plan.planId})と一致しません`
    );
    process.exit(2);
  }

  // codex review指摘対応(PR#1038): execute-drive-folder-merge.tsと同型のprojectIdゲート。
  // 別環境向けのPlanを誤ったFIREBASE_PROJECT_IDで実行してしまう事故を防ぐ。
  if (plan.projectId !== projectId) {
    console.error(`FATAL: plan.projectId(${plan.projectId}) !== runtime FIREBASE_PROJECT_ID(${projectId})`);
    process.exit(2);
  }

  const runtimeVersion = readDriveApiVersionSnapshot();
  const versionCheck = verifyDriveApiVersionMatch(
    { lockfileHash: plan.lockfileHash, googleapisLockfileVersion: plan.googleapisLockfileVersion },
    runtimeVersion
  );
  if (!versionCheck.ok) {
    console.error(`FATAL: ${versionCheck.reason}`);
    process.exit(2);
  }

  console.log(`プロジェクト: ${projectId}`);
  console.log(`Plan: ${planPath} (planId=${plan.planId}, groups=${plan.groups.length}件)`);
  console.log(`モード: ${shouldExecute ? '実行(--execute)' : 'dry-run(プレビューのみ)'}`);
  console.log('---');

  const { getDriveSettings, getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { invalidateResolvedClaimByFolderId, readClaim } = await import(
    '../functions/src/drive/driveFolderClaim'
  );
  const { FOLDER_MIME_TYPE, DOCSPLIT_FOLDER_CLAIM_KEY } = await import(
    '../functions/src/drive/driveApiConstants'
  );
  const { REQUIRED_DRIVE_SCOPE } = await import('../functions/src/drive/exchangeDriveAuthCode');

  // fable-reviewセカンドオピニオン指摘(High#3): 旧drive.fileスコープのままだと
  // 人作成フォルダが不可視のまま「重複0件」と誤って完走してしまう。再連携未実施の
  // まま誤って実行するのをfail-closedで防ぐ。
  const driveSettings = await getDriveSettings();
  const grantedScopes = driveSettings.grantedScopes ?? [];
  if (!grantedScopes.includes(REQUIRED_DRIVE_SCOPE)) {
    console.error(
      `FATAL: settings/drive.grantedScopesに${REQUIRED_DRIVE_SCOPE}が含まれていません。` +
        '再連携(Drive設定画面で「再連携する」)が完了してから実行してください。'
    );
    process.exit(2);
  }

  const drive = await getDriveClient();
  const firestore = admin.firestore();

  const { manifest } = await executeSiblingMerge(
    { drive, folderMimeType: FOLDER_MIME_TYPE, claimKey: DOCSPLIT_FOLDER_CLAIM_KEY },
    firestore,
    { readClaim, invalidateResolvedClaimByFolderId },
    plan,
    approval,
    {
      execute: shouldExecute,
      // silent-failure-hunter/code-reviewer指摘対応(PR#1038、execute-drive-folder-merge.tsと
      // 同型): 従来はループ全体の完走後に1回だけmanifestを書き出しており、途中でプロセスが
      // 落ちると(SIGKILL等)、それまでに完了したファイル移動・trashの記録が失われうる。
      // group単位の処理完了ごとに都度永続化する。
      onProgress: (m: SiblingMergeManifest) => {
        fs.writeFileSync(manifestOutFile, JSON.stringify(m, null, 2));
      },
    }
  );

  if (shouldExecute) {
    fs.writeFileSync(manifestOutFile, JSON.stringify(manifest, null, 2));
    console.log('---');
    console.log(`Manifestを書き出しました: ${manifestOutFile}`);
  }

  console.log('---');
  console.log(
    `結果: 完了=${manifest.entries.filter((e) => e.duplicateTrashedAt).length}件 / ` +
      `部分失敗=${manifest.entries.filter((e) => !e.duplicateTrashedAt).length}件 / ` +
      `skip=${manifest.skipped.length}件`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('エラー:', error);
    process.exit(1);
  });
