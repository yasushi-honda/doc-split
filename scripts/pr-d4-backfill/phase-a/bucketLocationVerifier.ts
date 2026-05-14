/**
 * Issue #445 PR-D4 S1-2: bucket location verifier (Codex 2nd I4 / BF19 反映).
 *
 * Cloud Run Job が動いている region と target bucket location を比較し、不一致なら
 * abort する。impl-plan §4.1 「bucket location 確認」に対応。
 *
 * 一致しないと:
 *   - egress (cross-region traffic) が課金される
 *   - Phase A の read-only 想定の cost 見積もりが破綻
 *   - Phase B/C/D の write も同様に egress 課金になる
 *
 * BF19 (artifact metadata) との連動: 検証結果 (bucketLocation / cloudRunJobLocation /
 * egressFreeAssertion) を artifact main file の field に記録する (caller 側)。
 */

export class BucketLocationMismatchError extends Error {
  public readonly cloudRunLocation: string;
  public readonly bucketLocation: string;
  constructor(cloudRunLocation: string, bucketLocation: string) {
    super(
      `Cloud Run Job location (${cloudRunLocation}) does not match target bucket location (${bucketLocation}). ` +
        'cross-region egress will be billed and Phase A cost assumption breaks. abort.'
    );
    this.name = 'BucketLocationMismatchError';
    this.cloudRunLocation = cloudRunLocation;
    this.bucketLocation = bucketLocation;
  }
}

export interface VerifyBucketLocationInput {
  /** caller が undefined を渡しても runtime で reject できるよう型上 optional */
  cloudRunLocation: string | undefined;
  bucketLocation: string | undefined;
}

export interface VerifyBucketLocationResult {
  cloudRunJobLocation: string;
  bucketLocation: string;
  egressFreeAssertion: true;
}

function normalize(location: string): string {
  return location.trim().toLowerCase();
}

/**
 * cloudRunLocation === bucketLocation を検証 (大文字小文字 / 末尾空白を正規化して比較)。
 * 不一致なら BucketLocationMismatchError を throw。
 *
 * multi-region bucket (例: ASIA, US, EU) は single-region cloudRunLocation と
 * 同一文字列にならないため自動的に mismatch 判定される (egress 課金リスクは存在)。
 */
export function verifyBucketLocation(
  input: VerifyBucketLocationInput
): VerifyBucketLocationResult {
  const cloudRunLocation = input.cloudRunLocation;
  const bucketLocation = input.bucketLocation;
  if (!cloudRunLocation || cloudRunLocation.trim() === '') {
    throw new Error('cloudRunLocation is empty (configuration bug?)');
  }
  if (!bucketLocation || bucketLocation.trim() === '') {
    throw new Error('bucketLocation is empty (configuration bug?)');
  }

  if (normalize(cloudRunLocation) !== normalize(bucketLocation)) {
    throw new BucketLocationMismatchError(cloudRunLocation, bucketLocation);
  }

  return {
    cloudRunJobLocation: cloudRunLocation,
    bucketLocation,
    egressFreeAssertion: true,
  };
}
