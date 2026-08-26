/**
 * Issue #811 Phase B: Drive file の runtime provenance 取得(`scripts/lib/parentPdfProvenance.ts`
 * のDrive版)。
 *
 * PDF版はStorageから親PDFをダウンロードしsha256を計算する重い処理だったが、Drive版は
 * `drive.files.get`のfieldsで`version`/`md5Checksum`/`headRevisionId`を一括取得できるため
 * ダウンロード不要。execute-drive-folder-merge.tsのGate9相当(実行直前の再照合)で使う。
 */

import type { drive_v3 } from 'googleapis';
import { SUPPORTS_ALL_DRIVES } from '../../functions/src/drive/driveApiConstants';
import type { FolderFileProvenance } from './folderMergePlanTypes';

export async function computeFolderFileProvenance(
  drive: drive_v3.Drive,
  fileId: string
): Promise<FolderFileProvenance> {
  const res = await drive.files.get({
    fileId,
    fields: 'id, version, md5Checksum, headRevisionId',
    ...SUPPORTS_ALL_DRIVES,
  });
  const id = res.data.id;
  const version = res.data.version;
  if (!id || !version) {
    throw new Error(`drive.files.get returned incomplete data for fileId=${fileId} (missing id/version)`);
  }
  return {
    fileId: id,
    version,
    md5Checksum: res.data.md5Checksum ?? null,
    headRevisionId: res.data.headRevisionId ?? null,
  };
}
