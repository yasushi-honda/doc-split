/**
 * bestFuzzyWindowScore のオラクル差分テスト (Issue #787)
 *
 * 素朴なスライディングウィンドウ実装(オラクル)との出力比較により、
 * bag distance branch-and-bound + 静的floorスキップが元の挙動と
 * 完全に等価であることを機械的に検証する。
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { bestFuzzyWindowScore, similarityScore } from '../src/utils/similarity';

// 素朴な実装(素朴なスライディングウィンドウ + 毎回similarityScore呼び出し)。
// extractors.ts のステップ5・extractCustomerCandidates 等の元実装と同一のロジック。
function naiveBestFuzzyWindowScore(text: string, needle: string, windowPad: number): number {
  const windowSize = Math.min(needle.length + windowPad, text.length);
  let best = 0;
  for (let i = 0; i <= text.length - windowSize; i++) {
    const window = text.slice(i, i + windowSize);
    const s = similarityScore(window, needle);
    if (s > best) best = s;
  }
  return best;
}

// 線形合同法(LCG)による決定的疑似乱数。Math.randomは使わない(再現性のため)。
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function randomString(rand: () => number, alphabet: string, maxLen: number): string {
  const len = Math.floor(rand() * (maxLen + 1));
  let s = '';
  for (let i = 0; i < len; i++) {
    s += alphabet[Math.floor(rand() * alphabet.length)];
  }
  return s;
}

describe('bestFuzzyWindowScore', () => {
  describe('完全等価モード(minAcceptableScore=0)', () => {
    it('ランダムなtext/needleペア4000件でオラクルと完全一致する', () => {
      const rand = makeLcg(20260803);
      // アルファベットは小さく保ち、近似一致(fuzzy経路への到達)頻度を上げる
      const alphabet = 'abcあいう介護支援センターさくら';
      for (let i = 0; i < 4000; i++) {
        const text = randomString(rand, alphabet, 60);
        const needle = randomString(rand, alphabet, 20);
        const pad = [0, 3, 5][Math.floor(rand() * 3)]!;
        const expected = naiveBestFuzzyWindowScore(text, needle, pad);
        const actual = bestFuzzyWindowScore(text, needle, pad, 0);
        expect(actual, `text=${JSON.stringify(text)} needle=${JSON.stringify(needle)} pad=${pad}`).to.equal(
          expected
        );
      }
    });

    it('needleが空文字列の場合は常に0(オラクルと一致)', () => {
      expect(bestFuzzyWindowScore('何らかのテキスト', '', 5)).to.equal(
        naiveBestFuzzyWindowScore('何らかのテキスト', '', 5)
      );
      expect(bestFuzzyWindowScore('何らかのテキスト', '', 5)).to.equal(0);
    });

    it('textが空文字列の場合(退化ケース)もオラクルと一致する', () => {
      expect(bestFuzzyWindowScore('', '', 5)).to.equal(naiveBestFuzzyWindowScore('', '', 5));
      expect(bestFuzzyWindowScore('', 'なにか', 5)).to.equal(naiveBestFuzzyWindowScore('', 'なにか', 5));
    });

    it('textがwindowSizeより短い場合(ループ0回)もオラクルと一致する', () => {
      const text = 'あ';
      const needle = '介護支援センターさくら';
      expect(bestFuzzyWindowScore(text, needle, 5)).to.equal(naiveBestFuzzyWindowScore(text, needle, 5));
      expect(bestFuzzyWindowScore(text, needle, 5)).to.equal(0);
    });

    it('サロゲートペアを含む文字列でもオラクルと一致する', () => {
      const cases: Array<[string, string, number]> = [
        ['送付先は𠮷田太郎様です', '𠮷田太郎', 5],
        ['送付先は吉田太郎様です', '𠮷田太郎', 5],
        ['𠮷𠮷𠮷𠮷𠮷', '𠮷𠮷𠮷', 3],
      ];
      for (const [text, needle, pad] of cases) {
        expect(bestFuzzyWindowScore(text, needle, pad)).to.equal(naiveBestFuzzyWindowScore(text, needle, pad));
      }
    });

    it('windowPad=0でneedleと完全一致するウィンドウがあれば100を返す', () => {
      // windowSize = needle.length + windowPad なので、pad>0だと窓が常にneedleより
      // 長くなり完全一致(距離0)にはなり得ない。pad=0の場合のみdistance=0が実現しうる。
      const needle = '株式会社テストケア';
      const text = `送付先${needle}御中`;
      expect(bestFuzzyWindowScore(text, needle, 0)).to.equal(100);
    });
  });

  describe('floorモード(minAcceptableScore>0)', () => {
    it('ランダムなtext/needleペア2000件で「floor以上ならオラクルと同値、未満なら0」を満たす', () => {
      const rand = makeLcg(78120260803);
      const alphabet = 'abcあいう介護支援センターさくら';
      for (let i = 0; i < 2000; i++) {
        const text = randomString(rand, alphabet, 60);
        const needle = randomString(rand, alphabet, 20);
        const pad = [0, 3, 5][Math.floor(rand() * 3)]!;
        const floor = 50 + Math.floor(rand() * 40); // 50-89
        const oracle = naiveBestFuzzyWindowScore(text, needle, pad);
        const expected = oracle >= floor ? oracle : 0;
        const actual = bestFuzzyWindowScore(text, needle, pad, floor);
        expect(
          actual,
          `text=${JSON.stringify(text)} needle=${JSON.stringify(needle)} pad=${pad} floor=${floor} oracle=${oracle}`
        ).to.equal(expected);
      }
    });

    it('floorちょうどのスコアは含まれる(境界off-by-oneの検出)', () => {
      // 事前に発見した実際の境界ケース: 62点(ブーストなしでは非マッチ)のペア
      const needle = '介護支援センターさくら';
      const text = 'A介語支援センタ差くらB';
      const oracle = naiveBestFuzzyWindowScore(text, needle, 5);
      expect(bestFuzzyWindowScore(text, needle, 5, oracle)).to.equal(oracle); // floor=oracleちょうど → 含まれる
      expect(bestFuzzyWindowScore(text, needle, 5, oracle + 1)).to.equal(0); // floor=oracle+1 → 除外される
    });
  });
});
