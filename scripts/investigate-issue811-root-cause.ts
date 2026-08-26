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
let scanRootDuplicates = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--folder-ids' && args[i + 1]) {
    folderIdsArg = args[i + 1];
    i++;
  } else if (args[i] === '--doc-ids' && args[i + 1]) {
    docIdsArg = args[i + 1];
    i++;
  } else if (args[i] === '--scan-root-duplicates') {
    scanRootDuplicates = true;
  }
}
if (!folderIdsArg && !docIdsArg && !scanRootDuplicates) {
  console.error('--folder-ids / --doc-ids / --scan-root-duplicates のいずれかを指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main(): Promise<void> {
  const { getDriveClient, getDriveSettings } = await import('../functions/src/utils/driveAuth');
  const { SUPPORTS_ALL_DRIVES } = await import('../functions/src/drive/driveApiConstants');

  console.log(`プロジェクト: ${projectId}`);
  console.log('---');

  if (scanRootDuplicates) {
    const drive = await getDriveClient();
    const settings = await getDriveSettings();
    const { rootFolderId } = settings;
    if (!rootFolderId) {
      console.error('❌ settings/drive の rootFolderId が未設定です。');
      process.exit(1);
    }
    console.log(`=== rootFolderId直下(ケアマネ階層)の同名フォルダ走査 ===`);
    console.log(`rootFolderId: ${rootFolderId}`);
    // Drive API v3のfiles.listはデフォルトでtrashedも含む(除外するには明示的にtrashed=falseの
    // 指定が必要、公式ドキュメント確認済み: developers.google.com/workspace/drive/api/reference/rest/v3/files/list)。
    // ここでは意図的にtrashed条件を付けず、trashed込みの全フォルダを一覧してactive/trashed両方の
    // 名前重複を安価に検出する(1回のlist呼び出しで済み、ドキュメント単位の物理チェックより遥かに軽量)。
    const byName = new Map<string, { id: string; trashed: boolean }[]>();
    let pageToken: string | undefined;
    let totalScanned = 0;
    do {
      const res = await drive.files.list({
        q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder'`,
        fields: 'nextPageToken, files(id, name, trashed)',
        pageSize: 1000,
        pageToken,
        includeItemsFromAllDrives: true,
        ...SUPPORTS_ALL_DRIVES,
      });
      for (const f of res.data.files ?? []) {
        totalScanned++;
        const name = f.name ?? '(名前なし)';
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name)!.push({ id: f.id!, trashed: !!f.trashed });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    console.log(`走査したケアマネ階層フォルダ総数(active+trashed): ${totalScanned}`);
    const duplicates = [...byName.entries()].filter(([, items]) => items.length > 1);
    console.log(`同名フォルダが複数存在するケアマネ名: ${duplicates.length}件`);
    if (duplicates.length > 0) {
      console.log('--- 内訳 ---');
      for (const [name, items] of duplicates) {
        const activeCount = items.filter((i) => !i.trashed).length;
        const trashedCount = items.filter((i) => i.trashed).length;
        console.log(
          `  "${name}": 物理フォルダ${items.length}件(active=${activeCount}, trashed=${trashedCount}) ` +
            `ids=${items.map((i) => `${i.id}${i.trashed ? '(trashed)' : ''}`).join(', ')}`
        );
      }
    }
    console.log('---');
  }

  if (folderIdsArg) {
    const drive = await getDriveClient();
    const folderIds = folderIdsArg.split(',').map((s) => s.trim()).filter(Boolean);
    console.log(`=== フォルダmetadata調査(${folderIds.length}件) ===`);
    for (const id of folderIds) {
      try {
        const res = await drive.files.get({
          fileId: id,
          fields: 'id,name,createdTime,modifiedTime,trashed,trashedTime,trashingUser(displayName,emailAddress),parents',
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
