/**
 * 検索インデックス: silent failure 防止テスト
 *
 * Issue #219: removeTokensFromIndex の catch で全エラー握潰し対策
 * NOT_FOUND (gRPC code 5) のみ無視可、それ以外は明示的にログを残す。
 */

import { expect } from 'chai';
import { isFirestoreNotFoundError } from '../src/search/errors';

describe('searchIndexer: isFirestoreNotFoundError', () => {
  it('gRPC code 5 (NOT_FOUND) を true と判定', () => {
    const error = Object.assign(new Error('Document not found'), { code: 5 });
    expect(isFirestoreNotFoundError(error)).to.be.true;
  });

  it('文字列 "NOT_FOUND" を含む code を true と判定', () => {
    const error = Object.assign(new Error('Document not found'), { code: 'NOT_FOUND' });
    expect(isFirestoreNotFoundError(error)).to.be.true;
  });

  it('PERMISSION_DENIED (code 7) を false と判定', () => {
    const error = Object.assign(new Error('Permission denied'), { code: 7 });
    expect(isFirestoreNotFoundError(error)).to.be.false;
  });

  it('UNAVAILABLE (code 14) を false と判定', () => {
    const error = Object.assign(new Error('Service unavailable'), { code: 14 });
    expect(isFirestoreNotFoundError(error)).to.be.false;
  });

  it('DEADLINE_EXCEEDED (code 4) を false と判定', () => {
    const error = Object.assign(new Error('Deadline exceeded'), { code: 4 });
    expect(isFirestoreNotFoundError(error)).to.be.false;
  });

  it('code が無いエラーを false と判定', () => {
    const error = new Error('Unknown error');
    expect(isFirestoreNotFoundError(error)).to.be.false;
  });

  it('null/undefined を false と判定', () => {
    expect(isFirestoreNotFoundError(null)).to.be.false;
    expect(isFirestoreNotFoundError(undefined)).to.be.false;
  });

  it('プリミティブ値を false と判定', () => {
    expect(isFirestoreNotFoundError('string')).to.be.false;
    expect(isFirestoreNotFoundError(42)).to.be.false;
    expect(isFirestoreNotFoundError(true)).to.be.false;
  });

  it('code が空オブジェクトのエラーを false と判定', () => {
    const error = Object.assign(new Error('Edge case'), { code: {} });
    expect(isFirestoreNotFoundError(error)).to.be.false;
  });
});
