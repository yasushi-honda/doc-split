/**
 * 2つのDriveフォルダの直下ファイルを照合する純関数(read-only診断用)
 *
 * 用途: audit-drive-sibling-duplicatesがmanual-review(タグ無し2件)とした重複フォルダ組で、
 * 片方にしか無いファイルがあるか(=統合で失われうるデータがあるか)を判断する材料を出す。
 *
 * 照合キー: md5Checksumがあればmd5(名前が違っても内容一致なら同一)、無ければ
 * 名前+mimeType(Googleドキュメント形式などmd5を持たないもの)。同一キーは多重度で対応付ける。
 *
 * PII対策: 戻り値は件数のみ。ファイル名は一切含めない(利用者名・書類種別を含みうるため、
 * GitHub Actionsのartifact/ログに残さない)。
 */

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface FolderChild {
  name: string;
  mimeType: string;
  md5Checksum?: string | null;
}

export interface FolderCompareResult {
  aFileCount: number;
  bFileCount: number;
  aChildFolderCount: number;
  bChildFolderCount: number;
  /** 両方に存在(多重度考慮) */
  both: number;
  onlyA: number;
  onlyB: number;
  matchedByMd5: number;
  matchedByNameAndMime: number;
}

type KeyKind = 'md5' | 'name';

function keyOf(child: FolderChild): { key: string; kind: KeyKind } {
  if (child.md5Checksum) return { key: `md5:${child.md5Checksum}`, kind: 'md5' };
  // JSON.stringifyで区切り文字衝突を避ける(名前に'|'が含まれても別キーにならない)
  return { key: `name:${JSON.stringify([child.name, child.mimeType])}`, kind: 'name' };
}

function countByKey(files: FolderChild[]): Map<string, { count: number; kind: KeyKind }> {
  const m = new Map<string, { count: number; kind: KeyKind }>();
  for (const f of files) {
    const { key, kind } = keyOf(f);
    const cur = m.get(key);
    if (cur) cur.count += 1;
    else m.set(key, { count: 1, kind });
  }
  return m;
}

export function compareFolderChildren(a: FolderChild[], b: FolderChild[]): FolderCompareResult {
  const aFiles = a.filter((c) => c.mimeType !== FOLDER_MIME_TYPE);
  const bFiles = b.filter((c) => c.mimeType !== FOLDER_MIME_TYPE);
  const aMap = countByKey(aFiles);
  const bMap = countByKey(bFiles);

  let both = 0;
  let matchedByMd5 = 0;
  let matchedByNameAndMime = 0;
  for (const [key, av] of aMap) {
    const bv = bMap.get(key);
    if (!bv) continue;
    const matched = Math.min(av.count, bv.count);
    both += matched;
    if (av.kind === 'md5') matchedByMd5 += matched;
    else matchedByNameAndMime += matched;
  }

  return {
    aFileCount: aFiles.length,
    bFileCount: bFiles.length,
    aChildFolderCount: a.length - aFiles.length,
    bChildFolderCount: b.length - bFiles.length,
    both,
    onlyA: aFiles.length - both,
    onlyB: bFiles.length - both,
    matchedByMd5,
    matchedByNameAndMime,
  };
}

export type CompareCaveat = 'weak-match' | 'has-child-folders';

/**
 * 「onlyB=0 でも B に固有データが無いとは言い切れない」理由を示す警告コードを返す。
 * - weak-match: md5を持たないファイル(Googleドキュメント等)を名前+mimeTypeだけで一致扱いにしており、
 *   内容が同一かは未検証
 * - has-child-folders: 子フォルダの中身は照合していない(件数のみ)
 * 警告が空でない組は、統合可否の判断前に人が中身を確認すること。
 */
export function deriveCaveats(r: FolderCompareResult): CompareCaveat[] {
  const caveats: CompareCaveat[] = [];
  if (r.matchedByNameAndMime > 0) caveats.push('weak-match');
  if (r.aChildFolderCount + r.bChildFolderCount > 0) caveats.push('has-child-folders');
  return caveats;
}
