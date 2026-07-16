/**
 * gmailLogs/uploadLogs delete safety net(functions/src/documents/sourceLogDeletionGuard.ts)
 * integration テスト(kanameone現場要件「複数顧客FAX複製機能」、GOAL.md 5-4、Firestore emulator)
 *
 * 実行: firebase emulators:exec --only firestore --project source-log-deletion-guard-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { canSafelyDeleteSourceLog } from '../src/documents/sourceLogDeletionGuard';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents'];

describe('canSafelyDeleteSourceLog (複数顧客FAX複製機能 gmailLogs/uploadLogs 削除ガード)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('自分自身のみが同一fileIdを参照 → canDelete: true', async () => {
    await db.collection('documents').doc('doc-self').set({ fileId: 'file-1', sourceType: 'gmail' });

    const result = await canSafelyDeleteSourceLog(db, 'file-1', 'doc-self');
    expect(result.canDelete).to.equal(true);
  });

  it('参照docが存在しない(自分自身も未書込) → canDelete: true', async () => {
    const result = await canSafelyDeleteSourceLog(db, 'file-nonexistent', 'doc-self');
    expect(result.canDelete).to.equal(true);
  });

  it('同一fileIdを参照する他docが存在 → canDelete: false(複製兄弟doc、AC-h)', async () => {
    await db.collection('documents').doc('doc-original').set({ fileId: 'file-1', sourceType: 'gmail' });
    await db.collection('documents').doc('doc-copy').set({ fileId: 'file-1', sourceType: 'gmail' });

    const result = await canSafelyDeleteSourceLog(db, 'file-1', 'doc-original');
    expect(result.canDelete).to.equal(false);
    expect(result.sharingDocCountUpTo2).to.equal(2);
  });

  it('sourceTypeが異なる(gmail/upload)docが同一fileIdを参照していてもcanDelete: false(CodeRabbit指摘: sourceType複合キー絞り込みでの検知漏れ回帰防止)', async () => {
    await db.collection('documents').doc('doc-gmail').set({ fileId: 'file-1', sourceType: 'gmail' });
    await db.collection('documents').doc('doc-upload').set({ fileId: 'file-1', sourceType: 'upload' });

    const result = await canSafelyDeleteSourceLog(db, 'file-1', 'doc-gmail');
    expect(result.canDelete).to.equal(false);
  });

  it('sourceType未設定(legacy doc)の兄弟が同一fileIdを参照していてもcanDelete: false(CodeRabbit指摘: legacy doc検知漏れ回帰防止)', async () => {
    await db.collection('documents').doc('doc-current').set({ fileId: 'file-1', sourceType: 'gmail' });
    await db.collection('documents').doc('doc-legacy-sibling').set({ fileId: 'file-1' });

    const result = await canSafelyDeleteSourceLog(db, 'file-1', 'doc-current');
    expect(result.canDelete).to.equal(false);
  });

  it('sourceType未設定(legacy doc)同士はfileIdのみで照合される', async () => {
    await db.collection('documents').doc('doc-legacy-1').set({ fileId: 'file-legacy' });
    await db.collection('documents').doc('doc-legacy-2').set({ fileId: 'file-legacy' });

    const result = await canSafelyDeleteSourceLog(db, 'file-legacy', 'doc-legacy-1');
    expect(result.canDelete).to.equal(false);
  });

  it('単独参照のdocはcanDelete: true', async () => {
    await db.collection('documents').doc('doc-solo').set({ fileId: 'file-solo' });

    const result = await canSafelyDeleteSourceLog(db, 'file-solo', 'doc-solo');
    expect(result.canDelete).to.equal(true);
  });
});
