/**
 * searchIndexer.addDocumentToIndex の db.getAll チャンク化 integration テスト
 * (Issue #217, kanameone 512MiB OOM 201件既発。本質対応として getAll をチャンク化)
 *
 * GET_ALL_CHUNK_SIZE(10) を跨ぐ十分な数のトークン(既存15件+新規15件、計30件)を
 * 用いて、チャンク境界をまたいでも既存/新規判定・df増分・postings付与が
 * 正しく行われることを検証する。
 *
 * 実行: firebase emulators:exec --only firestore --project search-indexer-chunked-getall-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { addDocumentToIndex } from '../src/search/searchIndexer';
import { generateTokenId, type TokenInfo } from '../src/utils/tokenizer';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['search_index'];

describe('searchIndexer.addDocumentToIndex - getAll チャンク化 (Issue #217)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  after(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('チャンクサイズ(10)を跨ぐ既存+新規混在トークンで、既存はupdate・新規はsetされる', async () => {
    // 既存15件: 事前に search_index docs を作成(df=5, postings に他doc)
    const existingTokens: TokenInfo[] = Array.from({ length: 15 }, (_, i) => ({
      token: `既存トークン${i}`,
      field: 'customer' as const,
      weight: 10,
    }));
    for (const t of existingTokens) {
      const tokenId = generateTokenId(t.token);
      await db.collection('search_index').doc(tokenId).set({
        updatedAt: Timestamp.now(),
        df: 5,
        postings: { 'other-doc': { score: 10, fieldsMask: 1, updatedAt: Timestamp.now() } },
      });
    }

    // 新規15件: search_index に未作成のトークン
    const newTokens: TokenInfo[] = Array.from({ length: 15 }, (_, i) => ({
      token: `新規トークン${i}`,
      field: 'fileName' as const,
      weight: 5,
    }));

    const allTokens = [...existingTokens, ...newTokens];
    expect(allTokens).to.have.length(30); // GET_ALL_CHUNK_SIZE(10)を3チャンクに跨ぐ

    await addDocumentToIndex('doc-under-test', allTokens);

    // 既存トークン: df が 5→6 に増分、postings に対象docが追加される
    for (const t of existingTokens) {
      const tokenId = generateTokenId(t.token);
      const snap = await db.collection('search_index').doc(tokenId).get();
      const data = snap.data();
      expect(data?.df, `${t.token} の df`).to.equal(6);
      expect(data?.postings?.['other-doc'], `${t.token} の既存posting維持`).to.exist;
      expect(data?.postings?.['doc-under-test'], `${t.token} の新規posting追加`).to.exist;
    }

    // 新規トークン: df=1 で新規作成される
    for (const t of newTokens) {
      const tokenId = generateTokenId(t.token);
      const snap = await db.collection('search_index').doc(tokenId).get();
      const data = snap.data();
      expect(data?.df, `${t.token} の df`).to.equal(1);
      expect(data?.postings?.['doc-under-test'], `${t.token} のposting`).to.exist;
    }
  });

  it('チャンクサイズ未満(5件)でも従来どおり動作する(回帰確認)', async () => {
    const tokens: TokenInfo[] = Array.from({ length: 5 }, (_, i) => ({
      token: `小規模トークン${i}`,
      field: 'office' as const,
      weight: 8,
    }));

    await addDocumentToIndex('doc-small', tokens);

    for (const t of tokens) {
      const tokenId = generateTokenId(t.token);
      const snap = await db.collection('search_index').doc(tokenId).get();
      expect(snap.exists, `${t.token} が新規作成される`).to.be.true;
      expect(snap.data()?.df).to.equal(1);
    }
  });
});
