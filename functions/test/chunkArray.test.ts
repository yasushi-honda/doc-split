/**
 * chunkArray ユーティリティのテスト
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { chunkArray } from '../src/utils/chunkArray';

describe('chunkArray', () => {
  it('要素数がサイズで割り切れる場合、均等なチャンクに分割する', () => {
    expect(chunkArray([1, 2, 3, 4, 5, 6], 2)).to.deep.equal([[1, 2], [3, 4], [5, 6]]);
  });

  it('要素数がサイズで割り切れない場合、最後のチャンクは端数になる', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).to.deep.equal([[1, 2], [3, 4], [5]]);
  });

  it('サイズが要素数以上なら1チャンクにまとまる', () => {
    expect(chunkArray([1, 2, 3], 10)).to.deep.equal([[1, 2, 3]]);
  });

  it('空配列は空配列を返す', () => {
    expect(chunkArray([], 5)).to.deep.equal([]);
  });

  it('サイズ1は各要素が個別チャンクになる', () => {
    expect(chunkArray(['a', 'b'], 1)).to.deep.equal([['a'], ['b']]);
  });

  it('元配列の順序を保持する', () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const chunks = chunkArray(items, 10);
    expect(chunks).to.have.length(3);
    expect(chunks.flat()).to.deep.equal(items);
  });

  it('size=0はエラーを投げる', () => {
    expect(() => chunkArray([1, 2], 0)).to.throw('size must be positive');
  });

  it('size負値はエラーを投げる', () => {
    expect(() => chunkArray([1, 2], -1)).to.throw('size must be positive');
  });
});
