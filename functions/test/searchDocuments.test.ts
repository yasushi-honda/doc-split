/**
 * searchDocuments: ソート関数の単体テスト
 *
 * 検索結果のソート順:
 *   1. fileDate desc（NULLS LAST）
 *   2. score desc
 *   3. processedAt desc
 *   4. docId asc（安定タイブレーク）
 */

import { expect } from 'chai';
import type { firestore } from 'firebase-admin';
import {
  compareSearchResults,
  safeToMillis,
  type SortableSearchDoc,
} from '../src/search/sortSearchResults';

const baseData: firestore.DocumentData = {};

function makeDoc(overrides: Partial<SortableSearchDoc>): SortableSearchDoc {
  return {
    docId: 'doc-1',
    score: 1.0,
    fileDateMs: null,
    processedAtMs: 0,
    data: baseData,
    ...overrides,
  };
}

/** ms 値で日付を表現するヘルパー */
function dateMs(iso: string): number {
  return new Date(iso).getTime();
}

describe('searchDocuments: compareSearchResults', () => {
  describe('AC1: fileDate 降順', () => {
    it('新しい fileDate の書類が先頭に来る', () => {
      const newer = makeDoc({ docId: 'a', fileDateMs: dateMs('2026-04-27') });
      const older = makeDoc({ docId: 'b', fileDateMs: dateMs('2026-01-01') });
      const arr = [older, newer];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['a', 'b']);
    });

    it('複数日付混在時、降順で並ぶ', () => {
      const d1 = makeDoc({ docId: 'd1', fileDateMs: dateMs('2025-12-01') });
      const d2 = makeDoc({ docId: 'd2', fileDateMs: dateMs('2026-04-27') });
      const d3 = makeDoc({ docId: 'd3', fileDateMs: dateMs('2026-02-15') });
      const arr = [d1, d2, d3];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['d2', 'd3', 'd1']);
    });
  });

  describe('AC2: 同一 fileDate 内は score 降順', () => {
    it('同じ fileDate なら高 score が先頭', () => {
      const lowScore = makeDoc({ docId: 'low', fileDateMs: dateMs('2026-04-27'), score: 1.5 });
      const highScore = makeDoc({ docId: 'high', fileDateMs: dateMs('2026-04-27'), score: 5.2 });
      const arr = [lowScore, highScore];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['high', 'low']);
    });

    it('日付優先で score より日付が支配する', () => {
      const newDateLowScore = makeDoc({
        docId: 'newer-low',
        fileDateMs: dateMs('2026-04-27'),
        score: 0.1,
      });
      const oldDateHighScore = makeDoc({
        docId: 'older-high',
        fileDateMs: dateMs('2026-01-01'),
        score: 999,
      });
      const arr = [oldDateHighScore, newDateLowScore];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['newer-low', 'older-high']);
    });
  });

  describe('AC3: fileDate null は末尾（NULLS LAST）', () => {
    it('null 1件 + 日付あり1件 → null が末尾', () => {
      const dated = makeDoc({ docId: 'dated', fileDateMs: dateMs('2026-04-27') });
      const undated = makeDoc({ docId: 'undated', fileDateMs: null });
      const arr = [undated, dated];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['dated', 'undated']);
    });

    it('複数 null は score 降順で並び、すべて末尾に集まる', () => {
      const dated = makeDoc({ docId: 'dated', fileDateMs: dateMs('2026-04-27'), score: 1.0 });
      const undatedHigh = makeDoc({ docId: 'undated-high', fileDateMs: null, score: 5.0 });
      const undatedLow = makeDoc({ docId: 'undated-low', fileDateMs: null, score: 1.0 });
      const arr = [undatedLow, undatedHigh, dated];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['dated', 'undated-high', 'undated-low']);
    });

    it('全件 null なら score 降順', () => {
      const a = makeDoc({ docId: 'a', fileDateMs: null, score: 2.0 });
      const b = makeDoc({ docId: 'b', fileDateMs: null, score: 5.0 });
      const c = makeDoc({ docId: 'c', fileDateMs: null, score: 1.0 });
      const arr = [a, b, c];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['b', 'a', 'c']);
    });
  });

  describe('AC4: 安定タイブレーク (processedAt → docId)', () => {
    it('同 fileDate 同 score なら processedAt 降順', () => {
      const older = makeDoc({
        docId: 'older',
        fileDateMs: dateMs('2026-04-27'),
        score: 1.0,
        processedAtMs: dateMs('2026-04-27T10:00:00Z'),
      });
      const newer = makeDoc({
        docId: 'newer',
        fileDateMs: dateMs('2026-04-27'),
        score: 1.0,
        processedAtMs: dateMs('2026-04-27T15:00:00Z'),
      });
      const arr = [older, newer];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['newer', 'older']);
    });

    it('全キー同点なら docId 昇順（安定）', () => {
      const z = makeDoc({
        docId: 'z',
        fileDateMs: dateMs('2026-04-27'),
        score: 1.0,
        processedAtMs: dateMs('2026-04-27T12:00:00Z'),
      });
      const a = makeDoc({
        docId: 'a',
        fileDateMs: dateMs('2026-04-27'),
        score: 1.0,
        processedAtMs: dateMs('2026-04-27T12:00:00Z'),
      });
      const m = makeDoc({
        docId: 'm',
        fileDateMs: dateMs('2026-04-27'),
        score: 1.0,
        processedAtMs: dateMs('2026-04-27T12:00:00Z'),
      });
      const arr = [z, m, a];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['a', 'm', 'z']);
    });

    it('ページ境界で順序が安定する（同じ入力を別順序で与えても結果一致）', () => {
      const docs = [
        makeDoc({ docId: 'd1', fileDateMs: dateMs('2026-04-27'), score: 5.0, processedAtMs: 100 }),
        makeDoc({ docId: 'd2', fileDateMs: dateMs('2026-04-27'), score: 5.0, processedAtMs: 100 }),
        makeDoc({ docId: 'd3', fileDateMs: dateMs('2026-04-27'), score: 3.0, processedAtMs: 200 }),
        makeDoc({ docId: 'd4', fileDateMs: dateMs('2026-01-01'), score: 9.0, processedAtMs: 100 }),
        makeDoc({ docId: 'd5', fileDateMs: null, score: 9.0, processedAtMs: 100 }),
      ];
      const sorted1 = [...docs].sort(compareSearchResults).map(d => d.docId);
      const sorted2 = [...docs].reverse().sort(compareSearchResults).map(d => d.docId);
      expect(sorted1).to.deep.equal(sorted2);
      // 期待: d1/d2 は同 fileDate 同 score 同 processedAt → docId asc で d1, d2
      expect(sorted1).to.deep.equal(['d1', 'd2', 'd3', 'd4', 'd5']);
    });
  });

  describe('境界ケース', () => {
    it('空配列のソートは空配列', () => {
      const arr: SortableSearchDoc[] = [];
      arr.sort(compareSearchResults);
      expect(arr).to.deep.equal([]);
    });

    it('1件のみ', () => {
      const only = makeDoc({ docId: 'only' });
      const arr = [only];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['only']);
    });

    it('processedAtMs=0（未設定）でも壊れない', () => {
      const a = makeDoc({
        docId: 'a',
        fileDateMs: dateMs('2026-04-27'),
        score: 1.0,
        processedAtMs: 0,
      });
      const b = makeDoc({
        docId: 'b',
        fileDateMs: dateMs('2026-04-27'),
        score: 1.0,
        processedAtMs: 100,
      });
      const arr = [a, b];
      arr.sort(compareSearchResults);
      expect(arr.map(d => d.docId)).to.deep.equal(['b', 'a']);
    });
  });
});

describe('searchDocuments: safeToMillis', () => {
  // console.warn の出力をテストごとに抑制
  let originalWarn: typeof console.warn;
  let warnCalls: unknown[][];
  beforeEach(() => {
    originalWarn = console.warn;
    warnCalls = [];
    console.warn = (...args: unknown[]) => { warnCalls.push(args); };
  });
  afterEach(() => {
    console.warn = originalWarn;
  });

  it('Timestamp 風オブジェクトは toMillis() の値を返す', () => {
    const ts = { toMillis: () => 1730000000000 };
    expect(safeToMillis(ts, 'doc1', 'fileDate')).to.equal(1730000000000);
    expect(warnCalls.length).to.equal(0);
  });

  it('null は null を返し warn なし', () => {
    expect(safeToMillis(null, 'doc1', 'fileDate')).to.be.null;
    expect(warnCalls.length).to.equal(0);
  });

  it('undefined は null を返し warn なし', () => {
    expect(safeToMillis(undefined, 'doc1', 'fileDate')).to.be.null;
    expect(warnCalls.length).to.equal(0);
  });

  it('文字列は null を返し warn を出す（旧データ防御）', () => {
    expect(safeToMillis('2026-04-27', 'doc1', 'fileDate')).to.be.null;
    expect(warnCalls.length).to.equal(1);
    expect(String(warnCalls[0]![0])).to.include('not a Timestamp');
  });

  it('plain object（toMillis なし）は null を返し warn を出す', () => {
    expect(safeToMillis({ seconds: 100 }, 'doc1', 'fileDate')).to.be.null;
    expect(warnCalls.length).to.equal(1);
  });

  it('Date インスタンスは null を返し warn を出す', () => {
    expect(safeToMillis(new Date(), 'doc1', 'fileDate')).to.be.null;
    expect(warnCalls.length).to.equal(1);
  });

  it('toMillis() が例外を投げても catch して null + warn', () => {
    const broken = {
      toMillis: () => {
        throw new Error('corrupted timestamp');
      },
    };
    expect(safeToMillis(broken, 'doc1', 'fileDate')).to.be.null;
    expect(warnCalls.length).to.equal(1);
    expect(String(warnCalls[0]![0])).to.include('toMillis() failed');
  });

  it('docId と field 名は warn ログに含まれる', () => {
    safeToMillis('bad', 'doc-abc', 'processedAt');
    expect(warnCalls.length).to.equal(1);
    const logContext = warnCalls[0]![1] as { docId: string };
    expect(logContext.docId).to.equal('doc-abc');
    expect(String(warnCalls[0]![0])).to.include('processedAt');
  });
});
