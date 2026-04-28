/**
 * searchDocuments handler 統合テスト (Closes #401)
 *
 * 目的: PR #400 の handler 契約を最小スコープで fixate し、Issue #402
 * (OOM ガード + latency/read 計測ログ) で壊しやすい挙動を回帰検出可能にする。
 *
 * 検証する契約:
 *   AC1: AND 検索 (全単語マッチのみ結果に含まれる)
 *   AC2: 多段ソート 4 段 (fileDate desc → score desc → processedAt desc → docId asc)
 *   AC3: NULLS LAST (fileDate null は末尾。各群内は安定タイブレーク; score desc は AC2 で検証)
 *   AC4: pagination 安定性 (offset/limit 重複なし、hasMore 切替、fullPage との一致)
 *   AC5: orphan 除外 (search_index posting あるが documents 不在 → 結果・total から除外)
 *   AC6: HttpsError 契約 (unauthenticated / permission-denied / invalid-argument)
 *   AC7: cache 結果不変 + Firestore 空でも cache 経由で返る (cache 経路の behavioral 検証)
 *   AC8: 壊れた fileDate 混在でも 500 落ちせず正常データのみ返る (warn payload は safeToMillis 由来)
 *
 * Out of scope (PR 本文に明記):
 *   - raw query の PII ログ抑制 → #402 計測ログ整備時に同時対応
 *   - HttpsError('resource-exhausted') 検証 → #402 ガード実装と同時
 *   - 旧 posting フォーマット (postings.docId 形式) の互換性検証 → 別 Issue 化候補
 *   - read 回数の厳密固定 → #402 read 計測経路を変える余地を残す
 *
 * 実行: npm run test:integration (firebase emulators:exec --only firestore 経由)
 */

// helpers/initFirestoreEmulator を最初に import して default app + emulator host を初期化。
// searchDocuments.ts が module-level で getFirestore() を評価するため、import 順序が重要。
import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import functionsTest from 'firebase-functions-test';
import { HttpsError } from 'firebase-functions/v2/https';
import { searchDocuments } from '../src/search/searchDocuments';
import { generateTokenId } from '../src/utils/tokenizer';
import { cleanupCollections } from './helpers/cleanupEmulator';

const test = functionsTest();
const wrapped = test.wrap(searchDocuments);
const db = admin.firestore();

const COLLECTIONS_TO_CLEAN: readonly string[] = [
  'documents',
  'users',
  'search_index',
  'errors',
];

const DEFAULT_UID = 'test-user-401a';

// ============================================
// Seed Helpers
// ============================================

/** users/{uid} に whitelist エントリを作成 */
async function seedUser(uid: string = DEFAULT_UID): Promise<void> {
  await db.doc(`users/${uid}`).set({ email: `${uid}@example.com`, role: 'user' });
}

/**
 * search_index/{tokenId} に posting を seed する。
 *
 * tokenizer の細部 (bi-gram, STOP_WORDS, 正規化) に依存しないよう、
 * `generateTokenId(token)` で token ID を直接計算して seed する。
 *
 * 注意: handler 内 tokenizeQueryByWords は normalizeForSearch (toLowerCase 含む) を
 * 適用するため、token は **小文字 ASCII の合成語** で seed する必要がある。
 *
 * df を明示指定することで、handler の idf 計算 (idf = log((totalDocs+1)/(df+1))、
 * totalDocs = max(過去のdf)) に意図的な差を作れる。score desc 検証で重要。
 *
 * @param token 小文字 ASCII の単語 (例: "alpha")。query 単語と完全一致させること。
 * @param postings docId → { score, fieldsMask } のマップ
 * @param df Document Frequency (省略時は postings の件数)
 */
async function seedSearchIndex(
  token: string,
  postings: Record<string, { score: number; fieldsMask: number }>,
  df?: number
): Promise<void> {
  const tokenId = generateTokenId(token);
  const now = admin.firestore.Timestamp.now();
  const postingsWithUpdatedAt: Record<string, unknown> = {};
  for (const [docId, p] of Object.entries(postings)) {
    postingsWithUpdatedAt[docId] = { ...p, updatedAt: now };
  }
  await db.collection('search_index').doc(tokenId).set({
    updatedAt: now,
    df: df ?? Object.keys(postings).length,
    postings: postingsWithUpdatedAt,
  });
}

/**
 * documents/{docId} を seed (status='processed', processedAt=now がデフォルト)。
 * fileDate: undefined → null、それ以外は値を保持 (AC8 で broken type 注入用)。
 */
interface SeedDocumentInput {
  fileName?: string;
  customerName?: string;
  officeName?: string;
  documentType?: string;
  fileDate?: admin.firestore.Timestamp | null | unknown;
  processedAt?: admin.firestore.Timestamp;
  status?: string;
}

async function seedDocument(docId: string, data: SeedDocumentInput): Promise<void> {
  await db.doc(`documents/${docId}`).set({
    fileName: data.fileName ?? `${docId}.pdf`,
    customerName: data.customerName ?? '',
    officeName: data.officeName ?? '',
    documentType: data.documentType ?? '',
    fileDate: data.fileDate === undefined ? null : data.fileDate,
    processedAt: data.processedAt ?? admin.firestore.Timestamp.now(),
    status: data.status ?? 'processed',
  });
}

/** ISO 日付文字列から Firestore Timestamp を生成 */
function ts(iso: string): admin.firestore.Timestamp {
  return admin.firestore.Timestamp.fromDate(new Date(iso));
}

/** Callable wrap 呼出しの省略形 (auth context + data) */
async function callSearch(
  data: { query: string; limit?: number; offset?: number },
  uid: string | null = DEFAULT_UID
): Promise<{
  documents: Array<{
    id: string;
    fileName: string;
    customerName: string;
    officeName: string;
    documentType: string;
    fileDate: string | null;
    score: number;
  }>;
  total: number;
  hasMore: boolean;
}> {
  const auth = uid === null ? undefined : { uid, token: {} as Record<string, unknown> };
  // wrap() awaits and re-throws handler errors as Promise rejections (AC6 が依存)。
  // rawRequest は CallableRequest 型で要求されるが handler 側で参照しないため空 object。
  const request = { auth, data, rawRequest: {} } as unknown as Parameters<typeof wrapped>[0];
  return wrapped(request);
}

/**
 * search_index に simple な fileName-field posting を 1 件 seed するヘルパー。
 * (FIELD_WEIGHTS.fileName=1, fieldsMask=8 が fileName field)
 */
async function seedSimplePosting(
  token: string,
  docId: string,
  score: number = 1.0
): Promise<void> {
  await seedSearchIndex(token, { [docId]: { score, fieldsMask: 8 } });
}

/**
 * HttpsError を期待する非同期処理を assert するヘルパー。
 *
 * 重要: 単純な try/catch + expect.fail() パターンは下記の二重バグを抱える:
 *   1. expect.fail() の AssertionError を catch が拾い、混乱したエラーメッセージになる
 *   2. HttpsError 以外の throw (TypeError 等) でも .code が偶然一致すれば合格してしまう
 *
 * 本ヘルパーは `let caught` + `instanceof HttpsError` の厳密チェックで両方解消する。
 */
async function expectHttpsError(
  action: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  let caught: unknown = undefined;
  try {
    await action();
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected HttpsError(${expectedCode}) to be thrown`).to.be.instanceOf(
    HttpsError
  );
  expect((caught as HttpsError).code).to.equal(expectedCode);
}

// ============================================
// Tests
// ============================================

describe('searchDocuments handler integration (#401a, Closes #401)', () => {
  // 各 it 終了時に状態をクリーン化。cache module-scope の汚染は query をテスト毎に
  // 一意化することで回避 (AC7 のみ意図的に同 key を 2 回使う)。
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  // ----------------------------------------
  // smoke: callable 起動 + auth/whitelist + 最小 successful search
  // ----------------------------------------
  describe('smoke', () => {
    it('whitelist あり user で 1 件マッチを返す', async () => {
      await seedUser();
      await seedSimplePosting('smokeword', 'doc-smoke', 5.0);
      await seedDocument('doc-smoke', {
        fileName: 'smoke document.pdf',
        fileDate: ts('2026-04-27'),
      });

      const result = await callSearch({ query: 'smokeword' });

      expect(result.total).to.equal(1);
      expect(result.documents).to.have.length(1);
      expect(result.documents[0]!.id).to.equal('doc-smoke');
      expect(result.hasMore).to.be.false;
    });
  });

  // ----------------------------------------
  // AC1: AND 検索
  // ----------------------------------------
  describe('AC1: AND 検索', () => {
    it('複数単語クエリで全単語にマッチする doc のみ結果に含まれる', async () => {
      await seedUser();
      // doc-A: alphaone のみ / doc-B: bravotwo のみ / doc-C: 両方
      await seedSearchIndex('alphaone', {
        'doc-A': { score: 1.0, fieldsMask: 8 },
        'doc-C': { score: 1.0, fieldsMask: 8 },
      });
      await seedSearchIndex('bravotwo', {
        'doc-B': { score: 1.0, fieldsMask: 8 },
        'doc-C': { score: 1.0, fieldsMask: 8 },
      });
      await seedDocument('doc-A', { fileDate: ts('2026-04-27') });
      await seedDocument('doc-B', { fileDate: ts('2026-04-27') });
      await seedDocument('doc-C', { fileDate: ts('2026-04-27') });

      const result = await callSearch({ query: 'alphaone bravotwo' });

      expect(result.total).to.equal(1);
      expect(result.documents.map((d) => d.id)).to.deep.equal(['doc-C']);
    });
  });

  // ----------------------------------------
  // AC2: 多段ソート 4 段 (score-desc 段が機能していることを fixture で強制検証)
  //
  // 設計のキー: 2 token AND + token 順 (token1 高 df / token2 低 df) で idf > 0 を成立させる。
  // handler の idf 計算は totalDocs = max(過去 indexData.df) を使うため、最初に高 df、
  // 次に低 df の順で snapshot を見ると 2 番目の token で idf > 0 となり、posting score の
  // 差が最終 score に反映される。
  //
  // docId 命名は「score 高い doc ほど辞書順で大きい」(z > y > a/b/c) にすることで、
  // handler から score 比較を削除した場合に tier-4 docId asc tiebreak で順序が逆転し、
  // テストが FAIL するように仕掛ける (false-positive 防止)。
  // ----------------------------------------
  describe('AC2: 多段ソート 4 段 handler レベル', () => {
    it('全 4 段の tie-break が handler レベルで正しく適用される (score desc も実差検証)', async () => {
      await seedUser();
      // token1 "ac2common": df=100 (人為的に大きい値)、5 doc 全部に posting
      // token2 "ac2rare":   df=2 (実 posting count と異なるが totalDocs に影響しない)、5 doc 全部に posting
      // → 最初の token (ac2common) で totalDocs=100、次の token (ac2rare) で
      //   idf = log(101 / 3) ≈ 3.52 が成立 → bravo 経由の score 差が最終 score に反映
      const fiveDocsCommon: Record<string, { score: number; fieldsMask: number }> = {
        'd-newer-z-high': { score: 1.0, fieldsMask: 8 },
        'd-newer-y-mid': { score: 1.0, fieldsMask: 8 },
        'd-old-newproc-c': { score: 1.0, fieldsMask: 8 },
        'd-old-oldproc-a': { score: 1.0, fieldsMask: 8 },
        'd-old-oldproc-b': { score: 1.0, fieldsMask: 8 },
      };
      const fiveDocsRare: Record<string, { score: number; fieldsMask: number }> = {
        'd-newer-z-high': { score: 5.0, fieldsMask: 8 }, // 同日付内で最高 score → 1 番目
        'd-newer-y-mid': { score: 1.0, fieldsMask: 8 }, // 同日付内で低 score → 2 番目
        'd-old-newproc-c': { score: 1.0, fieldsMask: 8 }, // 旧日付 + 新 processedAt → 3 番目
        'd-old-oldproc-a': { score: 1.0, fieldsMask: 8 }, // 旧日付 + 旧 processedAt + docId 'a' → 4 番目
        'd-old-oldproc-b': { score: 1.0, fieldsMask: 8 }, // 旧日付 + 旧 processedAt + docId 'b' → 5 番目
      };
      await seedSearchIndex('ac2common', fiveDocsCommon, 100);
      await seedSearchIndex('ac2rare', fiveDocsRare, 2);

      const newerDate = ts('2026-04-27');
      const olderDate = ts('2026-01-01');
      const newerProc = ts('2026-04-27T15:00:00Z');
      const olderProc = ts('2026-04-27T10:00:00Z');
      await seedDocument('d-newer-z-high', { fileDate: newerDate, processedAt: olderProc });
      await seedDocument('d-newer-y-mid', { fileDate: newerDate, processedAt: olderProc });
      await seedDocument('d-old-newproc-c', { fileDate: olderDate, processedAt: newerProc });
      await seedDocument('d-old-oldproc-a', { fileDate: olderDate, processedAt: olderProc });
      await seedDocument('d-old-oldproc-b', { fileDate: olderDate, processedAt: olderProc });

      const result = await callSearch({ query: 'ac2common ac2rare' });

      // 期待順:
      //   tier-1 fileDate desc: newer 群 (z-high, y-mid) → old 群 (3 件)
      //   tier-2 score desc:    newer 群内で z-high (5.0) > y-mid (1.0)
      //                         old 群は全部 score 同じ (1.0)
      //   tier-3 processedAt desc: old 群で newproc-c > oldproc-* 群
      //   tier-4 docId asc:     old 群 oldproc 内で 'a' < 'b'
      expect(result.documents.map((d) => d.id)).to.deep.equal([
        'd-newer-z-high',
        'd-newer-y-mid',
        'd-old-newproc-c',
        'd-old-oldproc-a',
        'd-old-oldproc-b',
      ]);

      // false-positive 防止 sanity check: 1 番目の score は 2 番目より厳密に大きい
      // (= score-desc 段が実際に機能している証跡)
      expect(result.documents[0]!.score).to.be.greaterThan(result.documents[1]!.score);
    });
  });

  // ----------------------------------------
  // AC3: NULLS LAST
  // ----------------------------------------
  describe('AC3: NULLS LAST', () => {
    it('fileDate null の doc は末尾に集まる (各群内は安定タイブレークで docId asc)', async () => {
      // 注意: 単一 token の search_index では df=totalDocs となり idf=log(1)=0、
      // tokenScore=0 になるため score 比較は機能しない。本 AC は「null が末尾」を
      // 主契約とし、各群内の順序は安定タイブレーク (processedAt desc → docId asc) に
      // 委ねる。score desc の handler レベル検証は AC2 でカバー済。
      await seedUser();
      await seedSearchIndex('ac3nullword', {
        'd-dated-high': { score: 5.0, fieldsMask: 8 },
        'd-dated-low': { score: 1.0, fieldsMask: 8 },
        'd-null-high': { score: 5.0, fieldsMask: 8 },
        'd-null-low': { score: 1.0, fieldsMask: 8 },
      });
      const date = ts('2026-04-27');
      const proc = ts('2026-04-27T12:00:00Z');
      await seedDocument('d-dated-high', { fileDate: date, processedAt: proc });
      await seedDocument('d-dated-low', { fileDate: date, processedAt: proc });
      await seedDocument('d-null-high', { fileDate: null, processedAt: proc });
      await seedDocument('d-null-low', { fileDate: null, processedAt: proc });

      const result = await callSearch({ query: 'ac3nullword' });

      // dated 群 (docId asc) → null 群 (docId asc)
      expect(result.documents.map((d) => d.id)).to.deep.equal([
        'd-dated-high',
        'd-dated-low',
        'd-null-high',
        'd-null-low',
      ]);
    });
  });

  // ----------------------------------------
  // AC4: pagination 安定性
  // ----------------------------------------
  describe('AC4: pagination 安定性', () => {
    it('limit + offset で 4 段ソートをまたいでも重複・欠落なく hasMore が切替わり、fullPage と一致する', async () => {
      await seedUser();
      // AC2 と同じ「score-desc が機能する」fixture (token 順 + df 差で idf > 0)
      const docsCommon: Record<string, { score: number; fieldsMask: number }> = {
        'p1-newer-z-high': { score: 1.0, fieldsMask: 8 },
        'p2-newer-y-mid': { score: 1.0, fieldsMask: 8 },
        'p3-old-newproc-c': { score: 1.0, fieldsMask: 8 },
        'p4-old-oldproc-a': { score: 1.0, fieldsMask: 8 },
        'p5-old-oldproc-b': { score: 1.0, fieldsMask: 8 },
      };
      const docsRare: Record<string, { score: number; fieldsMask: number }> = {
        'p1-newer-z-high': { score: 5.0, fieldsMask: 8 },
        'p2-newer-y-mid': { score: 1.0, fieldsMask: 8 },
        'p3-old-newproc-c': { score: 1.0, fieldsMask: 8 },
        'p4-old-oldproc-a': { score: 1.0, fieldsMask: 8 },
        'p5-old-oldproc-b': { score: 1.0, fieldsMask: 8 },
      };
      await seedSearchIndex('ac4common', docsCommon, 100);
      await seedSearchIndex('ac4rare', docsRare, 2);

      const newer = ts('2026-04-27');
      const older = ts('2026-01-01');
      const newProc = ts('2026-04-27T15:00:00Z');
      const oldProc = ts('2026-04-27T10:00:00Z');
      await seedDocument('p1-newer-z-high', { fileDate: newer, processedAt: oldProc });
      await seedDocument('p2-newer-y-mid', { fileDate: newer, processedAt: oldProc });
      await seedDocument('p3-old-newproc-c', { fileDate: older, processedAt: newProc });
      await seedDocument('p4-old-oldproc-a', { fileDate: older, processedAt: oldProc });
      await seedDocument('p5-old-oldproc-b', { fileDate: older, processedAt: oldProc });

      const expectedOrder = [
        'p1-newer-z-high',
        'p2-newer-y-mid',
        'p3-old-newproc-c',
        'p4-old-oldproc-a',
        'p5-old-oldproc-b',
      ];

      // page 1: limit=2, offset=0
      const page1 = await callSearch({ query: 'ac4common ac4rare', limit: 2, offset: 0 });
      expect(page1.total).to.equal(5);
      expect(page1.hasMore).to.be.true;
      expect(page1.documents.map((d) => d.id)).to.deep.equal(expectedOrder.slice(0, 2));

      // page 2: limit=2, offset=2
      const page2 = await callSearch({ query: 'ac4common ac4rare', limit: 2, offset: 2 });
      expect(page2.total).to.equal(5);
      expect(page2.hasMore).to.be.true;
      expect(page2.documents.map((d) => d.id)).to.deep.equal(expectedOrder.slice(2, 4));

      // page 3 (last): limit=2, offset=4
      const page3 = await callSearch({ query: 'ac4common ac4rare', limit: 2, offset: 4 });
      expect(page3.total).to.equal(5);
      expect(page3.hasMore).to.be.false;
      expect(page3.documents.map((d) => d.id)).to.deep.equal(expectedOrder.slice(4));

      // 重複・欠落がないこと
      const concatenated = [
        ...page1.documents.map((d) => d.id),
        ...page2.documents.map((d) => d.id),
        ...page3.documents.map((d) => d.id),
      ];
      expect(new Set(concatenated).size).to.equal(5);

      // 「pagination は同一の決定論的ソート結果を slicing しているだけ」を保証:
      // limit=10 の単一クエリ結果と、3 page を結合した順序が一致する。
      // 別 cache key (limit/offset 違い) で fullPage を取得するため、cache hit ではない。
      const fullPage = await callSearch({
        query: 'ac4common ac4rare',
        limit: 10,
        offset: 0,
      });
      expect(fullPage.documents.map((d) => d.id)).to.deep.equal(expectedOrder);
      expect(concatenated).to.deep.equal(fullPage.documents.map((d) => d.id));
    });
  });

  // ----------------------------------------
  // AC5: orphan 除外
  // ----------------------------------------
  describe('AC5: orphan 除外', () => {
    it('search_index posting あるが documents 不在の doc は結果・total から除外される', async () => {
      // Out-of-scope (PR 本文 / 冒頭 docstring): 警告ログの payload (raw query 含む) は
      // 固定しない。#402 計測ログ整備時に再評価。
      await seedUser();
      // 5 件 posting、うち 2 件は documents 側を作らない (orphan)
      await seedSearchIndex('ac5orphanword', {
        'live-1': { score: 1.0, fieldsMask: 8 },
        'live-2': { score: 1.0, fieldsMask: 8 },
        'live-3': { score: 1.0, fieldsMask: 8 },
        'orphan-1': { score: 1.0, fieldsMask: 8 },
        'orphan-2': { score: 1.0, fieldsMask: 8 },
      });
      await seedDocument('live-1', { fileDate: ts('2026-04-27') });
      await seedDocument('live-2', { fileDate: ts('2026-04-26') });
      await seedDocument('live-3', { fileDate: ts('2026-04-25') });
      // orphan-1, orphan-2 は documents 側に存在しない

      const result = await callSearch({ query: 'ac5orphanword' });

      expect(result.total).to.equal(3);
      expect(result.documents.map((d) => d.id)).to.deep.equal(['live-1', 'live-2', 'live-3']);
      // orphan は結果に含まれない
      expect(result.documents.map((d) => d.id)).to.not.include('orphan-1');
      expect(result.documents.map((d) => d.id)).to.not.include('orphan-2');
    });
  });

  // ----------------------------------------
  // AC6: HttpsError 契約
  // ----------------------------------------
  describe('AC6: HttpsError 契約', () => {
    it('auth=null → unauthenticated', async () => {
      await seedUser();
      await seedSimplePosting('ac6authword', 'doc-ac6-1');
      await seedDocument('doc-ac6-1', { fileDate: ts('2026-04-27') });

      await expectHttpsError(
        () => callSearch({ query: 'ac6authword' }, null),
        'unauthenticated'
      );
    });

    it('whitelist なし user → permission-denied', async () => {
      // users/{uid} を seed しない
      await seedSimplePosting('ac6permword', 'doc-ac6-2');
      await seedDocument('doc-ac6-2', { fileDate: ts('2026-04-27') });

      await expectHttpsError(
        () => callSearch({ query: 'ac6permword' }, 'unknown-user-uid'),
        'permission-denied'
      );
    });

    it('空 query → invalid-argument', async () => {
      await seedUser();
      await expectHttpsError(() => callSearch({ query: '' }), 'invalid-argument');
    });

    it('query 100 文字超 → invalid-argument', async () => {
      await seedUser();
      const longQuery = 'a'.repeat(101);
      await expectHttpsError(() => callSearch({ query: longQuery }), 'invalid-argument');
    });

    it('limit=0 → invalid-argument', async () => {
      await seedUser();
      await expectHttpsError(
        () => callSearch({ query: 'ac6limit0', limit: 0 }),
        'invalid-argument'
      );
    });

    it('limit=51 → invalid-argument', async () => {
      await seedUser();
      await expectHttpsError(
        () => callSearch({ query: 'ac6limit51', limit: 51 }),
        'invalid-argument'
      );
    });
  });

  // ----------------------------------------
  // AC7: cache 結果不変 + Firestore 空でも cache 経由で返る
  //
  // 「同 key の 2 回目で結果不変」だけでは cache 無効化された regression を検出できない
  // (1 回目と 2 回目の Firestore 状態が同じなら cache なしでも同じ結果が返る)。
  // 本 AC では 2 回目呼出し前に Firestore を全削除し、users のみ再 seed する。
  // 結果が 1 回目と同じなら、cache 経由しか説明がつかない (cache が機能している証跡)。
  // ----------------------------------------
  describe('AC7: cache 経路 behavioral 検証', () => {
    it('2 回目呼出し前に Firestore を空にしても cache hit で同じ結果が返る', async () => {
      await seedUser();
      await seedSearchIndex('ac7cacheword', {
        'doc-cache-1': { score: 1.0, fieldsMask: 8 },
      });
      await seedDocument('doc-cache-1', {
        fileName: 'first version.pdf',
        fileDate: ts('2026-04-27'),
      });

      // 1 回目: cache miss → DB から取得
      const first = await callSearch({ query: 'ac7cacheword' });
      expect(first.total).to.equal(1);
      expect(first.documents[0]!.fileName).to.equal('first version.pdf');

      // Firestore を空にする (search_index, documents, errors を全削除)。
      // users は再 seed する (whitelist チェックは cache hit 経路でも実行されるため)。
      await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
      await seedUser();

      // 2 回目: 同 (query, limit, offset) → cache hit。
      // search_index/documents が空でも結果が返る = cache 経由しか説明がつかない。
      const second = await callSearch({ query: 'ac7cacheword' });
      expect(second.total).to.equal(1);
      expect(second.documents[0]!.fileName).to.equal('first version.pdf');
      expect(second.documents).to.deep.equal(first.documents);
    });
  });

  // ----------------------------------------
  // AC8: 壊れた fileDate 混在でも 500 落ちしない
  // ----------------------------------------
  describe('AC8: 壊れた fileDate 防御', () => {
    // console.warn の spy は afterEach で必ず restore (テスト間汚染防止)。
    let originalWarn: typeof console.warn;
    let warnCalls: unknown[][];

    beforeEach(() => {
      originalWarn = console.warn;
      warnCalls = [];
      console.warn = (...args: unknown[]) => {
        warnCalls.push(args);
      };
    });

    afterEach(() => {
      console.warn = originalWarn;
    });

    it('string/plain object の fileDate でも handler は 500 落ちせず正常データを返す', async () => {
      // 注意: Firestore admin SDK は JS Date を自動的に Timestamp に変換するため、
      // Date インスタンスは「壊れた値」として再現できない (admin SDK 仕様)。
      // 本 AC では「safeToMillis で防御される非 Timestamp 値」として string と
      // plain object のみ検証する。
      await seedUser();
      await seedSearchIndex('ac8brokenword', {
        'd-good': { score: 1.0, fieldsMask: 8 },
        'd-string': { score: 1.0, fieldsMask: 8 },
        'd-plain': { score: 1.0, fieldsMask: 8 },
      });
      const proc = ts('2026-04-27T12:00:00Z');
      await seedDocument('d-good', { fileDate: ts('2026-04-27'), processedAt: proc });
      // 壊れた値: string / plain object (Firestore は型を保ったまま保存する)
      await seedDocument('d-string', {
        fileDate: '2026-04-27' as unknown as null,
        processedAt: proc,
      });
      await seedDocument('d-plain', {
        fileDate: { seconds: 100 } as unknown as null,
        processedAt: proc,
      });

      const result = await callSearch({ query: 'ac8brokenword' });

      // 3 件全部結果に含まれる (壊れた値は fileDate=null 扱いで NULLS LAST)
      expect(result.total).to.equal(3);
      const ids = result.documents.map((d) => d.id);
      // d-good が先頭 (fileDate あり)、残り 2 件は末尾群 (fileDate=null 扱い、docId asc)
      expect(ids).to.deep.equal(['d-good', 'd-plain', 'd-string']);

      // safeToMillis 由来の warn が 2 件以上 (string/plain それぞれ) 出ていること。
      // 単純に length >= 2 だと無関係 warn でも合格してしまうため、関数名/メッセージを
      // パターンマッチで絞り込む (false-positive 防止)。
      const safeToMillisWarns = warnCalls.filter((args) =>
        args.some(
          (a) =>
            typeof a === 'string' &&
            /fileDate|safeToMillis|not a Timestamp|toMillis/i.test(a)
        )
      );
      expect(safeToMillisWarns.length).to.be.at.least(2);
    });
  });

  // ----------------------------------------
  // AC9: perf observability ログ (Issue #402 段階1)
  // ----------------------------------------
  describe('AC9: perf observability ログ', () => {
    let originalInfo: typeof console.info;
    let infoCalls: unknown[][];

    beforeEach(() => {
      originalInfo = console.info;
      infoCalls = [];
      console.info = (...args: unknown[]) => {
        infoCalls.push(args);
      };
    });

    afterEach(() => {
      console.info = originalInfo;
    });

    it('閾値未満のマッチでは perf ログが出力されない (ノイズ抑制)', async () => {
      // Arrange: 5 件のみ seed (matchedCount=5, 100 件閾値未満)
      await seedUser();
      const postings: Record<string, { score: number; fieldsMask: number }> = {};
      for (let i = 1; i <= 5; i++) {
        postings[`ac9doc${i}`] = { score: 1.0, fieldsMask: 8 };
      }
      await seedSearchIndex('ac9smallword', postings);
      const proc = ts('2026-04-27T12:00:00Z');
      for (let i = 1; i <= 5; i++) {
        await seedDocument(`ac9doc${i}`, {
          fileName: `file-${i}.pdf`,
          processedAt: proc,
        });
      }

      // Act
      const result = await callSearch({ query: 'ac9smallword' });

      // Assert: 結果は正常 + perf ログは出力されない
      expect(result.total).to.equal(5);
      const perfLogs = infoCalls.filter((args) =>
        args.some((a) => typeof a === 'string' && a.includes('[searchDocuments] perf'))
      );
      expect(perfLogs).to.have.lengthOf(0);
    });
  });
});
