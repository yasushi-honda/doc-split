/**
 * Google Drive フォルダの find-or-create(ADR-0022 Decision 4)
 *
 * 親フォルダ直下を子フォルダ名で検索し、0件なら作成・1件なら再利用・
 * 2件以上なら `AmbiguousFolderError` をthrowして停止する。曖昧な状態での
 * 自動選択は誤配置リスクがあるため、常に停止を優先する。
 */

import { drive_v3 } from 'googleapis';
import { SUPPORTS_ALL_DRIVES, escapeQueryValue } from './driveApiConstants';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

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
 * `parentId` 直下で `name` と一致するフォルダを検索し、そのidを返す。
 * 0件なら新規作成、1件なら再利用、2件以上なら `AmbiguousFolderError` をthrowする。
 */
export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<string> {
  const q = `'${parentId}' in parents and name='${escapeQueryValue(name)}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;

  const listResponse = await drive.files.list({
    q,
    fields: 'files(id, name)',
    includeItemsFromAllDrives: true,
    ...SUPPORTS_ALL_DRIVES,
  });

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
}
