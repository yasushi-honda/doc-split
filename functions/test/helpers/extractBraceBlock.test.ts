/**
 * extractBraceBlock helper 単体テスト (#311 review I3 + #312 API 改善対応)
 *
 * 本 helper は 5 ファイルの contract test から依存される共通基盤。将来の改修で
 * silent regression (null 返却の意味論変化、anchorMode の挙動反転 等) を
 * 直接検知する fixture を配置する。contract test 側の detection logic describe
 * (aggregateCapLogErrorContract 等) は実コード対象のため残置、本ファイルは helper
 * 単体の挙動のみを狭く lock-in する。
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

    // #312 pr-test-analyzer I3: string anchor + 'after-match' + anchor 不在のケース lock-in。
    it("string anchor + 'after-match' で anchor 不在時は null", () => {
      expect(
        extractBraceBlock('no anchor here', 'MISSING', { anchorMode: 'after-match' }),
      ).to.be.null;
    });

    // #312 pr-test-analyzer I4: 'from-start' 明示指定の挙動を lock-in (default と同一動作)。
    it("anchorMode: 'from-start' 明示指定は default と同じ挙動", () => {
      const source = `try { inner } catch (e) { outer }`;
      const anchor = /try\s*\{[\s\S]*?\}\s*catch\s*\(\s*\w+\s*\)\s*/;
      expect(extractBraceBlock(source, anchor, { anchorMode: 'from-start' })).to.equal(
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

    // #312 pr-test-analyzer I2: 空 source の退化ケースを lock-in。
    it('空 source は null を返す', () => {
      expect(extractBraceBlock('', /const/)).to.be.null;
      expect(extractBraceBlock('', 'const')).to.be.null;
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

    // #312 pr-test-analyzer I1: brace 側の unbalanced テストと対称に paren 側も lock-in。
    it('unbalanced な `(` は null を返す (loop 完走時)', () => {
      expect(extractParenBlock('f(g(1, 2', 'f')).to.be.null;
    });
  });

  // #312 CodeRabbit Minor: global flag (/g) 付き RegExp は match.index が undefined になるため
  // silent に anchor 不在扱いになる silent PASS 経路。明示的 throw で regression を可視化。
  describe('global flag (/g) RegExp anchor の reject', () => {
    it('extractBraceBlock: /g 付き anchor は throw する', () => {
      expect(() => extractBraceBlock('function f() { return 1; }', /function\s+f/g)).to.throw(
        /global flag.*非対応/,
      );
    });

    it('extractParenBlock: /g 付き anchor は throw する', () => {
      expect(() => extractParenBlock('f()', /f/g)).to.throw(/global flag.*非対応/);
    });

    it('/gi など /g を含む複合 flag も reject する', () => {
      expect(() => extractBraceBlock('FUNC F() {}', /FUNC/gi)).to.throw(/global flag.*非対応/);
    });

    it('/i など /g 以外の flag は通常通り動作', () => {
      expect(extractBraceBlock('FUNC F() { inner }', /func/i)).to.equal('{ inner }');
    });
  });

  // #312 pr-test-analyzer C1 (Critical) + comment-analyzer S4: null source passthrough は
  // JSDoc で契約しているが本 helper 単体テストでの回帰ガードが欠如していた。chain 呼出
  // (`extractBraceBlock(extractBraceBlock(...), ...)` で内側が null) が実運用で発生するため
  // 必須 lock-in (#312 PR-2 で caller 側 alias wrapper を撤去、helper 側 null 透過に集約済)。
  describe('null source passthrough (chain 用途)', () => {
    it('extractBraceBlock(null, ...) は常に null を返す', () => {
      expect(extractBraceBlock(null, /anything/)).to.be.null;
      expect(extractBraceBlock(null, 'anything')).to.be.null;
      expect(extractBraceBlock(null, /anything/, { anchorMode: 'after-match' })).to.be.null;
      expect(extractBraceBlock(null, 'anything', { anchorMode: 'from-start' })).to.be.null;
    });

    it('extractParenBlock(null, ...) も null を透過する', () => {
      expect(extractParenBlock(null, /anything/)).to.be.null;
      expect(extractParenBlock(null, 'anything')).to.be.null;
      expect(extractParenBlock(null, /anything/, { anchorMode: 'after-match' })).to.be.null;
    });
  });
});
