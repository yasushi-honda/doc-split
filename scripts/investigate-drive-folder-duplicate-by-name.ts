#!/usr/bin/env ts-node
/**
 * フォルダ名パターンでDrive上の重複フォルダを直接調査する汎用read-onlyツール
 *
 * kaname報告(2026-09-23受領、「医療」フォルダを別の場所から保存先ドライブフォルダに移動したところ
 * 「医療（１）」ができた)の発生日時を特定するために作成。Issue #871(手動フォルダ作成/移動直後の
 * 保存操作でDriveフォルダが重複作成される)は2026-09-16にkanameoneへのclaimプロトコル
 * ロールアウト(段階0〜4)が完了しクローズ済みのため、今回の報告がロールアウト完了前の
 * 旧事象か、完了後の新規発生(=恒久対策の穴)かを切り分ける必要がある。
 *
 * 判定に`appProperties.docSplitFolderClaim`(claimプロトコルが`files.create`時に刻む冪等キー、
 * `functions/src/drive/driveApiConstants.ts`のDOCSPLIT_FOLDER_CLAIM_KEY)の有無を使う:
 * このキーが無いフォルダはclaimプロトコル導入前の古いfindOrCreateFolder経路で作成されたか、
 * 人間がDrive上で手動作成したフォルダのいずれか(app作成分は必ずこのキーを持つ)。
 *
 * 汎用ツールとして書いており、名前パターンを変えれば今後の同種の重複報告調査にも再利用できる。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/investigate-drive-folder-duplicate-by-name.ts \
 *     --name-contains "医療"
 *
 * オプション:
 *   --name-contains <文字列>   Drive `files.list` の `name contains` 検索語(必須)
 *   --include-trashed          既定はtrashed=false固定。指定時はtrashedも含めて検索
 */

import * as admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
const nameContainsIndex = args.indexOf('--name-contains');
const nameContains = nameContainsIndex >= 0 ? args[nameContainsIndex + 1] : undefined;
const includeTrashed = args.includes('--include-trashed');

if (!nameContains) {
  console.error('--name-contains <文字列> を指定してください(例: --name-contains "医療")');
  process.exit(1);
}

admin.initializeApp({ projectId });

async function main(): Promise<void> {
  // driveAuth.tsはモジュールトップレベルでadmin.firestore()を評価するため、
  // admin.initializeApp()より前に静的importするとFirebaseAppError(no-app)になる
  // (既存の investigate-caremanager-folder-duplicate.ts と同型の対策)。
  const { getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { FOLDER_MIME_TYPE, DOCSPLIT_FOLDER_CLAIM_KEY, escapeQueryValue } = await import(
    '../functions/src/drive/driveApiConstants'
  );

  const drive = await getDriveClient();

  console.log(`プロジェクト: ${projectId}`);
  console.log(`検索語: name contains "${nameContains}"`);
  console.log(`trashed含む: ${includeTrashed}`);
  console.log('---');

  const trashedClause = includeTrashed ? '' : ' and trashed=false';
  const q =
    `name contains '${escapeQueryValue(nameContains)}' and mimeType='${FOLDER_MIME_TYPE}'` +
    trashedClause;

  const files: Array<{
    id?: string | null;
    name?: string | null;
    createdTime?: string | null;
    modifiedTime?: string | null;
    parents?: string[] | null;
    trashed?: boolean | null;
    appProperties?: { [key: string]: string } | null;
  }> = [];

  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id,name,createdTime,modifiedTime,parents,trashed,appProperties)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives',
    });
    files.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  console.log(`該当フォルダ: ${files.length}件`);
  console.log('---');

  // 親フォルダIDでグループ化し、同一親配下に同名/類似名の兄弟が複数あるケース(=物理重複)を目視しやすくする
  const parentCache = new Map<string, string>();
  async function resolveParentName(parentId: string): Promise<string> {
    if (parentCache.has(parentId)) return parentCache.get(parentId)!;
    try {
      const res = await drive.files.get({
        fileId: parentId,
        fields: 'name',
        supportsAllDrives: true,
      });
      const name = res.data.name ?? '(不明)';
      parentCache.set(parentId, name);
      return name;
    } catch (e) {
      const name = `(取得失敗: ${(e as Error).message})`;
      parentCache.set(parentId, name);
      return name;
    }
  }

  const sorted = [...files].sort((a, b) =>
    (a.createdTime ?? '').localeCompare(b.createdTime ?? '')
  );

  for (const f of sorted) {
    const parentId = f.parents?.[0];
    const parentName = parentId ? await resolveParentName(parentId) : '(親なし)';
    const hasClaim = !!f.appProperties?.[DOCSPLIT_FOLDER_CLAIM_KEY];
    console.log(
      `id=${f.id} name="${f.name}" createdTime=${f.createdTime} modifiedTime=${f.modifiedTime} ` +
        `trashed=${f.trashed} parent="${parentName}"(${parentId}) claimProperty=${hasClaim}`
    );
  }

  console.log('---');
  console.log(
    'claimProperty=true は Issue #871 claimプロトコル(files.create時にappPropertiesを刻む経路)経由で作成されたことを示す。' +
      'false の場合は claimプロトコル導入前の旧経路作成、または人間によるDrive上の手動作成のいずれか。'
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('エラー:', error);
    process.exit(1);
  });
