/**
 * Firestore NOT_FOUND判定ユーティリティ テスト
 *
 * 削除トリガーでインデックスエントリ不在を冪等削除として許容する用途(searchIndexer)、
 * write-then-deleteレースで対象documentが既に削除された非致命的なケースを判別する用途
 * (updateDocumentGroups、Issue #660)双方から共有される。
 * gRPC/REST/Firebase admin SDK の3形式の code を識別する必要がある。
 */

import { expect } from 'chai';
import { isFirestoreNotFoundError } from '../src/utils/firestoreErrors';

describe('isFirestoreNotFoundError', () => {
  it('gRPC code 5 (数値) を true と判定', () => {
    const error = Object.assign(new Error('Document not found'), { code: 5 });
    expect(isFirestoreNotFoundError(error)).to.be.true;
  });

  it('REST/gcloud形式 "NOT_FOUND" (UPPER) を true と判定', () => {
    const error = Object.assign(new Error('Document not found'), { code: 'NOT_FOUND' });
    expect(isFirestoreNotFoundError(error)).to.be.true;
  });

  it('Firebase admin SDK形式 "not-found" (kebab-case) を true と判定', () => {
    const error = Object.assign(new Error('Document not found'), { code: 'not-found' });
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
