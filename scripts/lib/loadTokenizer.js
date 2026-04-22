/**
 * BE tokenizer (functions/src/utils/tokenizer.ts) を scripts から共有する helper (Issue #237)
 *
 * 背景: 従来は force-reindex.js のみが compiled lib/ を require していたが、
 * migrate-search-index.js は inline で tokenizer ロジックを再実装していた
 * (md5 hash / stopword なし / 日付 8 形式等、BE との drift 多数)。
 * 本 helper を両 script で共有し、tokenizer の SSoT を functions/src/utils/tokenizer.ts
 * に一元化する。
 *
 * 使い方:
 *   const { loadTokenizer, ensureTokenizerBuilt } = require('./lib/loadTokenizer');
 *   ensureTokenizerBuilt();                 // CLI 実行時のみ呼ぶ (test からは省略)
 *   const tokenizer = loadTokenizer();       // 10 関数を含む module を返す
 *
 * loadTokenizer() の戻り値 (BE tokenizer.ts の export 全て):
 *   - normalizeForSearch, generateBigrams, generateKeywords
 *   - generateDateTokens, generateDateTokensFromString
 *   - generateDocumentTokens (TokenInfo[] を返す)
 *   - tokenizeQuery, tokenizeQueryByWords
 *   - generateTokenId (32bit simple hash, 8 文字 hex), generateTokensHash
 *   - FIELD_WEIGHTS, TokenField, DocumentMetadata 型等
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const TOKENIZER_PATH = path.resolve(
  __dirname,
  '../../functions/lib/functions/src/utils/tokenizer.js',
);

/**
 * functions/lib/ が未生成なら `npm --prefix functions run build` を実行する。
 * CLI 起動時のみ呼び出し、test (require) 時は事前 build を呼び出し側に委ねる。
 */
function ensureTokenizerBuilt() {
  if (fs.existsSync(TOKENIZER_PATH)) return;
  console.log('[BUILD] functions/lib/ が未生成のため build を実行します...');
  // execFileSync: shell を介さないため引数注入リスクなし (force-reindex.js 既存慣習と整合)
  execFileSync('npm', ['run', 'build'], {
    cwd: path.resolve(__dirname, '../../functions'),
    stdio: 'inherit',
  });
  if (!fs.existsSync(TOKENIZER_PATH)) {
    throw new Error(
      `[FATAL] build 後も tokenizer が見つかりません: ${TOKENIZER_PATH}`,
    );
  }
}

/**
 * BE tokenizer の compiled module を返す。
 *
 * **事前に lib/ が build 済みであること**を呼び出し側が保証する必要がある
 * (CLI なら top-level の `if (require.main === module) ensureTokenizerBuilt()` で担保、
 * test なら `npm test` の前に `cd functions && npm run build` を走らせる前提)。
 *
 * Evaluator MEDIUM 指摘 (Issue #237): loadTokenizer() 内部で ensureTokenizerBuilt() を
 * 呼ぶと「test は事前 build、CLI は明示呼び出し」というコメントの規約と乖離するため、
 * 本関数は純粋な require に限定する。lib/ 不在時は require が MODULE_NOT_FOUND で
 * loud failure する (silent 自動ビルド経路を廃止)。
 */
function loadTokenizer() {
  try {
    return require(TOKENIZER_PATH);
  } catch (err) {
    // MODULE_NOT_FOUND を actionable message で包む (#379 silent-failure-hunter #1)。
    // 生のスタックだけだと tokenizer の build が必要であることが operator に伝わらない。
    if (err && err.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `[loadTokenizer] functions/lib/ が未生成です (path: ${TOKENIZER_PATH})。` +
          `CLI 実行時は ensureTokenizerBuilt() が事前に走るはずです。` +
          `test 実行前は 'cd functions && npm run build' を走らせてください。` +
          `原因: ${err.message}`,
      );
    }
    throw err;
  }
}

module.exports = {
  loadTokenizer,
  ensureTokenizerBuilt,
  TOKENIZER_PATH,
};
