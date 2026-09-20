/**
 * サイズ超過でスキップしたトークンの仕分け (Issue #984)
 *
 * 副作用のない純粋関数にしているのは、`generateTokenId` の 32bit ハッシュ衝突(異なるトークン文字列が同じ
 * tokenId になる)を、tokenizer の出力に依存せず固定の衝突ペアで単体テストするため。
 */

import { generateTokenId, type TokenInfo } from '../utils/tokenizer';

/**
 * トークン列を、登録できたものとスキップしたものに仕分ける。
 *
 * スキップ判定は tokenId 単位(書込みが失敗するのは search_index/{tokenId} 文書)。
 * `generateTokenId` は 32bit ハッシュで異なる文字列が同じ tokenId になりうるため、ID→文字列は 1:N で
 * 逆引きする(衝突した文字列の片方だけを skippedTokens に入れると、もう片方が search.tokens に残り、
 * 登録されていない posting を削除対象にして df を誤って減算する)。
 *
 * @returns registeredTokens: 登録できたトークン(search.tokens に保存する) /
 *          skippedTokens: スキップしたトークン文字列(重複排除済み。search.skippedTokens に保存する)
 */
export function partitionTokensBySkippedIds(
  tokens: readonly TokenInfo[],
  skippedTokenIds: ReadonlySet<string>
): { registeredTokens: TokenInfo[]; skippedTokens: string[] } {
  const registeredTokens: TokenInfo[] = [];
  const skipped = new Set<string>();
  for (const t of tokens) {
    if (skippedTokenIds.has(generateTokenId(t.token))) skipped.add(t.token);
    else registeredTokens.push(t);
  }
  return { registeredTokens, skippedTokens: [...skipped] };
}
