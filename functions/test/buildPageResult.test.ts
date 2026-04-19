/**
 * buildPageResult 振る舞いテスト (Issue #267, #258 follow-up)
 *
 * 目的: #258 で ocrProcessor.ts L146-149 の bridge code (capped.truncated ? ... )
 * を削除して `{ ...capped, pageNumber, ... }` に簡略化した際、Firestore 書込形式が
 * 旧 bridge code 経由と完全一致することを保証する。processDocument 統合テストは
 * OCR を mock しているため、buildPageResult 単体の振る舞いは未保証だった (pr-test-analyzer I3)。
 *
 * 方式: buildPageResult を module-level export (#267) し、truncated=true/false の
 * 両ケースで戻り値の shape (hasOwnProperty 含む) を検証。
 */

import { expect } from 'chai';
import { buildPageResult } from '../src/ocr/buildPageResult';
import { MAX_PAGE_TEXT_LENGTH } from '../src/utils/textCap';

describe('buildPageResult (#267)', () => {
  describe('truncated=false (short text)', () => {
    const result = buildPageResult(
      { text: 'short page body', inputTokens: 10, outputTokens: 20 },
      1,
      'Page 1/1'
    );

    it('text / pageNumber / tokens を正しく伝播する', () => {
      expect(result.text).to.equal('short page body');
      expect(result.pageNumber).to.equal(1);
      expect(result.inputTokens).to.equal(10);
      expect(result.outputTokens).to.equal(20);
    });

    it('truncated: false を返す', () => {
      expect(result.truncated).to.equal(false);
    });

    it('戻り値オブジェクトに originalLength キーが存在しない (hasOwnProperty で検証)', () => {
      expect(Object.prototype.hasOwnProperty.call(result, 'originalLength')).to.equal(false);
    });
  });

  describe('truncated=true (long text beyond MAX_PAGE_TEXT_LENGTH)', () => {
    const longText = 'x'.repeat(MAX_PAGE_TEXT_LENGTH + 1000);
    const result = buildPageResult(
      { text: longText, inputTokens: 100, outputTokens: 200 },
      3,
      'Page 3/5'
    );

    it('text は MAX_PAGE_TEXT_LENGTH 以下に切り詰められる', () => {
      expect(result.text.length).to.be.at.most(MAX_PAGE_TEXT_LENGTH);
    });

    it('truncated: true を返す', () => {
      expect(result.truncated).to.equal(true);
    });

    it('originalLength は元テキスト長と一致する', () => {
      if (result.truncated) {
        expect(result.originalLength).to.equal(longText.length);
      } else {
        throw new Error('truncated should be true for this test');
      }
    });

    it('pageNumber / tokens を正しく伝播する', () => {
      expect(result.pageNumber).to.equal(3);
      expect(result.inputTokens).to.equal(100);
      expect(result.outputTokens).to.equal(200);
    });
  });

  // #279: buildPageResult は truncate 時に console.warn で observability 信号を出す。
  // structured logger 差し替え時の silent failure 防御として、副作用を明示的に lock-in する。
  // textCap.test.ts の `withWarnSpy` と同方式 (sinon 依存を新規追加しない polyfill)。
  describe('console.warn 副作用 (#279)', () => {
    /** console.warn を一時的に差し替えて呼出を捕捉するヘルパ */
    function withWarnSpy<T>(fn: () => T): { calls: unknown[][]; result: T } {
      const original = console.warn;
      const calls: unknown[][] = [];
      console.warn = (...args: unknown[]) => {
        calls.push(args);
      };
      try {
        const result = fn();
        return { calls, result };
      } finally {
        console.warn = original;
      }
    }

    it('truncated=true 時に console.warn が 1 回だけ呼ばれる', () => {
      const longText = 'y'.repeat(MAX_PAGE_TEXT_LENGTH + 500);
      const { calls, result } = withWarnSpy(() =>
        buildPageResult(
          { text: longText, inputTokens: 1, outputTokens: 1 },
          2,
          'Page 2/7',
        ),
      );
      expect(result.truncated).to.equal(true);
      expect(calls.length).to.equal(1);
    });

    it('warn メッセージに label / originalLength / cap 値が含まれる', () => {
      const longText = 'z'.repeat(MAX_PAGE_TEXT_LENGTH + 777);
      const { calls } = withWarnSpy(() =>
        buildPageResult(
          { text: longText, inputTokens: 1, outputTokens: 1 },
          3,
          'Page 3/9',
        ),
      );
      expect(calls.length).to.equal(1);
      const message = String(calls[0]?.[0] ?? '');
      // 将来のフォーマット変更耐性のため、core 要素の存在のみ verify (厳密一致ではなく正規表現)
      expect(message).to.match(/Page 3\/9/);
      expect(message).to.include(String(MAX_PAGE_TEXT_LENGTH + 777));
      expect(message).to.include(String(MAX_PAGE_TEXT_LENGTH));
      expect(message).to.match(/truncat/i);
    });

    it('truncated=false 時は console.warn が呼ばれない', () => {
      const { calls, result } = withWarnSpy(() =>
        buildPageResult(
          { text: 'short body', inputTokens: 1, outputTokens: 1 },
          1,
          'Page 1/1',
        ),
      );
      expect(result.truncated).to.equal(false);
      expect(calls.length).to.equal(0);
    });
  });

  describe('境界値 (MAX_PAGE_TEXT_LENGTH 前後)', () => {
    it('text.length === MAX_PAGE_TEXT_LENGTH で truncated=false を返す', () => {
      const exactText = 'x'.repeat(MAX_PAGE_TEXT_LENGTH);
      const result = buildPageResult(
        { text: exactText, inputTokens: 1, outputTokens: 1 },
        1,
        'Boundary'
      );
      expect(result.truncated).to.equal(false);
      expect(result.text.length).to.equal(MAX_PAGE_TEXT_LENGTH);
      expect(Object.prototype.hasOwnProperty.call(result, 'originalLength')).to.equal(false);
    });

    it('text.length === MAX_PAGE_TEXT_LENGTH + 1 で truncated=true を返す', () => {
      const overByOne = 'x'.repeat(MAX_PAGE_TEXT_LENGTH + 1);
      const result = buildPageResult(
        { text: overByOne, inputTokens: 1, outputTokens: 1 },
        1,
        'Boundary+1'
      );
      expect(result.truncated).to.equal(true);
      if (result.truncated) {
        expect(result.originalLength).to.equal(MAX_PAGE_TEXT_LENGTH + 1);
      }
    });
  });
});
