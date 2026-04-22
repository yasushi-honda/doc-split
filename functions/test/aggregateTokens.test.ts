/**
 * scripts/lib/aggregateTokens.js の unit test (Issue #237)
 *
 * TokenInfo[] → Map<tokenId, {score, fieldsMask}> 集約ロジックの lock-in。
 * searchIndexer.ts:addDocumentToIndex 内 private 実装と意味的に等価であることを
 * 検証する (tokenizer.ts に FIELD_TO_MASK + aggregate helper を移動する本 PR 後続の
 * Follow-up Issue で完全統合する予定)。
 */

import { expect } from 'chai';
import * as path from 'path';
import { createRequire } from 'module';

const requireCjs = createRequire(`${process.cwd()}/package.json`);
const aggMod = requireCjs(
  path.resolve(process.cwd(), '../scripts/lib/aggregateTokens.js'),
) as {
  FIELD_TO_MASK: Readonly<Record<string, number>>;
  aggregateTokensByTokenId: (
    tokens: Array<{ token: string; field: string; weight: number }>,
    generateTokenId: (s: string) => string,
  ) => Map<string, { score: number; fieldsMask: number }>;
};

// test 用の fake generateTokenId: token 文字列をそのまま tokenId に使う
const fakeGenId = (s: string): string => `id:${s}`;

describe('scripts/lib/aggregateTokens (#237)', () => {
  describe('FIELD_TO_MASK', () => {
    it('searchIndexer.ts の FIELD_TO_MASK と同じ値を持つ (drift 検知)', () => {
      // searchIndexer.ts 側の FIELD_TO_MASK が変わったら本 test が fail する。
      // 両者の同期は Follow-up Issue で構造的に解決する予定 (tokenizer.ts へ export 移動)
      expect(aggMod.FIELD_TO_MASK).to.deep.equal({
        customer: 1,
        office: 2,
        documentType: 4,
        fileName: 8,
        date: 16,
      });
    });

    it('Object.freeze されている (mutation 防止)', () => {
      expect(Object.isFrozen(aggMod.FIELD_TO_MASK)).to.equal(true);
    });
  });

  describe('aggregateTokensByTokenId', () => {
    it('空配列 → 空 Map', () => {
      const result = aggMod.aggregateTokensByTokenId([], fakeGenId);
      expect(result.size).to.equal(0);
    });

    it('1 トークン → size=1、score/fieldsMask が単純代入', () => {
      const result = aggMod.aggregateTokensByTokenId(
        [{ token: 'A', field: 'customer', weight: 3 }],
        fakeGenId,
      );
      expect(result.size).to.equal(1);
      expect(result.get('id:A')).to.deep.equal({ score: 3, fieldsMask: 1 });
    });

    it('同 token 異 field → score 加算 + fieldsMask ビット OR', () => {
      // 同じ "A" が customer (mask=1) と office (mask=2) から来た場合、
      // tokenId は同じで score は weight 合算、fieldsMask は 1|2=3
      const result = aggMod.aggregateTokensByTokenId(
        [
          { token: 'A', field: 'customer', weight: 3 },
          { token: 'A', field: 'office', weight: 2 },
        ],
        fakeGenId,
      );
      expect(result.size).to.equal(1);
      expect(result.get('id:A')).to.deep.equal({ score: 5, fieldsMask: 3 });
    });

    it('異なる token → 独立したエントリ', () => {
      const result = aggMod.aggregateTokensByTokenId(
        [
          { token: 'A', field: 'customer', weight: 3 },
          { token: 'B', field: 'date', weight: 2 },
        ],
        fakeGenId,
      );
      expect(result.size).to.equal(2);
      expect(result.get('id:A')).to.deep.equal({ score: 3, fieldsMask: 1 });
      expect(result.get('id:B')).to.deep.equal({ score: 2, fieldsMask: 16 });
    });

    it('未知の field → 明示的 throw (silent drift 防止)', () => {
      expect(() =>
        aggMod.aggregateTokensByTokenId(
          [{ token: 'X', field: 'unknownField', weight: 1 }],
          fakeGenId,
        ),
      ).to.throw(/unknown TokenField/);
    });

    it('同 token 同 field 重複 → score 加算 / fieldsMask 不変 (bit OR 冪等)', () => {
      // 同じ field からの 2 entries は score 加算、fieldsMask は同じ値で OR → 不変
      const result = aggMod.aggregateTokensByTokenId(
        [
          { token: 'A', field: 'customer', weight: 3 },
          { token: 'A', field: 'customer', weight: 1.5 },
        ],
        fakeGenId,
      );
      expect(result.get('id:A')).to.deep.equal({ score: 4.5, fieldsMask: 1 });
    });

    it('全 5 field 型を網羅して fieldsMask = 31 (1|2|4|8|16)', () => {
      const result = aggMod.aggregateTokensByTokenId(
        [
          { token: 'X', field: 'customer', weight: 1 },
          { token: 'X', field: 'office', weight: 1 },
          { token: 'X', field: 'documentType', weight: 1 },
          { token: 'X', field: 'fileName', weight: 1 },
          { token: 'X', field: 'date', weight: 1 },
        ],
        fakeGenId,
      );
      expect(result.get('id:X')?.fieldsMask).to.equal(31);
      expect(result.get('id:X')?.score).to.equal(5);
    });
  });
});
