/**
 * Issue #811 Phase B: Part A(`scripts/execute-drive-folder-merge.ts`)専用の
 * customer/documentCategory階層resolver。
 *
 * `findOrCreateFolder.ts`(本番の`exportDocument.ts`が使う、`trashed=false`固定検索)を
 * **意図的に使わない**。4回の独立診断(codex)で「Part A自身が未修正のfindOrCreateFolder()
 * を使うと、canonical配下にゴミ箱内の同名フォルダがあった場合に新規作成し、Part Aの
 * 移行処理自身が新たな重複を作りうる」と指摘されたための専用実装。
 *
 * findOrCreateFolder.tsとの差分:
 *   - 検索は2段階(まずactiveのみ、0件の場合のみtrashed込みで再検索、2026-08-27訂正。
 *     単純な無条件trashed込み検索は、過去に整理された無関係な同名trashedフォルダが
 *     残っているだけの正常なケース(active 1件+trashedの残骸複数)まで
 *     `AmbiguousChildFolderError`にしてしまう回帰をkanameone本番で引き起こした。
 *     詳細は`findOrCreateFolder.ts`のコメント参照。同じ設計をここにも適用する)
 *   - `files.list`のページネーションを明示的に処理する(1ページ目のみで打ち切らない。
 *     findOrCreateFolder.tsの既存の穴でもある、codex Medium指摘)
 *   - 1件マッチかつtrashedなら`files.update({trashed:false})`で復元してから返す
 *   - 2件以上マッチならfail-closedで`AmbiguousChildFolderError`をthrowする(新規作成・
 *     復元のどちらも行わない)
 *
 * Issue #871恒久対策(2026-08-30、PR-4): `resolveChildFolder()`(書き込み経路)は
 * `driveFolderClaim.ts`のclaimプロトコルの完全な参加者にした(読みも書きも、
 * `findOrCreateFolder.ts`と同じ状態機械・同じFirestoreドキュメント空間を共有する)。
 * 旧`acquireFolderLock`/`releaseFolderLock`(単純な排他制御、「作成事実」を記録しない)
 * では、`files.list`の結果整合性遅延に対して無力だった経路——1件目が作成→ロック解放→
 * 直後に本番exportが同じparent+nameを検索して0件(索引未反映)→再作成——を、本resolver
 * 側からも塞ぐ。findOrCreateFolder.tsとの差分は「throwするエラークラス」(2件以上マッチ
 * 時は`AmbiguousChildFolderError`、それ以外の状態機械由来のエラーは共有クラスをそのまま
 * 使う)と「戻り値の形」(`ResolvedChildFolder`、rollback manifest用のrestored/created
 * フラグを持つ)だけに縮小している。read-only関数(`resolveExistingChildFile`等、
 * `classify-drive-export-drift.ts`用)は無変更(診断のground truth性を維持するため、
 * claimコレクションに一切アクセスしない)。
 */

import type { drive_v3 } from 'googleapis';
import type * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { SUPPORTS_ALL_DRIVES, DOCSPLIT_FOLDER_CLAIM_KEY, escapeQueryValue } from './driveApiConstants';
import { isDriveFolderClaimReadEnabled } from '../utils/featureFlags';
import {
  FolderCreationInProgressError,
  DivergentFolderClaimError,
  FolderClaimRestoreCommitError,
  CREATE_TRUST_MS,
  SOFT_TTL_MS,
  FolderClaimDoc,
  ResolvedFolderClaim,
  FolderClaimAttempt,
  readClaim,
  beginCreation,
  commitResolvedWithRetry,
  recordFullScanResolution,
  reconcileAttempt,
  invalidateAttempt,
  markDivergent,
  verifyFolderClaim,
} from './driveFolderClaim';

// 状態機械由来のエラーは呼び出し元(execute-drive-folder-merge.ts等)からの既存importを
// 壊さないよう、また`findOrCreateFolder.ts`と同じ意味を保つよう再exportする。
export { FolderCreationInProgressError, DivergentFolderClaimError, FolderClaimRestoreCommitError };

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/**
 * `resolveChildFolder`が`files.create()`自体は成功したがclaim確定書込み(`commitResolvedWithRetry`)
 * に失敗した場合に投げる(codex review P2指摘対応)。呼び出し元`resolveChildFolderPath`は
 * このerrorを検知し、Drive側で実際に作成済みの`createdFolderId`を`createdFolderIds`
 * (rollback manifest用)へ確実に含めてから`PartialChildFolderPathError`へ包み直す。
 * この専用errorを経由しないと、素の`error`だけが伝播しfolderIdが失われ、rollback対象から
 * この作成済みフォルダが漏れる(rollback-drive-folder-merge.tsが再trashed化できなくなる)。
 */
export class ChildFolderCreatedButUncommittedError extends Error {
  readonly createdFolderId: string;
  readonly cause: unknown;
  constructor(name: string, parentId: string, createdFolderId: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `[Phase B Part A] 子フォルダの作成には成功しましたがclaim確定書込みに失敗しました: "${name}"（親フォルダ: ${parentId}、folderId: ${createdFolderId}）: ${causeMessage}`
    );
    this.name = 'ChildFolderCreatedButUncommittedError';
    this.createdFolderId = createdFolderId;
    this.cause = cause;
  }
}

/**
 * `resolveChildFolder`が既存フォルダのtrashedからの復元(untrash)自体には成功したが、
 * その直後のclaim確定書込み(`commitResolvedWithRetry`)に失敗した場合に投げる
 * (codex review P2指摘対応、2巡目)。`ChildFolderCreatedButUncommittedError`の
 * restored版。呼び出し元`resolveChildFolderPath`はこのerrorを検知し、Drive側で
 * 実際に復元済みの`restoredFolderId`を`restoredFolderIds`(rollback manifest用)へ
 * 確実に含めてから`PartialChildFolderPathError`へ包み直す。
 */
export class ChildFolderRestoredButUncommittedError extends Error {
  readonly restoredFolderId: string;
  readonly cause: unknown;
  constructor(name: string, parentId: string, restoredFolderId: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `[Phase B Part A] フォルダの復元(untrash)には成功しましたがclaim確定書込みに失敗しました: "${name}"（親フォルダ: ${parentId}、folderId: ${restoredFolderId}）: ${causeMessage}`
    );
    this.name = 'ChildFolderRestoredButUncommittedError';
    this.restoredFolderId = restoredFolderId;
    this.cause = cause;
  }
}

export class AmbiguousChildFolderError extends Error {
  constructor(name: string, parentId: string, count: number) {
    super(
      `[Phase B Part A] 子フォルダ名が重複しているため解決できません(${count}件、trashed込み): "${name}"（親フォルダ: ${parentId}）。fail-closed: 作成・復元のいずれも行いません。`
    );
    this.name = 'AmbiguousChildFolderError';
  }
}

async function listMatchingFolders(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
  trashed: boolean
): Promise<drive_v3.Schema$File[]> {
  const q = `'${parentId}' in parents and name='${escapeQueryValue(name)}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=${trashed}`;
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name, trashed)',
      includeItemsFromAllDrives: true,
      pageSize: 100,
      pageToken,
      ...SUPPORTS_ALL_DRIVES,
    });
    files.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

/**
 * `parentId`直下で`name`と一致する既存フォルダを2段階で解決する
 * (`findOrCreateFolder.ts`の`resolveExistingFolder`と同型)。
 * 1. activeのみで検索: 1件ならそのファイルを返す(無関係なtrashedの同名フォルダは
 *    一切考慮しない)。2件以上なら`AmbiguousChildFolderError`。
 * 2. active 0件の場合のみtrashed込みで再検索: 1件ならそのファイル(trashed=true)を
 *    返す(呼び出し元がrestoreするかは呼び出し元の責務)。2件以上なら
 *    `AmbiguousChildFolderError`。
 * 両段階とも0件ならnullを返す。
 */
export async function resolveExistingChildFile(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<drive_v3.Schema$File | null> {
  const activeFiles = await listMatchingFolders(drive, parentId, name, false);
  if (activeFiles.length > 1) {
    throw new AmbiguousChildFolderError(name, parentId, activeFiles.length);
  }
  if (activeFiles.length === 1) {
    return activeFiles[0];
  }

  const trashedFiles = await listMatchingFolders(drive, parentId, name, true);
  if (trashedFiles.length > 1) {
    throw new AmbiguousChildFolderError(name, parentId, trashedFiles.length);
  }
  if (trashedFiles.length === 1) {
    return trashedFiles[0];
  }
  return null;
}

/**
 * `parentId`直下でtrashed込みの`name`一致フォルダをfind-or-createする(Part A専用)。
 * 0件なら新規作成、1件(trashedなら復元)なら再利用、2件以上ならfail-closedでthrowする。
 */
export interface ResolvedChildFolder {
  id: string;
  /** trashedだったフォルダをこの呼び出しでuntrashしたか(rollback記録用、codex review P2指摘対応) */
  restored: boolean;
  /** この呼び出しで新規作成したフォルダか(rollback記録用、codex review 3巡目P2指摘対応) */
  created: boolean;
}

async function toResolvedExisting(
  drive: drive_v3.Drive,
  existing: drive_v3.Schema$File,
  name: string
): Promise<ResolvedChildFolder> {
  if (!existing.id) {
    throw new Error(`[Phase B Part A] 既存子フォルダのidが取得できません: "${name}"`);
  }
  if (existing.trashed) {
    await drive.files.update({
      fileId: existing.id,
      requestBody: { trashed: false },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
    return { id: existing.id, restored: true, created: false };
  }
  return { id: existing.id, restored: false, created: false };
}

function isResolvedWithFolderId(claim: FolderClaimDoc | null): claim is ResolvedFolderClaim {
  return claim?.state === 'resolved' && typeof claim.folderId === 'string';
}

/**
 * `claim`が'creating'状態(進行中のattempt)の場合に、`reconcileAttempt`で回収・確定を
 * 試みる共通ロジック(codex review P2指摘対応、3巡目)。read有効時の通常経路と、shadow時の
 * 新規作成直前防御チェックの両方から呼ばれる — 重複実装すると挙動がずれるリスクがあるため
 * 一本化した。'adopt'ならResolvedChildFolderを返し、'wait'なら
 * FolderCreationInProgressErrorをthrow、'clear'(claimがinvalidated化された)ならnullを
 * 返す(呼び出し元は以降claim無しとして後続処理へ進む)。
 */
async function reconcileCreatingClaim(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  claim: FolderClaimDoc & { attempt: FolderClaimAttempt },
  runId: string
): Promise<ResolvedChildFolder | null> {
  const outcome = await reconcileAttempt(drive, firestore, parentId, name, claim, runId);
  if (outcome.status === 'adopt') {
    // reconcileAttemptが内部でuntrash済み(outcome.restored===true)の場合、直後の
    // commitResolvedWithRetryが失敗するとDrive側の復元事実がresolveChildFolderPathの
    // restoredFolderIds(rollback manifest用)から漏れる。folderIdを運べる専用errorへ包む。
    try {
      await commitResolvedWithRetry(firestore, parentId, name, claim.attempt.attemptId, outcome.folderId);
    } catch (commitError) {
      if (outcome.restored) {
        throw new ChildFolderRestoredButUncommittedError(name, parentId, outcome.folderId, commitError);
      }
      throw commitError;
    }
    return { id: outcome.folderId, restored: outcome.restored, created: false };
  }
  if (outcome.status === 'wait') {
    throw new FolderCreationInProgressError(name, parentId);
  }
  // status === 'clear' → claimはinvalidated化された。呼び出し元にclaim無しとして委ねる
  return null;
}

export async function resolveChildFolder(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string
): Promise<ResolvedChildFolder> {
  const runId = randomUUID();
  const readEnabled = await isDriveFolderClaimReadEnabled(firestore).catch(() => false);
  let claim: FolderClaimDoc | null = null;

  if (readEnabled) {
    claim = await readClaim(firestore, parentId, name);

    if (claim?.state === 'divergent') {
      throw new DivergentFolderClaimError(name, parentId, claim.folderId);
    }

    if (isResolvedWithFolderId(claim)) {
      const anchorMs = claim.verifiedAtMs ?? claim.resolvedAtMs ?? 0;
      const elapsedMs = Date.now() - anchorMs;
      if (elapsedMs < CREATE_TRUST_MS) {
        return { id: claim.folderId, restored: false, created: false };
      }
      if (elapsedMs < SOFT_TTL_MS) {
        const verified = await verifyFolderClaim(drive, firestore, parentId, name, claim, runId);
        return { id: verified.folderId, restored: verified.restored, created: false };
      }
      // elapsedMs >= SOFT_TTL_MS → 下の完全再検索に合流(claimとの突合はそちらで行う)
    }

    if (claim?.state === 'creating' && claim.attempt) {
      const reconciled = await reconcileCreatingClaim(
        drive,
        firestore,
        parentId,
        name,
        claim as FolderClaimDoc & { attempt: FolderClaimAttempt },
        runId
      );
      if (reconciled) {
        return reconciled;
      }
      // 'clear'(invalidated化)された。以降はclaim無しとして扱う
      claim = null;
    }
  }

  // --- 完全再検索(shadow時は常時ここから開始。read時はここまでfall throughした場合のみ) ---
  let existing: drive_v3.Schema$File | null;
  try {
    existing = await resolveExistingChildFile(drive, parentId, name);
  } catch (error) {
    if (readEnabled && isResolvedWithFolderId(claim) && error instanceof AmbiguousChildFolderError) {
      await markDivergent(firestore, parentId, name, 'ambiguous-full-scan').catch(() => {});
    }
    throw error;
  }

  if (existing) {
    const existingId = existing.id;
    if (!existingId) {
      throw new Error(`[Phase B Part A] 既存子フォルダのidが取得できません: "${name}"`);
    }
    // codex review P2指摘対応(2巡目): claimとの突合(divergent判定)を、trashedからの
    // 復元(toResolvedExisting、Drive側への書込み)より先に行う。順序を誤ると、claimとは
    // 無関係な(たまたま同名でtrashedの)フォルダをfail-closedの判定が確定する前に
    // untrashしてしまい、判定結果に関わらずDrive側を書き換えてしまう。
    if (readEnabled && isResolvedWithFolderId(claim) && claim.folderId !== existingId) {
      await markDivergent(firestore, parentId, name, 'full-scan-mismatch').catch(() => {});
      throw new DivergentFolderClaimError(name, parentId, claim.folderId, existingId);
    }
    const resolved = await toResolvedExisting(drive, existing, name);
    await recordFullScanResolution(firestore, parentId, name, resolved.id, runId).catch((error) =>
      console.error(
        `[Phase B Part A] claim記録に失敗しました(結果には影響しません): "${name}"（親フォルダ: ${parentId}）`,
        error
      )
    );
    return resolved;
  }

  // 0件。read時にresolved claimが存在する場合は、それを信用する(§4の要、driveFolderClaim.ts参照)
  if (readEnabled && isResolvedWithFolderId(claim)) {
    const verified = await verifyFolderClaim(drive, firestore, parentId, name, claim, runId);
    return { id: verified.folderId, restored: verified.restored, created: false };
  }

  // codex review P1指摘対応(2巡目): 読み経路が無効(shadowロールアウト中、既定)でも、
  // 直前にfindOrCreateFolder.ts(本番export)が既にこの同じparent+nameをresolved/
  // creating済みの可能性がある(files.listの結果整合性遅延で、ここまでの完全再検索が
  // 0件を返し続けた場合)。beginCreation()自体はshadowモードでresolved claimを無条件
  // 上書きしてよい設計だが(findOrCreateFolder.ts自身が同一resolver内の逐次呼び出しで
  // 許容している既知のトレードオフ)、それをそのままchildFolderResolver.tsに適用すると、
  // 旧acquireFolderLock(`state`フィールドの有無だけで常時blockしていた)が持っていた
  // 「移行期間中にdriveExportフラグが誤ってONのままだった場合の多層防御」を失い、
  // 本番exportとの間で物理フォルダ重複を新たに作りうる。childFolderResolver.tsは
  // 操作者が制御するPhase B移行スクリプトであり、読み経路のロールアウト段階に関わらず
  // 既存claimを信用してよいため、ここでは常にclaimを読み直してから判断する。
  if (!readEnabled) {
    const preCreateClaim = await readClaim(firestore, parentId, name);
    if (preCreateClaim?.state === 'creating' && preCreateClaim.attempt) {
      // codex review P2指摘対応(3巡目): 'creating'状態を発見しただけで無条件にblockすると、
      // プロセスクラッシュ後の孤児claim(リース失効済みだがattemptIdタグ付きフォルダは
      // 未確定)が180日TTLまで永久にFolderCreationInProgressErrorを返し続けてしまう
      // (beginCreation自身はリース失効を検知して再取得できるのに、この防御チェックだけが
      // それより手前で無条件throwしていた)。read有効時の通常経路と同じreconcileAttempt
      // ベースの回収ロジックを再利用する。
      const reconciled = await reconcileCreatingClaim(
        drive,
        firestore,
        parentId,
        name,
        preCreateClaim as FolderClaimDoc & { attempt: FolderClaimAttempt },
        runId
      );
      if (reconciled) {
        return reconciled;
      }
      // 'clear'(invalidated化)された → 下のbeginCreation()へ進んでよい
    } else if (isResolvedWithFolderId(preCreateClaim)) {
      const verified = await verifyFolderClaim(drive, firestore, parentId, name, preCreateClaim, runId);
      return { id: verified.folderId, restored: verified.restored, created: false };
    }
    // preCreateClaim?.state==='creating'かつattemptが無い(旧形式残骸)場合は、下の
    // beginCreation()自身のstaleness判定(claimedAtMs)に委ねる(read有効時の分岐と同型)。
  }

  // 0件マッチ = 新規作成が必要。異なる呼び出し間(並行稼働しうる本番export含む)の
  // 競合を防ぐためclaimを予約する。
  const begun = await beginCreation(firestore, parentId, name, runId);
  if (begun.status === 'blocked') {
    throw new FolderCreationInProgressError(name, parentId);
  }
  if (begun.status === 'divergent') {
    throw new DivergentFolderClaimError(name, parentId, begun.claim.folderId);
  }
  const { attemptId } = begun;
  // findOrCreateFolder.tsと同じ理由(コミット失敗時にDrive側の作成事実を握り潰さない)で、
  // このattemptで実際にfiles.create()したかどうかを追跡する。
  let createdViaThisAttempt: string | null = null;
  try {
    // 予約後に再検索(直前の予約保有者が既に作成済みの可能性があるため)。
    const recheckExisting = await resolveExistingChildFile(drive, parentId, name);
    if (recheckExisting) {
      const recheckResolved = await toResolvedExisting(drive, recheckExisting, name);
      // codex review P2指摘対応(2巡目): recheckResolved.restored===trueの場合と同様、
      // 直後のcommitResolvedWithRetryが失敗するとDrive側の復元事実が漏れる。
      try {
        await commitResolvedWithRetry(firestore, parentId, name, attemptId, recheckResolved.id);
      } catch (commitError) {
        if (recheckResolved.restored) {
          throw new ChildFolderRestoredButUncommittedError(name, parentId, recheckResolved.id, commitError);
        }
        throw commitError;
      }
      return recheckResolved;
    }

    const createResponse = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME_TYPE,
        parents: [parentId],
        appProperties: { [DOCSPLIT_FOLDER_CLAIM_KEY]: attemptId },
      },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
    const createdId = createResponse.data.id;
    if (!createdId) {
      throw new Error(`[Phase B Part A] 子フォルダの作成に失敗しました(idが返却されませんでした): "${name}"`);
    }
    createdViaThisAttempt = createdId;
    await commitResolvedWithRetry(firestore, parentId, name, attemptId, createdId);
    return { id: createdId, restored: false, created: true };
  } catch (error) {
    if (createdViaThisAttempt !== null) {
      // Drive側の作成自体は成功済み。claimは'creating'のまま残し、次回呼び出しの
      // reconcileAttempt(タグ検索)による回収に委ねる。invalidateしない。
      // codex review P2指摘対応: この場合`resolveChildFolder`はResolvedChildFolderを
      // 返せないため、素の`error`を再throwすると呼び出し元(`resolveChildFolderPath`)が
      // 「このattemptで実際にfiles.create()した」事実を知る手段を失い、rollback manifest
      // (createdFolderIds)からこの作成済みフォルダが漏れる。folderIdを運べる専用errorで包む。
      console.error(
        `[Phase B Part A] claim確定書込みに失敗しました(Drive側の作成は成功済み、次回呼び出しのreconcileAttemptで回収されます): "${name}"（親フォルダ: ${parentId}、folderId: ${createdViaThisAttempt}）:`,
        error
      );
      throw new ChildFolderCreatedButUncommittedError(name, parentId, createdViaThisAttempt, error);
    }
    await invalidateAttempt(firestore, parentId, name, attemptId).catch((invalidateError) =>
      console.error(
        `[Phase B Part A] claim invalidateに失敗しました("${name}"、親フォルダ: ${parentId}):`,
        invalidateError
      )
    );
    throw error;
  }
}

export interface ResolvedChildFolderPath {
  id: string;
  /** このpath解決の過程でtrashedから復元したフォルダID一覧(rollback記録用) */
  restoredFolderIds: string[];
  /** このpath解決の過程で新規作成したフォルダID一覧(rollback記録用、codex review 3巡目P2指摘対応) */
  createdFolderIds: string[];
}

/**
 * `resolveChildFolderPath`が階層の途中(2segment目以降)で失敗した場合に投げるerror。
 * 失敗までに実際にDrive側でuntrash/作成済みのフォルダID(rollback記録に必須)を
 * 呼び出し元へ伝搬する(codex review 4巡目P2指摘対応)。
 */
export class PartialChildFolderPathError extends Error {
  readonly restoredFolderIds: string[];
  readonly createdFolderIds: string[];
  readonly cause: unknown;
  constructor(cause: unknown, restoredFolderIds: string[], createdFolderIds: string[]) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`[Phase B Part A] 子フォルダpath解決が途中で失敗しました: ${causeMessage}`);
    this.name = 'PartialChildFolderPathError';
    this.restoredFolderIds = restoredFolderIds;
    this.createdFolderIds = createdFolderIds;
    this.cause = cause;
  }
}

/**
 * `segments`配列を`rootId`から順にfind-or-createで辿り、最終フォルダIDを返す。
 */
export async function resolveChildFolderPath(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  rootId: string,
  segments: string[]
): Promise<ResolvedChildFolderPath> {
  let currentId = rootId;
  const restoredFolderIds: string[] = [];
  const createdFolderIds: string[] = [];
  for (const segment of segments) {
    let result: ResolvedChildFolder;
    try {
      result = await resolveChildFolder(drive, firestore, currentId, segment);
    } catch (err) {
      // 直前までのsegmentで実際にuntrash/作成済みのフォルダは、この呼び出しが
      // 失敗してもDrive上では既にactive化されている。呼び出し元がmanifestへ
      // 記録できるよう、蓄積済みのIDを失敗理由と一緒に伝搬する。
      // codex review P2指摘対応: 今回失敗したsegment自身がfiles.create()には成功して
      // いた場合(ChildFolderCreatedButUncommittedError)も、そのfolderIdをcreatedFolderIds
      // へ含める(でなければDrive側に実在する孤立フォルダがrollback対象から漏れる)。
      // 2巡目: untrash(復元)には成功していた場合(ChildFolderRestoredButUncommittedError、
      // またはverifyFolderClaim由来のFolderClaimRestoreCommitError)も同様にfolderIdを
      // restoredFolderIdsへ含める。
      if (err instanceof ChildFolderCreatedButUncommittedError) {
        createdFolderIds.push(err.createdFolderId);
      } else if (err instanceof ChildFolderRestoredButUncommittedError) {
        restoredFolderIds.push(err.restoredFolderId);
      } else if (err instanceof FolderClaimRestoreCommitError) {
        restoredFolderIds.push(err.folderId);
      }
      throw new PartialChildFolderPathError(err, restoredFolderIds, createdFolderIds);
    }
    currentId = result.id;
    if (result.restored) restoredFolderIds.push(result.id);
    if (result.created) createdFolderIds.push(result.id);
  }
  return { id: currentId, restoredFolderIds, createdFolderIds };
}

/**
 * `resolveChildFolderPath`のread-only版(作成・復元を一切行わない)。preflight
 * (write-free)フェーズでの冪等性判定に使う。0件マッチの階層に到達した時点でnullを返す。
 * 2件以上マッチした階層はfail-closedで`AmbiguousChildFolderError`をthrowする
 * (書込み版と対称、曖昧な状態を無視して先へ進まない)。
 */
export async function resolveChildFolderPathReadOnly(
  drive: drive_v3.Drive,
  rootId: string,
  segments: string[]
): Promise<string | null> {
  let currentId = rootId;
  for (const segment of segments) {
    const existing = await resolveExistingChildFile(drive, currentId, segment);
    if (!existing) {
      return null;
    }
    if (!existing.id) {
      throw new Error(`[Phase B Part A] 既存子フォルダのidが取得できません: "${segment}"`);
    }
    currentId = existing.id;
  }
  return currentId;
}
