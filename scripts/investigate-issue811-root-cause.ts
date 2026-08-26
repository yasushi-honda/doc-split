#!/usr/bin/env ts-node
/**
 * Issue #811再オープン後の根本原因調査（read-only）
 *
 * scripts/investigate-caremanager-folder-duplicate.ts（Issue #823対応でtrashed復旧済み）の
 * 実行結果から判明した2つの謎を追加調査する:
 *   1. 「森奈穂美」という名前の物理フォルダが4つ(有効1+trashed3)存在する理由。
 *      各フォルダのcreatedTime/trashedTime/trashingUserを取得し、いつ・誰が重複を
 *      作った/消したかのタイムラインを再構成する材料にする。
 *   2. 40種類の別利用者名フォルダに紐づいた112件のdocumentの共通点。documentCategory/
 *      fileDate/isSplitSource等のFirestoreフィールドを取得し、パターンの有無を確認する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/investigate-issue811-root-cause.ts \
 *     --folder-ids "id1,id2,id3,id4" \
 *     --doc-ids "docA,docB,docC"
 *
 * オプション（いずれか片方だけの指定も可）:
 *   --folder-ids <カンマ区切り>  metadata(createdTime/trashedTime/trashingUser)を取得するフォルダID群
 *   --doc-ids <カンマ区切り>     Firestoreフィールドを確認するdocument ID群
 */

import * as admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
let folderIdsArg: string | undefined;
let docIdsArg: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--folder-ids' && args[i + 1]) {
    folderIdsArg = args[i + 1];
    i++;
  } else if (args[i] === '--doc-ids' && args[i + 1]) {
    docIdsArg = args[i + 1];
    i++;
  }
}
if (!folderIdsArg && !docIdsArg) {
  console.error('--folder-ids または --doc-ids の少なくとも一方を指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main(): Promise<void> {
  const { getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { SUPPORTS_ALL_DRIVES } = await import('../functions/src/drive/driveApiConstants');

  console.log(`プロジェクト: ${projectId}`);
  console.log('---');

  if (folderIdsArg) {
    const drive = await getDriveClient();
    const folderIds = folderIdsArg.split(',').map((s) => s.trim()).filter(Boolean);
    console.log(`=== フォルダmetadata調査(${folderIds.length}件) ===`);
    for (const id of folderIds) {
      try {
        const res = await drive.files.get({
          fileId: id,
          fields: 'id,name,createdTime,modifiedTime,trashed,trashedTime,trashingUser(displayName,emailAddress),parents',
          supportsAllDrives: true,
          ...SUPPORTS_ALL_DRIVES,
        });
        const d = res.data;
        console.log(
          `id=${id} name="${d.name}" trashed=${d.trashed} createdTime=${d.createdTime} ` +
            `modifiedTime=${d.modifiedTime} trashedTime=${d.trashedTime ?? '(N/A)'} ` +
            `trashingUser=${d.trashingUser ? `${d.trashingUser.displayName}<${d.trashingUser.emailAddress}>` : '(N/A)'} ` +
            `parents=${JSON.stringify(d.parents)}`
        );
      } catch (err) {
        console.log(`id=${id}: 取得失敗 - ${(err as Error).message}`);
      }
    }
    console.log('---');
  }

  if (docIdsArg) {
    const docIds = docIdsArg.split(',').map((s) => s.trim()).filter(Boolean);
    console.log(`=== Firestore document調査(${docIds.length}件) ===`);
    for (const docId of docIds) {
      const snap = await db.collection('documents').doc(docId).get();
      if (!snap.exists) {
        console.log(`docId=${docId}: Firestoreに存在しません`);
        continue;
      }
      const data = snap.data()!;
      console.log(
        `docId=${docId} customerName=${data.customerName} careManager=${data.careManager} ` +
          `documentCategory=${data.category ?? '(未設定)'} documentType=${data.documentType} ` +
          `fileDate=${data.fileDate ? data.fileDate.toDate().toISOString() : '(未設定)'} ` +
          `isSplitSource=${data.isSplitSource ?? false} status=${data.status} ` +
          `driveExportStatus=${data.driveExportStatus} driveFileId=${data.driveFileId} ` +
          `createdAt=${data.createdAt ? data.createdAt.toDate().toISOString() : '(N/A)'} ` +
          `updatedAt=${data.updatedAt ? data.updatedAt.toDate().toISOString() : '(N/A)'}`
      );
    }
    console.log('---');
  }

  console.log('調査完了。');
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
