/**
 * extractBraceBlock helper 単体テスト (#311 review I3 + #312 API 改善対応)
 *
 * 本 helper は 5 ファイルの contract test から依存される共通基盤。将来の改修で
 * silent regression (null 返却の意味論変化、anchorMode の挙動反転 等) を
 * 直接検知する fixture を配置する。contract test 側 (aggregateCapLogErrorContract)
 * の `extractAggregateCapBlock detection logic` describe は実コード対象のため残置、
 * 本ファイルは helper 単体の挙動のみを狭く lock-in する。
 *
 * #312: anchor/開き文字不在は空文字ではなく `null` を返す (silent PASS 防御)。
 */

import { expect } from 'chai';
import { extractBraceBlock, extractParenBlock } from './extractBraceBlock';

describe('extractBraceBlock helper', () => {
  describe("anchorMode: 'after-match' (制御フロー近接性)", () => {
    it('anchor 末尾を起点に次の `{` から block を抽出する', () => {
      // anchor は `catch (e) ` で終わり `{` を含まない。通常 ('from-start') だと
      // `match.index` から探索して try の `{` を拾ってしまう。'after-match' で `match[0].length` 後から
      // 探索することで catch 本体の `{` を正しく拾う。
      const source = `try { inner } catch (e) { safeLogError(); }`;
      const anchor = /try\s*\{[\s\S]*?\}\s*catch\s*\(\s*\w+\s*\)\s*/;

      const withoutOpt = extractBraceBlock(source, anchor);
      expect(withoutOpt, 'default は anchor 先頭起点で try 本体を拾う').to.equal('{ inner }');

      const withOpt = extractBraceBlock(source, anchor, { anchorMode: 'after-match' });
      expect(withOpt, "anchorMode: 'after-match' で catch 本体を拾う").to.equal(
        '{ safeLogError(); }',
      );
    });

    it('anchor 末尾以降に `{` が無い場合は null', () => {
      const source = `try { inner } catch (e) `;
      const anchor = /try\s*\{[\s\S]*?\}\s*catch\s*\(\s*\w+\s*\)\s*/;
      expect(extractBraceBlock(source, anchor, { anchorMode: 'after-match' })).to.be.null;
    });

    it("string anchor でも anchorMode: 'after-match' が機能する", () => {
      const source = `FOO BAR { inner }`;
      expect(extractBraceBlock(source, 'FOO BAR', { anchorMode: 'after-match' })).to.equal(
        '{ inner }',
      );
    });
  });

  describe("extractBraceBlock (default anchorMode: 'from-start')", () => {
    it('anchor 不在時は null を返す', () => {
      expect(extractBraceBlock('const x = 1;', /nomatch/)).to.be.null;
      expect(extractBraceBlock('const x = 1;', 'nomatch')).to.be.null;
    });

    it('anchor ヒットしても後続に `{` が無ければ null', () => {
      expect(extractBraceBlock('const x = 1;', /const/)).to.be.null;
    });

    it('ネストした `{}` を balance させて block 全体を返す', () => {
      const source = `function f() { if (x) { y(); } else { z(); } }`;
      const block = extractBraceBlock(source, 'function f()');
      expect(block).to.equal('{ if (x) { y(); } else { z(); } }');
    });

    it('unbalanced な `{` は null を返す (loop 完走時)', () => {
      const source = `function f() { if (x) { y(); `;
      expect(extractBraceBlock(source, 'function f()')).to.be.null;
    });
  });

  describe('extractParenBlock', () => {
    it('anchor 後の `(...)` を抽出する', () => {
      const source = `await safeLogError({ source: 'ocr' });`;
      const args = extractParenBlock(source, /\bsafeLogError\s*\(/);
      expect(args).to.equal(`({ source: 'ocr' })`);
    });

    it('ネストした `()` を balance させる', () => {
      const source = `f(g(1, 2), h(3));`;
      expect(extractParenBlock(source, 'f')).to.equal('(g(1, 2), h(3))');
    });

    it('anchor 不在時は null', () => {
      expect(extractParenBlock('const x = 1;', /nomatch/)).to.be.null;
    });
  });
});
