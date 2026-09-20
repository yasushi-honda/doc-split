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
  truncated?: boolean;
  actualMatchedCount?: number;
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

  // ----------------------------------------
  // AC10: OOM ガード暫定 (Issue #402 段階2)
  //
  // filteredDocs.length > MAX_GETALL (=500) のとき、score 降順で上位 MAX_GETALL 件
  // のみを getAll する。fileDate ソートは MAX_GETALL 件の範囲内に限定 (部分犠牲)。
  // 256MiB Functions の OOM 防止が目的。本 AC では production 定数 MAX_GETALL=500
  // に依存しつつ、501 件で境界 +1 を検証する (production 定数の変更は別 PR で扱う)。
  // ----------------------------------------
  describe('AC10: OOM ガード暫定 (#402 段階2)', () => {
    let originalWarn: typeof console.warn;
    let warnCalls: unknown[][];
    let originalInfo: typeof console.info;
    let infoCalls: unknown[][];

    beforeEach(() => {
      originalWarn = console.warn;
      warnCalls = [];
      console.warn = (...args: unknown[]) => {
        warnCalls.push(args);
      };
      originalInfo = console.info;
      infoCalls = [];
      console.info = (...args: unknown[]) => {
        infoCalls.push(args);
      };
    });

    afterEach(() => {
      console.warn = originalWarn;
      console.info = originalInfo;
    });

    it('matchedCount > 500 のとき score 上位 500 件のみ取得、warn 発火 + truncated=true', async () => {
      await seedUser();

      // AC2 と同じ「score-desc を実 fixture で強制検証」設計:
      // 2 token AND + token 順 (token1 高 df / token2 低 df) で idf > 0 を成立させる。
      // 単一 token search では totalDocs == df となり idf = log(1) = 0 で score 差が
      // 消えるため、501 件全件が同 score になり OOM ガードの「上位 N 件取得」が
      // 検証できない (前回 fail 原因)。
      //
      // ac10common: df=10000 (人為値)、501 doc 全部に posting (score=1.0)
      // ac10rare:   df=2 (人為値)、    501 doc 全部に posting (score=1..501)
      // → 最初の token (ac10common) で totalDocs=10000、次の token (ac10rare) で
      //   idf = log(10001/3) ≈ 8.12 が成立 → ac10rare 経由の score=i*8.12 が最終 score
      const MATCHED = 501;
      const TRUNCATE_LIMIT = 500;
      const commonPostings: Record<string, { score: number; fieldsMask: number }> = {};
      const rarePostings: Record<string, { score: number; fieldsMask: number }> = {};
      for (let i = 1; i <= MATCHED; i++) {
        const docId = `doc-ac10-${String(i).padStart(3, '0')}`;
        commonPostings[docId] = { score: 1.0, fieldsMask: 8 };
        rarePostings[docId] = { score: i, fieldsMask: 8 };
      }
      await seedSearchIndex('ac10common', commonPostings, 10000);
      await seedSearchIndex('ac10rare', rarePostings, 2);

      // documents を batch write で seed (admin SDK batch 制限 500 op/commit のため 2 batch)。
      const proc = ts('2026-04-27T12:00:00Z');
      for (let batchStart = 1; batchStart <= MATCHED; batchStart += 400) {
        const batch = db.batch();
        const batchEnd = Math.min(batchStart + 399, MATCHED);
        for (let i = batchStart; i <= batchEnd; i++) {
          const docId = `doc-ac10-${String(i).padStart(3, '0')}`;
          batch.set(db.doc(`documents/${docId}`), {
            fileName: `oom-${docId}.pdf`,
            customerName: '',
            officeName: '',
            documentType: '',
            fileDate: null,
            processedAt: proc,
            status: 'processed',
          });
        }
        await batch.commit();
      }

      // Act
      const result = await callSearch({
        query: 'ac10common ac10rare',
        limit: 50,
        offset: 0,
      });

      // Assert 1: total は取得した件数 (MAX_GETALL=500)。 全マッチ 501 件中 1 件は犠牲。
      expect(result.total).to.equal(TRUNCATE_LIMIT);
      expect(result.hasMore).to.be.true;

      // Assert 1b: silent loss 防止 (silent-failure-hunter CRT-1 対応)。
      // 切り捨て発動時は SearchResult に truncated=true + actualMatchedCount=実マッチ件数を
      // 含める。FE で「上位 N 件のみ表示」バナー表示用 (follow-up PR で消費)。
      expect((result as { truncated?: boolean }).truncated).to.equal(true);
      expect((result as { actualMatchedCount?: number }).actualMatchedCount).to.equal(MATCHED);

      // Assert 2: 除外される 1 件 (score=1, doc-ac10-001) は結果セットに含まれない。
      // limit=50 で 1 ページ目を取る場合、score 降順なら上位 50 件 (501..452) で 001 は含まれない。
      const ids = result.documents.map((d) => d.id);
      expect(ids).to.not.include('doc-ac10-001');

      // Assert 3: 1 ページ目は score 上位 50 件 (501..452) が含まれる。
      // fileDate=null + processedAt 同一 + score 降順 → ID 末尾 501..452 が並ぶ。
      const expectedTopIds = Array.from(
        { length: 50 },
        (_, k) => `doc-ac10-${String(MATCHED - k).padStart(3, '0')}`
      );
      expect(ids).to.deep.equal(expectedTopIds);

      // Assert 4: console.warn が発火している (OOM ガード payload を pattern match で絞り込む)。
      const guardWarns = warnCalls.filter((args) =>
        args.some(
          (a) => typeof a === 'string' && a.includes('exceeds safe getAll limit')
        )
      );
      expect(guardWarns).to.have.lengthOf(1);

      // Assert 5: warn payload は queryLength のみ含み raw query は含まない (PII リスク対策)。
      // payload は 2 番目の argument (object) として渡される。
      const guardPayload = guardWarns[0]![1] as {
        queryLength?: number;
        matchedCount?: number;
        limit?: number;
        query?: string;
      };
      expect(guardPayload.queryLength).to.equal('ac10common ac10rare'.length);
      expect(guardPayload.matchedCount).to.equal(MATCHED);
      expect(guardPayload.limit).to.equal(TRUNCATE_LIMIT);
      expect(guardPayload).to.not.have.property('query');

      // Assert 5b: PII 防御 negative — raw query 文字列が warn payload のどの key 経由でも
      // 漏れないことを全文検索で固定 (key 改名で漏れるリスクへの 2 段防御)。pr-test-analyzer
      // SUGGESTION #6 対応。
      const guardWarnSerialized = JSON.stringify(guardWarns[0]);
      expect(
        guardWarnSerialized,
        'raw query "ac10common ac10rare" must not appear in warn payload'
      ).to.not.include('ac10common ac10rare');

      // Assert 6: perf info ログに truncated=true が反映される (matchedCount は実マッチ数 501)。
      const perfLogs = infoCalls.filter((args) =>
        args.some((a) => typeof a === 'string' && a.includes('[searchDocuments] perf'))
      );
      expect(perfLogs).to.have.lengthOf(1);
      const perfPayload = perfLogs[0]![1] as {
        matchedCount?: number;
        fetchedCount?: number;
        truncated?: boolean;
      };
      expect(perfPayload.matchedCount).to.equal(MATCHED);
      expect(perfPayload.fetchedCount).to.equal(TRUNCATE_LIMIT);
      expect(perfPayload.truncated).to.be.true;
    }).timeout(60000); // 501 件 seed + getAll で時間がかかる場合のマージン

    it('matchedCount <= 500 のとき OOM ガード warn は発火せず truncated=false', async () => {
      // 境界の反対側: 100 件 (perf info ログ閾値は超えるが OOM ガードは未発動) を seed。
      await seedUser();
      const COUNT = 150;
      const postings: Record<string, { score: number; fieldsMask: number }> = {};
      for (let i = 1; i <= COUNT; i++) {
        postings[`doc-ac10b-${i}`] = { score: i, fieldsMask: 8 };
      }
      await seedSearchIndex('ac10bbelowword', postings);

      const proc = ts('2026-04-27T12:00:00Z');
      const batch = db.batch();
      for (let i = 1; i <= COUNT; i++) {
        batch.set(db.doc(`documents/doc-ac10b-${i}`), {
          fileName: `below-${i}.pdf`,
          customerName: '',
          officeName: '',
          documentType: '',
          fileDate: null,
          processedAt: proc,
          status: 'processed',
        });
      }
      await batch.commit();

      // Act
      const result = await callSearch({
        query: 'ac10bbelowword',
        limit: 50,
        offset: 0,
      });

      // Assert: 全件取得 + OOM warn 未発火 + perf info の truncated=false + 結果に
      // truncated/actualMatchedCount フィールドが付与されない (silent-failure-hunter
      // CRT-1 と対称な non-firing 側 fixate)。
      expect(result.total).to.equal(COUNT);
      expect((result as { truncated?: boolean })).to.not.have.property('truncated');
      expect((result as { actualMatchedCount?: number })).to.not.have.property(
        'actualMatchedCount'
      );
      const guardWarns = warnCalls.filter((args) =>
        args.some(
          (a) => typeof a === 'string' && a.includes('exceeds safe getAll limit')
        )
      );
      expect(guardWarns).to.have.lengthOf(0);

      const perfLogs = infoCalls.filter((args) =>
        args.some((a) => typeof a === 'string' && a.includes('[searchDocuments] perf'))
      );
      // matchedCount=150 > 100 閾値なので perf info ログは出力される
      expect(perfLogs).to.have.lengthOf(1);
      const perfPayload = perfLogs[0]![1] as { truncated?: boolean; matchedCount?: number };
      expect(perfPayload.matchedCount).to.equal(COUNT);
      expect(perfPayload.truncated).to.be.false;
    }).timeout(30000);

    // ----------------------------------------
    // AC10-c: fileDate 部分犠牲 — score 下位は fileDate 最新でも犠牲対象 (Issue #497、
    //         PR #496 レビュー pr-test-analyzer IMPORTANT-1 対応)
    //
    // OOM ガードは score 降順切り捨てで上位 MAX_GETALL 件のみ getAll する設計。fileDate
    // ソート (compareSearchResults の tier-1) は MAX_GETALL 件の範囲内に限定 (= 全体
    // ソートの「部分犠牲」)。本テストは「score 最下位 (= 犠牲対象) に最新 fileDate を
    // 仕込んでも結果に含まれない」ことを 1 アサーションで固定し、将来「ガード前に
    // fileDate sort してから getAll」へ書き換わるリファクタを回帰検出可能にする。
    // ----------------------------------------
    it('fileDate 部分犠牲 — score 下位は fileDate 最新でも犠牲対象 (IMPORTANT-1)', async () => {
      await seedUser();

      // AC10 発動側と同じ「2 token AND + 高 df / 低 df」設計で idf > 0 を成立させる。
      // 501 件のうち doc-ac10c-001 (score=1、最下位) のみ将来 fileDate を持たせ、残りは
      // null。ガード発動で doc-ac10c-001 が犠牲になることを「fileDate 最新でも除外」で
      // 明示検証する。
      const MATCHED = 501;
      const TRUNCATE_LIMIT = 500;
      const commonPostings: Record<string, { score: number; fieldsMask: number }> = {};
      const rarePostings: Record<string, { score: number; fieldsMask: number }> = {};
      for (let i = 1; i <= MATCHED; i++) {
        const docId = `doc-ac10c-${String(i).padStart(3, '0')}`;
        commonPostings[docId] = { score: 1.0, fieldsMask: 8 };
        rarePostings[docId] = { score: i, fieldsMask: 8 };
      }
      await seedSearchIndex('ac10ccommon', commonPostings, 10000);
      await seedSearchIndex('ac10crare', rarePostings, 2);

      const proc = ts('2026-04-27T12:00:00Z');
      // 上位 500 件 (doc-ac10c-002..doc-ac10c-501): fileDate=null
      // 最下位 1 件 (doc-ac10c-001): fileDate=2099-01-01 (将来日付、ソート tier-1 では最先頭)
      const futureFileDate = ts('2099-01-01T00:00:00Z');
      for (let batchStart = 1; batchStart <= MATCHED; batchStart += 400) {
        const batch = db.batch();
        const batchEnd = Math.min(batchStart + 399, MATCHED);
        for (let i = batchStart; i <= batchEnd; i++) {
          const docId = `doc-ac10c-${String(i).padStart(3, '0')}`;
          batch.set(db.doc(`documents/${docId}`), {
            fileName: `oom-fd-${docId}.pdf`,
            customerName: '',
            officeName: '',
            documentType: '',
            fileDate: i === 1 ? futureFileDate : null, // score=1 (最下位) のみ最新 fileDate
            processedAt: proc,
            status: 'processed',
          });
        }
        await batch.commit();
      }

      // Act
      const result = await callSearch({
        query: 'ac10ccommon ac10crare',
        limit: 50,
        offset: 0,
      });

      // Assert: doc-ac10c-001 は fileDate 最新だが score 最下位のため犠牲対象。
      // ガード発動なしの設計 (= fileDate sort 先行で getAll する実装) では doc-ac10c-001
      // が tier-1 fileDate desc で結果先頭に来るはずだが、本実装 (score 降順切り捨て)
      // では犠牲対象になり結果セットに含まれない。
      expect(result.total).to.equal(TRUNCATE_LIMIT);
      expect((result as { truncated?: boolean }).truncated).to.equal(true);
      expect((result as { actualMatchedCount?: number }).actualMatchedCount).to.equal(MATCHED);

      const ids = result.documents.map((d) => d.id);
      expect(
        ids,
        'fileDate 最新でも score 最下位 (doc-ac10c-001) は犠牲対象として除外される',
      ).to.not.include('doc-ac10c-001');

      // 上位 500 件は score 降順切り捨て後の集合 (doc-ac10c-002..501)、fileDate=null。
      // limit=50 + offset=0 で 1 ページ目は score 降順上位 50 件 = doc-ac10c-501..452。
      // fileDate=null なので tier-1 NULLS LAST 内では tier-2 score desc が支配。
      const expectedTopIds = Array.from(
        { length: 50 },
        (_, k) => `doc-ac10c-${String(MATCHED - k).padStart(3, '0')}`,
      );
      expect(ids).to.deep.equal(expectedTopIds);
    }).timeout(60000);
  });

  // ----------------------------------------
  // AC11: split ステータスドキュメントの除外 (Issue #810)
  // ----------------------------------------
  describe('AC11: split ステータスドキュメントの除外', () => {
    it('search_index に posting が残留していても status=split の doc は結果・total から除外される', async () => {
      // 分割元ドキュメントが検索インデックスに滞留しているケース (トリガーの
      // 削除漏れ・過去データ) を模擬。documents 側は存在するが status='split'。
      await seedUser();
      await seedSearchIndex('ac11splitword', {
        'live-1': { score: 1.0, fieldsMask: 8 },
        'split-1': { score: 1.0, fieldsMask: 8 },
      });
      await seedDocument('live-1', { fileDate: ts('2026-04-27') });
      await seedDocument('split-1', { fileDate: ts('2026-04-28'), status: 'split' });

      const result = await callSearch({ query: 'ac11splitword' });

      expect(result.total).to.equal(1);
      expect(result.documents.map((d) => d.id)).to.deep.equal(['live-1']);
      expect(result.documents.map((d) => d.id)).to.not.include('split-1');
    });
  });
  // ----------------------------------------
  // AC12: 日付語の範囲検索 (Issue #984 段階2a)
  // 日付語 (年・年月・年月日) は search_index ではなく documents.fileDate の UTC 範囲で答える。
  // cache は query 単位のため、各 it は他テストと重ならない年を使う。
  // ----------------------------------------
  describe('AC12: 日付語の範囲検索 (#984 段階2a)', () => {
    it('日付のみ (年): fileDate が範囲内の processed 書類だけが fileDate 降順で返る。search_index は使わない', async () => {
      await seedUser();
      await seedDocument('in-old', { fileDate: ts('2031-02-01') });
      await seedDocument('in-new', { fileDate: ts('2031-11-30') });
      await seedDocument('out-prev', { fileDate: ts('2030-12-31') });
      await seedDocument('out-next', { fileDate: ts('2032-01-01') });
      await seedDocument('no-date', { fileDate: null });
      await seedDocument('split-in', { fileDate: ts('2031-06-01'), status: 'split' });
      await seedDocument('pending-in', { fileDate: ts('2031-06-02'), status: 'pending' });
      // 索引に "2031" の decoy posting があっても、範囲検索は索引を読まない
      await seedSearchIndex('2031', { 'out-prev': { score: 9, fieldsMask: 16 } });

      const result = await callSearch({ query: '2031' });

      expect(result.documents.map((d) => d.id)).to.deep.equal(['in-new', 'in-old']);
      expect(result.total).to.equal(2);
      expect(result.hasMore).to.be.false;
      expect(result.truncated).to.equal(undefined);
      expect(result.documents.map((d) => d.fileDate)).to.deep.equal(['2031-11-30', '2031-02-01']);
    });

    it('年月・年月日 (ISO / 日本語表記) は該当期間だけを返す', async () => {
      await seedUser();
      await seedDocument('d1', { fileDate: ts('2033-09-19') });
      await seedDocument('d2', { fileDate: ts('2033-09-20') });
      await seedDocument('d3', { fileDate: ts('2033-09-21') });
      await seedDocument('d4', { fileDate: ts('2033-10-01') });

      const month = await callSearch({ query: '2033年9月' });
      expect(month.documents.map((d) => d.id)).to.deep.equal(['d3', 'd2', 'd1']);

      const dayIso = await callSearch({ query: '2033-09-20' });
      expect(dayIso.documents.map((d) => d.id)).to.deep.equal(['d2']);

      const daySlash = await callSearch({ query: '2033/9/20' });
      expect(daySlash.documents.map((d) => d.id)).to.deep.equal(['d2']);
    });

    it('共通部分が空の日付語 (異なる年) は 0 件', async () => {
      await seedUser();
      await seedDocument('x1', { fileDate: ts('2034-03-01') });

      const result = await callSearch({ query: '2034 2035' });

      expect(result.total).to.equal(0);
      expect(result.documents).to.deep.equal([]);
      expect(result.hasMore).to.be.false;
    });

    it('ページング: limit/offset で重複・欠落なく、hasMore が切り替わる (同日内も docId 降順で安定)', async () => {
      await seedUser();
      // 同一 fileDate 5 件 + 別日 1 件 (計 6 件)
      for (const id of ['p-a', 'p-b', 'p-c', 'p-d', 'p-e']) {
        await seedDocument(id, { fileDate: ts('2036-05-10') });
      }
      await seedDocument('p-old', { fileDate: ts('2036-01-01') });

      const full = await callSearch({ query: '2036', limit: 50 });
      // 同日内は Firestore native 順 (docId 降順)、別日は fileDate 降順
      expect(full.documents.map((d) => d.id)).to.deep.equal([
        'p-e', 'p-d', 'p-c', 'p-b', 'p-a', 'p-old',
      ]);
      const page1 = await callSearch({ query: '2036', limit: 2, offset: 0 });
      const page2 = await callSearch({ query: '2036', limit: 2, offset: 2 });
      const page3 = await callSearch({ query: '2036', limit: 2, offset: 4 });

      expect(full.total).to.equal(6);
      const paged = [...page1.documents, ...page2.documents, ...page3.documents].map((d) => d.id);
      expect(paged).to.deep.equal(full.documents.map((d) => d.id));
      expect(new Set(paged).size).to.equal(6);
      expect(page1.hasMore).to.be.true;
      expect(page2.hasMore).to.be.true;
      expect(page3.hasMore).to.be.false;
    });

    it('500 件超: 先頭 500 件のみ・truncated=true・actualMatchedCount=実件数。offset>=500 は空で hasMore=false', async () => {
      await seedUser();
      const TOTAL = 501;
      for (let start = 0; start < TOTAL; start += 400) {
        const batch = db.batch();
        for (let i = start; i < Math.min(start + 400, TOTAL); i++) {
          batch.set(db.doc(`documents/big-${String(i).padStart(3, '0')}`), {
            fileName: `big-${i}.pdf`,
            customerName: '',
            officeName: '',
            documentType: '',
            fileDate: ts('2037-06-15'),
            processedAt: admin.firestore.Timestamp.now(),
            status: 'processed',
          });
        }
        await batch.commit();
      }

      const head = await callSearch({ query: '2037', limit: 50, offset: 0 });
      expect(head.truncated).to.equal(true);
      expect(head.actualMatchedCount).to.equal(TOTAL);
      expect(head.total).to.equal(500);
      expect(head.documents).to.have.length(50);
      expect(head.hasMore).to.be.true;

      const last = await callSearch({ query: '2037', limit: 20, offset: 480 });
      expect(last.documents).to.have.length(20);
      expect(last.hasMore).to.be.false;

      const beyond = await callSearch({ query: '2037', limit: 20, offset: 500 });
      expect(beyond.documents).to.deep.equal([]);
      expect(beyond.hasMore).to.be.false;
    }).timeout(60000);

    it('範囲の境界: 開始は含み (>=)、終了は含まない (<)。UTC 暦日で判定する (日付のみ・混在の両経路)', async () => {
      await seedUser();
      await seedSearchIndex('ac12boundary', {
        'b-start': { score: 1, fieldsMask: 8 },
        'b-last': { score: 1, fieldsMask: 8 },
        'b-end': { score: 1, fieldsMask: 8 },
        'b-before': { score: 1, fieldsMask: 8 },
        'b-jst': { score: 1, fieldsMask: 8 },
      });
      await seedDocument('b-before', { fileDate: ts('2045-12-31T23:59:59.999Z') });
      await seedDocument('b-start', { fileDate: ts('2046-01-01T00:00:00.000Z') });
      await seedDocument('b-last', { fileDate: ts('2046-12-31T23:59:59.999Z') });
      await seedDocument('b-end', { fileDate: ts('2047-01-01T00:00:00.000Z') });
      // JST 0 時 (= UTC 前日 15:00) は UTC 暦日で判定されるため前日扱い
      await seedDocument('b-jst', { fileDate: ts('2046-06-14T15:00:00.000Z') });

      const dateOnly = await callSearch({ query: '2046', limit: 50 });
      expect(dateOnly.documents.map((d) => d.id)).to.deep.equal(['b-last', 'b-jst', 'b-start']);

      const mixed = await callSearch({ query: 'ac12boundary 2046', limit: 50 });
      expect(mixed.documents.map((d) => d.id)).to.deep.equal(['b-last', 'b-jst', 'b-start']);

      // 日単位: 15:00Z は UTC 6/14 なので 6/15 の検索には入らない
      const day = await callSearch({ query: '2046-06-15' });
      expect(day.documents).to.deep.equal([]);
      const dayBefore = await callSearch({ query: '2046-06-14' });
      expect(dayBefore.documents.map((d) => d.id)).to.deep.equal(['b-jst']);
    });

    it('ちょうど 500 件は truncated にならない (閾値は matched > 500)。offset 450 / limit 50 で末尾ページ・hasMore=false', async () => {
      await seedUser();
      const TOTAL = 500;
      for (let start = 0; start < TOTAL; start += 400) {
        const batch = db.batch();
        for (let i = start; i < Math.min(start + 400, TOTAL); i++) {
          batch.set(db.doc(`documents/x500-${String(i).padStart(3, '0')}`), {
            fileName: `x500-${i}.pdf`,
            customerName: '',
            officeName: '',
            documentType: '',
            fileDate: ts('2048-06-15'),
            processedAt: admin.firestore.Timestamp.now(),
            status: 'processed',
          });
        }
        await batch.commit();
      }

      const last = await callSearch({ query: '2048', limit: 50, offset: 450 });

      expect(last.total).to.equal(500);
      expect(last.documents).to.have.length(50);
      expect(last.hasMore).to.be.false;
      expect(last.truncated).to.equal(undefined);
      expect(last.actualMatchedCount).to.equal(undefined);
    }).timeout(60000);

    it('501 件超の中身: 返るのは fileDate 新しい側の先頭 500 件。最古の 1 件は含まれず、split は件数にも含まれない', async () => {
      await seedUser();
      const TOTAL = 501;
      for (let start = 0; start < TOTAL; start += 400) {
        const batch = db.batch();
        for (let i = start; i < Math.min(start + 400, TOTAL); i++) {
          // i が大きいほど新しい (2049-01-01T00:00Z + i 分。全件 2049 年内で重複なし)
          const d = new Date(Date.UTC(2049, 0, 1, 0, i));
          batch.set(db.doc(`documents/top-${String(i).padStart(3, '0')}`), {
            fileName: `top-${i}.pdf`,
            customerName: '',
            officeName: '',
            documentType: '',
            fileDate: admin.firestore.Timestamp.fromDate(d),
            processedAt: admin.firestore.Timestamp.now(),
            status: 'processed',
          });
        }
        await batch.commit();
      }
      // 範囲内でも status=split は count() にも結果にも含まれない
      await seedDocument('top-split', { fileDate: ts('2049-03-01'), status: 'split' });

      const first = await callSearch({ query: '2049', limit: 1, offset: 0 });
      expect(first.documents.map((d) => d.id)).to.deep.equal(['top-500']);
      expect(first.actualMatchedCount).to.equal(501);

      const tail = await callSearch({ query: '2049', limit: 50, offset: 450 });
      const tailIds = tail.documents.map((d) => d.id);
      expect(tailIds[tailIds.length - 1]).to.equal('top-001');
      expect(tailIds).to.not.include('top-000');
      expect(tailIds).to.not.include('top-split');
    }).timeout(60000);

    it('混在: 日付で絞った後に fileDate 降順で並び、total は絞り込み後の件数、hasMore がページで切り替わる。切り詰めなしなら truncated は無い', async () => {
      await seedUser();
      await seedSearchIndex('ac12mixpage', {
        'mp-1': { score: 1, fieldsMask: 8 },
        'mp-2': { score: 1, fieldsMask: 8 },
        'mp-3': { score: 1, fieldsMask: 8 },
        'mp-x': { score: 1, fieldsMask: 8 },
      });
      await seedDocument('mp-1', { fileDate: ts('2051-01-10') });
      await seedDocument('mp-2', { fileDate: ts('2051-03-10') });
      await seedDocument('mp-3', { fileDate: ts('2051-02-10') });
      await seedDocument('mp-x', { fileDate: ts('2052-01-01') });

      const page1 = await callSearch({ query: 'ac12mixpage 2051', limit: 2, offset: 0 });
      const page2 = await callSearch({ query: 'ac12mixpage 2051', limit: 2, offset: 2 });

      expect(page1.documents.map((d) => d.id)).to.deep.equal(['mp-2', 'mp-3']);
      expect(page2.documents.map((d) => d.id)).to.deep.equal(['mp-1']);
      expect(page1.total).to.equal(3);
      expect(page1.hasMore).to.be.true;
      expect(page2.hasMore).to.be.false;
      expect(page1.truncated).to.equal(undefined);
    });

    it('混在 + 候補 500 超で日付一致が候補から漏れる既知の限界: 該当書類は出ず、truncated=true で通知される', async () => {
      // 段階3 (posting に fileDate 内包) までの仕様。仕様として固定する。
      await seedUser();
      const TOTAL = 501;
      const postings: Record<string, { score: number; fieldsMask: number }> = {};
      for (let i = 0; i < TOTAL; i++) {
        // lo-500 だけ score が最小 = 切り捨て対象
        postings[`lo-${String(i).padStart(3, '0')}`] = { score: i === 500 ? 0.1 : 1, fieldsMask: 8 };
      }
      await seedSearchIndex('ac12lowscore', postings);
      for (let start = 0; start < TOTAL; start += 400) {
        const batch = db.batch();
        for (let i = start; i < Math.min(start + 400, TOTAL); i++) {
          batch.set(db.doc(`documents/lo-${String(i).padStart(3, '0')}`), {
            fileName: `lo-${i}.pdf`,
            customerName: '',
            officeName: '',
            documentType: '',
            fileDate: ts(i === 500 ? '2053-05-05' : '2054-05-05'),
            processedAt: admin.firestore.Timestamp.now(),
            status: 'processed',
          });
        }
        await batch.commit();
      }

      const result = await callSearch({ query: 'ac12lowscore 2053' });

      expect(result.documents).to.deep.equal([]);
      expect(result.total).to.equal(0);
      expect(result.truncated).to.equal(true);
    }).timeout(60000);

    it('日付のみで offset が件数を超える (切り詰めなし): 空・total は実件数・hasMore=false', async () => {
      await seedUser();
      for (const id of ['o-1', 'o-2', 'o-3']) {
        await seedDocument(id, { fileDate: ts('2055-04-01') });
      }

      const result = await callSearch({ query: '2055', limit: 10, offset: 5 });

      expect(result.documents).to.deep.equal([]);
      expect(result.total).to.equal(3);
      expect(result.hasMore).to.be.false;
      expect(result.truncated).to.equal(undefined);
    });

    it('混在: 日付以外の語で索引検索し、fileDate で絞る (日付が合わない候補と日付なしは除外)', async () => {
      await seedUser();
      await seedSearchIndex('ac12mixword', {
        'm-hit': { score: 1, fieldsMask: 8 },
        'm-other-year': { score: 1, fieldsMask: 8 },
        'm-nodate': { score: 1, fieldsMask: 8 },
      });
      await seedDocument('m-hit', { fileDate: ts('2038-05-01') });
      await seedDocument('m-other-year', { fileDate: ts('2039-05-01') });
      await seedDocument('m-nodate', { fileDate: null });

      const year = await callSearch({ query: 'ac12mixword 2038' });
      expect(year.documents.map((d) => d.id)).to.deep.equal(['m-hit']);
      expect(year.total).to.equal(1);

      const month = await callSearch({ query: 'ac12mixword 2038-05' });
      expect(month.documents.map((d) => d.id)).to.deep.equal(['m-hit']);

      const miss = await callSearch({ query: 'ac12mixword 2040' });
      expect(miss.total).to.equal(0);
    });

    it('混在 + 候補 500 超: truncated=true を維持し、actualMatchedCount は日付絞り込み後の件数と矛盾しない', async () => {
      // 通常語の候補が 501 件 (score 上位 500 件のみ取得) で、日付に合うのは 1 件だけ。
      // 未フィルタの候補数 (501) を actualMatchedCount にすると FE バナーが
      // 「上位 1 件のみ表示（501 件中）」と日付一致 501 件中の 1 件のように誤読させる。
      await seedUser();
      const TOTAL = 501;
      const postings: Record<string, { score: number; fieldsMask: number }> = {};
      for (let i = 0; i < TOTAL; i++) {
        postings[`mt-${String(i).padStart(3, '0')}`] = { score: i === 0 ? 10 : 1, fieldsMask: 8 };
      }
      await seedSearchIndex('ac12truncmix', postings);
      for (let start = 0; start < TOTAL; start += 400) {
        const batch = db.batch();
        for (let i = start; i < Math.min(start + 400, TOTAL); i++) {
          batch.set(db.doc(`documents/mt-${String(i).padStart(3, '0')}`), {
            fileName: `mt-${i}.pdf`,
            customerName: '',
            officeName: '',
            documentType: '',
            // mt-000 だけ 2042 年 (score 最大なので候補 500 件に必ず入る)。他は 2043 年
            fileDate: ts(i === 0 ? '2042-03-01' : '2043-03-01'),
            processedAt: admin.firestore.Timestamp.now(),
            status: 'processed',
          });
        }
        await batch.commit();
      }

      const result = await callSearch({ query: 'ac12truncmix 2042' });

      expect(result.documents.map((d) => d.id)).to.deep.equal(['mt-000']);
      expect(result.total).to.equal(1);
      expect(result.truncated).to.equal(true);
      expect(result.actualMatchedCount).to.equal(1);
    }).timeout(60000);

    it('offset / limit が不正 (負値・非整数) なら invalid-argument (Firestore の limit() 例外を内部エラーにしない)', async () => {
      await seedUser();
      for (const bad of [
        { query: '2044', limit: 3, offset: -5 },
        { query: '2044', limit: 3, offset: 0.5 },
        { query: '2044', limit: 2.5, offset: 0 },
      ]) {
        await expectHttpsError(() => callSearch(bad), 'invalid-argument');
      }
    });

    it('日付語を含まないクエリは従来どおり索引検索 (回帰)', async () => {
      await seedUser();
      await seedSimplePosting('ac12plainword', 'plain-1');
      await seedDocument('plain-1', { fileDate: ts('2041-01-01') });

      const result = await callSearch({ query: 'ac12plainword' });

      expect(result.documents.map((d) => d.id)).to.deep.equal(['plain-1']);
    });
  });
});
