/**
 * 同一docIdのファイルが親フォルダに2件ある状態(AmbiguousFileError)の判定ロジック(純粋関数)
 *
 * `scripts/resolve-drive-duplicate-file.ts` が使う。誤って正規のファイルをゴミ箱へ移さないよう、
 * 「残す側の推奨」と「ゴミ箱へ移す指定の妥当性」をここに集約してテストする。
 */

/** 重複ファイル1件分の情報。ファイル名は扱わない(氏名を含むため、PII対策)。 */
export interface DuplicateFileInfo {
  id: string;
  createdTime?: string | null;
  size?: string | null;
  md5Checksum?: string | null;
}

export interface KeepRecommendation {
  keepId: string;
  trashId: string;
  basis: 'doc-driveFileId';
}

/**
 * 書類側が記録しているdriveFileId(正規の保存先)と一致する1件を残す側として推奨する。
 * 重複がちょうど2件で、そのどちらかが書類のdriveFileIdと一致する場合のみ推奨し、
 * それ以外(driveFileIdが空・どちらにも一致しない・3件以上)は人が判断する。
 */
export function recommendKeep(
  files: DuplicateFileInfo[],
  docDriveFileId: string | null | undefined
): KeepRecommendation | null {
  if (files.length !== 2 || !docDriveFileId) return null;
  const keep = files.find((x) => x.id === docDriveFileId);
  if (!keep) return null;
  const trash = files.find((x) => x.id !== docDriveFileId);
  if (!trash) return null;
  return { keepId: keep.id, trashId: trash.id, basis: 'doc-driveFileId' };
}

/**
 * ゴミ箱へ移す指定の妥当性。重複がちょうど2件で、keepとtrashが異なり、どちらも重複一覧に
 * 含まれる場合のみ許可する(一覧に無いIDや、3件以上の重複では実行しない)。
 */
export function validateTrashRequest(
  files: DuplicateFileInfo[],
  keepId: string,
  trashId: string
): { ok: true } | { ok: false; reason: string } {
  if (files.length !== 2) return { ok: false, reason: `重複がちょうど2件ではありません(${files.length}件)` };
  if (keepId === trashId) return { ok: false, reason: 'keepとtrashが同じIDです' };
  const ids = new Set(files.map((x) => x.id));
  if (!ids.has(keepId)) return { ok: false, reason: 'keepIdが重複一覧にありません' };
  if (!ids.has(trashId)) return { ok: false, reason: 'trashIdが重複一覧にありません' };
  return { ok: true };
}
