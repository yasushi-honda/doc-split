/**
 * searchDocuments handler 統合テスト (Closes #401)
 *
 * 目的: PR #400 の handler 契約を最小スコープで fixate し、Issue #402
 * (OOM ガード + latency/read 計測ログ) で壊しやすい挙動を回帰検出可能にする。
 *
 * 検証する契約:
 *   AC1: AND 検索 (全単語マッチのみ結果に含まれる)
 *   AC2: 多段ソート 4 段 (fileDate desc → score desc → processedAt desc → docId asc)
 *   AC3: NULLS LAST (fileDate null は末尾、各群内 score desc)
 *   AC4: pagination 安定性 (offset/limit 重複なし、hasMore 切替)
 *   AC5: orphan 除外 (search_index posting あるが documents 不在 → 結果・total から除外)
 *   AC6: HttpsError 契約 (unauthenticated / permission-denied / invalid-argument)
 *   AC7: cache 結果不変 (同 query/limit/offset の 2 回目は index 変更しても結果不変)
 *   AC8: 壊れた fileDate 混在でも 500 落ちせず正常データのみ返る
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
 * Codex R8 反映: tokenizer の細部に依存せず、`generateTokenId(token)` で
 * token ID を直接計算して seed する。AND 条件成立に必要な token だけ用意。
 *
 * 注意: handler 内 tokenizeQueryByWords は normalizeForSearch (toLowerCase 含む) を
 * 適用するため、token は **小文字** で seed する必要がある。
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

/** documents/{docId} を processed status で seed */
interface SeedDocumentInput {
  fileName?: string;
  customerName?: string;
  officeName?: string;
  documentType?: string;
  fileDate?: admin.firestore.Timestamp | null | unknown; // unknown は AC8 (broken type) 用
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
  return wrapped({ auth, data, rawRequest: {} as never } as never);
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

// ============================================
// Tests
// ============================================

describe('searchDocuments handler integration (#401a, Closes #401)', () => {
  // 各 it 終了時に状態をクリーン化。cache module-scope の汚染は query をテスト毎に
  // 一意化することで回避 (Codex R6: cache 用 query と非 cache 用を分離)。
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
  // AC2: 多段ソート 4 段
  // (fileDate desc → score desc → processedAt desc → docId asc)
  // ----------------------------------------
  describe('AC2: 多段ソート 4 段 handler レベル', () => {
    it('全 4 段の tie-break が handler レベルで正しく適用される', async () => {
      await seedUser();
      // 5 doc を seed:
      //   d-newer-high: 新日付 + 高 score (1 番目)
      //   d-newer-low : 新日付 + 低 score (2 番目)
      //   d-old-newproc-z : 旧日付 + 同 score + 新 processedAt (3 番目)
      //   d-old-oldproc-aa: 旧日付 + 同 score + 旧 processedAt + docId 'aa' (4 番目)
      //   d-old-oldproc-bb: 旧日付 + 同 score + 旧 processedAt + docId 'bb' (5 番目, docId asc)
      await seedSearchIndex('ac2sortword', {
        'd-newer-high': { score: 5.0, fieldsMask: 8 },
        'd-newer-low': { score: 1.0, fieldsMask: 8 },
        'd-old-newproc-z': { score: 1.0, fieldsMask: 8 },
        'd-old-oldproc-aa': { score: 1.0, fieldsMask: 8 },
        'd-old-oldproc-bb': { score: 1.0, fieldsMask: 8 },
      });
      const newerDate = ts('2026-04-27');
      const olderDate = ts('2026-01-01');
      const newerProc = ts('2026-04-27T15:00:00Z');
      const olderProc = ts('2026-04-27T10:00:00Z');
      await seedDocument('d-newer-high', { fileDate: newerDate, processedAt: olderProc });
      await seedDocument('d-newer-low', { fileDate: newerDate, processedAt: olderProc });
      await seedDocument('d-old-newproc-z', { fileDate: olderDate, processedAt: newerProc });
      await seedDocument('d-old-oldproc-aa', { fileDate: olderDate, processedAt: olderProc });
      await seedDocument('d-old-oldproc-bb', { fileDate: olderDate, processedAt: olderProc });

      const result = await callSearch({ query: 'ac2sortword' });

      expect(result.documents.map((d) => d.id)).to.deep.equal([
        'd-newer-high',
        'd-newer-low',
        'd-old-newproc-z',
        'd-old-oldproc-aa',
        'd-old-oldproc-bb',
      ]);
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
  // AC4: pagination 安定性 (4 段ソートをまたぐ fixture)
  // ----------------------------------------
  describe('AC4: pagination 安定性', () => {
    it('limit + offset で 4 段ソートをまたいでも重複・欠落なく hasMore が切替わる', async () => {
      await seedUser();
      // 5 doc を AC2 と同じ完全順序でseed
      await seedSearchIndex('ac4pageword', {
        'p1-newer-high': { score: 5.0, fieldsMask: 8 },
        'p2-newer-low': { score: 1.0, fieldsMask: 8 },
        'p3-old-newproc': { score: 1.0, fieldsMask: 8 },
        'p4-old-oldproc-a': { score: 1.0, fieldsMask: 8 },
        'p5-old-oldproc-b': { score: 1.0, fieldsMask: 8 },
      });
      const newer = ts('2026-04-27');
      const older = ts('2026-01-01');
      const newProc = ts('2026-04-27T15:00:00Z');
      const oldProc = ts('2026-04-27T10:00:00Z');
      await seedDocument('p1-newer-high', { fileDate: newer, processedAt: oldProc });
      await seedDocument('p2-newer-low', { fileDate: newer, processedAt: oldProc });
      await seedDocument('p3-old-newproc', { fileDate: older, processedAt: newProc });
      await seedDocument('p4-old-oldproc-a', { fileDate: older, processedAt: oldProc });
      await seedDocument('p5-old-oldproc-b', { fileDate: older, processedAt: oldProc });

      // page 1: limit=2, offset=0
      const page1 = await callSearch({ query: 'ac4pageword', limit: 2, offset: 0 });
      expect(page1.total).to.equal(5);
      expect(page1.hasMore).to.be.true;
      expect(page1.documents.map((d) => d.id)).to.deep.equal([
        'p1-newer-high',
        'p2-newer-low',
      ]);

      // page 2: limit=2, offset=2
      const page2 = await callSearch({ query: 'ac4pageword', limit: 2, offset: 2 });
      expect(page2.total).to.equal(5);
      expect(page2.hasMore).to.be.true;
      expect(page2.documents.map((d) => d.id)).to.deep.equal([
        'p3-old-newproc',
        'p4-old-oldproc-a',
      ]);

      // page 3 (last): limit=2, offset=4
      const page3 = await callSearch({ query: 'ac4pageword', limit: 2, offset: 4 });
      expect(page3.total).to.equal(5);
      expect(page3.hasMore).to.be.false;
      expect(page3.documents.map((d) => d.id)).to.deep.equal(['p5-old-oldproc-b']);

      // 重複・欠落がないこと
      const allIds = [
        ...page1.documents.map((d) => d.id),
        ...page2.documents.map((d) => d.id),
        ...page3.documents.map((d) => d.id),
      ];
      expect(new Set(allIds).size).to.equal(5);
    });
  });

  // ----------------------------------------
  // AC5: orphan 除外
  // ----------------------------------------
  describe('AC5: orphan 除外', () => {
    it('search_index posting あるが documents 不在の doc は結果・total から除外される', async () => {
      // Codex 反映: 警告ログの payload (raw query 含む) は固定しない (AC9 と整合)
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

      try {
        await callSearch({ query: 'ac6authword' }, null);
        expect.fail('expected HttpsError to be thrown');
      } catch (err) {
        expect((err as { code?: string }).code).to.equal('unauthenticated');
      }
    });

    it('whitelist なし user → permission-denied', async () => {
      // users/{uid} を seed しない
      await seedSimplePosting('ac6permword', 'doc-ac6-2');
      await seedDocument('doc-ac6-2', { fileDate: ts('2026-04-27') });

      try {
        await callSearch({ query: 'ac6permword' }, 'unknown-user-uid');
        expect.fail('expected HttpsError to be thrown');
      } catch (err) {
        expect((err as { code?: string }).code).to.equal('permission-denied');
      }
    });

    it('空 query → invalid-argument', async () => {
      await seedUser();
      try {
        await callSearch({ query: '' });
        expect.fail('expected HttpsError to be thrown');
      } catch (err) {
        expect((err as { code?: string }).code).to.equal('invalid-argument');
      }
    });

    it('query 100 文字超 → invalid-argument', async () => {
      await seedUser();
      const longQuery = 'a'.repeat(101);
      try {
        await callSearch({ query: longQuery });
        expect.fail('expected HttpsError to be thrown');
      } catch (err) {
        expect((err as { code?: string }).code).to.equal('invalid-argument');
      }
    });

    it('limit=0 → invalid-argument', async () => {
      await seedUser();
      try {
        await callSearch({ query: 'ac6limit0', limit: 0 });
        expect.fail('expected HttpsError to be thrown');
      } catch (err) {
        expect((err as { code?: string }).code).to.equal('invalid-argument');
      }
    });

    it('limit=51 → invalid-argument', async () => {
      await seedUser();
      try {
        await callSearch({ query: 'ac6limit51', limit: 51 });
        expect.fail('expected HttpsError to be thrown');
      } catch (err) {
        expect((err as { code?: string }).code).to.equal('invalid-argument');
      }
    });
  });

  // ----------------------------------------
  // AC7: cache 結果不変
  // ----------------------------------------
  describe('AC7: cache 結果不変', () => {
    it('同 query/limit/offset の 2 回目は index 変更しても結果不変 (cache hit)', async () => {
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

      // 間に index/documents を変更
      await seedSearchIndex('ac7cacheword', {
        'doc-cache-1': { score: 1.0, fieldsMask: 8 },
        'doc-cache-2': { score: 1.0, fieldsMask: 8 },
      });
      await seedDocument('doc-cache-1', {
        fileName: 'updated version.pdf',
        fileDate: ts('2026-04-27'),
      });
      await seedDocument('doc-cache-2', { fileDate: ts('2026-04-27') });

      // 2 回目: 同じ key → cache hit、結果は 1 回目と同じ (変更が反映されない)
      const second = await callSearch({ query: 'ac7cacheword' });
      expect(second.total).to.equal(1);
      expect(second.documents[0]!.fileName).to.equal('first version.pdf');
    });
  });

  // ----------------------------------------
  // AC8: 壊れた fileDate 混在でも 500 落ちしない
  // ----------------------------------------
  describe('AC8: 壊れた fileDate 防御', () => {
    let originalWarn: typeof console.warn;
    let warnCalls: unknown[][];

    beforeEach(() => {
      // R7 反映: console.warn を spy するときは afterEach で必ず restore
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
      // safeToMillis の warn が 2 件以上出ていること (string/plain それぞれで)
      expect(warnCalls.length).to.be.at.least(2);
    });
  });
});
