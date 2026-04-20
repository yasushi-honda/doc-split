/**
 * helpers/patterns.ts の regex 定数挙動 lock-in テスト (Issue #313 Q4)
 *
 * 目的: SAFE_LOG_ERROR_CALL 等の anchor 正規表現が意図通りに match/non-match することを
 * 単体で保証する。集約により caller の安全性が regex 定義に集中依存するため、
 * 定数自体の挙動回帰を静的に防ぐ。
 *
 * 方針: positive / negative / boundary の 3 軸で網羅。`\b` word boundary の
 * 偽陽性防御挙動 (`xxxSafeLogError(` / `SafeLogErrorWrapper(` を除外) を明示 lock-in。
 */

import { expect } from 'chai';
import { SAFE_LOG_ERROR_CALL } from './patterns';

describe('helpers/patterns SAFE_LOG_ERROR_CALL', () => {
  describe('positive: 正当な safeLogError 呼出を match', () => {
    it('単純呼出 `safeLogError(` を match', () => {
      expect(SAFE_LOG_ERROR_CALL.test('safeLogError(')).to.equal(true);
    });

    it('await 付き `await safeLogError(` を match', () => {
      expect(SAFE_LOG_ERROR_CALL.test('await safeLogError(')).to.equal(true);
    });

    it('スペース入り `safeLogError (` を match (\\s* 許容)', () => {
      expect(SAFE_LOG_ERROR_CALL.test('safeLogError (')).to.equal(true);
    });

    it('行頭 indent 後の呼出を match', () => {
      expect(SAFE_LOG_ERROR_CALL.test('    safeLogError(')).to.equal(true);
    });

    it('オブジェクトリテラル引数付きの呼出を match', () => {
      expect(SAFE_LOG_ERROR_CALL.test('safeLogError({ error, source: "ocr" })')).to.equal(true);
    });
  });

  describe('negative: 類似名 / 無関係文字列を非 match (\\b 偽陽性防御)', () => {
    it('prefix 付き `xxxSafeLogError(` を非 match (word boundary)', () => {
      // `\b` の直前が word char (x) の場合、`\b` は非境界で match しない。
      expect(SAFE_LOG_ERROR_CALL.test('xxxSafeLogError(')).to.equal(false);
    });

    it('類似名 `SafeLogErrorWrapper(` を非 match', () => {
      // 大文字始まりは `safeLogError` と literal が一致しないため non-match。
      // `s` と `S` で大小文字が食い違う検知も lock-in。
      expect(SAFE_LOG_ERROR_CALL.test('SafeLogErrorWrapper(')).to.equal(false);
    });

    it('中間含有名 `isSafeLogError(` を非 match (word 中間の `\\b` 偽陽性防御)', () => {
      // `isSafeLogError` は `is` + `SafeLogError` のキャメル結合。literal `safeLogError` (s 小文字)
      // が文字列中に現れず non-match。大文字 `SafeLogError` への match を許すと、helper 名と
      // 判定関数名 (`isSafeLogError` 等) が混同される silent 誤検知リスクがある。
      expect(SAFE_LOG_ERROR_CALL.test('isSafeLogError(')).to.equal(false);
    });

    it('`logError(` (safe なし) を非 match', () => {
      expect(SAFE_LOG_ERROR_CALL.test('logError(')).to.equal(false);
    });

    it('文字列リテラル内のみで `(` が欠落している場合は非 match', () => {
      // `\s*\(` で `(` 必須のため、呼出 syntax を持たない参照は非 match。
      expect(SAFE_LOG_ERROR_CALL.test("const fn = 'safeLogError';")).to.equal(false);
    });

    it('空文字列を非 match', () => {
      expect(SAFE_LOG_ERROR_CALL.test('')).to.equal(false);
    });
  });

  describe('boundary: 挙動契約 lock-in', () => {
    it('global flag (/g) を持たない (exec 状態保持による silent drift 防止)', () => {
      // `match(/foo/g)` は match.index を undefined にする silent PASS 経路を持つ
      // (session23 CodeRabbit 指摘)。SAFE_LOG_ERROR_CALL は /g を持たない契約。
      expect(SAFE_LOG_ERROR_CALL.global).to.equal(false);
    });

    it('case sensitive (/i flag を持たない)', () => {
      // `safelogerror` 等の大小文字違いは別 identifier として non-match であるべき。
      expect(SAFE_LOG_ERROR_CALL.ignoreCase).to.equal(false);
      expect(SAFE_LOG_ERROR_CALL.test('safelogerror(')).to.equal(false);
      expect(SAFE_LOG_ERROR_CALL.test('SAFELOGERROR(')).to.equal(false);
    });

    it('multiline flag (/m) を持たない (単一行検知前提)', () => {
      expect(SAFE_LOG_ERROR_CALL.multiline).to.equal(false);
    });
  });
});
