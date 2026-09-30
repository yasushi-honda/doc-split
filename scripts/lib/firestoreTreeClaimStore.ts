/**
 * `TreeMergeClaimStore`の本番実装(Firestore `driveFolderLocks` + `settings/features`)。
 *
 * functions側のclaim関数はDIで受ける(scriptsからfunctionsをstatic importしない既存規約。
 * CLIでは動的importして渡し、emulator統合テストでは実関数を渡す)。
 *
 * countClaimsReferencingは、Firestoreの`in`上限(30)でチャンク化し、`parentId`・`folderId`の
 * 両方を単一フィールド問い合わせで数える(複合indexが無い環境でも動く)。
 */

import type * as admin from 'firebase-admin';
import type { TreeMergeClaimStore } from './folderTreeMerge';

export interface ClaimFunctions {
  FOLDER_LOCKS_COLLECTION: string;
  buildFolderLockId: (parentId: string, name: string) => string;
  isDriveFolderClaimReadEnabled: (db: admin.firestore.Firestore) => Promise<boolean>;
  resolveDivergentClaim: (
    firestore: admin.firestore.Firestore,
    parentId: string,
    name: string,
    fence: {
      expectedFolderId?: string;
      expectedDivergentReason: string;
      expectedUpdateTimeMs: number;
      actor: string;
    },
    mode: 'restore-expected' | 'finalize-resolved'
  ) => Promise<{ outcome: 'resolved' } | { outcome: 'no-op'; reason: string }>;
}

/** Firestore `in`演算子の要素数上限。 */
export const FIRESTORE_IN_LIMIT = 30;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildFirestoreClaimStore(
  firestore: admin.firestore.Firestore,
  fns: ClaimFunctions
): TreeMergeClaimStore {
  const col = firestore.collection(fns.FOLDER_LOCKS_COLLECTION);
  const countBy = async (field: 'parentId' | 'folderId', ids: string[]): Promise<number> => {
    let total = 0;
    for (const part of chunk(ids, FIRESTORE_IN_LIMIT)) {
      const snap = await col.where(field, 'in', part).count().get();
      total += snap.data().count;
    }
    return total;
  };

  return {
    async readRootClaim(parentId, name) {
      const snap = await col.doc(fns.buildFolderLockId(parentId, name)).get();
      if (!snap.exists || !snap.updateTime) return null;
      const data = snap.data() as { state?: string; folderId?: string; divergentReason?: string };
      return {
        state: data.state ?? 'unknown',
        folderId: data.folderId,
        divergentReason: data.divergentReason,
        updateTimeMs: snap.updateTime.toMillis(),
      };
    },
    isClaimReadEnabled: () => fns.isDriveFolderClaimReadEnabled(firestore),
    async countClaimsReferencing(folderIds) {
      return {
        byParentId: await countBy('parentId', folderIds),
        byFolderId: await countBy('folderId', folderIds),
      };
    },
    async hasClaim(parentId, name) {
      const snap = await col.doc(fns.buildFolderLockId(parentId, name)).get();
      return snap.exists;
    },
    finalizeResolved(parentId, name, fence) {
      return fns.resolveDivergentClaim(firestore, parentId, name, fence, 'finalize-resolved');
    },
  };
}
