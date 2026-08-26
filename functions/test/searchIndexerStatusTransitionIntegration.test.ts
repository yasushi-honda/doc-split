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
 *
 * 実行: npm run test:integration (firebase emulators:exec --only firestore 経由)
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { processSearchIndexTrigger } from '../src/search/searchIndexer';
import { generateTokenId } from '../src/utils/tokenizer';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['search_index', 'documents'];

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
    const before = { status: 'processed', search: searchMeta };
    const after = { status: 'split', search: searchMeta };

    await processSearchIndexTrigger(docId, before, after);

    const snap = await db.collection('search_index').doc(tokenId).get();
    const data = snap.data();
    expect(data?.postings?.[docId], 'split 遷移後は posting が削除される').to.not.exist;
    expect(data?.df, 'df が減算される').to.equal(0);
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
