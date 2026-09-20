/**
 * サイズ超過でスキップしたトークンの仕分け (Issue #984)
 *
 * `generateTokenId` は 32bit ハッシュで、異なるトークン文字列が同じ tokenId になりうる。
 * 書込みが失敗するのは search_index/{tokenId} 文書のため、衝突した文字列は全て同じ運命になる。
 * 実装の式を再計算するのではなく、固定の衝突ペア("Aa" と "BB"、ともに Java の hashCode 系で
 * 同じ値 2112)を使って、ID→文字列の逆引きが 1:N であることを検証する。
 */

import { expect } from 'chai';
import { partitionTokensBySkippedIds } from '../src/search/skippedTokens';
import { generateTokenId, type TokenInfo } from '../src/utils/tokenizer';

const tok = (token: string): TokenInfo => ({ token, field: 'customer', weight: 10 });

describe('partitionTokensBySkippedIds', () => {
  it('前提: "Aa" と "BB" は同じ tokenId に衝突する(固定の衝突ペア)', () => {
    expect(generateTokenId('Aa')).to.equal(generateTokenId('BB'));
    expect(generateTokenId('Aa')).to.equal('00000840'); // 2112 = 0x840
    expect(generateTokenId('other')).to.not.equal(generateTokenId('Aa'));
  });

  it('衝突した両方の文字列を skippedTokens に入れ、registeredTokens には残さない(1:N 逆引き)', () => {
    const tokens = [tok('Aa'), tok('BB'), tok('other')];
    const { registeredTokens, skippedTokens } = partitionTokensBySkippedIds(
      tokens,
      new Set([generateTokenId('Aa')])
    );
    expect(skippedTokens).to.deep.equal(['Aa', 'BB']);
    expect(registeredTokens.map((t) => t.token)).to.deep.equal(['other']);
  });

  it('skippedTokens は重複を排除する(同じ文字列が複数フィールドから生成された場合)', () => {
    const tokens: TokenInfo[] = [
      { token: 'Aa', field: 'customer', weight: 10 },
      { token: 'Aa', field: 'office', weight: 8 },
      { token: 'plain', field: 'fileName', weight: 5 },
    ];
    const { registeredTokens, skippedTokens } = partitionTokensBySkippedIds(tokens, new Set([generateTokenId('Aa')]));
    expect(skippedTokens).to.deep.equal(['Aa']);
    expect(registeredTokens.map((t) => t.token)).to.deep.equal(['plain']);
  });

  it('スキップが無ければ全て registeredTokens、skippedTokens は空(境界)', () => {
    const tokens = [tok('a'), tok('b')];
    const { registeredTokens, skippedTokens } = partitionTokensBySkippedIds(tokens, new Set());
    expect(registeredTokens).to.deep.equal(tokens);
    expect(skippedTokens).to.deep.equal([]);
  });

  it('全トークンがスキップなら registeredTokens は空(境界)', () => {
    const tokens = [tok('Aa'), tok('BB')];
    const { registeredTokens, skippedTokens } = partitionTokensBySkippedIds(tokens, new Set([generateTokenId('Aa')]));
    expect(registeredTokens).to.deep.equal([]);
    expect(skippedTokens).to.deep.equal(['Aa', 'BB']);
  });

  it('トークン列が空なら両方とも空(境界)', () => {
    const { registeredTokens, skippedTokens } = partitionTokensBySkippedIds([], new Set(['00000840']));
    expect(registeredTokens).to.deep.equal([]);
    expect(skippedTokens).to.deep.equal([]);
  });
});
