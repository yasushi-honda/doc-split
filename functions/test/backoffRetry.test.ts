/**
 * withBackoffRetry (functions/src/utils/retry.ts) / isRetryableFirestoreError
 * (functions/src/utils/firestoreErrors.ts) のユニットテスト
 *
 * 元は driveFolderClaim.ts のclaim書込みtransaction専用private関数だったが、
 * Issue #957でocrProcessor.tsにも適用するため共通utilへ抽出した際、public化されたにも
 * かかわらず直接のユニットテストが1件も存在しなかった(fable-reviewセカンドオピニオン
 * 指摘M1)。driveFolderClaimIntegration.test.ts/ocrCompletionTransactionIntegration.test.ts/
 * ocrRunGuardIntegration.test.tsのIssue #957系describeブロックはFirestore emulator経由の
 * 統合テストでこのutilの呼び出し結果を間接検証しているが、本ファイルは純粋関数として
 * 境界値(attempts=1、shouldRetry省略時の既定挙動、code 8除外等)を直接lock-inする。
 */

import { expect } from 'chai';
import { withBackoffRetry } from '../src/utils/retry';
import { isRetryableFirestoreError, FIRESTORE_TRANSIENT_GRPC_CODES } from '../src/utils/firestoreErrors';

function makeErrorWithCode(code: unknown): Error {
  const err = new Error(`error code=${String(code)}`) as Error & { code?: unknown };
  err.code = code;
  return err;
}

describe('withBackoffRetry', () => {
  it('1回目で成功する場合はリトライせず、1回だけ呼ばれる', async () => {
    let calls = 0;
    const result = await withBackoffRetry(
      async () => {
        calls++;
        return 'ok';
      },
      3,
      1
    );
    expect(result).to.equal('ok');
    expect(calls).to.equal(1);
  });

  it('shouldRetry省略時は理由を問わず`attempts`回まで全リトライする', async () => {
    let calls = 0;
    const result = await withBackoffRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'ok';
      },
      3,
      1
    );
    expect(result).to.equal('ok');
    expect(calls).to.equal(3);
  });

  it('全attempts失敗すると最後のエラーをthrowする', async () => {
    let calls = 0;
    try {
      await withBackoffRetry(
        async () => {
          calls++;
          throw new Error(`fail #${calls}`);
        },
        3,
        1
      );
      expect.fail('throwされるはず');
    } catch (error) {
      expect((error as Error).message).to.equal('fail #3');
    }
    expect(calls).to.equal(3);
  });

  it('shouldRetryがfalseを返すエラーは即座に諦める(2回目以降を呼ばない)', async () => {
    let calls = 0;
    try {
      await withBackoffRetry(
        async () => {
          calls++;
          throw new Error('non-retryable');
        },
        3,
        1,
        () => false
      );
      expect.fail('throwされるはず');
    } catch (error) {
      expect((error as Error).message).to.equal('non-retryable');
    }
    expect(calls, 'shouldRetry=falseのため1回のみ呼ばれるはず').to.equal(1);
  });

  it('attempts=1の場合、shouldRetryがtrueでもリトライせず1回で諦める(最終試行時は無条件throw)', async () => {
    let calls = 0;
    try {
      await withBackoffRetry(
        async () => {
          calls++;
          throw new Error('single attempt failure');
        },
        1,
        1,
        () => true
      );
      expect.fail('throwされるはず');
    } catch (error) {
      expect((error as Error).message).to.equal('single attempt failure');
    }
    expect(calls).to.equal(1);
  });

  it('途中の失敗でshouldRetryに実際のエラーオブジェクトが渡される', async () => {
    const seenErrors: unknown[] = [];
    let calls = 0;
    await withBackoffRetry(
      async () => {
        calls++;
        if (calls < 2) throw makeErrorWithCode(14);
        return 'ok';
      },
      3,
      1,
      (error) => {
        seenErrors.push(error);
        return true;
      }
    );
    expect(seenErrors).to.have.lengthOf(1);
    expect((seenErrors[0] as Error & { code?: unknown }).code).to.equal(14);
  });
});

describe('isRetryableFirestoreError / FIRESTORE_TRANSIENT_GRPC_CODES', () => {
  it('gRPC transientコード集合(1,2,4,10,13,14,16)はtrueを返す', () => {
    for (const code of [1, 2, 4, 10, 13, 14, 16]) {
      expect(isRetryableFirestoreError(makeErrorWithCode(code)), `code=${code}`).to.equal(true);
    }
    expect(Array.from(FIRESTORE_TRANSIENT_GRPC_CODES).sort((a, b) => a - b)).to.deep.equal([
      1, 2, 4, 10, 13, 14, 16,
    ]);
  });

  it('code 8(RESOURCE_EXHAUSTED)は意図的に除外されfalseを返す(SDK内部リトライとの二重適用回避)', () => {
    expect(isRetryableFirestoreError(makeErrorWithCode(8))).to.equal(false);
  });

  it('非transientコード(例: 7=PERMISSION_DENIED)はfalseを返す', () => {
    expect(isRetryableFirestoreError(makeErrorWithCode(7))).to.equal(false);
  });

  it('.codeが数値でない場合(文字列/undefined/欠落)はfalseを返す', () => {
    expect(isRetryableFirestoreError(makeErrorWithCode('ABORTED'))).to.equal(false);
    expect(isRetryableFirestoreError(makeErrorWithCode(undefined))).to.equal(false);
    expect(isRetryableFirestoreError(new Error('no code field'))).to.equal(false);
    expect(isRetryableFirestoreError(undefined)).to.equal(false);
    expect(isRetryableFirestoreError(null)).to.equal(false);
  });
});
