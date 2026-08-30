#!/usr/bin/env ts-node
/**
 * Driveフォルダ重複の因果診断スクリプト（read-only、Issue #871 実装前ゲート）
 *
 * `findOrCreateFolder()`のGoogle Drive API結果整合性遅延によるフォルダ重複対策
 * （計画 `~/.claude/plans/moonlit-jumping-alpaca.md`）は本番のDrive連携コアロジックへの
 * アーキテクチャ変更のため、実装着手前に「本当にこの因果で重複が起きているか」を
 * 実データで検証するゲートとして本スクリプトを用意した。
 *
 * 指定されたDriveフォルダID群のメタデータ（name/createdTime/parents/trashed等）を
 * `files.get()`（直接ID指定、検索インデックスを経由しない）で取得して出力するだけの
 * 単純なツール。因果の分類・判定（名前のバイト一致比較、作成時刻差のバケット分け）は
 * 意図的に本スクリプトへ含めない: 出力JSONをローカルで後処理すれば十分な軽量作業であり、
 * 「重複ペアの組み方」（どのIDとどのIDが同一問題のペアか）は呼び出し元
 * （`classify-drive-export-drift.ts`のmisplaced判定結果等）に依存するドメイン知識のため、
 * 本スクリプト自体を特定の調査に結合させない汎用ツールとして設計する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/diagnose-drive-folder-duplicate-causality.ts \
 *     --folder-ids <id1,id2,...> --out /tmp/report.json
 *
 * オプション:
 *   --folder-ids <CSV>   調査対象のDriveフォルダID（カンマ区切り、必須）
 *   --out <path>         結果JSONの出力先（必須）
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import type { drive_v3 } from 'googleapis';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
let folderIdsRaw: string | undefined;
let outPath: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--folder-ids' && args[i + 1]) {
    folderIdsRaw = args[i + 1];
    i++;
  } else if (args[i] === '--out' && args[i + 1]) {
    outPath = args[i + 1];
    i++;
  }
}
if (!folderIdsRaw) {
  console.error('--folder-ids <id1,id2,...> を指定してください');
  process.exit(1);
}
if (!outPath) {
  console.error('--out <path> を指定してください');
  process.exit(1);
}
const folderIds = folderIdsRaw
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
if (folderIds.length === 0) {
  console.error('--folder-ids に有効なIDが1件もありません');
  process.exit(1);
}

admin.initializeApp({ projectId });

interface FolderReport {
  folderId: string;
  found: boolean;
  name?: string;
  createdTime?: string;
  modifiedTime?: string;
  trashed?: boolean;
  parents?: string[];
  lastModifyingUserEmail?: string | null;
  ownerEmails?: string[];
  error?: string;
}

async function main(): Promise<void> {
  // functions/src/utils/driveAuth.ts はモジュールトップレベルで admin.firestore() を評価するため、
  // admin.initializeApp() より前に静的importするとFirebaseAppError(no-app)になる
  // (investigate-caremanager-folder-duplicate.ts等と同型の対策)。
  const { getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { SUPPORTS_ALL_DRIVES } = await import('../functions/src/drive/driveApiConstants');

  console.log(`プロジェクト: ${projectId}`);
  console.log(`調査対象フォルダ数: ${folderIds.length}件`);
  console.log('---');

  const drive: drive_v3.Drive = await getDriveClient();
  const reports: FolderReport[] = [];

  for (const folderId of folderIds) {
    try {
      const res = await drive.files.get({
        fileId: folderId,
        fields:
          'id, name, createdTime, modifiedTime, trashed, parents, ' +
          'lastModifyingUser(emailAddress), owners(emailAddress)',
        ...SUPPORTS_ALL_DRIVES,
      });
      const data = res.data;
      reports.push({
        folderId,
        found: true,
        name: data.name ?? undefined,
        createdTime: data.createdTime ?? undefined,
        modifiedTime: data.modifiedTime ?? undefined,
        trashed: data.trashed ?? undefined,
        parents: data.parents ?? undefined,
        lastModifyingUserEmail: data.lastModifyingUser?.emailAddress ?? null,
        ownerEmails: (data.owners ?? []).map((o) => o.emailAddress ?? '').filter(Boolean),
      });
      console.log(
        `✅ ${folderId}: name="${data.name}" createdTime=${data.createdTime} trashed=${data.trashed}`
      );
    } catch (err) {
      const message = (err as Error).message;
      reports.push({ folderId, found: false, error: message });
      console.log(`⚠️  ${folderId}: 取得失敗 (${message})`);
    }
  }

  const output = {
    projectId,
    generatedAt: new Date().toISOString(),
    requestedCount: folderIds.length,
    foundCount: reports.filter((r) => r.found).length,
    notFoundCount: reports.filter((r) => !r.found).length,
    reports,
  };
  fs.writeFileSync(outPath as string, JSON.stringify(output, null, 2));
  console.log('---');
  console.log(
    `完了: ${output.foundCount}/${output.requestedCount}件取得成功。結果を書き込みました: ${outPath}`
  );
}

main().catch((err) => {
  console.error('診断スクリプトが失敗しました:', err);
  process.exit(1);
});
