/**
 * Google Drive フォルダの find-or-create(ADR-0022 Decision 4)
 *
 * 親フォルダ直下を子フォルダ名で検索し、0件なら作成・1件なら再利用・
 * 2件以上なら `AmbiguousFolderError` をthrowして停止する。曖昧な状態での
 * 自動選択は誤配置リスクがあるため、常に停止を優先する。
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

/** ロック保有中とみなす期間。Drive API呼び出し(list+create)の想定所要時間より十分大きい値。 */
const FOLDER_LOCK_STALE_MS = 2 * 60 * 1000;

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
 * 呼び出し元（トリガー）はこれを捕捉し `driveExportStatus: 'error'` に遷移させ、
 * 次回スケジュールスイープでの自動リトライに委ねる(その時点では先行の作成が
 * 完了しているため、通常のfind分岐で解決する)。
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
async function acquireFolderLock(
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

async function releaseFolderLock(
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
 * `parentId` 直下で `name` と一致するフォルダを検索し、そのidを返す。
 * 0件なら新規作成、1件なら再利用、2件以上なら `AmbiguousFolderError` をthrowする。
 */
export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  firestore: admin.firestore.Firestore,
  parentId: string,
  name: string
): Promise<string> {
  const q = `'${parentId}' in parents and name='${escapeQueryValue(name)}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
  const listParams = {
    q,
    fields: 'files(id, name)',
    includeItemsFromAllDrives: true,
    ...SUPPORTS_ALL_DRIVES,
  };

  const listResponse = await drive.files.list(listParams);
  const files = listResponse.data.files ?? [];

  if (files.length > 1) {
    throw new AmbiguousFolderError(name, parentId, files.length);
  }

  if (files.length === 1) {
    const existingId = files[0].id;
    if (!existingId) {
      throw new Error(`既存フォルダのidが取得できません: "${name}"`);
    }
    return existingId;
  }

  // 0件マッチ = 新規作成が必要。異なるdocId間の競合を防ぐためロックを取得する。
  const lockToken = await acquireFolderLock(firestore, parentId, name);
  try {
    // ロック獲得後に再検索(直前のロック保有者が既に作成済みの可能性があるため)。
    // 2件以上見つかった場合も、pre-lockの検索と同様にAmbiguousFolderErrorで
    // 停止する(code-review high指摘#2対応: 従来は`>=1`のみで判定しており、
    // 2件以上を観測してもfiles[0]を無条件採用し曖昧な状態を見逃していた)。
    const recheckResponse = await drive.files.list(listParams);
    const recheckFiles = recheckResponse.data.files ?? [];
    if (recheckFiles.length > 1) {
      throw new AmbiguousFolderError(name, parentId, recheckFiles.length);
    }
    if (recheckFiles.length === 1) {
      const existingId = recheckFiles[0].id;
      if (!existingId) {
        throw new Error(`既存フォルダのidが取得できません: "${name}"`);
      }
      return existingId;
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
