/**
 * Issue #445 PR-D4 S1-2: bucket-location-verifier.ts pure function テスト。
 *
 * impl-plan v3.1 §4.1 「bucket location 確認 (Codex 2nd review I4 反映、BF19 連動)」:
 * - Cloud Run Job region と target bucket location が同一なら egress 無料
 * - 不一致なら abort + artifact `egressFreeAssertion: false` 記録
 */

import { expect } from 'chai';
import {
  verifyBucketLocation,
  BucketLocationMismatchError,
} from '../../scripts/pr-d4-backfill/phase-a/bucketLocationVerifier';

describe('verifyBucketLocation (PR-D4 S1-2 region check)', () => {
  it('cloudRunLocation === bucketLocation なら egressFreeAssertion=true で正常終了', () => {
    const result = verifyBucketLocation({
      cloudRunLocation: 'asia-northeast1',
      bucketLocation: 'asia-northeast1',
    });
    expect(result.egressFreeAssertion).to.equal(true);
    expect(result.bucketLocation).to.equal('asia-northeast1');
    expect(result.cloudRunJobLocation).to.equal('asia-northeast1');
  });

  it('region 不一致は BucketLocationMismatchError を throw する (egress 課金前提崩れ)', () => {
    expect(() =>
      verifyBucketLocation({
        cloudRunLocation: 'asia-northeast1',
        bucketLocation: 'us-central1',
      })
    ).to.throw(BucketLocationMismatchError);
  });

  it('region 不一致 throw 時の error.message に両 region が含まれる (operator 監査用)', () => {
    try {
      verifyBucketLocation({
        cloudRunLocation: 'asia-northeast1',
        bucketLocation: 'us-central1',
      });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).to.be.instanceOf(BucketLocationMismatchError);
      const msg = (err as Error).message;
      expect(msg).to.include('asia-northeast1');
      expect(msg).to.include('us-central1');
    }
  });

  it('region 大文字小文字 / 末尾空白の差は normalize して比較する (GCS API は大文字、Cloud Run は小文字を返すケースに対応)', () => {
    const result = verifyBucketLocation({
      cloudRunLocation: 'asia-northeast1',
      bucketLocation: 'ASIA-NORTHEAST1 ',
    });
    expect(result.egressFreeAssertion).to.equal(true);
  });

  it('multi-region bucket (例: ASIA) は single-region cloudRunLocation と非同等 → mismatch', () => {
    expect(() =>
      verifyBucketLocation({
        cloudRunLocation: 'asia-northeast1',
        bucketLocation: 'ASIA',
      })
    ).to.throw(BucketLocationMismatchError);
  });

  it('cloudRunLocation 空文字なら ValidationError (configuration bug 検出)', () => {
    expect(() =>
      verifyBucketLocation({ cloudRunLocation: '', bucketLocation: 'asia-northeast1' })
    ).to.throw(/cloudRunLocation/);
  });

  it('bucketLocation 空文字なら ValidationError', () => {
    expect(() =>
      verifyBucketLocation({ cloudRunLocation: 'asia-northeast1', bucketLocation: '' })
    ).to.throw(/bucketLocation/);
  });
});
