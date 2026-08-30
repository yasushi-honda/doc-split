/**
 * `driveFolderClaim.ts`の`classifyDriveApiError()`(fail-closedなDrive APIエラー分類、§3)の
 * 純粋関数テスト。Firestore/Drive I/Oに依存しないため`npm test`(emulator不要)で実行される。
 */

import { expect } from 'chai';
import { classifyDriveApiError } from '../src/drive/driveFolderClaim';

describe('classifyDriveApiError (Issue #871 §3)', () => {
  it('status:404 は notFound', () => {
    expect(classifyDriveApiError({ status: 404 })).to.equal('notFound');
  });

  it('code:404(数値) も notFound', () => {
    expect(classifyDriveApiError({ code: 404 })).to.equal('notFound');
  });

  it('response.status:404 も notFound', () => {
    expect(classifyDriveApiError({ response: { status: 404 } })).to.equal('notFound');
  });

  it('status:401 は unauthenticated', () => {
    expect(classifyDriveApiError({ status: 401 })).to.equal('unauthenticated');
  });

  it('status:403かつreason未指定は permissionDenied', () => {
    expect(classifyDriveApiError({ status: 403 })).to.equal('permissionDenied');
  });

  it('status:403かつreason:rateLimitExceededは rateLimited', () => {
    expect(
      classifyDriveApiError({ status: 403, errors: [{ reason: 'rateLimitExceeded' }] })
    ).to.equal('rateLimited');
  });

  it('status:403かつreason:userRateLimitExceededは rateLimited', () => {
    expect(
      classifyDriveApiError({ status: 403, errors: [{ reason: 'userRateLimitExceeded' }] })
    ).to.equal('rateLimited');
  });

  it('status:429 は rateLimited', () => {
    expect(classifyDriveApiError({ status: 429 })).to.equal('rateLimited');
  });

  it('status:500 は transient', () => {
    expect(classifyDriveApiError({ status: 500 })).to.equal('transient');
  });

  it('status:503 は transient', () => {
    expect(classifyDriveApiError({ status: 503 })).to.equal('transient');
  });

  it('statusを持たないネットワーク層エラーは transient', () => {
    expect(classifyDriveApiError(new Error('ECONNRESET'))).to.equal('transient');
  });

  it('未知の4xx(例: 400)は unknown', () => {
    expect(classifyDriveApiError({ status: 400 })).to.equal('unknown');
  });
});
