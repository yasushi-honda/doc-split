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
 *   - `trashed=false`条件を外し、trashed込みで検索する
 *   - `files.list`のページネーションを明示的に処理する(1ページ目のみで打ち切らない。
 *     findOrCreateFolder.tsの既存の穴でもある、codex Medium指摘)
 *   - 1件マッチかつtrashedなら`files.update({trashed:false})`で復元してから返す
 *   - 2件以上マッチならfail-closedで`AmbiguousChildFolderError`をthrowする(新規作成・
 *     復元のどちらも行わない)
 *   - `driveFolderLocks`によるトランザクションロックは実装しない。Part Aはスクリプトの
 *     単一プロセス逐次実行を前提とするため、Cloud Functions同時実行(findOrCreateFolder.ts
 *     が対処する競合)は起こり得ない(plan前提、[[reference]]参照なし・本ファイルコメントで
 *     明記するのみ)。
 */

import type { drive_v3 } from 'googleapis';
import { SUPPORTS_ALL_DRIVES, escapeQueryValue } from './driveApiConstants';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export class AmbiguousChildFolderError extends Error {
  constructor(name: string, parentId: string, count: number) {
    super(
      `[Phase B Part A] 子フォルダ名が重複しているため解決できません(${count}件、trashed込み): "${name}"（親フォルダ: ${parentId}）。fail-closed: 作成・復元のいずれも行いません。`
    );
    this.name = 'AmbiguousChildFolderError';
  }
}

async function listAllMatchingFolders(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<drive_v3.Schema$File[]> {
  const q = `'${parentId}' in parents and name='${escapeQueryValue(name)}' and mimeType='${FOLDER_MIME_TYPE}'`;
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
 * `parentId`直下でtrashed込みの`name`一致フォルダをfind-or-createする(Part A専用)。
 * 0件なら新規作成、1件(trashedなら復元)なら再利用、2件以上ならfail-closedでthrowする。
 */
export async function resolveChildFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<string> {
  const files = await listAllMatchingFolders(drive, parentId, name);

  if (files.length > 1) {
    throw new AmbiguousChildFolderError(name, parentId, files.length);
  }

  if (files.length === 1) {
    const existing = files[0];
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
    }
    return existing.id;
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
    throw new Error(`[Phase B Part A] 子フォルダの作成に失敗しました(idが返却されませんでした): "${name}"`);
  }
  return createdId;
}

/**
 * `segments`配列を`rootId`から順にfind-or-createで辿り、最終フォルダIDを返す。
 */
export async function resolveChildFolderPath(
  drive: drive_v3.Drive,
  rootId: string,
  segments: string[]
): Promise<string> {
  let currentId = rootId;
  for (const segment of segments) {
    currentId = await resolveChildFolder(drive, currentId, segment);
  }
  return currentId;
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
    const files = await listAllMatchingFolders(drive, currentId, segment);
    if (files.length > 1) {
      throw new AmbiguousChildFolderError(segment, currentId, files.length);
    }
    if (files.length === 0) {
      return null;
    }
    const existing = files[0];
    if (!existing.id) {
      throw new Error(`[Phase B Part A] 既存子フォルダのidが取得できません: "${segment}"`);
    }
    currentId = existing.id;
  }
  return currentId;
}
