/**
 * searchIndexer - 高頻度トークン飽和(1MiB 超過)でも致命傷にしない (Issue #984)
 *
 * 背景: `search_index/{tokenId}` は1トークン=1ドキュメントに全書類の postings を詰める設計で、
 * 高頻度トークン("2026" 等)が Firestore の 1MiB 上限に達すると、`addDocumentToIndex` の原子的 batch が
 * 失敗し、その書類の全トークンが未登録になっていた(kanameone 本番で 2026 年書類の約 10.6% が未索引)。
 *
 * 検証する契約(段階1):
 *   - サイズ超過でも `addDocumentToIndex` は resolve し、超過したトークン以外は登録される
 *   - サイズ超過以外のエラーは従来どおり throw し、throw 前に固定ログを出す
 *   - `documents.search` メタ: tokens=登録分 / skippedTokens=スキップ分 / tokenHash=全トークンのハッシュ
 *   - `df` は `postings[docId]` の有無で増分を決める(自己再発火・部分失敗後の再試行・旧書式で二重加算しない)
 *   - 高頻度トークンを飽和させた書類でも、非高頻度トークンで検索にヒットする
 *
 * エミュレータは 1MiB を強制し code=3 + `maximum entity size is 1048576 bytes` で拒否する
 * (2026-09-20 スパイクで実測)。飽和は二分探索で文書を上限ぎりぎりまで膨らませて再現する。
 *
 * 実行: firebase emulators:exec --only firestore --project search-indexer-hot-token-integration-test \
 *         'npx mocha --require ts-node/register --timeout 30000 test/searchIndexerHotTokenIntegration.test.ts'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import functionsTest from 'firebase-functions-test';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { addDocumentToIndex, processSearchIndexTrigger } from '../src/search/searchIndexer';
import { searchDocuments } from '../src/search/searchDocuments';
import {
  generateDocumentTokens,
  generateTokenId,
  generateTokensHash,
  type TokenInfo,
} from '../src/utils/tokenizer';

const test = functionsTest();
const wrappedSearch = test.wrap(searchDocuments);
const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['search_index', 'documents', 'users'];

const SKIP_LOG = '[searchIndexer] token skipped: document size limit';
const FAILED_LOG = '[searchIndexer] index write failed';

/**
 * 指定 tokenId の search_index 文書を、これ以上の書込みが 1MiB 超過になる上限ぎりぎりまで膨らませる。
 * `set` は全置換のため、pad の長さを二分探索して「set が成功する最大長」を求める。
 */
async function saturateTokenDoc(
  tokenId: string,
  base: Record<string, unknown> = { df: 1, postings: {} }
): Promise<void> {
  const ref = db.collection('search_index').doc(tokenId);
  let lo = 900_000; // 成功することが分かっている長さ
  let hi = 1_048_576; // 失敗することが分かっている長さ
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    try {
      await ref.set({ ...base, pad: 'x'.repeat(mid) });
      lo = mid;
    } catch {
      hi = mid;
    }
  }
  await ref.set({ ...base, pad: 'x'.repeat(lo) });
}

/** console.error の呼び出しを引数配列ごと記録する(引数が1個の単一文字列かも検証するため) */
function captureConsoleError(): { calls: unknown[][]; restore: () => void } {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  return { calls, restore: () => { console.error = original; } };
}

const token = (t: string): TokenInfo => ({ token: t, field: 'customer', weight: 10 });

async function getIndexDoc(t: string): Promise<FirebaseFirestore.DocumentData | undefined> {
  return (await db.collection('search_index').doc(generateTokenId(t)).get()).data();
}

describe('searchIndexer - 高頻度トークン飽和のフォールバック (Issue #984)', function () {
  // 飽和の再現(二分探索で 1MiB 文書を十数回書き直す)は数秒かかるため、遅い CI でも余裕を持たせる
  this.timeout(60_000);

  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  after(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  describe('addDocumentToIndex', () => {
    it('AC1: サイズ超過トークンだけスキップし、他トークンは登録され、飽和した文書は不変', async () => {
      const hot = 'hottoken984';
      const hotId = generateTokenId(hot);
      await saturateTokenDoc(hotId);
      const hotBefore = (await db.collection('search_index').doc(hotId).get()).data();

      const cap = captureConsoleError();
      let result;
      try {
        result = await addDocumentToIndex('doc-ac1', [token(hot), token('normalA'), token('normalB')]);
      } finally {
        cap.restore();
      }

      expect(result.skippedTokenIds).to.deep.equal([hotId]);

      for (const t of ['normalA', 'normalB']) {
        const data = await getIndexDoc(t);
        expect(data, `${t} は登録される`).to.not.equal(undefined);
        expect(data!.df).to.equal(1);
        expect(Object.keys(data!.postings)).to.deep.equal(['doc-ac1']);
      }

      const hotAfter = (await db.collection('search_index').doc(hotId).get()).data();
      expect(hotAfter, '飽和した文書は変更されない').to.deep.equal(hotBefore);

      const skipLines = cap.calls.filter((c) => String(c[0]).includes(SKIP_LOG));
      expect(skipLines, 'skip ログは1書類につき1行').to.have.length(1);
      expect(skipLines[0], 'ログは引数1個の単一文字列(textPayload 前提の metric に当てるため)').to.have.length(1);
      expect(String(skipLines[0][0])).to.include('doc-ac1').and.to.include(hotId);
    });

    it('サイズ超過が無ければフォールバックせず全トークン登録、skippedTokenIds は空', async () => {
      const cap = captureConsoleError();
      let result;
      try {
        result = await addDocumentToIndex('doc-normal', [token('plainA'), token('plainB')]);
      } finally {
        cap.restore();
      }
      expect(result.skippedTokenIds).to.deep.equal([]);
      expect(cap.calls.filter((c) => String(c[0]).includes(SKIP_LOG))).to.have.length(0);
      expect((await getIndexDoc('plainA'))!.df).to.equal(1);
      expect((await getIndexDoc('plainB'))!.df).to.equal(1);
    });

    it('batch はサイズ超過で失敗したが個別書込みは全て成功した場合は、skipped 空で skip ログを出さない', async () => {
      const sizeError = Object.assign(new Error('maximum entity size is 1048576 bytes'), { code: 3 });
      const cap = captureConsoleError();
      let result;
      try {
        result = await addDocumentToIndex('doc-race', [token('raceA'), token('raceB')], {
          commitOps: async () => {
            throw sizeError; // batch だけ失敗(他の書込みと競合して容量が空くケースを模擬)
          },
        });
      } finally {
        cap.restore();
      }
      expect(result.skippedTokenIds).to.deep.equal([]);
      expect(cap.calls.filter((c) => String(c[0]).includes(SKIP_LOG)), 'skipped=0 のログは出さない').to.have.length(0);
      expect((await getIndexDoc('raceA'))!.df).to.equal(1);
      expect((await getIndexDoc('raceB'))!.df).to.equal(1);
    });

    it('AC2: サイズ超過以外のエラー(batch)は従来どおり throw し、throw 前に固定ログを出す', async () => {
      const boom = Object.assign(new Error('transient failure'), { code: 14 });
      const cap = captureConsoleError();
      let thrown: unknown;
      try {
        await addDocumentToIndex('doc-ac2', [token('errA')], {
          commitOps: async () => {
            throw boom;
          },
        });
      } catch (e) {
        thrown = e;
      } finally {
        cap.restore();
      }
      expect(thrown).to.equal(boom);
      const failed = cap.calls.filter((c) => String(c[0]).includes(FAILED_LOG));
      expect(failed).to.have.length(1);
      expect(failed[0], '固定ログは引数1個の単一文字列').to.have.length(1);
      expect(String(failed[0][0])).to.include('doc-ac2');
    });

    it('AC2: フォールバック中のサイズ超過以外のエラーも throw し、固定ログを出す', async () => {
      const hot = 'hotForNonSize';
      await saturateTokenDoc(generateTokenId(hot));
      const boom = Object.assign(new Error('permission denied'), { code: 7 });
      const failingId = generateTokenId('failsInFallback');

      const cap = captureConsoleError();
      let thrown: unknown;
      try {
        await addDocumentToIndex(
          'doc-ac2b',
          [token(hot), token('okToken'), token('failsInFallback')],
          {
            writeOp: async (op) => {
              if (op.tokenId === failingId) throw boom;
              if (op.kind === 'set') await op.ref.set(op.data);
              else await op.ref.update(op.data);
            },
          }
        );
      } catch (e) {
        thrown = e;
      } finally {
        cap.restore();
      }
      expect(thrown).to.equal(boom);
      expect(cap.calls.filter((c) => String(c[0]).includes(FAILED_LOG))).to.have.length(1);
    });

    it('AC4(b): フォールバックで一部成功 → 非サイズ失敗 → 再試行しても、成功済みトークンの df が増えない', async () => {
      const hot = 'hotForRetry';
      await saturateTokenDoc(generateTokenId(hot));
      const failingId = generateTokenId('retryC');
      const tokens = [token(hot), token('retryA'), token('retryB'), token('retryC')];
      const boom = Object.assign(new Error('unavailable'), { code: 14 });

      // 1回目: A/B は書けるが C は非サイズエラー → throw
      const cap = captureConsoleError();
      try {
        let threw = false;
        try {
          await addDocumentToIndex('doc-retry', tokens, {
            writeOp: async (op) => {
              if (op.tokenId === failingId) throw boom;
              if (op.kind === 'set') await op.ref.set(op.data);
              else await op.ref.update(op.data);
            },
          });
        } catch {
          threw = true;
        }
        expect(threw).to.equal(true);
      } finally {
        cap.restore();
      }
      expect((await getIndexDoc('retryA'))!.df).to.equal(1);
      expect(await getIndexDoc('retryC'), 'C は未登録').to.equal(undefined);

      // 2回目(再試行): 成功済みの A/B は hadPosting なので df を再加算しない。C は新規で df=1
      const cap2 = captureConsoleError();
      try {
        await addDocumentToIndex('doc-retry', tokens);
      } finally {
        cap2.restore();
      }
      expect((await getIndexDoc('retryA'))!.df, 'A の df は増えない').to.equal(1);
      expect((await getIndexDoc('retryB'))!.df, 'B の df は増えない').to.equal(1);
      expect((await getIndexDoc('retryC'))!.df, 'C は新規登録で df=1').to.equal(1);
    });

    it('AC4(c): 旧書式(ルート直下の postings.<docId>)の既存 posting でも df を再加算しない', async () => {
      const legacy = 'legacyShape';
      const legacyId = generateTokenId(legacy);
      // 旧 addDocumentToIndex は set({[`postings.${docId}`]: ...}, {merge:true}) で、
      // ドットをパスとして解釈せず、ルート直下に文字どおり "postings.doc-legacy" フィールドを作った
      await db.collection('search_index').doc(legacyId).set({
        updatedAt: Timestamp.now(),
        df: 1,
        'postings.doc-legacy': { score: 10, fieldsMask: 1, updatedAt: Timestamp.now() },
      });

      await addDocumentToIndex('doc-legacy', [token(legacy)]);

      expect((await getIndexDoc(legacy))!.df, '旧書式でも既存 posting とみなし df は増えない').to.equal(1);
    });

    it('既存 posting が無い書類が既存トークンに加わる場合は従来どおり df を +1 する(回帰確認)', async () => {
      const shared = 'sharedToken984';
      await db.collection('search_index').doc(generateTokenId(shared)).set({
        updatedAt: Timestamp.now(),
        df: 5,
        postings: { 'other-doc': { score: 10, fieldsMask: 1, updatedAt: Timestamp.now() } },
      });

      await addDocumentToIndex('doc-new', [token(shared)]);

      const data = (await getIndexDoc(shared))!;
      expect(data.df).to.equal(6);
      expect(Object.keys(data.postings).sort()).to.deep.equal(['doc-new', 'other-doc']);
    });

    it('M1: 書込みがサイズ超過で失敗しても、その書類の posting が既に存在するトークンは skipped に含めない', async () => {
      const hot = 'hotWithExistingPosting';
      const hotId = generateTokenId(hot);
      // この書類の posting は既に存在する(小さい形)。新しい posting は fieldsMask を持つため大きくなり、
      // かつ上限ぎりぎりのため書込みがサイズ超過で失敗する
      await saturateTokenDoc(hotId, {
        df: 1,
        postings: { 'doc-m1': { score: 10, updatedAt: Timestamp.fromMillis(0) } },
      });

      const cap = captureConsoleError();
      let result;
      try {
        result = await addDocumentToIndex('doc-m1', [token(hot), token('m1Other')]);
      } finally {
        cap.restore();
      }

      expect(result.skippedTokenIds, '既存 posting がある = 索引に残っているので skipped ではない').to.deep.equal([]);
      expect((await getIndexDoc('m1Other'))!.df).to.equal(1);
    });
  });

  describe('processSearchIndexTrigger', () => {
    const base = {
      status: 'processed',
      customerName: 'テスト太郎',
      officeName: 'テスト事業所',
      documentType: '請求書',
      fileName: 'test984.pdf',
      fileDate: Timestamp.fromDate(new Date('2026-01-15T00:00:00Z')),
    };
    const expectedTokens = (): TokenInfo[] =>
      generateDocumentTokens({
        customerName: base.customerName,
        officeName: base.officeName,
        documentType: base.documentType,
        fileDate: base.fileDate.toDate(),
        fileName: base.fileName,
      });

    it('AC4(a): 初回処理 → 自身の search 書込みによる再発火を再現しても、df は posting 実数(1)のまま', async () => {
      const docId = 'doc-chain';
      await db.doc(`documents/${docId}`).set(base);

      // イベント1: 新規書類の作成
      await processSearchIndexTrigger(docId, undefined, base);
      // イベント2: イベント1 が書いた search メタによる再発火(before には search が無い)
      const afterEvent1 = (await db.doc(`documents/${docId}`).get()).data()!;
      await processSearchIndexTrigger(docId, base, afterEvent1);

      const tokens = expectedTokens();
      expect(tokens.length).to.be.greaterThan(3);
      for (const { token: t } of tokens) {
        const data = (await getIndexDoc(t))!;
        expect(data, `${t} は登録される`).to.not.equal(undefined);
        expect(data.df, `${t} の df は posting 実数と一致`).to.equal(1);
        expect(Object.keys(data.postings)).to.deep.equal([docId]);
      }
    });

    it('AC3/AC5: 高頻度トークンが飽和していても、search メタは仕様どおりで、非高頻度トークンで検索にヒットする', async () => {
      const docId = 'doc-hot-meta';
      const tokens = expectedTokens();
      // 顧客名由来のトークンを1つ飽和させる(事業所名など他のトークンは飽和させない)
      const hotToken = tokens.find((t) => t.field === 'customer')!.token;
      const hotId = generateTokenId(hotToken);
      await saturateTokenDoc(hotId);

      await db.doc('users/test-user-984').set({ email: 'test-984@example.com', role: 'user' });
      await db.doc(`documents/${docId}`).set(base);

      const cap = captureConsoleError();
      try {
        await processSearchIndexTrigger(docId, undefined, base);
      } finally {
        cap.restore();
      }

      const meta = (await db.doc(`documents/${docId}`).get()).data()!.search;
      const skippedStrings = [...new Set(tokens.filter((t) => generateTokenId(t.token) === hotId).map((t) => t.token))];
      expect(meta.skippedTokens, 'skippedTokens=スキップした(同一 tokenId の)トークン文字列').to.deep.equal(skippedStrings);
      expect(meta.tokens, 'tokens は登録できたトークンのみ').to.not.include(hotToken);
      expect(meta.tokens.length).to.equal(tokens.length - tokens.filter((t) => generateTokenId(t.token) === hotId).length);
      expect(meta.tokenHash, 'tokenHash は期待する全トークンのハッシュ').to.equal(generateTokensHash(tokens));

      // 非高頻度トークン(事業所名)では検索にヒットする
      const request = {
        auth: { uid: 'test-user-984', token: {} as Record<string, unknown> },
        data: { query: 'テスト事業所' },
        rawRequest: {},
      } as unknown as Parameters<typeof wrappedSearch>[0];
      const found = await wrappedSearch(request);
      expect(found.documents.map((d: { id: string }) => d.id)).to.include(docId);

      // イベント3(before に search がある): tokenHash 一致で変更なし判定になり、search メタは書き換わらない
      const stored = (await db.doc(`documents/${docId}`).get()).data()!;
      await processSearchIndexTrigger(docId, stored, stored);
      const after3 = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(after3.search.indexedAt.toMillis(), 'indexedAt は不変').to.equal(stored.search.indexedAt.toMillis());
    });

    it('スキップが無い通常の書類では skippedTokens を付けない', async () => {
      const docId = 'doc-no-skip';
      await db.doc(`documents/${docId}`).set(base);
      await processSearchIndexTrigger(docId, undefined, base);
      const meta = (await db.doc(`documents/${docId}`).get()).data()!.search;
      expect(meta).to.not.have.property('skippedTokens');
      expect(meta.tokens.length).to.equal(expectedTokens().length);
    });
  });
});
