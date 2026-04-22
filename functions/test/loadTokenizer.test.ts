/**
 * scripts/lib/loadTokenizer.js の contract test (Issue #237)
 *
 * 対象:
 *   - loadTokenizer(): BE tokenizer module (compiled lib/) を require して返す
 *   - ensureTokenizerBuilt(): functions/lib/ が未生成なら build を自動実行
 *   - TOKENIZER_PATH: 期待パスが resolve される
 *
 * 実行前提: `cd functions && npm run build` が事前に走っている必要がある (既存
 * forceReindex.test.ts と同じ前提)。CI / npm test は type-check:test → mocha の
 * 順で実行されるが、lib/ の生成は CLI ops (`npm test` 直前の build task) に委ねる。
 */

import { expect } from 'chai';
import * as path from 'path';
import { createRequire } from 'module';

const requireCjs = createRequire(`${process.cwd()}/package.json`);
const loadTokenizerMod = requireCjs(
  path.resolve(process.cwd(), '../scripts/lib/loadTokenizer.js'),
) as {
  loadTokenizer: () => unknown;
  ensureTokenizerBuilt: () => void;
  TOKENIZER_PATH: string;
};

describe('scripts/lib/loadTokenizer (#237)', () => {
  describe('TOKENIZER_PATH', () => {
    it('functions/lib/functions/src/utils/tokenizer.js を指す', () => {
      expect(loadTokenizerMod.TOKENIZER_PATH).to.match(
        /functions\/lib\/functions\/src\/utils\/tokenizer\.js$/,
      );
    });
  });

  describe('loadTokenizer()', () => {
    // BE tokenizer が export する必須関数 (tokenizer.ts の主要 API)
    const REQUIRED_FUNCTIONS = [
      'normalizeForSearch',
      'generateBigrams',
      'generateKeywords',
      'generateDateTokens',
      'generateDateTokensFromString',
      'generateDocumentTokens',
      'tokenizeQuery',
      'tokenizeQueryByWords',
      'generateTokenId',
      'generateTokensHash',
    ] as const;

    for (const fnName of REQUIRED_FUNCTIONS) {
      it(`${fnName} が function として load される`, () => {
        const tokenizer = loadTokenizerMod.loadTokenizer() as Record<string, unknown>;
        expect(tokenizer[fnName], `${fnName} must be a function`).to.be.a('function');
      });
    }

    it('FIELD_WEIGHTS が object として load される', () => {
      const tokenizer = loadTokenizerMod.loadTokenizer() as {
        FIELD_WEIGHTS: Record<string, number>;
      };
      expect(tokenizer.FIELD_WEIGHTS).to.be.an('object');
      expect(tokenizer.FIELD_WEIGHTS).to.include.all.keys(
        'customer',
        'office',
        'documentType',
        'date',
        'fileName',
      );
    });

    it('generateTokenId が 8 文字 hex simple hash を返す (md5 16 文字ではない)', () => {
      // Issue #237 core: migrate-search-index 旧実装の md5 16 文字から
      // BE と同じ 32bit simple hash 8 文字へ統一したことを lock-in
      const tokenizer = loadTokenizerMod.loadTokenizer() as {
        generateTokenId: (token: string) => string;
      };
      const tokenId = tokenizer.generateTokenId('事業所');
      expect(tokenId).to.be.a('string');
      expect(tokenId).to.have.lengthOf(8);
      expect(tokenId).to.match(/^[0-9a-f]{8}$/);
    });

    it('generateDocumentTokens が TokenInfo[] を返す (旧 {token: {...}} 形式ではない)', () => {
      const tokenizer = loadTokenizerMod.loadTokenizer() as {
        generateDocumentTokens: (metadata: unknown) => Array<{
          token: string;
          field: string;
          weight: number;
        }>;
      };
      const tokens = tokenizer.generateDocumentTokens({
        customerName: 'テスト太郎',
        fileDate: null,
      });
      expect(tokens).to.be.an('array');
      expect(tokens.length).to.be.greaterThan(0);
      for (const t of tokens) {
        expect(t).to.have.all.keys('token', 'field', 'weight');
        expect(t.token).to.be.a('string');
        expect(t.field).to.be.a('string');
        expect(t.weight).to.be.a('number');
      }
    });
  });

  describe('ensureTokenizerBuilt()', () => {
    it('既に lib/ が存在する場合は no-op (throw しない)', () => {
      // test 実行時は事前 build 済前提なので、呼出しても throw しないことを確認
      expect(() => loadTokenizerMod.ensureTokenizerBuilt()).to.not.throw();
    });
  });
});
