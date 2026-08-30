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
 * 場合は`AmbiguousFolderError`で停止する。初版はtrashed込み検索を無条件に行って
 * いたため、「active 1件+無関係なtrashedの残骸が複数」という従来は問題なく
 * 解決できていたケースまで誤ってAmbiguousFolderErrorにしてしまう回帰を
 * kanameone本番で引き起こした(顧客「大橋のぶ子」配下の「報告書」フォルダ、
 * PR #840マージ直後に実エクスポートで発覚)。復元APIが失敗した場合は
 * 新規作成へフォールバックせず例外を再送出する(同名フォルダが実際には既に
 * 存在するため、フォールバックすると新たな重複を作りかねない)。
 *
 * 異なるdocId間の作成競合防止(code-review xhigh指摘#2対応、2026-07-22):
 * 同一parent+nameに解決する異なるdocumentが近接タイミングで検証されると、
 * 両方が0件マッチを観測してどちらも`files.create()`を呼び、重複フォルダが
 * 作成されうる(既存の`driveExportRunId`は同一document内の二重実行のみ防止する
 * ため、この競合は防げない)。0件マッチ時のみ`driveFolderLocks`コレクションへの
 * Firestoreトランザクションで所有権を主張してから作成する。Drive APIのような
 * 非冪等な外部I/Oをトランザクション内に置くとFirestore側の自動リトライで
 * 二重実行するリスクがあるため、`executeDriveExport.ts`のクレーム機構と同じ
 * 「トランザクションで所有権主張→実I/OはトランザクションOuter→finallyで解放」
 * という設計を踏襲する。ロック獲得に失敗した場合は`FolderCreationInProgressError`を
 * throwし、新しい待機/リトライループを自前で作らず既存のcatch-and-set-error機構
 * (`driveExportStatus:'error'`→次回スケジュールスイープで自動リトライ)に委ねる。
 */

import { drive_v3 } from 'googleapis';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { SUPPORTS_ALL_DRIVES, escapeQueryValue } from './driveApiConstants';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/**
 * ロック保有中とみなす期間。
 *
 * Issue #871是正(2026-08-30): 従来値(2分)は`driveExportTrigger.ts`/`retryDriveExport.ts`の
 * `timeoutSeconds:120`(=2分)と完全に一致しており、「関数がタイムアウト死する瞬間」と
 * 「ロックが失効し他の実行に奪われる瞬間」が同時に来る設計になっていた。Drive API呼び出しの
 * 応答待ちで関数が強制終了させられると、Drive側では作成が成功しているかもしれないのに
 * ロックの記録が残らず、直後に別の実行がロックを奪って再作成できてしまう
 * (kanameone本番でのフォルダ重複急増の代替原因候補、Issue #871参照)。
 * `driveExportScheduled.ts`の`DRIVE_EXPORT_STUCK_EXPORTING_THRESHOLD_MS`と同値の10分へ是正し、
 * リースが常にプロセス最大寿命(120秒)より十分長くなるようにする。
 */
const FOLDER_LOCK_STALE_MS = 10 * 60 * 1000;

/**
 * 同名フォルダが2件以上見つかった場合にthrow。
 * 呼び出し元（トリガー）はこれを捕捉し `driveExportStatus: 'error'` に遷移させる。
 */
export class AmbiguousFolderError extends Error {
  constructor(name: string, parentId: string, count: number) {
    super(
      `フォルダ名が重複しているため解決できません(${count}件): "${name}"（親フォルダ: ${parentId}）`
    );
    this.name = 'AmbiguousFolderError';
  }
}

/**
 * 同一parent+nameのフォルダ作成が別の実行で進行中の場合にthrow。
 * 呼び出し元（トリガー）はこれを捕捉し `driveExportStatus: 'error'` に遷移させる。
 * この状態は`error`扱いのため、他の恒久エラーと同じ`DRIVE_EXPORT_ERROR_RETRY_THRESHOLD_MS`
 * (1時間、`driveExportScheduled.ts`)が適用され自動リトライまで最大1時間かかる
 * (/review-pr指摘、2026-07-22: 当初のコメントは次回スイープ=15分後に解決するかの
 * ように読めたが、実際には1時間のcooldownが効く。管理者による手動リトライは
 * cooldown無しで即座に成功する)。
 */
export class FolderCreationInProgressError extends Error {
  constructor(name: string, parentId: string) {
    super(
      `フォルダ作成が別の処理で進行中のため待機します: "${name}"（親フォルダ: ${parentId}）`
    );
    this.name = 'FolderCreationInProgressError';
  }
}

/** ロックドキュメントの永続化先(トップレベルコレクション)。Admin SDK専有(firestore.rules変更不要)。 */
const FOLDER_LOCKS_COLLECTION = 'driveFolderLocks';

function buildFolderLockId(parentId: string, name: string): string {
  // Firestoreドキュメント名の制約(スラッシュ不可等)を避けるためbase64urlでエンコード
  return Buffer.from(`${parentId}/${name}`).toString('base64url');
}

/**
 * ロックを取得し、所有権トークン(`lockToken`)を返す。`releaseFolderLock`は
 * このトークンが現在のロック保有者と一致する場合のみ削除する
 * (code-review high指摘#1対応、2026-07-22): 従来は`claimedAtMs`のみで判定して
 * おり、staleとみなされ別の実行にロックを奪われた後、元の実行が完了時に
 * 無条件で`.delete()`すると新しい保有者のロックまで削除してしまっていた
 * (`executeDriveExport.ts`の`driveExportRunId`と同型の所有権トークンで解決)。
 */
/**
 * codex review 9巡目P1指摘対応: `childFolderResolver.ts`(Phase B Part A)の0件マッチ
 * →作成パスも、本番exportトリガーと同じ`driveFolderLocks`ロックを使って競合を防ぐ
 * 必要があるため、export可視にする(ロジックの複製を避ける)。
 */
export async function acquireFolderLock(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string
): Promise<string> {
  const lockRef = firestore
    .collection(FOLDER_LOCKS_COLLECTION)
    .doc(buildFolderLockId(parentId, name));
  const lockToken = randomUUID();
  const acquired = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const claimedAtMs = snap.data()?.claimedAtMs as number | undefined;
    if (claimedAtMs !== undefined && Date.now() - claimedAtMs < FOLDER_LOCK_STALE_MS) {
      return false;
    }
    tx.set(lockRef, { claimedAtMs: Date.now(), lockToken });
    return true;
  });
  if (!acquired) {
    throw new FolderCreationInProgressError(name, parentId);
  }
  return lockToken;
}

export async function releaseFolderLock(
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string,
  lockToken: string
): Promise<void> {
  const lockRef = firestore
    .collection(FOLDER_LOCKS_COLLECTION)
    .doc(buildFolderLockId(parentId, name));
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    if (snap.data()?.lockToken !== lockToken) {
      return; // 既に他の実行に引き継がれている(superseded) → 削除しない
    }
    tx.delete(lockRef);
  });
}

/**
 * `parentId`直下で`name`一致・`trashed`条件一致のフォルダを全ページ列挙する。
 * 1ページ目のみで打ち切ると多数の同名フォルダが存在する親配下で見落としうる。
 */
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
 * `parentId`直下で`name`と一致する既存フォルダを2段階で解決する。
 * 1. activeのみで検索: 1件ならそのidを返す(過去の無関係なtrashed同名フォルダは
 *    一切考慮しない)。2件以上なら`AmbiguousFolderError`。
 * 2. active 0件の場合のみtrashed込みで再検索: 1件なら`files.update({trashed:false})`
 *    で復元してから返す(復元API失敗時は例外を再送出、新規作成へフォールバックしない)。
 *    2件以上なら`AmbiguousFolderError`。
 * 両段階とも0件ならnullを返す(呼び出し元が新規作成する)。
 */
async function resolveExistingFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<string | null> {
  const activeFiles = await listMatchingFolders(drive, parentId, name, false);
  if (activeFiles.length > 1) {
    throw new AmbiguousFolderError(name, parentId, activeFiles.length);
  }
  if (activeFiles.length === 1) {
    const existingId = activeFiles[0].id;
    if (!existingId) {
      throw new Error(`既存フォルダのidが取得できません: "${name}"`);
    }
    return existingId;
  }

  const trashedFiles = await listMatchingFolders(drive, parentId, name, true);
  if (trashedFiles.length > 1) {
    throw new AmbiguousFolderError(name, parentId, trashedFiles.length);
  }
  if (trashedFiles.length === 1) {
    const existingId = trashedFiles[0].id;
    if (!existingId) {
      throw new Error(`既存フォルダのidが取得できません: "${name}"`);
    }
    await drive.files.update({
      fileId: existingId,
      requestBody: { trashed: false },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
    return existingId;
  }

  return null;
}

/**
 * `parentId` 直下で `name` と一致するフォルダを検索し、そのidを返す。
 * 0件なら新規作成、1件なら再利用(activeで0件の場合のみtrashedを確認し復元)、
 * いずれかの段階で2件以上なら `AmbiguousFolderError` をthrowする。
 */
export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string
): Promise<string> {
  const existingId = await resolveExistingFolder(drive, parentId, name);
  if (existingId) {
    return existingId;
  }

  // 0件マッチ = 新規作成が必要。異なるdocId間の競合を防ぐためロックを取得する。
  const lockToken = await acquireFolderLock(firestore, parentId, name);
  try {
    // ロック獲得後に再検索(直前のロック保有者が既に作成済みの可能性があるため)。
    // 2件以上見つかった場合も、pre-lockの検索と同様にAmbiguousFolderErrorで
    // 停止する(code-review high指摘#2対応: 従来は`>=1`のみで判定しており、
    // 2件以上を観測してもfiles[0]を無条件採用し曖昧な状態を見逃していた)。
    const recheckId = await resolveExistingFolder(drive, parentId, name);
    if (recheckId) {
      return recheckId;
    }

    const createResponse = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME_TYPE,
        parents: [parentId],
      },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });

    const createdId = createResponse.data.id;
    if (!createdId) {
      throw new Error(`フォルダの作成に失敗しました(idが返却されませんでした): "${name}"`);
    }
    return createdId;
  } finally {
    // releaseFolderLock自体の失敗がtryブロックの戻り値/エラーを握りつぶさないよう、
    // 独立したtry/catchで囲む(rules/error-handling.md §1: 状態復旧・エラーハンドラの
    // 各ステップは独立させ、他のステップの失敗に影響されないようにする)。
    // 解放に失敗してもFOLDER_LOCK_STALE_MS経過後は次の呼び出しが上書き取得できるため、
    // 自己修復可能(orphanしたロックが恒久的にブロックし続けることはない)。
    try {
      await releaseFolderLock(firestore, parentId, name, lockToken);
    } catch (releaseError) {
      console.error(
        `[findOrCreateFolder] ロック解放に失敗しました("${name}"、親フォルダ: ${parentId}):`,
        releaseError
      );
    }
  }
}
