/**
 * 複製配信メンバー間の削除順序不変性 integration テスト
 * (kanameone現場要件「複数顧客FAX複製機能」、GOAL.md AC-h、Firestore emulator)
 *
 * 元doc→コピー、コピー→元のどちらの削除順序でも、Storage実体(canSafelyDeleteStorageFile)と
 * gmailLogs/uploadLogs(canSafelyDeleteSourceLog、5-4で追加)が最後の1件の削除まで残ること
 * (誤って生きているdocの実体を削除してしまわないこと)を検証する。deleteDocument.ts自体は
 * onCall + 実Storageバケットに依存し直接呼び出せないため、実際に使われている2つのガード
 * 関数を、実際のdeleteDocument.tsの呼出し順序(Storage削除→gmailLogs/uploadLogs削除→
 * documents削除)を模して両順序で駆動する。
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { canSafelyDeleteStorageFile } from '../src/storage/storageDeletionGuard';
import { canSafelyDeleteSourceLog } from '../src/documents/sourceLogDeletionGuard';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'gmailLogs'];

const SHARED_FILE_URL = 'gs://bucket/multi-customer-fax.pdf';
const SHARED_FILE_ID = 'gmail-msg-shared-1';
const SOURCE_TYPE = 'gmail';

/**
 * deleteDocument.ts と同じ判定+削除の手順を模す(Storage実体は判定のみ、実バケット操作は
 * emulatorでは行わない。gmailLogs/documentsは実際にFirestoreへ削除を反映する)。
 */
async function deleteMember(docId: string): Promise<{ storageDeleted: boolean; logDeleted: boolean }> {
  const storageGuard = await canSafelyDeleteStorageFile(db, SHARED_FILE_URL, docId);
  const logGuard = await canSafelyDeleteSourceLog(db, SOURCE_TYPE, SHARED_FILE_ID, docId);

  if (logGuard.canDelete) {
    await db.collection('gmailLogs').doc(SHARED_FILE_ID).delete();
  }

  const batch = db.batch();
  batch.delete(db.doc(`documents/${docId}/detail/main`));
  batch.delete(db.doc(`documents/${docId}`));
  await batch.commit();

  return { storageDeleted: storageGuard.canDelete, logDeleted: logGuard.canDelete };
}

async function seedDistributionPair(): Promise<void> {
  await db.collection('documents').doc('orig-doc').set({
    fileUrl: SHARED_FILE_URL,
    fileId: SHARED_FILE_ID,
    sourceType: SOURCE_TYPE,
    distributionId: 'orig-doc',
  });
  await db.collection('documents').doc('copy-doc').set({
    fileUrl: SHARED_FILE_URL,
    fileId: SHARED_FILE_ID,
    sourceType: SOURCE_TYPE,
    distributionId: 'orig-doc',
  });
  await db.collection('gmailLogs').doc(SHARED_FILE_ID).set({ processedAt: Date.now() });
}

describe('複製配信メンバー間の削除順序不変性 (GOAL.md AC-h)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('元doc→コピーの順で削除しても、1件目ではStorage/gmailLogsが残り、2件目(最後)で削除される', async () => {
    await seedDistributionPair();

    const firstResult = await deleteMember('orig-doc');
    expect(firstResult.storageDeleted, '1件目削除時点ではcopy-docが残っているためStorageは削除されない').to.equal(false);
    expect(firstResult.logDeleted, '1件目削除時点ではcopy-docが残っているためgmailLogsは削除されない').to.equal(false);

    const logAfterFirst = await db.collection('gmailLogs').doc(SHARED_FILE_ID).get();
    expect(logAfterFirst.exists, '1件目削除後もgmailLogsは実際に残っていること').to.equal(true);

    const secondResult = await deleteMember('copy-doc');
    expect(secondResult.storageDeleted, '最後の1件を削除する時はStorageが削除可能と判定される').to.equal(true);
    expect(secondResult.logDeleted, '最後の1件を削除する時はgmailLogsが削除可能と判定される').to.equal(true);

    const logAfterSecond = await db.collection('gmailLogs').doc(SHARED_FILE_ID).get();
    expect(logAfterSecond.exists, '最後の1件の削除でgmailLogsも実際に削除されること').to.equal(false);
  });

  it('コピー→元docの順で削除しても、1件目ではStorage/gmailLogsが残り、2件目(最後)で削除される(順序対称性)', async () => {
    await seedDistributionPair();

    const firstResult = await deleteMember('copy-doc');
    expect(firstResult.storageDeleted, '1件目削除時点ではorig-docが残っているためStorageは削除されない').to.equal(false);
    expect(firstResult.logDeleted, '1件目削除時点ではorig-docが残っているためgmailLogsは削除されない').to.equal(false);

    const logAfterFirst = await db.collection('gmailLogs').doc(SHARED_FILE_ID).get();
    expect(logAfterFirst.exists, '1件目削除後もgmailLogsは実際に残っていること').to.equal(true);

    const secondResult = await deleteMember('orig-doc');
    expect(secondResult.storageDeleted, '最後の1件を削除する時はStorageが削除可能と判定される').to.equal(true);
    expect(secondResult.logDeleted, '最後の1件を削除する時はgmailLogsが削除可能と判定される').to.equal(true);

    const logAfterSecond = await db.collection('gmailLogs').doc(SHARED_FILE_ID).get();
    expect(logAfterSecond.exists, '最後の1件の削除でgmailLogsも実際に削除されること').to.equal(false);
  });
});
