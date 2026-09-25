/**
 * Issue #1039恒久対応: `scripts/execute-drive-sibling-merge.ts`のmain()に直接実装されていた
 * コアロジック(Drive呼出し順序・7つの安全分岐)を、fake Drive/実Firestore emulatorで
 * 統合テスト可能な形に切り出したもの(`scripts/lib/executeDivergenceResync.ts`と同型
 * パターン)。挙動(Drive呼出しの順序・引数・manifest内容・ログ文言)は元の
 * `execute-drive-sibling-merge.ts`から一切変更していない、純粋な抽出リファクタ。
 *
 * 実行順序はcodex High#5指摘対応で固定している(移設元のヘッダーコメント参照):
 *   1. duplicate(app作成)フォルダ配下の全ファイルをcanonical(人作成)フォルダへ移動
 *   2. 全ファイル移動の成功を確認(1件でも失敗があれば以降は実行せず次のgroupへ)
 *   3. duplicateフォルダのresolved claimをフェンシング付きで無効化し、成功件数を確認
 *      (その直前に現在のclaim状態を読み、trashを進めてよいかを判定する)
 *   4. 上記が全て完了した後にのみ、空になったduplicateフォルダをtrashする
 *
 * plan-crossreview(2026-09-25)でのdecision-maker確定事項: Issue #1039本文が例示した
 * 「API timeout後の状態照合」(files.update失敗時に対象ファイルを再取得し実際に
 * 適用済みか判定するロジック)は、実装すると「純粋な抽出リファクタ」の前提を破る
 * 挙動変更になるため、本Issueのスコープには含めない。timeout時は従来通り
 * `failedFileMoves`に記録してそのgroupの処理を打ち切り、次回同一planの再実行時に
 * 移動対象ファイルの再列挙から仕切り直す(=既に移動済みのファイルは再列挙で
 * 対象から外れる)という既存の回復力に留める。
 */

import type { drive_v3 } from 'googleapis';
import type * as admin from 'firebase-admin';
import {
  verifySiblingGroupFingerprint,
  isGroupAlreadyMerged,
  type FolderSnapshot,
  type SiblingDuplicateApproval,
  type SiblingDuplicatePlan,
} from './siblingDuplicatePlanTypes';
import type { SiblingMergeManifest, SiblingMergeManifestEntry } from './siblingMergeManifest';

export interface SiblingMergeDriveDeps {
  drive: drive_v3.Drive;
  folderMimeType: string;
  claimKey: string;
}

interface ClaimRecord {
  state: 'creating' | 'resolved' | 'invalidated' | 'divergent';
  folderId?: string;
}

export interface SiblingMergeClaimFunctions {
  readClaim: (
    firestore: admin.firestore.Firestore,
    parentId: string,
    name: string
  ) => Promise<ClaimRecord | null>;
  invalidateResolvedClaimByFolderId: (
    firestore: admin.firestore.Firestore,
    folderId: string
  ) => Promise<number>;
}

export interface ExecuteSiblingMergeOptions {
  execute: boolean;
  log?: (message: string) => void;
  logError?: (message: string) => void;
  /** execute時のみ、各group処理直後に呼ぶ(元main()の`persistManifest()`相当)。 */
  onProgress?: (manifest: SiblingMergeManifest) => void;
}

export type SiblingGroupStatus =
  | 'merged'
  | 'dry-run'
  | 'skipped-non-merge-action'
  | 'skipped-missing-snapshot'
  | 'skipped-already-merged'
  | 'skipped-canonical-missing'
  | 'skipped-fingerprint-mismatch'
  | 'partial-file-move-failure'
  | 'trash-blocked-by-claim'
  | 'trash-blocked-not-empty'
  | 'trash-blocked-claim-toctou';

export interface SiblingGroupOutcome {
  groupId: string;
  status: SiblingGroupStatus;
  plannedFileMoveCount?: number;
}

async function fetchLiveSnapshot(
  deps: SiblingMergeDriveDeps,
  folderId: string
): Promise<FolderSnapshot | null> {
  let res;
  try {
    res = await deps.drive.files.get({
      fileId: folderId,
      fields: 'id,name,parents,trashed,modifiedTime,appProperties',
      supportsAllDrives: true,
    });
  } catch (err) {
    const status =
      (err as { code?: number; response?: { status?: number } }).code ??
      (err as { response?: { status?: number } }).response?.status;
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
      hasClaimTag: !!f.appProperties?.[deps.claimKey],
      childFolderCount: 0,
      childFileCount: 0,
    };
  }

  let childFolderCount = 0;
  let childFileCount = 0;
  let pageToken: string | undefined;
  do {
    const childRes = await deps.drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,mimeType)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const c of childRes.data.files ?? []) {
      if (c.mimeType === deps.folderMimeType) childFolderCount += 1;
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
    hasClaimTag: !!f.appProperties?.[deps.claimKey],
    childFolderCount,
    childFileCount,
  };
}

export async function executeSiblingMerge(
  deps: SiblingMergeDriveDeps,
  firestore: admin.firestore.Firestore,
  claimFns: SiblingMergeClaimFunctions,
  plan: SiblingDuplicatePlan,
  approval: SiblingDuplicateApproval,
  options: ExecuteSiblingMergeOptions
): Promise<{ manifest: SiblingMergeManifest; outcomes: SiblingGroupOutcome[] }> {
  const log = options.log ?? ((msg: string) => console.log(msg));
  const logError = options.logError ?? ((msg: string) => console.error(msg));
  const shouldExecute = options.execute;

  const approvedGroups = plan.groups.filter((g) => approval.approvedGroupIds.includes(g.groupId));

  const manifest: SiblingMergeManifest = {
    planId: plan.planId,
    environment: plan.environment,
    entries: [],
    skipped: [],
  };
  const outcomes: SiblingGroupOutcome[] = [];

  function persistManifest(): void {
    if (!shouldExecute) return;
    options.onProgress?.(manifest);
  }

  for (const group of approvedGroups) {
    if (group.action !== 'merge' || !group.canonicalFolderId || !group.duplicateFolderId) {
      log(`[skip] ${group.groupId}: action='${group.action}'のgroupは承認されていても実行しない`);
      manifest.skipped.push({ groupId: group.groupId, reason: `action='${group.action}'は実行対象外` });
      outcomes.push({ groupId: group.groupId, status: 'skipped-non-merge-action' });
      persistManifest();
      continue;
    }

    const planCanonical = group.folders.find((f) => f.id === group.canonicalFolderId);
    const planDuplicate = group.folders.find((f) => f.id === group.duplicateFolderId);
    if (!planCanonical || !planDuplicate) {
      manifest.skipped.push({ groupId: group.groupId, reason: 'plan内にcanonical/duplicateのsnapshotが見つからない' });
      outcomes.push({ groupId: group.groupId, status: 'skipped-missing-snapshot' });
      persistManifest();
      continue;
    }

    const liveDuplicate = await fetchLiveSnapshot(deps, group.duplicateFolderId);
    if (isGroupAlreadyMerged(liveDuplicate)) {
      log(`[skip] ${group.groupId}: 既に統合済み(duplicateフォルダが404またはtrashed)`);
      manifest.skipped.push({ groupId: group.groupId, reason: '既に統合済み' });
      outcomes.push({ groupId: group.groupId, status: 'skipped-already-merged' });
      persistManifest();
      continue;
    }

    const liveCanonical = await fetchLiveSnapshot(deps, group.canonicalFolderId);
    if (!liveCanonical) {
      manifest.skipped.push({ groupId: group.groupId, reason: 'canonicalフォルダが404(手動削除された可能性)' });
      outcomes.push({ groupId: group.groupId, status: 'skipped-canonical-missing' });
      persistManifest();
      continue;
    }

    const fingerprintCheck = verifySiblingGroupFingerprint(
      { canonical: planCanonical, duplicate: planDuplicate },
      { canonical: liveCanonical, duplicate: liveDuplicate as FolderSnapshot }
    );
    if (!fingerprintCheck.ok) {
      log(`[skip] ${group.groupId}: ${fingerprintCheck.reason}`);
      manifest.skipped.push({ groupId: group.groupId, reason: fingerprintCheck.reason });
      outcomes.push({ groupId: group.groupId, status: 'skipped-fingerprint-mismatch' });
      persistManifest();
      continue;
    }

    // duplicateフォルダ配下の全ファイルを列挙する
    const filesToMove: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await deps.drive.files.list({
        q: `'${group.duplicateFolderId}' in parents and trashed=false and mimeType!='${deps.folderMimeType}'`,
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

    log(
      `[${shouldExecute ? '実行' : 'dry-run'}] ${group.groupId}: "${group.parentPath}/${group.name}" ` +
        `duplicate(${group.duplicateFolderId}) → canonical(${group.canonicalFolderId}) へ${filesToMove.length}件を移動`
    );

    if (!shouldExecute) {
      outcomes.push({ groupId: group.groupId, status: 'dry-run', plannedFileMoveCount: filesToMove.length });
      continue;
    }

    const movedFileIds: string[] = [];
    const failedFileMoves: Array<{ fileId: string; error: string }> = [];
    for (const fileId of filesToMove) {
      try {
        await deps.drive.files.update({
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
      logError(
        `  ⚠️  ${failedFileMoves.length}件のファイル移動が失敗したため、claim無効化・trashは実行しません(次回再実行で再試行可能)`
      );
      manifest.entries.push(entry);
      outcomes.push({ groupId: group.groupId, status: 'partial-file-move-failure' });
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
        // 'resolved'以外を一律skipしていたため、release-claim直後の再実行でも
        // 無限にtrashできない不具合があった=SOP記載の「再実行すればtrashまで完了する」
    //       という前提と実装が食い違っていた、comment-analyzer指摘で発覚)
    // divergent/creatingはtrashをskipし、先にexecute-drive-claim-resync(release-claim)での
    // 解消を促す。
    const existingClaim = await claimFns.readClaim(firestore, group.parentId, group.name);
    const claimWasResolvedForDuplicate =
      !!existingClaim && existingClaim.state === 'resolved' && existingClaim.folderId === group.duplicateFolderId;
    const claimBlocksTrash =
      !!existingClaim && existingClaim.state !== 'invalidated' && !claimWasResolvedForDuplicate;
    if (claimBlocksTrash) {
      logError(
        `  ⚠️  claim状態が'${existingClaim!.state}'のためtrashをskipします(ファイル移動は完了済み)。` +
          `先に classify-drive-claim-divergence → execute-drive-claim-resync(release-claim) で解消してから再実行してください`
      );
      manifest.skipped.push({
        groupId: group.groupId,
        reason: `claim状態が'${existingClaim!.state}'のため未解消(release-claim後に再実行が必要)`,
      });
      manifest.entries.push(entry);
      outcomes.push({ groupId: group.groupId, status: 'trash-blocked-by-claim' });
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
      const recheckRes = await deps.drive.files.list({
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
      logError(
        `  ⚠️  trash直前の再確認でduplicateフォルダに${remainingChildren.length}件の新規ファイル/フォルダを検出したためtrashをskipします(並行exportとの競合の可能性、次回再実行で再試行可能)`
      );
      manifest.skipped.push({
        groupId: group.groupId,
        reason: `trash直前の再確認でduplicateフォルダが空でなかった(${remainingChildren.length}件、並行export競合の疑い)`,
      });
      manifest.entries.push(entry);
      outcomes.push({ groupId: group.groupId, status: 'trash-blocked-not-empty' });
      persistManifest();
      continue;
    }

    // claim無効化(件数照合)→ trashの順序を厳守する(codex High#5対応)
    const claimInvalidatedCount = await claimFns.invalidateResolvedClaimByFolderId(firestore, group.duplicateFolderId);
    entry.claimInvalidatedCount = claimInvalidatedCount;

    // codex review指摘対応(PR#1038、P1): 上のreadClaim確認からここまでの間に並行export
    // がclaimを'resolved'から別状態へ遷移させていた場合(TOCTOU)、
    // invalidateResolvedClaimByFolderId内部のトランザクションは状態不一致でwriteをスキップし
    // invalidatedCount=0を返す。claimWasResolvedForDuplicate(=1件無効化されるはずだった)なのに
    // 実際の無効化件数が0件なら、対象claimがまだduplicateを指す形で生きている可能性が
    // あるためtrashを進めてはならない。
    if (claimWasResolvedForDuplicate && claimInvalidatedCount === 0) {
      logError(
        `  ⚠️  claim無効化件数が0件(並行してclaim状態が変化した疑い)のためtrashをskipします(次回再実行で再試行可能)`
      );
      manifest.skipped.push({
        groupId: group.groupId,
        reason: 'claim無効化直前の再照合で不一致(並行更新の疑い)',
      });
      manifest.entries.push(entry);
      outcomes.push({ groupId: group.groupId, status: 'trash-blocked-claim-toctou' });
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
    await deps.drive.files.update({
      fileId: group.duplicateFolderId,
      requestBody: { name: `${group.name}${trashedSuffix}`, trashed: true },
      supportsAllDrives: true,
      fields: 'id',
    });
    entry.duplicateTrashedAt = new Date().toISOString();

    log(
      `  ✅ 完了: ${movedFileIds.length}件移動、claim ${claimInvalidatedCount}件無効化、duplicateをtrash`
    );
    manifest.entries.push(entry);
    outcomes.push({ groupId: group.groupId, status: 'merged' });
    persistManifest();
  }

  return { manifest, outcomes };
}
