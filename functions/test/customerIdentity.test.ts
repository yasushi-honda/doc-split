/**
 * customerIdentity テスト (ADR-0022 顧客未確定ゲート再設計、2026-07-25)
 *
 * isValidCustomerSelection/findSameNameCollisionNamesはFirestore/Admin SDK非依存の
 * 純粋関数のため、displayFileName.test.ts等と同じ規約でユニットテストする(emulator不要)。
 * frontend/functions双方から参照される契約をここで固定する。
 */

import { expect } from 'chai';
import {
  isValidCustomerSelection,
  findSameNameCollisionNames,
} from '../../shared/customerIdentity';

describe('isValidCustomerSelection', () => {
  it('有効な顧客名はtrueを返す', () => {
    expect(isValidCustomerSelection('田中太郎')).to.equal(true);
  });

  it('前後空白付きの有効な顧客名もtrueを返す(trim後に判定)', () => {
    expect(isValidCustomerSelection(' 田中太郎 ')).to.equal(true);
  });

  it('null/undefinedはfalseを返す', () => {
    expect(isValidCustomerSelection(null)).to.equal(false);
    expect(isValidCustomerSelection(undefined)).to.equal(false);
  });

  it('空文字・空白のみはfalseを返す', () => {
    expect(isValidCustomerSelection('')).to.equal(false);
    expect(isValidCustomerSelection('   ')).to.equal(false);
  });

  it('sentinel値(「未判定」「不明顧客」)はfalseを返す', () => {
    expect(isValidCustomerSelection('未判定')).to.equal(false);
    expect(isValidCustomerSelection('不明顧客')).to.equal(false);
  });

  it('前後空白付きのsentinel値もfalseを返す', () => {
    expect(isValidCustomerSelection(' 不明顧客 ')).to.equal(false);
  });
});

describe('findSameNameCollisionNames', () => {
  it('同名が2件以上のグループのみを集合として返す', () => {
    const result = findSameNameCollisionNames([
      { name: '田中太郎' },
      { name: '田中太郎' },
      { name: '佐藤花子' },
    ]);
    expect([...result]).to.deep.equal(['田中太郎']);
  });

  it('同名が1件のみの名前は含まれない', () => {
    const result = findSameNameCollisionNames([{ name: '佐藤花子' }]);
    expect(result.size).to.equal(0);
  });

  it('空配列は空の集合を返す', () => {
    const result = findSameNameCollisionNames([]);
    expect(result.size).to.equal(0);
  });

  it('3件以上の同名グループも1件の衝突名として集合に含まれる', () => {
    const result = findSameNameCollisionNames([
      { name: '田中太郎' },
      { name: '田中太郎' },
      { name: '田中太郎' },
    ]);
    expect([...result]).to.deep.equal(['田中太郎']);
  });

  it('複数の衝突グループをすべて検出する', () => {
    const result = findSameNameCollisionNames([
      { name: '田中太郎' },
      { name: '田中太郎' },
      { name: '鈴木一郎' },
      { name: '鈴木一郎' },
      { name: '佐藤花子' },
    ]);
    expect([...result].sort()).to.deep.equal(['田中太郎', '鈴木一郎']);
  });
});
