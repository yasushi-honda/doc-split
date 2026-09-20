/**
 * Firestore NOT_FOUND判定ユーティリティ テスト
 *
 * 削除トリガーでインデックスエントリ不在を冪等削除として許容する用途(searchIndexer)、
 * write-then-deleteレースで対象documentが既に削除された非致命的なケースを判別する用途
 * (updateDocumentGroups、Issue #660)双方から共有される。
 * gRPC/REST/Firebase admin SDK の3形式の code を識別する必要がある。
 */

import { expect } from 'chai';
import {
  isFirestoreNotFoundError,
  isFirestoreDocumentSizeExceededError,
} from '../src/utils/firestoreErrors';

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

/**
 * ドキュメントサイズ超過(1MiB)判定 (Issue #984)
 *
 * 本番(Cloud Firestore)とエミュレータ、および WriteBatch と BulkWriter でメッセージが異なるため、
 * code が INVALID_ARGUMENT(3 / 'INVALID_ARGUMENT' / 'invalid-argument')かつ既知の2文言のどちらかに
 * 一致する場合だけ true とする(スパイクで実測: 2026-09-20)。
 * - 本番: `3 INVALID_ARGUMENT: Document '...' cannot be written because its size (1,048...`
 * - エミュレータ(WriteBatch): `3 INVALID_ARGUMENT: maximum entity size is 1048576 bytes`
 * - エミュレータ(BulkWriter): `maximum entity size is 1048576 bytes`(接頭辞なし)
 */
describe('isFirestoreDocumentSizeExceededError', () => {
  const PROD_MESSAGE =
    "3 INVALID_ARGUMENT: Document 'projects/p/databases/(default)/documents/search_index/00177502' cannot be written because its size (1,048,600 bytes) exceeds the maximum allowed size of 1,048,576 bytes.";
  const EMULATOR_BATCH_MESSAGE = '3 INVALID_ARGUMENT: maximum entity size is 1048576 bytes';
  const EMULATOR_BULK_MESSAGE = 'maximum entity size is 1048576 bytes';

  it('本番メッセージ + code 3 を true と判定', () => {
    const error = Object.assign(new Error(PROD_MESSAGE), { code: 3 });
    expect(isFirestoreDocumentSizeExceededError(error)).to.be.true;
  });

  it('エミュレータ(WriteBatch)メッセージ + code 3 を true と判定', () => {
    const error = Object.assign(new Error(EMULATOR_BATCH_MESSAGE), { code: 3 });
    expect(isFirestoreDocumentSizeExceededError(error)).to.be.true;
  });

  it('エミュレータ(BulkWriter、接頭辞なし)メッセージ + code 3 を true と判定', () => {
    const error = Object.assign(new Error(EMULATOR_BULK_MESSAGE), { code: 3 });
    expect(isFirestoreDocumentSizeExceededError(error)).to.be.true;
  });

  it("code 'INVALID_ARGUMENT' (UPPER) を true と判定", () => {
    const error = Object.assign(new Error(PROD_MESSAGE), { code: 'INVALID_ARGUMENT' });
    expect(isFirestoreDocumentSizeExceededError(error)).to.be.true;
  });

  it("code 'invalid-argument' (kebab-case) を true と判定", () => {
    const error = Object.assign(new Error(PROD_MESSAGE), { code: 'invalid-argument' });
    expect(isFirestoreDocumentSizeExceededError(error)).to.be.true;
  });

  it('別原因の INVALID_ARGUMENT (too many index entries) を false と判定', () => {
    const error = Object.assign(
      new Error('3 INVALID_ARGUMENT: too many index entries for entity /search_index/00000644'),
      { code: 3 }
    );
    expect(isFirestoreDocumentSizeExceededError(error)).to.be.false;
  });

  it('サイズ文言を含んでも code が INVALID_ARGUMENT 以外なら false と判定', () => {
    const error = Object.assign(new Error(PROD_MESSAGE), { code: 5 });
    expect(isFirestoreDocumentSizeExceededError(error)).to.be.false;
  });

  it('code が無いエラー / 文字列 / null / undefined / 空オブジェクトを false と判定', () => {
    expect(isFirestoreDocumentSizeExceededError(new Error(PROD_MESSAGE))).to.be.false;
    expect(isFirestoreDocumentSizeExceededError(PROD_MESSAGE)).to.be.false;
    expect(isFirestoreDocumentSizeExceededError(null)).to.be.false;
    expect(isFirestoreDocumentSizeExceededError(undefined)).to.be.false;
    expect(isFirestoreDocumentSizeExceededError({})).to.be.false;
  });

  it('message が文字列でない場合は false と判定(境界)', () => {
    expect(isFirestoreDocumentSizeExceededError({ code: 3, message: 123 })).to.be.false;
    expect(isFirestoreDocumentSizeExceededError({ code: 3 })).to.be.false;
  });
});
