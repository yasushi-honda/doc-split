/**
 * BE tokenizer が返す TokenInfo[] を search_index 用に tokenId ごと集約する helper (Issue #237)
 *
 * 背景: BE `functions/src/utils/tokenizer.ts` の `generateDocumentTokens()` は
 * `TokenInfo[] = { token, field, weight }[]` を返す。search_index collection では
 * 同じ tokenId (= hash(token)) に対して複数 field からの score / fieldsMask を集約した
 * `{ [tokenId]: { score, fieldsMask } }` 形式が必要。この集約ロジックは
 * `functions/src/search/searchIndexer.ts:addDocumentToIndex` 内で private 実装として
 * 存在する (本 PR では BE 側 refactor を scope 外、Follow-up Issue 予定)。
 *
 * 本 helper は migrate-search-index.js が BE tokenizer を利用する際に同じ集約結果を
 * 得るための薄い scripts ローカル実装。BE searchIndexer と意図的に同ロジックで、
 * 将来 BE 側から export される aggregate helper が追加されたら本ファイルは
 * それに差替える (Follow-up Issue)。
 *
 * FIELD_TO_MASK は searchIndexer.ts:23-29 の値と完全一致させる必要がある。
 * 不一致なら production trigger と migrate-search-index の fieldsMask が drift する。
 */

/**
 * フィールド名 → ビットマスク変換 (searchIndexer.ts の private const と同値を維持)
 * tokenizer.ts の TokenField union と 1:1 対応。
 */
const FIELD_TO_MASK = Object.freeze({
  customer: 1,
  office: 2,
  documentType: 4,
  fileName: 8,
  date: 16,
});

/**
 * TokenInfo[] を tokenId ごとに集約する。
 *
 * @param {Array<{token: string, field: string, weight: number}>} tokens
 *   BE tokenizer の generateDocumentTokens 戻り値
 * @param {(token: string) => string} generateTokenId
 *   BE tokenizer の generateTokenId (loadTokenizer().generateTokenId)
 * @returns {Map<string, {score: number, fieldsMask: number}>}
 *   tokenId をキーとした集約結果 Map
 */
function aggregateTokensByTokenId(tokens, generateTokenId) {
  const tokenMap = new Map();

  for (const { token, field, weight } of tokens) {
    const fieldMask = FIELD_TO_MASK[field];
    if (fieldMask === undefined) {
      throw new Error(
        `[aggregateTokens] unknown TokenField "${field}". ` +
          `FIELD_TO_MASK = ${JSON.stringify(FIELD_TO_MASK)}. ` +
          `tokenizer.ts の TokenField union を拡張した場合は本 helper の ` +
          `FIELD_TO_MASK も同時に更新すること。`,
      );
    }
    const tokenId = generateTokenId(token);
    const existing = tokenMap.get(tokenId);
    if (existing) {
      existing.score += weight;
      existing.fieldsMask |= fieldMask;
    } else {
      tokenMap.set(tokenId, {
        score: weight,
        fieldsMask: fieldMask,
      });
    }
  }

  return tokenMap;
}

module.exports = {
  FIELD_TO_MASK,
  aggregateTokensByTokenId,
};
