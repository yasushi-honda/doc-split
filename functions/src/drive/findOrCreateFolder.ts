/**
 * Google Drive フォルダの find-or-create(ADR-0022 Decision 4)
 *
 * 親フォルダ直下を子フォルダ名で検索し、0件なら作成・1件なら再利用(trashedなら
 * 復元してから再利用)・2件以上なら `AmbiguousFolderError` をthrowして停止する。
 * 曖昧な状態での自動選択は誤配置リスクがあるため、常に停止を優先する。
 *
 * Issue #811根本原因の修正(2026-08-27、Phase B Part B): 従来は`trashed=false`
 * 固定検索だったため、手動でゴミ箱に入れたフォルダを次回エクスポート時に
 * 「存在しない」と誤判定し新規作成し続け、物理フォルダ重複を生んでいた
 * (kanameone「森奈穂美」フォルダで6重複・241件のdocumentが影響を受けた実害を
 * Phase B Part Aで移行済み)。
 *
 * 検索は2段階で行う(2026-08-27、初版の単純なtrashed込み検索をkanameone本番の
 * 実運用で検出した回帰を受けて訂正): まずactiveのみで検索し、1件ならそれを
 * 即座に返す(過去に整理された無関係なtrashedの同名フォルダが他に残っていても
 * 一切考慮しない)。active 0件の場合のみtrashed込みで再検索し、1件なら
 * `files.update({trashed:false})`で復元してから返す。各段階で2件以上見つかった
 * 場合は`AmbiguousFolderError`で停止する。
 *
 * Issue #871恒久対策(2026-08-30、claimプロトコル): `files.list`の結果整合性遅延
 * (`files.create`直後の検索で新規作成分が返らないことがある)により、逐次実行でも
 * 「1件目が作成→ロック解放→2件目が同じparent+nameを検索して0件(索引未反映)→
 * 再作成」という経路で物理フォルダ重複が発生していた(診断結果はIssue #871参照)。
 * 「作成の予約(creating)→確定(resolved)」を`driveFolderClaim.ts`の単一ドキュメント・
 * 単一トランザクションで扱うことで、この経路を塞ぐ。
 *
 * 段階導入(shadowモード): `settings/features`の`driveFolderClaimRead`フラグが
 * 有効になるまでは、claimの書き込みのみ行い(既存挙動への影響ゼロ)、`files.list`/
 * `files.get`をclaimで短絡することはない。フラグ有効化後は下記3段ラダーで
 * Drive API呼び出しを短絡する:
 *
 * | resolvedAtMs/verifiedAtMsからの経過 | Drive API呼び出し |
 * |---|---|
 * | < CREATE_TRUST_MS(60秒)            | なし(claimのfolderIdを即返す) |
 * | CREATE_TRUST_MS〜SOFT_TTL_MS(5分)  | files.getのみ(健全性確認) |
 * | > SOFT_TTL_MS                       | files.list完全検索(現行と同等の重複検知力) |
 *
 * 完全再検索が0件の場合はclaimを信用する(§4の要): resolved claimが存在するのに
 * `files.list`が0件を返す状態こそが本バグの症状そのものであり、これを「フォルダが
 * 消えた」と解釈して再作成に倒すと5分の壁を越えただけでバグが再現する。claimを
 * 無効化できる唯一の経路は`files.get`の404累積判定(`driveFolderClaim.ts`の
 * `recordMiss`)だけである。
 */

import { drive_v3 } from 'googleapis';
import * as admin from 'firebase-admin';
import {
  SUPPORTS_ALL_DRIVES,
  FOLDER_MIME_TYPE,
  DOCSPLIT_FOLDER_CLAIM_KEY,
  escapeQueryValue,
} from './driveApiConstants';
import { isDriveFolderClaimReadEnabled } from '../utils/featureFlags';
import {
  AmbiguousFolderError,
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
  buildFolderLockId,
  FOLDER_LOCKS_COLLECTION,
  FOLDER_LOCK_STALE_MS,
} from './driveFolderClaim';
import { randomUUID } from 'node:crypto';

// 呼び出し元(exportDocument.ts等)・テストからの既存importを壊さないための再export。
export {
  AmbiguousFolderError,
  FolderCreationInProgressError,
  DivergentFolderClaimError,
  FOLDER_LOCKS_COLLECTION,
  FOLDER_LOCK_STALE_MS,
  buildFolderLockId,
};

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

interface MatchedFolder {
  id: string;
  trashed: boolean;
}

/**
 * 副作用なしの検索のみ(claimとの突合を先に行うため、`materializeExistingFolder`と
 * 分離している。codex review P2指摘対応: 突合前にtrashedからの復元を行うと、claimとは
 * 無関係な同名trashedフォルダをfail-closedの判定確定前にuntrashしてしまう)。
 */
async function findExistingFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<MatchedFolder | null> {
  const activeFiles = await listMatchingFolders(drive, parentId, name, false);
  if (activeFiles.length > 1) {
    throw new AmbiguousFolderError(name, parentId, activeFiles.length);
  }
  if (activeFiles.length === 1) {
    const id = activeFiles[0].id;
    if (!id) {
      throw new Error(`既存フォルダのidが取得できません: "${name}"`);
    }
    return { id, trashed: false };
  }

  const trashedFiles = await listMatchingFolders(drive, parentId, name, true);
  if (trashedFiles.length > 1) {
    throw new AmbiguousFolderError(name, parentId, trashedFiles.length);
  }
  if (trashedFiles.length === 1) {
    const id = trashedFiles[0].id;
    if (!id) {
      throw new Error(`既存フォルダのidが取得できません: "${name}"`);
    }
    return { id, trashed: true };
  }

  return null;
}

/** trashedなら復元してidを返す(副作用あり)。 */
async function materializeExistingFolder(drive: drive_v3.Drive, match: MatchedFolder): Promise<string> {
  if (match.trashed) {
    await drive.files.update({
      fileId: match.id,
      requestBody: { trashed: false },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
  }
  return match.id;
}

async function resolveExistingFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<string | null> {
  const match = await findExistingFolder(drive, parentId, name);
  if (!match) return null;
  return materializeExistingFolder(drive, match);
}

function isResolvedWithFolderId(claim: FolderClaimDoc | null): claim is ResolvedFolderClaim {
  return claim?.state === 'resolved' && typeof claim.folderId === 'string';
}

export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string
): Promise<string> {
  const runId = randomUUID();
  // silent-failure-hunterレビュー指摘対応: shadowモードへのfail-closedフォールバック自体は
  // 妥当だが、直後にも同じfirestore引数でreadClaim等のFirestore操作が続くため、ここで
  // 起きたエラーが一過性か、Firestoreへの接続自体が本質的に壊れているか(IAM設定ミス等)の
  // 区別がつかない。ログを残さないと、本番運用でこの障害が「単にshadowモードのまま動いて
  // いる」ように見えてしまい検知できない。
  const readEnabled = await isDriveFolderClaimReadEnabled(firestore).catch((error) => {
    console.error(
      `[findOrCreateFolder] driveFolderClaimReadフラグの読取に失敗しました(shadowモードへfail-closed): "${name}"（親フォルダ: ${parentId}）`,
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
        return claim.folderId;
      }
      if (elapsedMs < SOFT_TTL_MS) {
        return (await verifyFolderClaim(drive, firestore, parentId, name, claim, runId)).folderId;
      }
      // elapsedMs >= SOFT_TTL_MS → 下の完全再検索に合流(claimとの突合はそちらで行う)
    }

    if (claim?.state === 'creating' && claim.attempt) {
      const outcome = await reconcileAttempt(
        drive,
        firestore,
        parentId,
        name,
        claim as FolderClaimDoc & { attempt: FolderClaimAttempt },
        runId
      );
      if (outcome.status === 'adopt') {
        await commitResolvedWithRetry(firestore, parentId, name, claim.attempt.attemptId, outcome.folderId);
        return outcome.folderId;
      }
      if (outcome.status === 'wait') {
        throw new FolderCreationInProgressError(name, parentId);
      }
      // status === 'clear' → claimはinvalidated化された。以降はclaim無しとして扱う
      claim = null;
    }
  }

  // --- 完全再検索(shadow時は常時ここから開始。read時はここまでfall throughした場合のみ) ---
  let match: MatchedFolder | null;
  try {
    match = await findExistingFolder(drive, parentId, name);
  } catch (error) {
    if (readEnabled && isResolvedWithFolderId(claim) && error instanceof AmbiguousFolderError) {
      // silent-failure-hunterレビュー指摘対応: divergentマーカーの永続化はこの状態機械
      // 唯一の「人手介入が必要」シグナル。書込み自体が失敗すると、claimドキュメントには
      // 反映されないままこの呼び出しだけ異常終了し、次回以降の呼び出しがこの矛盾を
      // 検知できなくなる。best-effort(投げない)のままだが、ログだけは必ず残す。
      await markDivergent(firestore, parentId, name, 'ambiguous-full-scan').catch((markError) =>
        console.error(
          `[findOrCreateFolder] divergent記録に失敗しました("${name}"、親フォルダ: ${parentId}）: 次回呼び出しがこの矛盾を検知できない可能性があります`,
          markError
        )
      );
    }
    throw error;
  }

  if (match) {
    // codex review P2指摘対応: claimとの突合(divergent判定)を、trashedからの復元
    // (materializeExistingFolder、Drive側への書込み)より先に行う。
    if (readEnabled && isResolvedWithFolderId(claim) && claim.folderId !== match.id) {
      await markDivergent(firestore, parentId, name, 'full-scan-mismatch').catch((markError) =>
        console.error(
          `[findOrCreateFolder] divergent記録に失敗しました("${name}"、親フォルダ: ${parentId}）: 次回呼び出しがこの矛盾を検知できない可能性があります`,
          markError
        )
      );
      throw new DivergentFolderClaimError(name, parentId, claim.folderId, match.id);
    }
    const existingId = await materializeExistingFolder(drive, match);
    await recordFullScanResolution(firestore, parentId, name, existingId, runId).catch((error) =>
      console.error(
        `[findOrCreateFolder] claim記録に失敗しました(結果には影響しません): "${name}"（親フォルダ: ${parentId}）`,
        error
      )
    );
    return existingId;
  }

  // 0件。read時にresolved claimが存在する場合は、それを信用する(§4の要、詳細はモジュール冒頭コメント参照)
  if (readEnabled && isResolvedWithFolderId(claim)) {
    return (await verifyFolderClaim(drive, firestore, parentId, name, claim, runId)).folderId;
  }

  // codex review指摘対応(6巡目、P2): 読み経路が無効(shadowロールアウト中、既定)でも、
  // 直前にchildFolderResolver.ts(Phase B移行スクリプト)や他の並行実行がクラッシュし
  // 'creating'状態の孤児claim(リース失効済みだがattemptIdタグ付きフォルダは未確定)を
  // 残している可能性がある。beginCreation()自身はリース失効時に無条件で上書きして
  // 新規createへ進んでしまう(Driveへのタグ検索は行わない)ため、それをそのまま許すと
  // 孤児フォルダを見落として二重作成しうる。childFolderResolver.ts側は3巡目で対応済み
  // だったが、本来の(hot path側の)findOrCreateFolder.tsに対称的に適用されていなかった。
  if (!readEnabled) {
    const preCreateClaim = await readClaim(firestore, parentId, name);
    if (preCreateClaim?.state === 'creating' && preCreateClaim.attempt) {
      const outcome = await reconcileAttempt(
        drive,
        firestore,
        parentId,
        name,
        preCreateClaim as FolderClaimDoc & { attempt: FolderClaimAttempt },
        runId
      );
      if (outcome.status === 'adopt') {
        await commitResolvedWithRetry(firestore, parentId, name, preCreateClaim.attempt.attemptId, outcome.folderId);
        return outcome.folderId;
      }
      if (outcome.status === 'wait') {
        throw new FolderCreationInProgressError(name, parentId);
      }
      // status === 'clear' → claimはinvalidated化された。以降はbeginCreation()へ進んでよい
    }
    // 'creating'かつattemptが無い(旧形式残骸)場合は、下のbeginCreation()自身の
    // staleness判定(claimedAtMs)に委ねる(read有効時の分岐と同型)。
  }

  // 0件マッチ = 新規作成が必要。異なるdocId間の競合を防ぐためclaimを予約する。
  const begun = await beginCreation(firestore, parentId, name, runId);
  if (begun.status === 'blocked') {
    throw new FolderCreationInProgressError(name, parentId);
  }
  if (begun.status === 'divergent') {
    throw new DivergentFolderClaimError(name, parentId, begun.claim.folderId);
  }
  if (begun.status === 'resolved') {
    // codex review指摘対応(4巡目、P1): この完全再検索の直後〜beginCreation呼び出しの
    // 間隙で、別の呼び出し元(childFolderResolver.ts等)が既にresolvedへ確定させていた。
    // beginCreation自身のトランザクションで検知できたためTOCTOUなく採用できる。
    return (await verifyFolderClaim(drive, firestore, parentId, name, begun.claim, runId)).folderId;
  }
  const { attemptId } = begun;
  // codex review P1指摘対応: files.create()が成功しattemptIdタグ付きの実フォルダが
  // 既にDrive側に存在する状態でcommitResolvedWithRetryだけが失敗した場合、catch節で
  // 無条件にinvalidateすると、そのタグへの唯一の参照(attempt)が失われ次回呼び出しの
  // reconcileAttemptが回収できなくなる。索引未反映(完全再検索が0件)と重なると、
  // このPRが塞ごうとしている重複作成が再発しうる。「このattemptで実際にfiles.create()
  // した(=タグ付き実体が存在する)かどうか」を追跡し、その場合だけinvalidateを
  // スキップしてreconcileAttemptによる回収に委ねる。
  let createdViaThisAttempt: string | null = null;
  try {
    // 予約後に再検索(直前の予約保有者が既に作成済みの可能性があるため)。
    const recheckId = await resolveExistingFolder(drive, parentId, name);
    if (recheckId) {
      await commitResolvedWithRetry(firestore, parentId, name, attemptId, recheckId);
      return recheckId;
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
      throw new Error(`フォルダの作成に失敗しました(idが返却されませんでした): "${name}"`);
    }
    createdViaThisAttempt = createdId;
    await commitResolvedWithRetry(firestore, parentId, name, attemptId, createdId);
    return createdId;
  } catch (error) {
    if (createdViaThisAttempt !== null) {
      // files.create()自体は成功済み(Drive側にattemptIdタグ付きの実フォルダが存在する)。
      // claimは'creating'のまま残し、次回呼び出しのreconcileAttempt(タグ検索)による
      // 回収に委ねる。invalidateしない。
      console.error(
        `[findOrCreateFolder] claim確定書込みに失敗しました(Drive側の作成は成功済み、次回呼び出しのreconcileAttemptで回収されます): "${name}"（親フォルダ: ${parentId}、folderId: ${createdViaThisAttempt}）:`,
        error
      );
      throw error;
    }
    // Drive側の作成(または再検索での既存フォルダ発見)自体が失敗した場合のみ、attemptを
    // 無効化し、次回呼び出しがFOLDER_LOCK_STALE_MSの経過を待たず即座にリトライできる
    // ようにする(invalidate自体の失敗は握り潰す: rules/error-handling.md §1、状態復旧の
    // 失敗が本来のエラーを隠さないようにする)。
    await invalidateAttempt(firestore, parentId, name, attemptId).catch((invalidateError) =>
      console.error(
        `[findOrCreateFolder] claim invalidateに失敗しました("${name}"、親フォルダ: ${parentId}):`,
        invalidateError
      )
    );
    throw error;
  }
}
