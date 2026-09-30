#!/usr/bin/env ts-node
/**
 * Driveフォルダ組の直下ファイル照合スクリプト(read-only)
 *
 * audit-drive-sibling-duplicatesがmanual-review(タグ無し2件で自動判定不可)とした
 * 重複フォルダ組について、片方にしか無いファイルがあるか(=統合で失われうるデータがあるか)を
 * 件数で出力する。照合ロジックは`scripts/lib/compareFolderPairs.ts`(md5優先、無ければ名前+mimeType)。
 *
 * 書き込みAPI(files.update/create/delete等)は一切呼ばない。
 *
 * PII対策: 出力(ログ・JSON)にファイル名・フォルダ名は含めない(利用者名を含みうるため)。
 * 組はフォルダIDのみで識別する。Drive APIのエラーメッセージ(リソース名を含みうる)も出力せず、
 * 無害化した種別(describeErrorSafely)と固定の理由コードだけを残す。
 *
 * fail-closed: settings/drive.grantedScopesにフルスコープ`drive`が無い場合(旧drive.file)は、
 * 人作成のフォルダ/ファイルが不可視のまま「0件・片側のみ」と誤った結果を返すため実行を拒否する
 * (audit-drive-sibling-duplicates.tsと同型)。各IDは有効(未ゴミ箱)なフォルダであることを確認する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/compare-drive-folder-pairs.ts \
 *     --pairs <idA:idB,idA2:idB2,...> --out /tmp/report.json
 *
 * オプション:
 *   --pairs <CSV>  比較するフォルダIDの組(`A:B`形式、カンマ区切り、必須)。A/Bの役割の区別は
 *                  出力上の呼称のみ(照合は対称)。慣習としてA=app作成側、B=人作成側で渡す。
 *   --out <path>   結果JSONの出力先(必須)
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import type { drive_v3 } from 'googleapis';
import { compareFolderChildren, type FolderChild, type FolderCompareResult } from './lib/compareFolderPairs';
import { describeErrorSafely } from './lib/confirmedReplayStats';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
let pairsRaw: string | undefined;
let outPath: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pairs' && args[i + 1]) {
    pairsRaw = args[i + 1];
    i++;
  } else if (args[i] === '--out' && args[i + 1]) {
    outPath = args[i + 1];
    i++;
  }
}
if (!pairsRaw) {
  console.error('--pairs <idA:idB,idA2:idB2,...> を指定してください');
  process.exit(1);
}
if (!outPath) {
  console.error('--out <path> を指定してください');
  process.exit(1);
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const pairs: Array<{ a: string; b: string }> = pairsRaw
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((s) => {
    const parts = s.split(':');
    if (parts.length !== 2 || !ID_PATTERN.test(parts[0]) || !ID_PATTERN.test(parts[1])) {
      console.error(`--pairs の要素は "idA:idB"(英数字・_-のみ)で指定してください: ${s}`);
      process.exit(1);
    }
    return { a: parts[0], b: parts[1] };
  });
if (pairs.length === 0) {
  console.error('--pairs に有効な組が1件もありません');
  process.exit(1);
}

admin.initializeApp({ projectId });

interface PairReport {
  folderIdA: string;
  folderIdB: string;
  found: boolean;
  result?: FolderCompareResult;
  error?: string;
}

async function listChildren(drive: drive_v3.Drive, parentId: string): Promise<FolderChild[]> {
  const out: FolderChild[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(name,mimeType,md5Checksum)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      if (!f.name || !f.mimeType) continue;
      out.push({ name: f.name, mimeType: f.mimeType, md5Checksum: f.md5Checksum ?? null });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/** 指定IDが有効(未ゴミ箱)なフォルダなら null、そうでなければ固定の理由コードを返す(名前は含めない)。 */
async function folderProblem(
  drive: drive_v3.Drive,
  folderId: string,
  folderMimeType: string
): Promise<string | null> {
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: 'mimeType,trashed',
      supportsAllDrives: true,
    });
    if (res.data.trashed) return 'trashed';
    if (res.data.mimeType !== folderMimeType) return 'not-a-folder';
    return null;
  } catch (err) {
    return `unavailable:${describeErrorSafely(err)}`;
  }
}

async function main(): Promise<void> {
  // functions/src/utils/driveAuth.ts はモジュールトップレベルで admin.firestore() を評価するため、
  // admin.initializeApp() より前に静的importするとFirebaseAppError(no-app)になる
  // (diagnose-drive-folder-duplicate-causality.ts等と同型の対策)。
  const { getDriveSettings, getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { FOLDER_MIME_TYPE } = await import('../functions/src/drive/driveApiConstants');
  const { REQUIRED_DRIVE_SCOPE } = await import('../functions/src/drive/exchangeDriveAuthCode');

  console.log(`プロジェクト: ${projectId}`);
  console.log(`比較対象: ${pairs.length}組`);
  console.log('---');

  const settings = await getDriveSettings();
  const grantedScopes = settings.grantedScopes ?? [];
  if (!grantedScopes.includes(REQUIRED_DRIVE_SCOPE)) {
    console.error(
      `❌ settings/drive.grantedScopesに${REQUIRED_DRIVE_SCOPE}が含まれていません。` +
        '再連携が完了してから実行してください。未連携のまま実行すると、人作成のフォルダ/ファイルが' +
        '不可視のため「0件・片側のみ」という誤った結果になります。'
    );
    process.exit(2);
  }

  const drive: drive_v3.Drive = await getDriveClient();
  const reports: PairReport[] = [];

  for (const [i, pair] of pairs.entries()) {
    const problemA = await folderProblem(drive, pair.a, FOLDER_MIME_TYPE);
    const problemB = await folderProblem(drive, pair.b, FOLDER_MIME_TYPE);
    if (problemA || problemB) {
      const error = [problemA && `A:${problemA}`, problemB && `B:${problemB}`].filter(Boolean).join(' ');
      reports.push({ folderIdA: pair.a, folderIdB: pair.b, found: false, error });
      console.log(`⚠️  組${i + 1}: フォルダ確認に失敗 (${error})`);
      continue;
    }
    try {
      const [childrenA, childrenB] = await Promise.all([
        listChildren(drive, pair.a),
        listChildren(drive, pair.b),
      ]);
      const result = compareFolderChildren(childrenA, childrenB);
      reports.push({ folderIdA: pair.a, folderIdB: pair.b, found: true, result });
      console.log(
        `✅ 組${i + 1}: A(ファイル${result.aFileCount}/子フォルダ${result.aChildFolderCount}) ` +
          `B(ファイル${result.bFileCount}/子フォルダ${result.bChildFolderCount}) ` +
          `共通${result.both} Aのみ${result.onlyA} Bのみ${result.onlyB}`
      );
    } catch (err) {
      const message = describeErrorSafely(err);
      reports.push({ folderIdA: pair.a, folderIdB: pair.b, found: false, error: message });
      console.log(`⚠️  組${i + 1}: 取得失敗 (${message})`);
    }
  }

  const output = {
    projectId,
    generatedAt: new Date().toISOString(),
    requestedCount: pairs.length,
    successCount: reports.filter((r) => r.found).length,
    failedCount: reports.filter((r) => !r.found).length,
    reports,
  };
  fs.writeFileSync(outPath as string, JSON.stringify(output, null, 2));
  console.log('---');
  console.log(`完了: ${output.successCount}/${output.requestedCount}組成功。結果を書き込みました: ${outPath}`);
}

main().catch((err) => {
  console.error('照合スクリプトが失敗しました:', describeErrorSafely(err));
  process.exit(1);
});
