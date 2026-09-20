/**
 * searchIndexer - 日付由来トークンの除外 (Issue #984 段階2a / ADR-0026)
 *
 * `processSearchIndexTrigger()` を直接呼び出す(`searchIndexerStatusTransitionIntegration` と同型)。
 *
 * 検証する契約:
 *   - 日付・2 桁数字トークンを索引に書かない (新規書類)
 *   - 旧書類の search.tokens に残る除外対象は削除バッチに含めない。除外トークンの索引文書が
 *     存在しなくても、同じバッチの正当なトークンの posting 削除・df 減算が巻き添えで失敗しない
 *     (removeTokensFromIndex は原子的 batch.update で NOT_FOUND をバッチ全体で握りつぶす)
 *   - 同一 tokenId の重複 (複数フィールドで同じ語) で df を重複減算しない (負値の防止)
 *   - トークンが 0 件になった書類は旧 posting を削除し、search メタを空で保存する
 *
 * 実行: npm run test:integration (firebase emulators:exec --only firestore 経由)
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { processSearchIndexTrigger } from '../src/search/searchIndexer';
import { generateTokenId, generateTokensHash } from '../src/utils/tokenizer';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['search_index', 'documents'];

async function seedIndex(token: string, docIds: string[], df?: number): Promise<void> {
  const postings: Record<string, unknown> = {};
  for (const id of docIds) {
    postings[id] = { score: 1, fieldsMask: 1, updatedAt: Timestamp.now() };
  }
  await db.collection('search_index').doc(generateTokenId(token)).set({
    updatedAt: Timestamp.now(),
    df: df ?? docIds.length,
    postings,
  });
}

async function readIndex(token: string): Promise<FirebaseFirestore.DocumentData | undefined> {
  return (await db.collection('search_index').doc(generateTokenId(token)).get()).data();
}

describe('searchIndexer: 日付由来トークンの除外 (Issue #984 段階2a)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  after(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('新規書類: 日付・2 桁数字トークンの索引文書を作らない (通常の語は作る)', async () => {
    const docId = 'excl-new';
    const after = {
      status: 'processed',
      customerName: '田中太郎',
      fileName: '訪問看護報告書_西春内科在宅クリニック_20260920_田中太郎.pdf',
      fileDate: Timestamp.fromDate(new Date(Date.UTC(2026, 8, 20))),
    };
    await db.doc(`documents/${docId}`).set(after);

    await processSearchIndexTrigger(docId, undefined, after);

    for (const t of ['2026', '2026-09', '2026-09-20', '20', '02', '26', '60']) {
      expect((await db.collection('search_index').doc(generateTokenId(t)).get()).exists, t).to.equal(false);
    }
    expect((await readIndex('田中'))?.postings?.[docId], '通常の語は索引される').to.exist;
    const meta = (await db.doc(`documents/${docId}`).get()).data()?.search;
    expect(meta.tokens).to.not.include('2026');
    expect(meta.tokens).to.not.include('26');
  });

  it('罠: 旧 search.tokens の除外対象の索引文書が存在しなくても、正当なトークンの posting 削除・df 減算が成立する', async () => {
    const docId = 'excl-trap';
    // 旧書類は日付トークン込みで索引済みだった (search.tokens に 2026 / 20 が残る)。
    // 除外トークンの索引文書は存在しない (削除済み or 未作成)。正当な '佐藤' だけ存在する
    await seedIndex('佐藤', [docId]);
    const oldMeta = { version: 1, tokens: ['佐藤', '2026', '20'], tokenHash: 'old', indexedAt: Timestamp.now() };
    const before = { status: 'processed', customerName: '佐藤', search: oldMeta };
    const after = { status: 'processed', customerName: '鈴木', search: oldMeta };
    await db.doc(`documents/${docId}`).set(after);

    await processSearchIndexTrigger(docId, before, after);

    const sato = await readIndex('佐藤');
    expect(sato?.postings?.[docId], '正当なトークンの posting が削除される (巻き添えで失敗しない)').to.not.exist;
    expect(sato?.df).to.equal(0);
    expect((await readIndex('鈴木'))?.postings?.[docId], '新しいトークンが登録される').to.exist;
  });

  it('罠: 書類削除でも、除外トークンの索引文書が無くて正当なトークンの posting 削除が成立する', async () => {
    const docId = 'excl-trap-delete';
    await seedIndex('高橋', [docId]);
    const before = {
      status: 'processed',
      search: { version: 1, tokens: ['高橋', '2026', '26'], tokenHash: 'old', indexedAt: Timestamp.now() },
    };

    await processSearchIndexTrigger(docId, before, undefined);

    const data = await readIndex('高橋');
    expect(data?.postings?.[docId]).to.not.exist;
    expect(data?.df).to.equal(0);
  });

  it('除外対象の既存索引文書 (飽和済み等) の posting / df には触れない', async () => {
    const docId = 'excl-untouched';
    await seedIndex('2026', [docId, 'other-1', 'other-2'], 3);
    await seedIndex('渡辺', [docId]);
    const before = {
      status: 'processed',
      search: { version: 1, tokens: ['渡辺', '2026'], tokenHash: 'old', indexedAt: Timestamp.now() },
    };

    await processSearchIndexTrigger(docId, before, undefined);

    const year = await readIndex('2026');
    expect(Object.keys(year?.postings ?? {}).sort(), '除外トークンの索引文書は読まれず更新もされない').to.deep.equal(
      [docId, 'other-1', 'other-2'].sort()
    );
    expect(year?.df).to.equal(3);
    expect((await readIndex('渡辺'))?.postings?.[docId]).to.not.exist;
  });

  it('同一 tokenId の重複 (複数フィールドで同じ語) でも df を重複減算しない', async () => {
    const docId = 'excl-dup';
    await seedIndex('zzk', [docId], 1);
    // 顧客名と事業所名に同じ語 → search.tokens に同じ文字列が 2 回入る
    const before = {
      status: 'processed',
      search: { version: 1, tokens: ['zzk', 'zzk'], tokenHash: 'old', indexedAt: Timestamp.now() },
    };

    await processSearchIndexTrigger(docId, before, undefined);

    const data = await readIndex('zzk');
    expect(data?.postings?.[docId]).to.not.exist;
    expect(data?.df, 'df は 1→0 (重複減算で -1 にならない)').to.equal(0);
  });

  it('トークン 0 件になった書類: 旧 posting を削除し、search メタを空で保存する。再実行は変更なし', async () => {
    const docId = 'excl-zero';
    await seedIndex('山田', [docId]);
    const oldMeta = {
      version: 1,
      tokens: ['山田'],
      tokenHash: 'old',
      indexedAt: Timestamp.now(),
      skippedTokens: ['hotword'],
    };
    const before = { status: 'processed', customerName: '山田', search: oldMeta };
    // 顧客名などが空になり、fileDate だけが残った書類 (date は索引しないのでトークン 0 件)
    const after = {
      status: 'processed',
      fileDate: Timestamp.fromDate(new Date(Date.UTC(2026, 8, 20))),
      search: oldMeta,
    };
    await db.doc(`documents/${docId}`).set(after);

    await processSearchIndexTrigger(docId, before, after);

    const yamada = await readIndex('山田');
    expect(yamada?.postings?.[docId], '旧 posting が削除される').to.not.exist;
    expect(yamada?.df).to.equal(0);
    const meta = (await db.doc(`documents/${docId}`).get()).data()?.search;
    expect(meta.tokens).to.deep.equal([]);
    expect(meta.tokenHash).to.equal(generateTokensHash([]));
    expect(meta.skippedTokens, 'skippedTokens は消える').to.equal(undefined);

    // 再実行 (自己再発火): 保存済みメタを before にして同じ after を処理 → 何も変えない
    const indexedAtBefore = (meta.indexedAt as Timestamp).toMillis();
    await processSearchIndexTrigger(docId, { ...after, search: meta }, { ...after, search: meta });
    const meta2 = (await db.doc(`documents/${docId}`).get()).data()?.search;
    expect((meta2.indexedAt as Timestamp).toMillis()).to.equal(indexedAtBefore);
  });

  it('もともとトークンが無く旧メタも無い書類は、何も書かない (従来どおり)', async () => {
    const docId = 'excl-never';
    const after = { status: 'processed' };
    await db.doc(`documents/${docId}`).set(after);

    await processSearchIndexTrigger(docId, undefined, after);

    expect((await db.doc(`documents/${docId}`).get()).data()?.search).to.equal(undefined);
  });
});
