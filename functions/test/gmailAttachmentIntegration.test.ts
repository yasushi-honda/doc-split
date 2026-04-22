/**
 * checkGmailAttachments 統合テスト (Firebase emulator) - Issue #200 AC1/AC4
 *
 * PR #199 (Gmail 重複取得の根本対策) で導入された:
 *   - messageId based 早期 skip (gmailLogs collection)
 *   - isSplitSource=true の場合の再取り込み許可ロジック (documents collection)
 * を Firestore 実クエリで検証する。
 *
 * 方式: 既存 ocrRetryIntegration.test.ts の「ロジック再現型」パターンを踏襲する。
 * checkGmailAttachments wrapper の内部 helper は非公開であり、Gmail API の mock は
 * コストが高いため、source と同一の Firestore query/write pattern を test 内で再現し、
 * 結果の分岐 (skip vs 処理対象 / duplicate vs re-import) を assert する。
 *
 * 実行: firebase emulators:exec --only firestore --project gmail-attachment-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['gmailLogs', 'documents', 'uploadLogs'];

// checkGmailAttachments.ts の messageId skip ロジックを再現
async function isAlreadyProcessedByMessageId(messageId: string): Promise<boolean> {
  const existing = await db
    .collection('gmailLogs')
    .where('messageId', '==', messageId)
    .limit(1)
    .get();
  return !existing.empty;
}

// checkGmailAttachments.ts の hash 重複 + isSplitSource 再取り込み許可ロジックを再現
// 戻り値:
//   'new'      = hash 未登録 (新規処理対象)
//   'skip'     = fileUrl 欠損 or 1 件以上のアクティブ doc (isSplitSource != true) 存在
//   'reimport' = fileUrl あり + アクティブ doc ゼロ (全て split source or 関連 doc なし)
async function shouldSkipByHashDuplicate(
  hash: string
): Promise<'skip' | 'reimport' | 'new'> {
  const [existingGmailLog, existingUploadLog] = await Promise.all([
    db.collection('gmailLogs').where('hash', '==', hash).limit(1).get(),
    db.collection('uploadLogs').where('hash', '==', hash).limit(1).get(),
  ]);

  if (existingGmailLog.empty && existingUploadLog.empty) return 'new';

  const existingLog = !existingGmailLog.empty
    ? existingGmailLog.docs[0]
    : existingUploadLog.docs[0];
  const existingFileUrl = existingLog?.data().fileUrl as string | undefined;

  if (!existingFileUrl) return 'skip';

  const relatedDocs = await db
    .collection('documents')
    .where('fileUrl', '==', existingFileUrl)
    .get();

  const hasActiveDocs = relatedDocs.docs.some((doc) => !doc.data().isSplitSource);
  return hasActiveDocs ? 'skip' : 'reimport';
}

describe('checkGmailAttachments 統合テスト (#200)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  describe('AC1: messageId based 早期 skip', () => {
    it('既存 gmailLog あり (同一 messageId) → skip=true', async () => {
      const messageId = 'msg-duplicate-001';
      await db.collection('gmailLogs').add({
        messageId,
        fileName: 'existing.pdf',
        hash: 'hash-abc',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const skip = await isAlreadyProcessedByMessageId(messageId);
      expect(skip).to.equal(true);
    });

    it('既存 gmailLog なし (新規 messageId) → skip=false', async () => {
      const skip = await isAlreadyProcessedByMessageId('msg-new-001');
      expect(skip).to.equal(false);
    });

    it('異なる messageId が混在 → 対象の messageId のみ skip', async () => {
      await db.collection('gmailLogs').add({
        messageId: 'msg-existing-A',
        fileName: 'a.pdf',
        hash: 'hash-a',
      });
      await db.collection('gmailLogs').add({
        messageId: 'msg-existing-B',
        fileName: 'b.pdf',
        hash: 'hash-b',
      });

      const skipA = await isAlreadyProcessedByMessageId('msg-existing-A');
      const skipB = await isAlreadyProcessedByMessageId('msg-existing-B');
      const skipC = await isAlreadyProcessedByMessageId('msg-new-C');

      expect(skipA).to.equal(true);
      expect(skipB).to.equal(true);
      expect(skipC).to.equal(false);
    });
  });

  describe('AC4: isSplitSource=true 再取り込み許可', () => {
    it('関連 documents が全て isSplitSource=true → 再取り込み許可 (reimport)', async () => {
      const hash = 'hash-split-all';
      const fileUrl = 'gs://bucket/original/1700000000_all-split.pdf';

      await db.collection('gmailLogs').add({
        messageId: 'msg-A',
        fileName: 'all-split.pdf',
        hash,
        fileUrl,
      });
      await db.collection('documents').add({
        fileUrl,
        isSplitSource: true,
        status: 'split',
      });
      await db.collection('documents').add({
        fileUrl,
        isSplitSource: true,
        status: 'split',
      });

      const verdict = await shouldSkipByHashDuplicate(hash);
      expect(verdict).to.equal('reimport');
    });

    it('関連 documents にアクティブ (isSplitSource=false or 未設定) あり → skip', async () => {
      const hash = 'hash-mixed';
      const fileUrl = 'gs://bucket/original/1700000000_mixed.pdf';

      await db.collection('gmailLogs').add({
        messageId: 'msg-B',
        fileName: 'mixed.pdf',
        hash,
        fileUrl,
      });
      // 1件はアクティブ (isSplitSource 未設定)
      await db.collection('documents').add({
        fileUrl,
        status: 'processed',
      });
      // もう1件は分割元
      await db.collection('documents').add({
        fileUrl,
        isSplitSource: true,
        status: 'split',
      });

      const verdict = await shouldSkipByHashDuplicate(hash);
      expect(verdict).to.equal('skip');
    });

    it('関連 documents が 1 件も存在しない + fileUrl あり → 再取り込み許可', async () => {
      // hasActiveDocs は some() なので、空配列では false を返す。
      // 既存 fileUrl に紐づくドキュメントが 1 件もない状態 = 全削除後などは reimport。
      const hash = 'hash-no-docs';
      const fileUrl = 'gs://bucket/original/1700000000_no-docs.pdf';

      await db.collection('gmailLogs').add({
        messageId: 'msg-C',
        fileName: 'no-docs.pdf',
        hash,
        fileUrl,
      });

      const verdict = await shouldSkipByHashDuplicate(hash);
      expect(verdict).to.equal('reimport');
    });

    it('既存 log に fileUrl が欠損 → 従来通り skip (後方互換性)', async () => {
      const hash = 'hash-no-fileurl';
      await db.collection('gmailLogs').add({
        messageId: 'msg-D',
        fileName: 'legacy.pdf',
        hash,
        // fileUrl 未設定 (古いレコード想定)
      });

      const verdict = await shouldSkipByHashDuplicate(hash);
      expect(verdict).to.equal('skip');
    });

    it('hash 一致がない → new (新規処理)', async () => {
      const verdict = await shouldSkipByHashDuplicate('hash-unknown');
      expect(verdict).to.equal('new');
    });

    it('uploadLogs 側の hash 一致でも同じ判定', async () => {
      const hash = 'hash-uploadlogs';
      const fileUrl = 'gs://bucket/uploaded/file.pdf';

      await db.collection('uploadLogs').add({
        fileName: 'uploaded.pdf',
        hash,
        fileUrl,
      });
      await db.collection('documents').add({
        fileUrl,
        status: 'processed',
      });

      const verdict = await shouldSkipByHashDuplicate(hash);
      expect(verdict).to.equal('skip');
    });
  });
});
