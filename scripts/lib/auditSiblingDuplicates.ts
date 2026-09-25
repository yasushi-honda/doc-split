/**
 * Issue #1039恒久対応: `scripts/audit-drive-sibling-duplicates.ts`のmain()に直接実装されて
 * いたコアロジック(BFS走査+兄弟重複グループ化+分類)を、fake Drive(emulator不要)で
 * unit test可能な形に切り出したもの。firebase-admin(Firestore)には一切依存しない
 * (settings読込・スコープゲート・rootメタ確認・Plan組立/書出しは呼び出し元のCLIに残す)。
 * 挙動(Drive呼出しの順序・引数・グルーピングロジック)は元の
 * `audit-drive-sibling-duplicates.ts`から一切変更していない、純粋な抽出リファクタ。
 */

import type { drive_v3 } from 'googleapis';
import {
  buildGroupId,
  type FolderSnapshot,
  type SiblingGroup,
} from './siblingDuplicatePlanTypes';
import { classifySiblingGroup } from './siblingDuplicateClassifier';

export interface AuditSiblingDuplicatesDeps {
  drive: drive_v3.Drive;
  rootFolderId: string;
  rootName: string;
  folderMimeType: string;
  claimKey: string;
}

export interface ScanSiblingDuplicatesResult {
  scannedFolderCount: number;
  groups: SiblingGroup[];
}

interface RawChild {
  id: string;
  name: string;
  mimeType: string;
  trashed: boolean;
  modifiedTime: string;
  appProperties: Record<string, string> | null;
}

interface QueueItem {
  folderId: string;
  path: string;
}

async function listChildren(drive: drive_v3.Drive, parentId: string): Promise<RawChild[]> {
  const files: RawChild[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,name,mimeType,trashed,modifiedTime,appProperties)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      if (!f.id || !f.name || !f.mimeType || !f.modifiedTime) continue;
      files.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        trashed: !!f.trashed,
        modifiedTime: f.modifiedTime,
        appProperties: (f.appProperties as Record<string, string> | undefined) ?? null,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

export async function scanSiblingDuplicates(deps: AuditSiblingDuplicatesDeps): Promise<ScanSiblingDuplicatesResult> {
  // 発見済みフォルダの一覧(parentId+nameでの兄弟重複検出用)。childFolderCount/
  // childFileCountは、そのフォルダ自身がBFSでdequeueされ子要素を列挙した時点で
  // 別途pathCountsへ記録し、走査完了後にマージする(自分の子要素数は自分が
  // 発見された時点ではまだ分からないため)。
  const discovered: Array<{
    id: string;
    parentId: string;
    name: string;
    trashed: boolean;
    modifiedTime: string;
    hasClaimTag: boolean;
    path: string;
  }> = [];
  const counts = new Map<string, { childFolderCount: number; childFileCount: number }>();

  let scannedFolderCount = 0;
  const queue: QueueItem[] = [{ folderId: deps.rootFolderId, path: deps.rootName }];
  const visited = new Set<string>([deps.rootFolderId]);

  while (queue.length > 0) {
    const { folderId, path } = queue.shift()!;
    scannedFolderCount += 1;
    const children = await listChildren(deps.drive, folderId);

    let childFolderCount = 0;
    let childFileCount = 0;
    for (const child of children) {
      if (child.mimeType === deps.folderMimeType) {
        childFolderCount += 1;
        if (!visited.has(child.id)) {
          visited.add(child.id);
          const childPath = `${path}/${child.name}`;
          discovered.push({
            id: child.id,
            parentId: folderId,
            name: child.name,
            trashed: child.trashed,
            modifiedTime: child.modifiedTime,
            hasClaimTag: !!child.appProperties?.[deps.claimKey],
            path: childPath,
          });
          queue.push({ folderId: child.id, path: childPath });
        }
      } else {
        childFileCount += 1;
      }
    }
    counts.set(folderId, { childFolderCount, childFileCount });
  }

  const folderSnapshots: FolderSnapshot[] = discovered.map((d) => ({
    id: d.id,
    parentId: d.parentId,
    name: d.name,
    trashed: d.trashed,
    modifiedTime: d.modifiedTime,
    hasClaimTag: d.hasClaimTag,
    childFolderCount: counts.get(d.id)?.childFolderCount ?? 0,
    childFileCount: counts.get(d.id)?.childFileCount ?? 0,
  }));
  const pathById = new Map(discovered.map((d) => [d.id, d.path]));

  // parentId+nameでグループ化(activeフォルダのみ対象。trashedは対象外)。
  const byKey = new Map<string, FolderSnapshot[]>();
  for (const snap of folderSnapshots) {
    if (snap.trashed) continue;
    const key = buildGroupId(snap.parentId, snap.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(snap);
  }

  const groups: SiblingGroup[] = [];
  for (const [key, folders] of byKey.entries()) {
    if (folders.length < 2) continue;
    const classified = classifySiblingGroup(folders);
    const parentPath = pathById.get(folders[0].parentId) ?? '(root)';
    groups.push({
      groupId: key,
      parentId: folders[0].parentId,
      parentPath,
      name: folders[0].name,
      folders,
      action: classified.action,
      reason: classified.reason,
      canonicalFolderId: classified.canonicalFolderId,
      duplicateFolderId: classified.duplicateFolderId,
    });
  }

  return { scannedFolderCount, groups };
}
