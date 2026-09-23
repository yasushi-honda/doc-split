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
import type { drive_v3 } from 'googleapis';
import {
  SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION,
  verifySiblingGroupFingerprint,
  isGroupAlreadyMerged,
  type FolderSnapshot,
  type SiblingDuplicateApproval,
  type SiblingDuplicatePlan,
  type SiblingGroup,
} from './lib/siblingDuplicatePlanTypes';
import type { SiblingMergeManifest, SiblingMergeManifestEntry } from './lib/siblingMergeManifest';
import { readDriveApiVersionSnapshot, verifyDriveApiVersionMatch } from './lib/driveApiVersionGate';

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

async function fetchLiveSnapshot(
  drive: drive_v3.Drive,
  folderId: string,
  folderMimeType: string,
  claimKey: string
): Promise<FolderSnapshot | null> {
  let res;
  try {
    res = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,parents,trashed,modifiedTime,appProperties',
      supportsAllDrives: true,
    });
  } catch (err) {
    const status = (err as { code?: number; response?: { status?: number } }).code
      ?? (err as { response?: { status?: number } }).response?.status;
    if (status === 404) return null;
    throw err;
  }
  const f = res.data;
  if (f.trashed) {
    return {
      id: f.id as string,
      parentId: f.parents?.[0] ?? '',
      name: f.name ?? '',
      trashed: true,
      modifiedTime: f.modifiedTime ?? '',
      hasClaimTag: !!f.appProperties?.[claimKey],
      childFolderCount: 0,
      childFileCount: 0,
    };
  }

  let childFolderCount = 0;
  let childFileCount = 0;
  let pageToken: string | undefined;
  do {
    const childRes = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,mimeType)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const c of childRes.data.files ?? []) {
      if (c.mimeType === folderMimeType) childFolderCount += 1;
      else childFileCount += 1;
    }
    pageToken = childRes.data.nextPageToken ?? undefined;
  } while (pageToken);

  return {
    id: f.id as string,
    parentId: f.parents?.[0] ?? '',
    name: f.name ?? '',
    trashed: false,
    modifiedTime: f.modifiedTime ?? '',
    hasClaimTag: !!f.appProperties?.[claimKey],
    childFolderCount,
    childFileCount,
  };
}

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

  const approvedGroups = plan.groups.filter((g) => approval.approvedGroupIds.includes(g.groupId));

  const manifest: SiblingMergeManifest = {
    planId: plan.planId,
    environment: plan.environment,
    entries: [],
    skipped: [],
  };

  // silent-failure-hunter/code-reviewer指摘対応(PR#1038、execute-drive-folder-merge.tsと
  // 同型): 従来はループ全体の完走後に1回だけmanifestを書き出しており、途中でプロセスが
  // 落ちると(SIGKILL等)、それまでに完了したファイル移動・trashの記録が失われうる。
  // group単位の処理完了ごとに都度永続化する。
  function persistManifest(): void {
    if (!shouldExecute) return;
    fs.writeFileSync(manifestOutFile, JSON.stringify(manifest, null, 2));
  }

  for (const group of approvedGroups) {
    if (group.action !== 'merge' || !group.canonicalFolderId || !group.duplicateFolderId) {
      console.log(`[skip] ${group.groupId}: action='${group.action}'のgroupは承認されていても実行しない`);
      manifest.skipped.push({ groupId: group.groupId, reason: `action='${group.action}'は実行対象外` });
      persistManifest();
      continue;
    }

    const planCanonical = group.folders.find((f) => f.id === group.canonicalFolderId);
    const planDuplicate = group.folders.find((f) => f.id === group.duplicateFolderId);
    if (!planCanonical || !planDuplicate) {
      manifest.skipped.push({ groupId: group.groupId, reason: 'plan内にcanonical/duplicateのsnapshotが見つからない' });
      persistManifest();
      continue;
    }

    const liveDuplicate = await fetchLiveSnapshot(drive, group.duplicateFolderId, FOLDER_MIME_TYPE, DOCSPLIT_FOLDER_CLAIM_KEY);
    if (isGroupAlreadyMerged(liveDuplicate)) {
      console.log(`[skip] ${group.groupId}: 既に統合済み(duplicateフォルダが404またはtrashed)`);
      manifest.skipped.push({ groupId: group.groupId, reason: '既に統合済み' });
      persistManifest();
      continue;
    }

    const liveCanonical = await fetchLiveSnapshot(drive, group.canonicalFolderId, FOLDER_MIME_TYPE, DOCSPLIT_FOLDER_CLAIM_KEY);
    if (!liveCanonical) {
      manifest.skipped.push({ groupId: group.groupId, reason: 'canonicalフォルダが404(手動削除された可能性)' });
      persistManifest();
      continue;
    }

    const fingerprintCheck = verifySiblingGroupFingerprint(
      { canonical: planCanonical, duplicate: planDuplicate },
      { canonical: liveCanonical, duplicate: liveDuplicate as FolderSnapshot }
    );
    if (!fingerprintCheck.ok) {
      console.log(`[skip] ${group.groupId}: ${fingerprintCheck.reason}`);
      manifest.skipped.push({ groupId: group.groupId, reason: fingerprintCheck.reason });
      persistManifest();
      continue;
    }

    // duplicateフォルダ配下の全ファイルを列挙する
    const filesToMove: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${group.duplicateFolderId}' in parents and trashed=false and mimeType!='${FOLDER_MIME_TYPE}'`,
        fields: 'nextPageToken, files(id)',
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files ?? []) {
        if (f.id) filesToMove.push(f.id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    console.log(
      `[${shouldExecute ? '実行' : 'dry-run'}] ${group.groupId}: "${group.parentPath}/${group.name}" ` +
        `duplicate(${group.duplicateFolderId}) → canonical(${group.canonicalFolderId}) へ${filesToMove.length}件を移動`
    );

    if (!shouldExecute) {
      continue;
    }

    const movedFileIds: string[] = [];
    const failedFileMoves: Array<{ fileId: string; error: string }> = [];
    for (const fileId of filesToMove) {
      try {
        await drive.files.update({
          fileId,
          addParents: group.canonicalFolderId,
          removeParents: group.duplicateFolderId,
          supportsAllDrives: true,
          fields: 'id',
        });
        movedFileIds.push(fileId);
      } catch (err) {
        failedFileMoves.push({ fileId, error: (err as Error).message });
      }
    }

    const entry: SiblingMergeManifestEntry = {
      groupId: group.groupId,
      canonicalFolderId: group.canonicalFolderId,
      duplicateFolderId: group.duplicateFolderId,
      movedFileIds,
      failedFileMoves,
      claimInvalidatedCount: 0,
      duplicateTrashedAt: null,
      timestamp: new Date().toISOString(),
    };

    if (failedFileMoves.length > 0) {
      console.error(
        `  ⚠️  ${failedFileMoves.length}件のファイル移動が失敗したため、claim無効化・trashは実行しません(次回再実行で再試行可能)`
      );
      manifest.entries.push(entry);
      persistManifest();
      continue;
    }

    // fable-reviewセカンドオピニオン指摘(High#1、2パス目) + comment-analyzer/codex review
    // 指摘対応(PR#1038): kanameoneはdriveFolderClaimReadが既に有効なため、対象claimが
    // 既にdivergent化している場合がありうる。安全にtrashへ進めてよいのは次のいずれか:
    //   (a) claimが存在しない
    //   (b) state==='resolved' かつ folderIdがduplicate自身を指す(この後で無効化してtrash)
    //   (c) state==='invalidated'(execute-drive-claim-resync --mode release-claim等で
    //       既に無効化済み。この場所を指す生きたclaimはもう無いためtrash可能。旧実装は
    //       'resolved'以外を一律skipしていたため、release-claim直後の再実行でも
    //       無限にtrashできない不具合があった=SOP記載の「再実行すればtrashまで完了する」
    //       という前提と実装が食い違っていた、comment-analyzer指摘で発覚)
    // divergent/creatingはtrashをskipし、先にexecute-drive-claim-resync(release-claim)での
    // 解消を促す。
    const existingClaim = await readClaim(firestore, group.parentId, group.name);
    const claimWasResolvedForDuplicate =
      !!existingClaim && existingClaim.state === 'resolved' && existingClaim.folderId === group.duplicateFolderId;
    const claimBlocksTrash =
      !!existingClaim && existingClaim.state !== 'invalidated' && !claimWasResolvedForDuplicate;
    if (claimBlocksTrash) {
      console.error(
        `  ⚠️  claim状態が'${existingClaim!.state}'のためtrashをskipします(ファイル移動は完了済み)。` +
          `先に classify-drive-claim-divergence → execute-drive-claim-resync(release-claim) で解消してから再実行してください`
      );
      manifest.skipped.push({
        groupId: group.groupId,
        reason: `claim状態が'${existingClaim!.state}'のため未解消(release-claim後に再実行が必要)`,
      });
      manifest.entries.push(entry);
      persistManifest();
      continue;
    }

    // fable-reviewセカンドオピニオン指摘(High#2、1パス目) + codex review指摘対応
    // (PR#1038、P1): ファイル列挙〜trashの間に並行exportがduplicateフォルダへ新規の
    // ファイル/フォルダを作成する競合窓がある(resolved claimは5分間files.getのみで
    // 信頼されるため、並行exportがfiles.list照合無しでduplicateへ書き込みうる)。
    // trash直前に再列挙し、1件でも残っていればtrashせずskipする。旧実装はmimeTypeで
    // 非フォルダのみを再確認していたため、並行exportが作成した「サブフォルダ」を
    // 見逃し、そのままduplicateごとtrashしてしまう欠陥があった(codex指摘、classifier側の
    // 前提「duplicate.childFolderCount===0」を維持するにはフォルダも含めて0件を要求する
    // 必要がある)。
    const remainingChildren: string[] = [];
    let recheckPageToken: string | undefined;
    do {
      const recheckRes = await drive.files.list({
        q: `'${group.duplicateFolderId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(id)',
        pageSize: 100,
        pageToken: recheckPageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of recheckRes.data.files ?? []) {
        if (f.id) remainingChildren.push(f.id);
      }
      recheckPageToken = recheckRes.data.nextPageToken ?? undefined;
    } while (recheckPageToken);
    if (remainingChildren.length > 0) {
      console.error(
        `  ⚠️  trash直前の再確認でduplicateフォルダに${remainingChildren.length}件の新規ファイル/フォルダを検出したためtrashをskipします(並行exportとの競合の可能性、次回再実行で再試行可能)`
      );
      manifest.skipped.push({
        groupId: group.groupId,
        reason: `trash直前の再確認でduplicateフォルダが空でなかった(${remainingChildren.length}件、並行export競合の疑い)`,
      });
      manifest.entries.push(entry);
      persistManifest();
      continue;
    }

    // claim無効化(件数照合)→ trashの順序を厳守する(codex High#5対応)
    const claimInvalidatedCount = await invalidateResolvedClaimByFolderId(firestore, group.duplicateFolderId);
    entry.claimInvalidatedCount = claimInvalidatedCount;

    // codex review指摘対応(PR#1038、P1): 上のreadClaim確認からここまでの間に並行export
    // がclaimを'resolved'から別状態へ遷移させていた場合(TOCTOU)、
    // invalidateResolvedClaimByFolderId内部のトランザクションは状態不一致でwriteをスキップし
    // invalidatedCount=0を返す。claimWasResolvedForDuplicate(=1件無効化されるはずだった)なのに
    // 実際の無効化件数が0件なら、対象claimがまだduplicateを指す形で生きている可能性が
    // あるためtrashを進めてはならない。
    if (claimWasResolvedForDuplicate && claimInvalidatedCount === 0) {
      console.error(
        `  ⚠️  claim無効化件数が0件(並行してclaim状態が変化した疑い)のためtrashをskipします(次回再実行で再試行可能)`
      );
      manifest.skipped.push({
        groupId: group.groupId,
        reason: 'claim無効化直前の再照合で不一致(並行更新の疑い)',
      });
      manifest.entries.push(entry);
      persistManifest();
      continue;
    }

    // fable-reviewセカンドオピニオン指摘(High#4): drive.file→driveフルスコープ化に伴い、
    // 既存の`materializeExistingFolderFile()`(2段階検索のtrashed fallback)は、タグの
    // 有無を問わず同名trashedフォルダを復元するようになった(旧スコープでは人が捨てた
    // フォルダは不可視だったため実害が無かった)。統合済みduplicateを元の名前のまま
    // trashすると、将来同じ名前で0件マッチが起きた際に誤って復元されうる。改名してから
    // trashすることで、名前一致検索の対象から外す。
    const trashedSuffix = `【統合済み_${new Date().toISOString().slice(0, 10)}】`;
    await drive.files.update({
      fileId: group.duplicateFolderId,
      requestBody: { name: `${group.name}${trashedSuffix}`, trashed: true },
      supportsAllDrives: true,
      fields: 'id',
    });
    entry.duplicateTrashedAt = new Date().toISOString();

    console.log(
      `  ✅ 完了: ${movedFileIds.length}件移動、claim ${claimInvalidatedCount}件無効化、duplicateをtrash`
    );
    manifest.entries.push(entry);
    persistManifest();
  }

  if (shouldExecute) {
    persistManifest();
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
