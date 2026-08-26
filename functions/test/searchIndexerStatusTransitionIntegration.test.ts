/**
 * searchIndexer.processSearchIndexTrigger - status遷移時のインデックス削除
 * (Issue #810: FAX分割元ドキュメント(status='split')の検索インデックス残留)
 *
 * `onDocumentWritten`のCloudEvent配管から独立させた`processSearchIndexTrigger()`を
 * 直接呼び出す(`driveExportTriggerIntegration.test.ts`と同型パターン)。
 *
 * 検証する契約:
 *   - status が 'processed' から他の値(例: 'split')へ遷移した場合、既存の
 *     search_index posting が削除されること(根本原因の修正)
 *   - status が 'processed' のまま維持される通常更新では、既存インデックスが
 *     誤って削除されないこと(回帰確認)
 *   - split 遷移後に同一ドキュメントへ後続の書込みが発生しても df が二重減算
 *     されないこと(codex review指摘 P2、PR #818)
 *   - split 遷移時に検索結果キャッシュ(10分TTL)が無効化され、遷移前にキャッシュ
 *     済みの結果が served され続けないこと(codex review指摘 P1、PR #818)
 *
 * 実行: npm run test:integration (firebase emulators:exec --only firestore 経由)
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import functionsTest from 'firebase-functions-test';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { processSearchIndexTrigger } from '../src/search/searchIndexer';
import { searchDocuments } from '../src/search/searchDocuments';
import { generateTokenId } from '../src/utils/tokenizer';

const test = functionsTest();
const wrappedSearch = test.wrap(searchDocuments);
const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['search_index', 'documents', 'users'];

describe('searchIndexer.processSearchIndexTrigger - status遷移時のインデックス削除 (Issue #810)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  after(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('processed → split 遷移時、既存の search_index posting が削除される', async () => {
    const docId = 'doc-issue810-split';
    const token = 'issue810splittoken';
    const tokenId = generateTokenId(token);

    // 分割前に processed としてインデックス済みだった状態を模擬
    await db.collection('search_index').doc(tokenId).set({
      updatedAt: Timestamp.now(),
      df: 1,
      postings: { [docId]: { score: 10, fieldsMask: 8, updatedAt: Timestamp.now() } },
    });

    const searchMeta = {
      version: 1,
      tokens: [token],
      tokenHash: 'dummy-hash-810',
      indexedAt: Timestamp.now(),
    };
    // 本番のトリガーは documents/{docId} の書込みイベントで発火するため after は
    // 常に実在ドキュメントを指す。processSearchIndexTrigger 内で
    // db.doc(`documents/${docId}`).update() を呼ぶため、実 doc を seed する。
    await db.doc(`documents/${docId}`).set({ status: 'processed', search: searchMeta });
    const before = { status: 'processed', search: searchMeta };
    const after = { status: 'split', search: searchMeta };

    await processSearchIndexTrigger(docId, before, after);

    const snap = await db.collection('search_index').doc(tokenId).get();
    const data = snap.data();
    expect(data?.postings?.[docId], 'split 遷移後は posting が削除される').to.not.exist;
    expect(data?.df, 'df が減算される').to.equal(0);

    // codex review指摘 P2: search メタデータがクリアされていること
    const docSnap = await db.doc(`documents/${docId}`).get();
    expect(docSnap.data()?.search, 'search メタデータはクリアされる').to.not.exist;
  });

  it('split 遷移後、同一ドキュメントへの後続書込みでも df が二重減算されない (codex review指摘 P2)', async () => {
    const docId = 'doc-issue810-double-write';
    const token = 'issue810doubletoken';
    const tokenId = generateTokenId(token);

    await db.collection('search_index').doc(tokenId).set({
      updatedAt: Timestamp.now(),
      df: 1,
      postings: { [docId]: { score: 10, fieldsMask: 8, updatedAt: Timestamp.now() } },
    });

    const searchMeta = {
      version: 1,
      tokens: [token],
      tokenHash: 'dummy-hash-double',
      indexedAt: Timestamp.now(),
    };
    await db.doc(`documents/${docId}`).set({ status: 'processed', search: searchMeta });

    // 1回目: processed → split (posting削除、df: 1→0、search メタデータクリア)
    await processSearchIndexTrigger(docId, { status: 'processed', search: searchMeta }, {
      status: 'split',
      search: searchMeta,
    });

    // 2回目: split のドキュメントへの後続更新(例: 要約再生成等)。トリガーは
    // 実際の documents/{docId} 最新状態(before.search が既にクリア済み)を渡す。
    const docAfterFirstWrite = (await db.doc(`documents/${docId}`).get()).data()!;
    await processSearchIndexTrigger(docId, docAfterFirstWrite, {
      status: 'split',
      note: 'unrelated field update',
    });

    const snap = await db.collection('search_index').doc(tokenId).get();
    const data = snap.data();
    expect(data?.df, 'df は 0 のまま(二重減算されない)').to.equal(0);
  });

  it('split 遷移時、検索結果キャッシュが無効化され旧結果が served され続けない (codex review指摘 P1)', async () => {
    const docId = 'doc-issue810-cache';
    const token = 'issue810cachetoken';

    // whitelist ユーザーを用意
    await db.doc('users/test-user-810').set({ email: 'test-810@example.com', role: 'user' });

    // search_index に posting を直接 seed (searchDocuments のトークン生成非依存で
    // 確実にヒットさせる)
    const tokenId = generateTokenId(token);
    await db.collection('search_index').doc(tokenId).set({
      updatedAt: Timestamp.now(),
      df: 1,
      postings: { [docId]: { score: 10, fieldsMask: 8, updatedAt: Timestamp.now() } },
    });
    const searchMeta = { version: 1, tokens: [token], tokenHash: 'dummy-hash-cache', indexedAt: Timestamp.now() };
    await db.doc(`documents/${docId}`).set({
      status: 'processed',
      search: searchMeta,
      fileName: 'cache-test.pdf',
      customerName: '',
      officeName: '',
      documentType: '',
    });

    const request = {
      auth: { uid: 'test-user-810', token: {} as Record<string, unknown> },
      data: { query: token },
      rawRequest: {},
    } as unknown as Parameters<typeof wrappedSearch>[0];

    // 1回目呼出しでキャッシュに split 前の結果 (docId を含む) を格納させる
    const before = await wrappedSearch(request);
    expect(before.documents.map((d: { id: string }) => d.id)).to.include(docId);

    // ドキュメントが split へ遷移 (インデックス削除 + キャッシュ全消去)
    await processSearchIndexTrigger(
      docId,
      { status: 'processed', search: searchMeta },
      { status: 'split', search: searchMeta }
    );

    // 同一クエリを再実行。キャッシュが無効化されていなければ split 前の結果が
    // そのまま返ってしまう(codex review P1 の再現条件)。
    const after = await wrappedSearch(request);
    expect(
      after.documents.map((d: { id: string }) => d.id),
      'キャッシュ無効化により split ドキュメントは再検索で除外される'
    ).to.not.include(docId);
  });

  it('processed 状態を維持する更新では既存インデックスが削除されない(回帰確認)', async () => {
    const docId = 'doc-issue810-stay-processed';
    const token = 'issue810staytoken';
    const tokenId = generateTokenId(token);

    await db.collection('search_index').doc(tokenId).set({
      updatedAt: Timestamp.now(),
      df: 1,
      postings: { [docId]: { score: 10, fieldsMask: 8, updatedAt: Timestamp.now() } },
    });

    const before = {
      status: 'processed',
      search: { version: 1, tokens: [token], tokenHash: 'dummy-hash-stay', indexedAt: Timestamp.now() },
    };
    // customerName等が空のため generateDocumentTokens は空配列を返し早期return する
    // (= 新しいstatus遷移ガードは発火しない経路)。既存 posting が無傷であることを確認する。
    const after = {
      status: 'processed',
      customerName: '',
      officeName: '',
      documentType: '',
      fileName: '',
      fileDate: null,
    };

    await processSearchIndexTrigger(docId, before, after);

    const snap = await db.collection('search_index').doc(tokenId).get();
    const data = snap.data();
    expect(data?.postings?.[docId], 'processed 維持時は posting が保持される').to.exist;
    expect(data?.df).to.equal(1);
  });
});
