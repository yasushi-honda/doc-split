#!/usr/bin/env ts-node
/**
 * Driveの項目(ファイル・フォルダ・ショートカット)の実体調査(read-only)
 *
 * 再帰統合plan(plan-drive-folder-tree-merge)の阻害要因(ショートカット・複数親など)について、
 * その項目が何で、どこにあり、(ショートカットなら)何を指しているかを確認する。書き込みAPIは呼ばない。
 *
 * 出力: 各IDについて種別・trashed・親の数と親の連鎖(rootへ向かって最大MAX_DEPTH段)、
 * ショートカットなら参照先のID・種別・trashed・親の連鎖。
 * PII対策: フォルダ名・ファイル名は出力しない(IDと種別のみ)。Drive APIのエラー文言も出さない。
 *
 * 使用方法(GitHub Actions: Run Operations Script):
 *   script=inspect-drive-items / exec_args_json={"ids":["<id1>","<id2>"]}
 */

import * as admin from 'firebase-admin';
import type { drive_v3 } from 'googleapis';
import { describeErrorSafely } from './lib/confirmedReplayStats';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}
const idx = process.argv.indexOf('--ids');
const idsArg = idx >= 0 ? process.argv[idx + 1] : undefined;
if (!idsArg || !/^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$/.test(idsArg)) {
  console.error('--ids <id1,id2,...> (英数字・-・_のみ)は必須です');
  process.exit(1);
}
const ids = idsArg.split(',');
const MAX_DEPTH = 12;

admin.initializeApp({ projectId });

const FIELDS = 'id,mimeType,trashed,parents,shortcutDetails(targetId,targetMimeType)';

async function meta(drive: drive_v3.Drive, id: string): Promise<drive_v3.Schema$File | null> {
  try {
    return (await drive.files.get({ fileId: id, fields: FIELDS, supportsAllDrives: true })).data;
  } catch {
    return null;
  }
}

/** 親をたどったID連鎖(自分を除く)。複数親は最初の親を辿り、複数親であること自体は別途表示する。 */
async function ancestry(drive: drive_v3.Drive, first: drive_v3.Schema$File): Promise<string[]> {
  const chain: string[] = [];
  let cur: drive_v3.Schema$File | null = first;
  for (let i = 0; i < MAX_DEPTH && cur?.parents?.[0]; i++) {
    chain.push(cur.parents[0]);
    cur = await meta(drive, cur.parents[0]);
  }
  return chain;
}

function kind(mime?: string | null): string {
  if (mime === 'application/vnd.google-apps.folder') return 'folder';
  if (mime === 'application/vnd.google-apps.shortcut') return 'shortcut';
  return `file(${mime ?? '?'})`;
}

async function main(): Promise<void> {
  const { getDriveClient } = await import('../functions/src/utils/driveAuth');
  const drive = await getDriveClient();
  for (const id of ids) {
    const m = await meta(drive, id);
    if (!m) {
      console.log(`${id}: 取得不可(404または権限なし)`);
      continue;
    }
    console.log(
      `${id}: ${kind(m.mimeType)} trashed=${!!m.trashed} parents=${(m.parents ?? []).length}件 ` +
        `親の連鎖=[${(await ancestry(drive, m)).join(' > ')}]`
    );
    const t = m.shortcutDetails;
    if (t?.targetId) {
      const tm = await meta(drive, t.targetId);
      console.log(
        `  → 参照先 ${t.targetId}: ${kind(t.targetMimeType)} ` +
          (tm
            ? `trashed=${!!tm.trashed} parents=${(tm.parents ?? []).length}件 親の連鎖=[${(await ancestry(drive, tm)).join(' > ')}]`
            : '取得不可(404または権限なし)')
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('エラー:', describeErrorSafely(error));
    process.exit(1);
  });
