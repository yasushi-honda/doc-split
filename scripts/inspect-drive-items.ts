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

type MetaResult = { ok: true; file: drive_v3.Schema$File } | { ok: false; reason: string };

/** 404と一時エラー(429/5xx等)を区別する。リンク切れの判定に使うため、失敗理由をコード付きで返す。 */
async function meta(drive: drive_v3.Drive, id: string): Promise<MetaResult> {
  try {
    return { ok: true, file: (await drive.files.get({ fileId: id, fields: FIELDS, supportsAllDrives: true })).data };
  } catch (err) {
    return { ok: false, reason: describeErrorSafely(err) };
  }
}

/** 親をたどったID連鎖(自分を除く)。複数親は最初の親を辿り、複数親であること自体は別途表示する。 */
async function ancestry(drive: drive_v3.Drive, first: drive_v3.Schema$File): Promise<string> {
  const chain: string[] = [];
  let cur: drive_v3.Schema$File | null = first;
  for (let i = 0; i < MAX_DEPTH && cur?.parents?.[0]; i++) {
    chain.push(cur.parents[0]);
    const r: MetaResult = await meta(drive, cur.parents[0]);
    if (!r.ok) return `${chain.join(' > ')} > (途中で取得失敗: ${r.reason})`;
    cur = r.file;
  }
  return cur?.parents?.[0] ? `${chain.join(' > ')} > (${MAX_DEPTH}段で打ち切り)` : chain.join(' > ');
}

/** 複数親の項目は、最初の親以外も含めて全ての親IDを示す(統合対象の枝を見落とさないため)。 */
function parentsOf(f: drive_v3.Schema$File): string {
  const p = f.parents ?? [];
  return p.length > 1 ? `parents=${p.length}件(${p.join(',')})` : `parents=${p.length}件`;
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
    const r = await meta(drive, id);
    if (!r.ok) {
      console.log(`${id}: 取得不可(${r.reason})`);
      continue;
    }
    const m = r.file;
    console.log(`${id}: ${kind(m.mimeType)} trashed=${!!m.trashed} ${parentsOf(m)} 親の連鎖=[${await ancestry(drive, m)}]`);
    const t = m.shortcutDetails;
    if (t?.targetId) {
      const tr = await meta(drive, t.targetId);
      console.log(
        `  → 参照先 ${t.targetId}: ${kind(t.targetMimeType)} ` +
          (tr.ok
            ? `trashed=${!!tr.file.trashed} ${parentsOf(tr.file)} 親の連鎖=[${await ancestry(drive, tr.file)}]`
            : `取得不可(${tr.reason})`)
      );
    } else if (m.mimeType === 'application/vnd.google-apps.shortcut') {
      console.log('  → 参照先の情報が取得できませんでした(shortcutDetails無し)');
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('エラー:', describeErrorSafely(error));
    process.exit(1);
  });
