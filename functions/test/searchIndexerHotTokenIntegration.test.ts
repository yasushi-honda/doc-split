/**
 * searchIndexer - 高頻度トークン飽和(1MiB 超過)でも致命傷にしない (Issue #984)
 *
 * 背景: `search_index/{tokenId}` は1トークン=1ドキュメントに全書類の postings を詰める設計で、
 * 高頻度トークン("2026" 等)が Firestore の 1MiB 上限に達すると、`addDocumentToIndex` の原子的 batch が
 * 失敗し、その書類の全トークンが未登録になっていた。
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
 *         'npx mocha --require ts-node/register --timeout 60000 test/searchIndexerHotTokenIntegration.test.ts'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import functionsTest from 'firebase-functions-test';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { addDocumentToIndex, processSearchIndexTrigger } from '../src/search/searchIndexer';
import { searchDocuments } from '../src/search/searchDocuments';
import { isFirestoreDocumentSizeExceededError } from '../src/utils/firestoreErrors';
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
 * 埋め草(pad)のフィールド群を作る。Firestore は文字列プロパティ1つの長さにも上限(約 1,048,487 バイト)が
 * あり、それに当たると「エンティティサイズ超過」ではない別のエラーになるため、複数フィールドに分割して
 * 本物のエンティティサイズ上限(1MiB)で飽和させる。
 */
function padFields(length: number): Record<string, string> {
  const fields: Record<string, string> = {};
  let remaining = length;
  for (let i = 0; remaining > 0; i++) {
    const n = Math.min(remaining, 500_000);
    fields[`pad${i}`] = 'x'.repeat(n);
    remaining -= n;
  }
  return fields;
}

/**
 * 指定 tokenId の search_index 文書を、これ以上の書込みが 1MiB 超過になる上限ぎりぎりまで膨らませる。
 * `set` は全置換のため、pad の長さを二分探索して「set が成功する最大長」を求める。
 */
async function saturateTokenDoc(
  tokenId: string,
  base: Record<string, unknown> = { df: 1, postings: {} }
): Promise<number> {
  const ref = db.collection('search_index').doc(tokenId);
  let lo = 900_000; // 成功することが分かっている長さ
  let hi = 1_048_576; // 失敗することが分かっている長さ
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    try {
      await ref.set({ ...base, ...padFields(mid) });
      lo = mid;
    } catch (error) {
      // サイズ超過以外(エミュレータ接続断など)を飲み込むと、原因不明のまま探索が縮んでしまう
      if (!isFirestoreDocumentSizeExceededError(error)) throw error;
      hi = mid;
    }
  }
  await ref.set({ ...base, ...padFields(lo) });
  return lo;
}

/**
 * 複数の tokenId を飽和させる。tokenId は全て同じ長さ(8桁 hex)で文書サイズが同じなので、
 * 二分探索は先頭の1件だけで行い、残りは求めた pad 長で直接 set する(全件で探索すると遅い)。
 */
async function saturateTokenDocs(tokenIds: string[]): Promise<void> {
  const [first, ...rest] = tokenIds;
  if (first === undefined) return;
  const pad = await saturateTokenDoc(first);
  for (const id of rest) {
    await db.collection('search_index').doc(id).set({ df: 1, postings: {}, ...padFields(pad) });
  }
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
      expect(cap.calls, '固定ログ以外の console.error を出さない').to.have.length(1);
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
      const failed = cap.calls.filter((c) => String(c[0]).includes(FAILED_LOG));
      expect(failed).to.have.length(1);
      // 診断情報: 失敗件数と失敗した tokenId(複数の失敗を1件に潰さない)
      expect(String(failed[0][0])).to.include('failed=1/3').and.to.include(failingId);
      // 致命エラーで throw する場合、スキップの記録(skip ログ)は出さない
      expect(cap.calls.filter((c) => String(c[0]).includes(SKIP_LOG))).to.have.length(0);
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

    it('M1: 書込みがサイズ超過で失敗しても、その書類の posting が既に存在するトークンは skipped に含めず、skip ログも出さない', async () => {
      const hot = 'hotWithExistingPosting';
      const hotId = generateTokenId(hot);
      // この書類の posting は既に存在する(小さい形)。新しい posting は fieldsMask を持つため大きくなり、
      // かつ上限ぎりぎりのため書込みがサイズ超過で失敗する
      await saturateTokenDoc(hotId, {
        df: 1,
        postings: { 'doc-m1': { score: 10, updatedAt: Timestamp.fromMillis(0) } },
      });
      const hotBefore = (await db.collection('search_index').doc(hotId).get()).data();

      // 「サイズ超過が実際に起きた」ことの証明(起きていなければ、このテストは空振りする)
      const sizeErrorTokenIds: string[] = [];
      const cap = captureConsoleError();
      let result;
      try {
        result = await addDocumentToIndex('doc-m1', [token(hot), token('m1Other')], {
          writeOp: async (op) => {
            try {
              if (op.kind === 'set') await op.ref.set(op.data);
              else await op.ref.update(op.data);
            } catch (error) {
              if (isFirestoreDocumentSizeExceededError(error)) sizeErrorTokenIds.push(op.tokenId);
              throw error;
            }
          },
        });
      } finally {
        cap.restore();
      }

      expect(sizeErrorTokenIds, 'hot トークンの書込みが実際にサイズ超過で失敗した').to.deep.equal([hotId]);
      expect(result.skippedTokenIds, '既存 posting がある = 索引に残っているので skipped ではない').to.deep.equal([]);
      expect(cap.calls.filter((c) => String(c[0]).includes(SKIP_LOG)), 'スキップが無いので skip ログは出さない').to.have.length(0);
      expect((await db.collection('search_index').doc(hotId).get()).data(), '飽和した文書は不変').to.deep.equal(hotBefore);
      expect((await getIndexDoc('m1Other'))!.df).to.equal(1);
    });

    it('chunk 境界(10件)をまたぐフォールバック: 25 トークン中 2番目と23番目が飽和 → その2件だけ skipped、他 23 件は登録、skip ログは1行', async () => {
      const names = Array.from({ length: 25 }, (_, i) => `chunkTok${i}`);
      const hotIndexes = [1, 22];
      await saturateTokenDocs(hotIndexes.map((i) => generateTokenId(names[i]!)));

      const cap = captureConsoleError();
      let result;
      try {
        result = await addDocumentToIndex('doc-chunk', names.map(token));
      } finally {
        cap.restore();
      }

      expect([...result.skippedTokenIds].sort()).to.deep.equal(hotIndexes.map((i) => generateTokenId(names[i]!)).sort());
      for (const [i, name] of names.entries()) {
        if (hotIndexes.includes(i)) continue;
        expect((await getIndexDoc(name))!.df, `${name} は登録される`).to.equal(1);
      }
      expect(cap.calls.filter((c) => String(c[0]).includes(SKIP_LOG)), 'skip ログは1書類につき1行').to.have.length(1);
    });

    it('chunk 境界: 11件目以降(2番目の getAll chunk)の既存 posting でも df を再加算しない', async () => {
      const names = Array.from({ length: 25 }, (_, i) => `chunkHad${i}`);
      // 13番目(2番目の chunk)のトークンに、この書類の posting が既にある
      await db.collection('search_index').doc(generateTokenId(names[12]!)).set({
        updatedAt: Timestamp.now(),
        df: 1,
        postings: { 'doc-chunk2': { score: 10, fieldsMask: 1, updatedAt: Timestamp.now() } },
      });

      await addDocumentToIndex('doc-chunk2', names.map(token));

      expect((await getIndexDoc(names[12]!))!.df, 'chunk をまたいでも hadPosting を判定できる').to.equal(1);
      expect((await getIndexDoc(names[0]!))!.df).to.equal(1);
    });

    it('フォールバックの2番目の chunk で非サイズ失敗 → throw、1番目の chunk は登録済み、3番目の chunk は未実行', async () => {
      const names = Array.from({ length: 25 }, (_, i) => `chunkFatal${i}`);
      await saturateTokenDoc(generateTokenId(names[0]!)); // batch を失敗させてフォールバックへ入れる
      const failingId = generateTokenId(names[12]!); // 2番目の chunk(10〜19番目)
      const boom = Object.assign(new Error('unavailable'), { code: 14 });

      const cap = captureConsoleError();
      let thrown: unknown;
      try {
        await addDocumentToIndex('doc-chunk-fatal', names.map(token), {
          writeOp: async (op) => {
            if (op.tokenId === failingId) throw boom;
            if (op.kind === 'set') await op.ref.set(op.data);
            else await op.ref.update(op.data);
          },
        });
      } catch (e) {
        thrown = e;
      } finally {
        cap.restore();
      }

      expect(thrown).to.equal(boom);
      expect(await getIndexDoc(names[1]!), '1番目の chunk のトークンは登録済み').to.not.equal(undefined);
      expect(await getIndexDoc(names[22]!), '3番目の chunk は試行されない').to.equal(undefined);
    });

    it('フォールバック時、既存の共有トークン(他書類の posting あり)は update で df+1 され、他書類の posting は保持される', async () => {
      const hot = 'hotForUpdateKind';
      await saturateTokenDoc(generateTokenId(hot));
      const shared = 'sharedForFallback';
      await db.collection('search_index').doc(generateTokenId(shared)).set({
        updatedAt: Timestamp.now(),
        df: 5,
        postings: { 'other-doc': { score: 10, fieldsMask: 1, updatedAt: Timestamp.now() } },
      });

      const cap = captureConsoleError();
      try {
        await addDocumentToIndex('doc-upd', [token(hot), token(shared)]);
      } finally {
        cap.restore();
      }

      const data = (await getIndexDoc(shared))!;
      expect(data.df).to.equal(6);
      expect(Object.keys(data.postings).sort()).to.deep.equal(['doc-upd', 'other-doc']);
    });

    it('AC2: code=3 でもサイズ超過以外(too many index entries)なら、フォールバックせず throw し固定ログを出す', async () => {
      const tooMany = Object.assign(
        new Error('3 INVALID_ARGUMENT: too many index entries for entity /search_index/00000644'),
        { code: 3 }
      );
      let writeOpCalls = 0;
      const cap = captureConsoleError();
      let thrown: unknown;
      try {
        await addDocumentToIndex('doc-many', [token('manyA')], {
          commitOps: async () => {
            throw tooMany;
          },
          writeOp: async () => {
            writeOpCalls++;
          },
        });
      } catch (e) {
        thrown = e;
      } finally {
        cap.restore();
      }
      expect(thrown).to.equal(tooMany);
      expect(writeOpCalls, '別原因の INVALID_ARGUMENT でフォールバックに入らない').to.equal(0);
      expect(cap.calls.filter((c) => String(c[0]).includes(FAILED_LOG))).to.have.length(1);
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

    it('AC4(a)+飽和: 高頻度トークンが飽和した新規書類が自身の search 書込みで再発火しても、df・search メタは安定する(skip ログは処理ごとに1行=2行)', async () => {
      const docId = 'doc-chain-hot';
      const tokens = expectedTokens();
      const hotId = generateTokenId(tokens.find((t) => t.field === 'customer')!.token);
      await saturateTokenDoc(hotId);
      const hotBefore = (await db.collection('search_index').doc(hotId).get()).data();
      await db.doc(`documents/${docId}`).set(base);

      const cap = captureConsoleError();
      let afterEvent1: FirebaseFirestore.DocumentData;
      try {
        // イベント1: 新規作成 / イベント2: イベント1 の search メタ書込みによる再発火(before に search が無いので再索引される)
        await processSearchIndexTrigger(docId, undefined, base);
        afterEvent1 = (await db.doc(`documents/${docId}`).get()).data()!;
        await processSearchIndexTrigger(docId, base, afterEvent1);
      } finally {
        cap.restore();
      }

      const afterEvent2 = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(afterEvent2.search.skippedTokens, '再発火後も skippedTokens は同じ').to.deep.equal(afterEvent1.search.skippedTokens);
      expect(afterEvent2.search.tokens, '再発火後も tokens は同じ').to.deep.equal(afterEvent1.search.tokens);
      expect(afterEvent2.search.tokenHash).to.equal(afterEvent1.search.tokenHash);

      for (const { token: t } of tokens.filter((x) => generateTokenId(x.token) !== hotId)) {
        const data = (await getIndexDoc(t))!;
        expect(data.df, `${t} の df は posting 実数(1)のまま`).to.equal(1);
        expect(Object.keys(data.postings)).to.deep.equal([docId]);
      }
      expect((await db.collection('search_index').doc(hotId).get()).data(), '飽和した文書は不変').to.deep.equal(hotBefore);

      const skipLogs = cap.calls.filter((args) => typeof args[0] === 'string' && (args[0] as string).startsWith(SKIP_LOG));
      expect(skipLogs.length, '飽和トークンは posting が無いため、再発火でも再試行され skip ログが出る').to.equal(2);
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

    it('全トークンが飽和していても resolve し、search.tokens=[] / skippedTokens=全件 / tokenHash=全ハッシュ。以後の変更イベントでも壊れない', async () => {
      const docId = 'doc-all-hot';
      const tokens = expectedTokens();
      const ids = [...new Set(tokens.map((t) => generateTokenId(t.token)))];
      await saturateTokenDocs(ids);
      await db.doc(`documents/${docId}`).set(base);

      const cap = captureConsoleError();
      try {
        await processSearchIndexTrigger(docId, undefined, base);
      } finally {
        cap.restore();
      }

      const stored = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(stored.search.tokens).to.deep.equal([]);
      expect([...stored.search.skippedTokens].sort()).to.deep.equal([...new Set(tokens.map((t) => t.token))].sort());
      expect(stored.search.tokenHash).to.equal(generateTokensHash(tokens));

      // before.search.tokens が空配列(truthy)でも、書類の変更イベントで例外にならない
      const changed = { ...stored, customerName: 'ぜんぜんちがう名前' };
      await db.doc(`documents/${docId}`).set(changed);
      const cap2 = captureConsoleError();
      try {
        await processSearchIndexTrigger(docId, stored, changed);
      } finally {
        cap2.restore();
      }
      expect((await db.doc(`documents/${docId}`).get()).data()!.search.tokens).to.be.an('array');
    });

    it('スキップ後にその書類が変更されても、スキップ済みトークンの df を誤って減算しない(tokens にスキップ分を含めない理由)', async () => {
      const docId = 'doc-skip-then-edit';
      const tokens = expectedTokens();
      const hotToken = tokens.find((t) => t.field === 'customer')!.token;
      const hotId = generateTokenId(hotToken);
      // df を明示的な値にして、誤減算(df が 7 → 6)を検出できるようにする
      await saturateTokenDoc(hotId, { df: 7, postings: {} });
      await db.doc(`documents/${docId}`).set(base);

      const cap = captureConsoleError();
      try {
        await processSearchIndexTrigger(docId, undefined, base);
      } finally {
        cap.restore();
      }
      const stored = (await db.doc(`documents/${docId}`).get()).data()!;
      expect(stored.search.skippedTokens).to.include(hotToken);
      const hotBefore = (await db.collection('search_index').doc(hotId).get()).data();

      // 顧客名を全く別のものに変更(hot トークンは新しいトークン列に含まれない)
      const changed = { ...stored, customerName: 'zzqxv' };
      await db.doc(`documents/${docId}`).set(changed);
      const cap2 = captureConsoleError();
      try {
        await processSearchIndexTrigger(docId, stored, changed);
      } finally {
        cap2.restore();
      }

      const hotAfter = (await db.collection('search_index').doc(hotId).get()).data();
      expect(hotAfter, 'スキップ済みトークンの search_index(df=7)は変更されない').to.deep.equal(hotBefore);
      expect(hotAfter!.df).to.equal(7);
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
