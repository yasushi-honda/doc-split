#!/usr/bin/env ts-node
/**
 * Issue #811 Phase B: dev 環境に Drive フォルダ重複統合の fixture を投入(idempotent)
 *
 * `scripts/setup-collision-fixture.ts`(Issue #432)のADR-0016 devリハーサル規律を踏襲する:
 * kanameone本番でexecute pathが初動するリスクを避けるため、devに意図的な重複+ケース分岐を
 * 作り、classify→execute(dry-run→execute)を本番前に検証する。
 *
 * 投入内容(識別可能なfixture名`pr-x-fixture-*`固定):
 *   - canonicalフォルダ1件(rootFolderId直下)
 *   - duplicateフォルダ2件(同名、うち1件はtrashed) — 配下に customer/category の
 *     ネストフォルダ + fixtureファイルを作成
 *     - move-to-canonical期待: docSplitDocIdがFirestore fixture documentに解決でき、
 *       careManagerが一致するファイル
 *     - manual-review期待: careManagerが一致しない(担当替えシナリオ)ファイル
 *   - 対応するFirestore fixture document(`documents/pr-x-fixture-*`)
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/setup-drive-folder-fixture.ts [--cleanup]
 *
 * --cleanup: fixtureを削除する(再投入前のリセット用)
 */

import * as admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}
if (!projectId.includes('dev')) {
  console.error(`FATAL: setup-drive-folder-fixture は dev 環境専用です。projectId=${projectId} は dev を含みません。`);
  process.exit(2);
}

const cleanup = process.argv.includes('--cleanup');

admin.initializeApp({ projectId });
const db = admin.firestore();

const FIXTURE_PREFIX = 'pr-x-fixture';
const FIXTURE_FOLDER_NAME = `${FIXTURE_PREFIX}-caremanager`;
const FIXTURE_DOC_MATCH = `${FIXTURE_PREFIX}-doc-match`;
const FIXTURE_DOC_REASSIGNED = `${FIXTURE_PREFIX}-doc-reassigned`;

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

async function main(): Promise<void> {
  const { getDriveSettings, getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { SUPPORTS_ALL_DRIVES, escapeQueryValue } = await import('../functions/src/drive/driveApiConstants');
  const drive = await getDriveClient();

  const settings = await getDriveSettings();
  const { rootFolderId } = settings;
  if (!rootFolderId) {
    console.error('❌ dev の settings/drive.rootFolderId が未設定です。Drive連携を先に接続してください。');
    process.exit(1);
  }

  console.log(`プロジェクト: ${projectId}`);
  console.log(`rootFolderId: ${rootFolderId}`);
  console.log(cleanup ? 'モード: cleanup' : 'モード: cleanup → 再投入(idempotent)');
  console.log('---');

  // ─── cleanup: 既存fixtureを削除 ─────────────────────────
  async function doCleanup(): Promise<void> {
    // Firestore fixture docs
    for (const docId of [FIXTURE_DOC_MATCH, FIXTURE_DOC_REASSIGNED]) {
      await db.doc(`documents/${docId}`).delete().catch(() => undefined);
    }
    // Drive fixture folders(全ページ・trashed込みで名前検索)
    let pageToken: string | undefined;
    const toDelete: string[] = [];
    do {
      const res = await drive.files.list({
        q: `'${rootFolderId}' in parents and name='${escapeQueryValue(FIXTURE_FOLDER_NAME)}' and mimeType='${FOLDER_MIME_TYPE}'`,
        fields: 'nextPageToken, files(id)',
        includeItemsFromAllDrives: true,
        pageSize: 100,
        pageToken,
        ...SUPPORTS_ALL_DRIVES,
      });
      for (const f of res.data.files ?? []) {
        if (f.id) toDelete.push(f.id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    for (const id of toDelete) {
      // drive.fileスコープでは完全削除不可、trashedにするのみ(既存fixtureのcleanupなので
      // 復元不能でも実害なし)
      await drive.files
        .update({ fileId: id, requestBody: { trashed: true }, fields: 'id', ...SUPPORTS_ALL_DRIVES })
        .catch(() => undefined);
    }
    console.log(`cleanup完了: Drive fixtureフォルダ${toDelete.length}件をtrashed化、Firestore fixture doc 2件削除`);
  }

  await doCleanup();
  if (cleanup) {
    await admin.app().delete();
    return;
  }

  // ─── Firestore fixture documents ───────────────────────
  const now = admin.firestore.Timestamp.now();
  await db.doc(`documents/${FIXTURE_DOC_MATCH}`).set({
    careManager: 'フィクスチャ 太郎',
    customerName: 'フィクスチャ利用者A',
    customerId: null,
    category: 'フィクスチャ書類',
    documentType: 'フィクスチャ書類',
    fileDate: now,
    status: 'processed',
  });
  await db.doc(`documents/${FIXTURE_DOC_REASSIGNED}`).set({
    careManager: 'フィクスチャ 次郎', // canonicalのケアマネ名と意図的に不一致(担当替えシナリオ)
    customerName: 'フィクスチャ利用者B',
    customerId: null,
    category: 'フィクスチャ書類',
    documentType: 'フィクスチャ書類',
    fileDate: now,
    status: 'processed',
  });

  // ─── canonicalフォルダ + duplicateフォルダ2件を作成 ────────────
  async function createFolder(name: string, parentId: string, trashed: boolean): Promise<string> {
    const res = await drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
    const id = res.data.id;
    if (!id) throw new Error(`fixtureフォルダ作成に失敗: ${name}`);
    if (trashed) {
      await drive.files.update({ fileId: id, requestBody: { trashed: true }, fields: 'id', ...SUPPORTS_ALL_DRIVES });
    }
    return id;
  }

  async function createFixtureFile(
    parentId: string,
    name: string,
    docSplitDocId: string
  ): Promise<string> {
    const res = await drive.files.create({
      requestBody: {
        name,
        parents: [parentId],
        appProperties: { docSplitDocId },
      },
      media: { mimeType: 'text/plain', body: 'phase-b fixture file' },
      fields: 'id',
      ...SUPPORTS_ALL_DRIVES,
    });
    const id = res.data.id;
    if (!id) throw new Error(`fixtureファイル作成に失敗: ${name}`);
    return id;
  }

  const canonicalId = await createFolder(FIXTURE_FOLDER_NAME, rootFolderId, false);

  const duplicateAId = await createFolder(FIXTURE_FOLDER_NAME, rootFolderId, true);
  const dupASubfolder = await createFolder('フィクスチャ利用者A', duplicateAId, true);
  const dupACategory = await createFolder('フィクスチャ書類', dupASubfolder, true);
  await createFixtureFile(dupACategory, 'fixture-match.txt', FIXTURE_DOC_MATCH);

  const duplicateBId = await createFolder(FIXTURE_FOLDER_NAME, rootFolderId, true);
  const dupBSubfolder = await createFolder('フィクスチャ利用者B', duplicateBId, true);
  const dupBCategory = await createFolder('フィクスチャ書類', dupBSubfolder, true);
  await createFixtureFile(dupBCategory, 'fixture-reassigned.txt', FIXTURE_DOC_REASSIGNED);

  console.log('\n投入完了:');
  console.log(`  canonicalFolderId: ${canonicalId}`);
  console.log(`  duplicateFolderIds: ${duplicateAId},${duplicateBId}`);
  console.log('\nこれらのIDを classify-drive-folder-duplicates.ts --canonical-id / --duplicate-ids に渡してください。');
  console.log('期待される分類: fixture-match.txt → move-to-canonical / fixture-reassigned.txt → manual-review');

  await admin.app().delete();
}

main().catch(async (err) => {
  console.error('Failed:', err);
  try {
    await admin.app().delete();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
