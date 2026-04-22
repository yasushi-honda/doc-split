/**
 * scripts/migrate-search-index.js の grep-based contract test (Issue #237)
 *
 * 目的: 本 PR で inline tokenizer (normalizeForSearch / generateBigrams /
 * generateKeywords / generateDateTokens / generateDocumentTokens / generateTokenId /
 * generateTokensHash / FIELD_WEIGHTS / FIELD_TO_MASK / crypto) を削除し、
 * BE tokenizer.ts (via scripts/lib/loadTokenizer.js) に依存する構造に統一した
 * ことを lock-in する。
 *
 * 方式: grep-based (checkGmailAttachmentsEndpointContract.test.ts / splitPdfPayloadContract.test.ts
 * と同形式)。ソースファイル文字列を直接解析する。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SOURCE_PATH = '../scripts/migrate-search-index.js';

let source: string = '';

describe('migrate-search-index.js structural contract (#237)', () => {
  before(() => {
    const abs = resolve(process.cwd(), SOURCE_PATH);
    if (!existsSync(abs)) {
      throw new Error(`Source file not found: ${SOURCE_PATH}`);
    }
    source = readFileSync(abs, 'utf-8');
  });

  describe('inline tokenizer 関数が削除されている', () => {
    // 旧版で inline 定義されていた 7 関数。function 宣言 or 代入式のいずれも許さない。
    // コメント内の「generateTokenId に md5 16 文字 hex を使用していた」等の言及は
    // マッチしないよう `function\s+` / `^const\s+` を anchor にする。
    const INLINE_NAMES = [
      'normalizeForSearch',
      'generateBigrams',
      'generateKeywords',
      'generateDateTokens',
      'generateDocumentTokens',
      'generateTokenId',
      'generateTokensHash',
    ] as const;

    for (const name of INLINE_NAMES) {
      it(`${name} の function 宣言が存在しない`, () => {
        const declRegex = new RegExp(`^function\\s+${name}\\b`, 'm');
        expect(source).to.not.match(declRegex);
      });

      it(`${name} の const 代入 (= function/=> 式) が存在しない`, () => {
        const assignRegex = new RegExp(`^const\\s+${name}\\s*=`, 'm');
        expect(source).to.not.match(assignRegex);
      });
    }
  });

  describe('BE tokenizer 依存が正しく組まれている', () => {
    it("require('./lib/loadTokenizer') が存在する", () => {
      expect(source).to.match(/require\(['"]\.\/lib\/loadTokenizer['"]\)/);
    });

    it("require('./lib/aggregateTokens') が存在する", () => {
      expect(source).to.match(/require\(['"]\.\/lib\/aggregateTokens['"]\)/);
    });

    it('loadTokenizer() が呼ばれている (tokenizer module を取得)', () => {
      expect(source).to.match(/loadTokenizer\(\)/);
    });

    it('aggregateTokensByTokenId が呼ばれている (集約 helper 使用)', () => {
      expect(source).to.match(/aggregateTokensByTokenId\s*\(/);
    });

    it('BE tokenizer.generateDocumentTokens が呼ばれている', () => {
      expect(source).to.match(/tokenizer\.generateDocumentTokens\s*\(/);
    });

    it('BE tokenizer.generateTokensHash が呼ばれている', () => {
      expect(source).to.match(/tokenizer\.generateTokensHash\s*\(/);
    });
  });

  describe('旧 md5 依存が削除されている (doc ID 統一 = Issue #237 core)', () => {
    it("require('crypto') が存在しない", () => {
      // コメント内の "md5" は残っているが、crypto モジュール require はゼロであるべき
      expect(source).to.not.match(/require\(['"]crypto['"]\)/);
    });

    it('createHash (md5 ベースの旧実装) の呼出しが存在しない', () => {
      expect(source).to.not.match(/createHash\s*\(/);
    });
  });

  describe('FIELD_TO_MASK / FIELD_WEIGHTS の inline 定義が削除されている', () => {
    it('FIELD_TO_MASK の const 定義が存在しない (aggregateTokens 側に移動)', () => {
      expect(source).to.not.match(/^const\s+FIELD_TO_MASK\s*=/m);
    });

    it('FIELD_WEIGHTS の const 定義が存在しない (tokenizer.ts 側に移動)', () => {
      expect(source).to.not.match(/^const\s+FIELD_WEIGHTS\s*=/m);
    });
  });
});
