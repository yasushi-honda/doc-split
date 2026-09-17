/**
 * Google Drive フォルダの find-or-create 状態機械の共通コア(Issue #880)
 *
 * `findOrCreateFolder.ts`(本番 export の hot path)と`childFolderResolver.ts`(Issue #811
 * Phase B 移行スクリプト用)が、`driveFolderClaim.ts`の claim プロトコル状態機械を
 * ほぼ同一のシーケンスで呼んでいた重複を、本モジュールへ集約する。
 *
 * 重複の実害(実証済み):
 * - 2026-08-30(コミット8a89badd): shadowモード時の孤児claim回収防御をchildFolderResolver.ts
 *   にだけ追加し、findOrCreateFolder.ts(本番hot path)への対称適用がcodex review 6巡目まで漏れた
 * - 2026-09-16(PR #928): markDivergent()へのrunId引数追加で、両ファイル計4箇所に完全に
 *   同一の編集が必要だった
 *
 * 両リゾルバの差分は `FolderResolutionPolicy` で吸収する:
 * - 戻り値: findOrCreateFolder は folderId(string)のみ、resolveChildFolder は
 *   {id, restored, created} を必要とする → コアは常に最も豊かな型
 *   (`FolderResolutionOutcome`)を返し、findOrCreateFolder側が`.id`だけ取り出す
 * - Ambiguousエラークラス: AmbiguousFolderError vs AmbiguousChildFolderError
 *   (scripts/classify-drive-export-drift.tsがinstanceofで分岐するため区別必須)
 * - id欠落時のエラー文言: プレフィクス・名詞が異なる
 * - commit失敗時の包装: childFolderResolver側のみ、Drive側で実際に確定した事実
 *   (restored/created)をfolderId付きの専用errorで運ぶ(rollback manifest用)
 *
 * trashed判定は検索段階(`listMatchingFolders`のtrashed引数)を正とする。
 * findOrCreateFolder.ts旧実装は検索段階から`MatchedFolder.trashed`を導出していたのに対し、
 * childFolderResolver.ts旧実装はAPI応答フィールド`file.trashed`を直接見ていた。実運用・
 * テストfakeいずれでも両者は一致するため今まで観測されていないが、Drive APIの結果整合性
 * 遅延時には理論上ズレうる。findOrCreateFolder.ts(本番hot path)の設計思想
 * (files.listの結果整合性遅延への配慮)を正とし、返す`Schema$File`の`trashed`フィールドを
 * 検索段階の値で上書きする。
 */

import { drive_v3 } from 'googleapis';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { SUPPORTS_ALL_DRIVES, FOLDER_MIME_TYPE, DOCSPLIT_FOLDER_CLAIM_KEY, escapeQueryValue } from './driveApiConstants';
import { isDriveFolderClaimReadEnabled } from '../utils/featureFlags';
import {
  FolderCreationInProgressError,
  DivergentFolderClaimError,
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

export interface FolderResolutionOutcome {
  id: string;
  /** この呼び出しでtrashedから復元(untrash)したか */
  restored: boolean;
  /** この呼び出しで新規作成したか */
  created: boolean;
}

export interface FolderResolutionPolicy {
  /** console.error の先頭('[findOrCreateFolder]' / '[Phase B Part A]') */
  logPrefix: string;
  /** 2件以上マッチ時のエラー。呼び出し元がinstanceofで分岐するため区別の維持が必須 */
  makeAmbiguousError(name: string, parentId: string, count: number): Error;
  /** `error`が`makeAmbiguousError`が生成したクラスのインスタンスかどうかの判定 */
  isAmbiguousError(error: unknown): boolean;
  /** id欠落時のエラー。両ファイルで文言・名詞が異なるためpolicy側に持たせる */
  makeMissingIdError(name: string, context: 'existing' | 'created'): Error;
  /**
   * commitResolvedWithRetry失敗時に、Drive側で確定済みの事実(untrash/作成)を運べる
   * 専用errorへ包む。未指定なら素のerrorを再throw(= findOrCreateFolderの現挙動)。
   */
  wrapCommitFailure?(
    kind: 'created' | 'restored',
    name: string,
    parentId: string,
    folderId: string,
    cause: unknown
  ): Error;
}

export async function listMatchingFolders(
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
 * `parentId`直下で`name`と一致する既存フォルダを2段階で解決する。
 * 1. activeのみで検索: 1件ならそれを返す(無関係なtrashedの同名フォルダは一切考慮しない)。
 *    2件以上なら`makeAmbiguousError`のErrorをthrow。
 * 2. active 0件の場合のみtrashed込みで再検索: 1件ならそれ(trashed=true扱い)を返す。
 *    2件以上なら`makeAmbiguousError`のErrorをthrow。
 * 両段階とも0件ならnullを返す。
 *
 * id欠落チェックはここでは行わない(呼び出し元の責務。childFolderResolver.tsの
 * 公開API`resolveExistingChildFile`が本関数をそのまま返すため、既存の契約を維持する)。
 */
export async function findExistingFolderFile(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
  makeAmbiguousError: (name: string, parentId: string, count: number) => Error
): Promise<drive_v3.Schema$File | null> {
  const activeFiles = await listMatchingFolders(drive, parentId, name, false);
  if (activeFiles.length > 1) {
    throw makeAmbiguousError(name, parentId, activeFiles.length);
  }
  if (activeFiles.length === 1) {
    return { ...activeFiles[0], trashed: false };
  }

  const trashedFiles = await listMatchingFolders(drive, parentId, name, true);
  if (trashedFiles.length > 1) {
    throw makeAmbiguousError(name, parentId, trashedFiles.length);
  }
  if (trashedFiles.length === 1) {
    return { ...trashedFiles[0], trashed: true };
  }

  return null;
}

/** trashedなら復元してidを返す(副作用あり)。 */
async function materializeExistingFolderFile(
  drive: drive_v3.Drive,
  file: drive_v3.Schema$File & { id: string }
): Promise<{ id: string; restored: boolean }> {
  if (file.trashed) {
    await drive.files.update({
      fileId: file.id,
      requestBody: { trashed: false },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
    return { id: file.id, restored: true };
  }
  return { id: file.id, restored: false };
}

function isResolvedWithFolderId(claim: FolderClaimDoc | null): claim is ResolvedFolderClaim {
  return claim?.state === 'resolved' && typeof claim.folderId === 'string';
}

/**
 * `claim`が'creating'状態(進行中のattempt)の場合に、`reconcileAttempt`で回収・確定を
 * 試みる共通ロジック。read有効時の通常経路と、shadow時の新規作成直前防御チェックの
 * 両方から呼ばれる。'adopt'ならFolderResolutionOutcomeを返し、'wait'なら
 * FolderCreationInProgressErrorをthrow、'clear'(claimがinvalidated化された)ならnullを
 * 返す(呼び出し元は以降claim無しとして後続処理へ進む)。
 */
async function reconcileCreatingClaim(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  claim: FolderClaimDoc & { attempt: FolderClaimAttempt },
  runId: string,
  policy: FolderResolutionPolicy
): Promise<FolderResolutionOutcome | null> {
  const outcome = await reconcileAttempt(drive, firestore, parentId, name, claim, runId);
  if (outcome.status === 'adopt') {
    try {
      await commitResolvedWithRetry(firestore, parentId, name, claim.attempt.attemptId, outcome.folderId);
    } catch (commitError) {
      if (outcome.restored && policy.wrapCommitFailure) {
        throw policy.wrapCommitFailure('restored', name, parentId, outcome.folderId, commitError);
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

export async function resolveFolderWithClaim(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  policy: FolderResolutionPolicy
): Promise<FolderResolutionOutcome> {
  const runId = randomUUID();
  // shadowモードへのfail-closedフォールバック自体は妥当だが、直後にも同じfirestore引数で
  // readClaim等のFirestore操作が続くため、ここで起きたエラーが一過性か、Firestoreへの
  // 接続自体が本質的に壊れているか(IAM設定ミス等)の区別がつかない。ログを残さないと、
  // 本番運用でこの障害が「単にshadowモードのまま動いている」ように見えてしまい検知できない。
  const readEnabled = await isDriveFolderClaimReadEnabled(firestore).catch((error) => {
    console.error(
      `${policy.logPrefix} driveFolderClaimReadフラグの読取に失敗しました(shadowモードへfail-closed): "${name}"（親フォルダ: ${parentId}）`,
      error
    );
    return false;
  });
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
        runId,
        policy
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
    existing = await findExistingFolderFile(drive, parentId, name, policy.makeAmbiguousError);
  } catch (error) {
    if (readEnabled && isResolvedWithFolderId(claim) && policy.isAmbiguousError(error)) {
      // divergentマーカーの永続化はこの状態機械唯一の「人手介入が必要」シグナル。書込み
      // 自体が失敗すると、claimドキュメントには反映されないままこの呼び出しだけ異常終了し、
      // 次回以降の呼び出しがこの矛盾を検知できなくなる。best-effort(投げない)のままだが、
      // ログだけは必ず残す。
      await markDivergent(firestore, parentId, name, 'ambiguous-full-scan', runId).catch((markError) =>
        console.error(
          `${policy.logPrefix} divergent記録に失敗しました(親フォルダ: ${parentId}）: 次回呼び出しがこの矛盾を検知できない可能性があります`,
          markError
        )
      );
    }
    throw error;
  }

  if (existing) {
    const existingId = existing.id;
    if (!existingId) {
      throw policy.makeMissingIdError(name, 'existing');
    }
    // claimとの突合(divergent判定)を、trashedからの復元(Drive側への書込み)より先に行う。
    // 順序を誤ると、claimとは無関係な(たまたま同名でtrashedの)フォルダをfail-closedの
    // 判定が確定する前にuntrashしてしまう。
    if (readEnabled && isResolvedWithFolderId(claim) && claim.folderId !== existingId) {
      await markDivergent(firestore, parentId, name, 'full-scan-mismatch', runId).catch((markError) =>
        console.error(
          `${policy.logPrefix} divergent記録に失敗しました(親フォルダ: ${parentId}）: 次回呼び出しがこの矛盾を検知できない可能性があります`,
          markError
        )
      );
      throw new DivergentFolderClaimError(name, parentId, claim.folderId, existingId);
    }
    const materialized = await materializeExistingFolderFile(drive, { ...existing, id: existingId });
    await recordFullScanResolution(firestore, parentId, name, materialized.id, runId).catch((error) =>
      console.error(
        `${policy.logPrefix} claim記録に失敗しました(結果には影響しません): "${name}"（親フォルダ: ${parentId}）`,
        error
      )
    );
    return { id: materialized.id, restored: materialized.restored, created: false };
  }

  // 0件。read時にresolved claimが存在する場合は、それを信用する(§4の要、driveFolderClaim.ts参照)
  if (readEnabled && isResolvedWithFolderId(claim)) {
    const verified = await verifyFolderClaim(drive, firestore, parentId, name, claim, runId);
    return { id: verified.folderId, restored: verified.restored, created: false };
  }

  // 読み経路が無効(shadowロールアウト中、既定)でも、直前に他の呼び出しがクラッシュし
  // 'creating'状態の孤児claim(リース失効済みだがattemptIdタグ付きフォルダは未確定)を
  // 残している可能性がある。beginCreation()自身はリース失効時に無条件で上書きして
  // 新規createへ進んでしまう(Driveへのタグ検索は行わない)ため、それをそのまま許すと
  // 孤児フォルダを見落として二重作成しうる。
  if (!readEnabled) {
    const preCreateClaim = await readClaim(firestore, parentId, name);
    if (preCreateClaim?.state === 'creating' && preCreateClaim.attempt) {
      const reconciled = await reconcileCreatingClaim(
        drive,
        firestore,
        parentId,
        name,
        preCreateClaim as FolderClaimDoc & { attempt: FolderClaimAttempt },
        runId,
        policy
      );
      if (reconciled) {
        return reconciled;
      }
      // 'clear'(invalidated化)された → 下のbeginCreation()へ進んでよい
    }
    // 'creating'かつattemptが無い(旧形式残骸)場合は、下のbeginCreation()自身の
    // staleness判定(claimedAtMs)に委ねる(read有効時の分岐と同型)。
  }

  // 0件マッチ = 新規作成が必要。異なる呼び出し間の競合を防ぐためclaimを予約する。
  const begun = await beginCreation(firestore, parentId, name, runId);
  if (begun.status === 'blocked') {
    throw new FolderCreationInProgressError(name, parentId);
  }
  if (begun.status === 'divergent') {
    throw new DivergentFolderClaimError(name, parentId, begun.claim.folderId);
  }
  if (begun.status === 'resolved') {
    // 直前の完全再検索〜beginCreation呼び出しの間隙で、別の呼び出し元が既にresolvedへ
    // 確定させていた。beginCreation自身のトランザクションで検知できたためTOCTOUなく採用できる。
    const verified = await verifyFolderClaim(drive, firestore, parentId, name, begun.claim, runId);
    return { id: verified.folderId, restored: verified.restored, created: false };
  }
  const { attemptId } = begun;
  // files.create()が成功しattemptIdタグ付きの実フォルダが既にDrive側に存在する状態で
  // commitResolvedWithRetryだけが失敗した場合、catch節で無条件にinvalidateすると、
  // そのタグへの唯一の参照(attempt)が失われ次回呼び出しのreconcileAttemptが回収できなく
  // なる。索引未反映(完全再検索が0件)と重なると、このリファクタが塞ごうとしている
  // 重複作成が再発しうる。「このattemptで実際にfiles.create()した(=タグ付き実体が
  // 存在する)かどうか」を追跡し、その場合だけinvalidateをスキップしてreconcileAttempt
  // による回収に委ねる。
  let createdViaThisAttempt: string | null = null;
  try {
    // 予約後に再検索(直前の予約保有者が既に作成済みの可能性があるため)。
    const recheckExisting = await findExistingFolderFile(drive, parentId, name, policy.makeAmbiguousError);
    if (recheckExisting) {
      const recheckId = recheckExisting.id;
      if (!recheckId) {
        throw policy.makeMissingIdError(name, 'existing');
      }
      const materialized = await materializeExistingFolderFile(drive, { ...recheckExisting, id: recheckId });
      try {
        await commitResolvedWithRetry(firestore, parentId, name, attemptId, materialized.id);
      } catch (commitError) {
        if (materialized.restored && policy.wrapCommitFailure) {
          throw policy.wrapCommitFailure('restored', name, parentId, materialized.id, commitError);
        }
        throw commitError;
      }
      return { id: materialized.id, restored: materialized.restored, created: false };
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
      throw policy.makeMissingIdError(name, 'created');
    }
    createdViaThisAttempt = createdId;
    await commitResolvedWithRetry(firestore, parentId, name, attemptId, createdId);
    return { id: createdId, restored: false, created: true };
  } catch (error) {
    if (createdViaThisAttempt !== null) {
      // files.create()自体は成功済み(Drive側にattemptIdタグ付きの実フォルダが存在する)。
      // claimは'creating'のまま残し、次回呼び出しのreconcileAttempt(タグ検索)による
      // 回収に委ねる。invalidateしない。
      console.error(
        `${policy.logPrefix} claim確定書込みに失敗しました(Drive側の作成は成功済み、次回呼び出しのreconcileAttemptで回収されます): "${name}"（親フォルダ: ${parentId}、folderId: ${createdViaThisAttempt}）:`,
        error
      );
      if (policy.wrapCommitFailure) {
        throw policy.wrapCommitFailure('created', name, parentId, createdViaThisAttempt, error);
      }
      throw error;
    }
    // Drive側の作成(または再検索での既存フォルダ発見)自体が失敗した場合のみ、attemptを
    // 無効化し、次回呼び出しがFOLDER_LOCK_STALE_MSの経過を待たず即座にリトライできる
    // ようにする(invalidate自体の失敗は握り潰す: 状態復旧の失敗が本来のエラーを
    // 隠さないようにする)。
    await invalidateAttempt(firestore, parentId, name, attemptId).catch((invalidateError) =>
      console.error(
        `${policy.logPrefix} claim invalidateに失敗しました("${name}"、親フォルダ: ${parentId}):`,
        invalidateError
      )
    );
    throw error;
  }
}
