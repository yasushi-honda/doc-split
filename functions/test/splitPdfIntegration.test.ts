/**
 * splitPdf 統合テスト (Firebase emulator) - Issue #200 AC3
 *
 * PR #199 で splitPdf が元ドキュメントに付与するようになった `isSplitSource: true` フラグと、
 * AC4 側 (checkGmailAttachments の再取り込み許可判定) のハンドシェイクを保証する。
 *
 * 方式: Gmail/Storage/pdf-lib の副作用は本テスト scope 外。splitPdf 末尾の元ドキュメント
 * update (`splitInto` / `status:'split'` / `isSplitSource:true`) を trx で再現し、
 *   - 指定されたキー集合のみ更新されること (CLAUDE.md MUST: Partial Update 不変契約)
 *   - AC4 のクエリ (fileUrl 一致 + isSplitSource=true) に元ドキュメントがヒットしないこと
 *     (元ドキュメントは split source として「アクティブではない」扱いになる)
 * を assert する。
 *
 * 実行: firebase emulators:exec --only firestore --project split-pdf-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents'];

// src/pdf/pdfOperations.ts の splitPdf 内、
//   docRef.update({ splitInto, status: 'split', isSplitSource: true })
// と同等の書き込み (3 フィールド、これ以外を触らない Partial Update 契約)
async function markParentAsSplitSource(
  docRef: admin.firestore.DocumentReference,
  createdDocIds: string[]
): Promise<void> {
  await docRef.update({
    splitInto: createdDocIds,
    status: 'split',
    isSplitSource: true,
  });
}

describe('splitPdf 統合テスト (#200 AC3)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('元ドキュメントに splitInto / status:split / isSplitSource:true のみが追加される', async () => {
    const docId = 'split-parent-001';
    const originalData = {
      fileName: 'original.pdf',
      fileUrl: 'gs://bucket/original/1700000000_parent.pdf',
      mimeType: 'application/pdf',
      totalPages: 10,
      status: 'processed',
      customerName: '山田太郎',
      officeName: '事業所A',
      documentType: '請求書',
    };
    await db.doc(`documents/${docId}`).set(originalData);

    const createdIds = ['child-A', 'child-B'];
    await markParentAsSplitSource(db.doc(`documents/${docId}`), createdIds);

    const snap = await db.doc(`documents/${docId}`).get();
    const data = snap.data()!;

    // 追加された 3 フィールドが期待値
    expect(data.splitInto).to.deep.equal(createdIds);
    expect(data.status).to.equal('split');
    expect(data.isSplitSource).to.equal(true);

    // 更新対象外フィールドが不変 (CLAUDE.md MUST: Partial Update の不変契約)
    expect(data.fileName).to.equal('original.pdf');
    expect(data.fileUrl).to.equal('gs://bucket/original/1700000000_parent.pdf');
    expect(data.mimeType).to.equal('application/pdf');
    expect(data.totalPages).to.equal(10);
    expect(data.customerName).to.equal('山田太郎');
    expect(data.officeName).to.equal('事業所A');
    expect(data.documentType).to.equal('請求書');
  });

  it('AC4 ハンドシェイク: 元ドキュメントは isSplitSource=true で「アクティブ」扱いされない', async () => {
    // splitPdf 後に checkGmailAttachments が同一 fileUrl に対して再取り込み可否を判定する想定。
    // 子ドキュメントがないケース (= 元のみ存在) でも、isSplitSource=true が付いているため
    // AC4 のクエリ上は hasActiveDocs=false と評価されるべき。
    const fileUrl = 'gs://bucket/original/1700000001_handshake.pdf';
    const parentRef = db.collection('documents').doc();
    await parentRef.set({
      fileName: 'original.pdf',
      fileUrl,
      status: 'processed',
    });
    await markParentAsSplitSource(parentRef, ['child-X']);

    // AC4 の hasActiveDocs 判定を再現
    const related = await db
      .collection('documents')
      .where('fileUrl', '==', fileUrl)
      .get();
    const hasActiveDocs = related.docs.some((doc) => !doc.data().isSplitSource);

    expect(related.size).to.equal(1);
    expect(hasActiveDocs).to.equal(false);
  });

  it('子ドキュメント (アクティブ) が同 fileUrl を共有すると hasActiveDocs=true になる (negative guard)', async () => {
    // 子ドキュメントは通常別 fileUrl (processed/ prefix) を持つため本来発生しないが、
    // クエリ契約を明示するために negative case を lock-in しておく。
    const fileUrl = 'gs://bucket/original/1700000002_negative.pdf';
    const parentRef = db.collection('documents').doc();
    await parentRef.set({
      fileName: 'original.pdf',
      fileUrl,
      status: 'processed',
    });
    await markParentAsSplitSource(parentRef, ['child-Y']);

    // 稀だが同一 fileUrl でアクティブな子が居ると、AC4 は skip 側に倒れるべき
    await db.collection('documents').add({
      fileUrl,
      isSplitSource: false,
      status: 'processed',
    });

    const related = await db
      .collection('documents')
      .where('fileUrl', '==', fileUrl)
      .get();
    const hasActiveDocs = related.docs.some((doc) => !doc.data().isSplitSource);

    expect(related.size).to.equal(2);
    expect(hasActiveDocs).to.equal(true);
  });
});
