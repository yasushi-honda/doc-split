#!/usr/bin/env ts-node
/**
 * 同一docIdのファイルが親フォルダに2件ある状態(AmbiguousFileError)の調査と解消
 *
 * 既定は調査のみ(read-only): 親フォルダ直下で`appProperties.docSplitDocId==docId`のファイル
 * (本番のfindOrUploadFile/assertNoDuplicateFileと同じ検索条件)のid・作成時刻・サイズ・md5を出力し、
 * 書類側のdriveFileIdとの一致から「残す側」を推奨する。
 * `--execute --keep-file-id X --trash-file-id Y`の指定時のみ、Yをゴミ箱へ移す(完全削除はしない)。
 *
 * 安全策:
 *   - 書込み直前に重複を再取得し、ちょうど2件・keepとtrashが一覧内の別ID、でなければ実行しない
 *   - 書類にdriveFileIdが記録されている場合、keepはそれと一致していなければ実行しない
 *   - ゴミ箱へ移すだけ(Driveのゴミ箱から復元可能)
 * PII対策: ファイル名は出力しない(IDと属性のみ)。Drive APIのエラー文言も出さない。
 *
 * 使用方法(GitHub Actions: Run Operations Script):
 *   調査: script=resolve-drive-duplicate-file / exec_args_json={"docId":"<id>","parentId":"<folderId>"}
 *   解消: script=resolve-drive-duplicate-file --execute / exec_args_json={"docId":"..","parentId":"..","keepFileId":"..","trashFileId":".."}
 */

import * as admin from 'firebase-admin';
import type { drive_v3 } from 'googleapis';
import { describeErrorSafely } from './lib/confirmedReplayStats';
import { recommendKeep, validateTrashRequest, type DuplicateFileInfo } from './lib/duplicateFileTrashPlan';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

const ID_RE = /^[A-Za-z0-9_-]+$/;
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const docId = arg('--doc-id');
const parentId = arg('--parent-id');
const keepId = arg('--keep-file-id');
const trashId = arg('--trash-file-id');
const execute = process.argv.includes('--execute');

if (!docId || !ID_RE.test(docId) || !parentId || !ID_RE.test(parentId)) {
  console.error('--doc-id と --parent-id (英数字・-・_のみ)は必須です');
  process.exit(1);
}
if (execute && (!keepId || !trashId || !ID_RE.test(keepId) || !ID_RE.test(trashId))) {
  console.error('--execute には --keep-file-id と --trash-file-id (英数字・-・_のみ)が必須です');
  process.exit(1);
}

admin.initializeApp({ projectId });

async function listDuplicates(drive: drive_v3.Drive): Promise<DuplicateFileInfo[]> {
  const { escapeQueryValue } = await import('../functions/src/drive/driveApiConstants');
  const q =
    `'${parentId}' in parents and appProperties has ` +
    `{ key='docSplitDocId' and value='${escapeQueryValue(docId as string)}' } and trashed=false`;
  // 部分ページが返っても取りこぼさないよう、nextPageTokenを最後まで辿る(ゴミ箱へ移す判定の根拠になるため)
  const out: DuplicateFileInfo[] = [];
  let pageToken: string | undefined;
  do {
    const res: { data: drive_v3.Schema$FileList } = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, createdTime, size, md5Checksum)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageToken,
    });
    for (const x of res.data.files ?? []) {
      out.push({ id: x.id ?? '', createdTime: x.createdTime, size: x.size, md5Checksum: x.md5Checksum });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function main(): Promise<void> {
  const { getDriveClient } = await import('../functions/src/utils/driveAuth');
  const drive = await getDriveClient();

  const docSnap = await admin.firestore().doc(`documents/${docId}`).get();
  const docDriveFileId = (docSnap.data()?.driveFileId as string | null | undefined) ?? null;
  console.log(`モード: ${execute ? '実行(ゴミ箱へ移動)' : '調査のみ(書込みなし)'}`);
  console.log(`書類: 存在=${docSnap.exists} driveFileId記録=${docDriveFileId ? 'あり' : 'なし'}`);

  const files = await listDuplicates(drive);
  console.log(`重複ファイル(ゴミ箱の外): ${files.length}件`);
  for (const x of files) {
    console.log(
      `  ${x.id}: 作成=${x.createdTime ?? '?'} size=${x.size ?? '?'} md5=${x.md5Checksum ?? '?'}` +
        ` 書類のdriveFileIdと一致=${x.id === docDriveFileId}`
    );
  }
  if (files.length === 2) {
    console.log(`内容(md5)の一致: ${files[0].md5Checksum && files[0].md5Checksum === files[1].md5Checksum}`);
  }
  const rec = recommendKeep(files, docDriveFileId);
  console.log(rec ? `推奨: 残す=${rec.keepId} / ゴミ箱へ=${rec.trashId} (根拠: 書類のdriveFileId一致)` : '推奨: なし(人が判断)');

  if (!execute) {
    console.log('調査のみのため、書込みは行いませんでした');
    return;
  }

  const check = validateTrashRequest(files, keepId as string, trashId as string);
  if (!check.ok) {
    console.error(`中断: ${check.reason}`);
    process.exit(1);
  }
  if (docDriveFileId && keepId !== docDriveFileId) {
    console.error('中断: 書類のdriveFileIdと異なるファイルを残す指定です(driveFileIdが指す側を残してください)');
    process.exit(1);
  }
  await drive.files.update({ fileId: trashId as string, requestBody: { trashed: true }, supportsAllDrives: true });
  const after = await listDuplicates(drive);
  console.log(`完了: ${trashId} をゴミ箱へ移動しました。重複ファイル(ゴミ箱の外): ${after.length}件`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('エラー:', describeErrorSafely(error));
    process.exit(1);
  });
