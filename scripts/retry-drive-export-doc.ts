#!/usr/bin/env ts-node
/**
 * Issue #811 Phase B: 単一documentのDriveエクスポート手動リトライ(read-write)
 *
 * `functions/src/drive/retryDriveExport.ts`の`retryDriveExportCore`(本番のエラー一覧UI
 * 「リトライ」ボタンと同一ロジック)を、GitHub Actionsの管理者権限で直接呼び出す。
 *
 * PR #842(findOrCreateFolder.tsの2段階検索修正)デプロイ後、実際に`AmbiguousFolderError`で
 * 失敗していたdocumentが修正後のロジックで正しくエクスポートできることを検証する目的で追加。
 * `driveExportScheduled.ts`の定期スイープ(15分毎)は`driveExportStatus in ['error','exporting']`
 * の全documentをdocumentId順のカーソルで巡回するため、backlogが大きいと目的のdocumentに
 * 到達するまで長時間かかる(この検証中、2時間経過しても対象documentが未到達だったため
 * 直接リトライする経路を追加した)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/retry-drive-export-doc.ts \
 *     --doc-id CaHY72YWfJjR1qZPG6M5
 */

import * as admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
const docIdIndex = args.indexOf('--doc-id');
const docId = docIdIndex >= 0 ? args[docIdIndex + 1] : undefined;
if (!docId) {
  console.error('--doc-id <docId> を指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main(): Promise<void> {
  const { retryDriveExportCore, DriveExportNotRetryableError } = await import(
    '../functions/src/drive/retryDriveExport'
  );

  console.log(`プロジェクト: ${projectId}`);
  console.log(`対象docId: ${docId}`);
  console.log('---');

  try {
    const result = await retryDriveExportCore(db, docId as string);
    console.log(`結果: success=${result.success} status=${result.status} error=${result.error ?? '(なし)'}`);
  } catch (err) {
    if (err instanceof DriveExportNotRetryableError) {
      console.error(`リトライ対象外です(documentが存在しないか、error状態ではありません): ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  console.log('---');
  console.log('完了。');
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
