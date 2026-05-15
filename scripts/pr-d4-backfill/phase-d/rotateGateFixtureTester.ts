/**
 * Issue #445 PR-D4 S1-5: dev 環境 rotate gate fixture tester (BF12 / BF13、Codex 8th Important 2).
 *
 * impl-plan §4.4 step 2 + Codex 7th Important 2 反映の cleanup hook 必須条件:
 *   - **env hard gate**: env !== 'dev' で throw (test caller 側で更に保証)
 *   - **fixture docId prefix allowlist**: `BF13_test_fixture_${runId}_${kind}_${uuid}` 形式以外は cleanup refuse
 *   - **GCS delete scope**: fixture original object + rotate 結果 object のみ (Codex 8th 回答 3 反映)
 *   - **generation precondition**: delete 時に `ifGenerationMatch: <作成時 generation>` 付与
 *   - **try / finally**: rotate 成否に関わらず cleanup 強制実行
 *   - **cleanup 失敗 artifact 記録**: `fixtureCleanupFailures[]` に operator 目視削除を明示
 *
 * **本 module は dev 環境のみで起動される**。本番 (cocoro/kanameone) では orchestrator が
 * `rotateGateTest: null` を返し本 module を一切 invoke しない (Codex 3rd I6 反映、本番 doc に
 * rotate side effect ゼロ)。
 *
 * 設計: rotate API は callable function 直接呼出ではなく、DI 経由の `RotateApiCaller` interface
 * を通じる。production wire (adapters.ts) で実 `rotatePdfPages` を呼ぶ実装を提供。test では
 * fake で in-memory rotate emulation 可能。
 */

import { randomUUID } from 'node:crypto';
import type { BackfillEnvName, PhaseDRotateGateTestResult } from '../types';

/**
 * fixture 作成 / cleanup の Firestore + GCS adapter (DI、production wire は adapters.ts)。
 */
export interface FixtureStore {
  /**
   * fixture doc を Firestore に作成し、Storage に PDF object を 1 件 save。
   * 戻り値の `objectGeneration` は cleanup の precondition に使う。
   */
  createFixture(input: {
    docId: string;
    confidence: 'derived-bytes-verified' | 'child-snapshot-only';
    /** Phase B から流用する parent PDF bytes (sha256 計算済 derived bytes) */
    pdfBytes: Buffer;
  }): Promise<{ objectPath: string; objectGeneration: string }>;
  /**
   * fixture doc を Firestore + Storage から削除。
   * Storage delete は `ifGenerationMatch: <objectGeneration>` 付与 (誤削除防止)。
   * doc 削除は ADR-0008 削除制約と整合 (特定 doc delete は許可、--all-collections は使わない)。
   */
  cleanupFixture(input: {
    docId: string;
    /** original object + rotate 結果 object (path + generation の組) */
    objects: Array<{ path: string; generation: string }>;
  }): Promise<void>;
}

/**
 * rotate API caller の DI (production = 実 rotatePdfPages、test = fake)。
 *
 * 戻り値:
 * - kind=success: rotate API が success を返した (BF12 verified の期待動作)
 * - kind=rejected: failed-precondition で reject (BF13 child-snapshot-only の期待動作)
 * - kind=error: それ以外の error (test を fail 扱いに分類)
 */
export interface RotateApiCaller {
  callRotate(input: {
    docId: string;
  }): Promise<
    | { kind: 'success'; rotatedAt: string; newRotationObjectPath: string; newRotationObjectGeneration: string }
    | { kind: 'rejected'; rejectionMessage: string }
    | { kind: 'error'; message: string }
  >;
}

/**
 * dev fixture docId 命名規則 (Codex 8th 回答 3 反映: prefix + UUID 二重識別)。
 *
 * 形式: `BF13_test_fixture_${runId}_${kind}_${uuid}`
 * - prefix `BF13_test_fixture_` は cleanup allowlist で前方一致確認
 * - kind ∈ 'verified' | 'child_snapshot_only'
 * - uuid は randomUUID() で衝突回避
 */
const FIXTURE_PREFIX = 'BF13_test_fixture_';

export function buildFixtureDocId(
  runId: string,
  kind: 'verified' | 'child_snapshot_only'
): string {
  const uuid = randomUUID();
  return `${FIXTURE_PREFIX}${runId}_${kind}_${uuid}`;
}

/**
 * cleanup allowlist 判定 (defense in depth、本 module 外で呼ばれた場合の保護)。
 */
export function isFixtureDocId(docId: string): boolean {
  return docId.startsWith(FIXTURE_PREFIX);
}

export interface RunRotateGateFixtureTestInput {
  env: BackfillEnvName;
  runId: string;
  /** BF12 test fixture 用の verified PDF bytes (Phase B 由来など、test caller が用意) */
  pdfBytesVerified: Buffer;
  /** BF13 test fixture 用の child-snapshot-only PDF bytes */
  pdfBytesChildSnapshotOnly: Buffer;
  fixtureStore: FixtureStore;
  rotateApiCaller: RotateApiCaller;
}

/**
 * BF12 + BF13 rotate gate test を dev 環境のみで実行。
 *
 * Codex 8th Important 2 反映:
 * - env !== 'dev' で hard fail (test caller 側で更に env check 二重)
 * - try / finally で cleanup 強制
 * - cleanup 失敗を `fixtureCleanupFailures[]` に記録 (rotate test 結果と分離)
 */
export async function runRotateGateFixtureTest(
  input: RunRotateGateFixtureTestInput
): Promise<PhaseDRotateGateTestResult> {
  if (input.env !== 'dev') {
    throw new Error(
      `rotate gate fixture test is dev-only; received env=${input.env} (Codex 7th Important 2 / ADR-0008 削除制約 遵守)`
    );
  }

  const verifiedDocId = buildFixtureDocId(input.runId, 'verified');
  const childSnapshotDocId = buildFixtureDocId(input.runId, 'child_snapshot_only');

  const objectsToCleanup: Array<{
    docId: string;
    objects: Array<{ path: string; generation: string }>;
  }> = [];

  const fixtureCleanupFailures: PhaseDRotateGateTestResult['fixtureCleanupFailures'] = [];

  let derivedBytesVerifiedResult: PhaseDRotateGateTestResult['derivedBytesVerified'] = {
    fixtureDocId: verifiedDocId,
    rotateApiResult: 'rejected',
    rotatedAt: null,
    rejectionMessage: 'fixture creation failed',
  };

  let childSnapshotResult: PhaseDRotateGateTestResult['childSnapshotOnly'] = {
    fixtureDocId: childSnapshotDocId,
    rotateApiResult: 'rejected',
    rotatedAt: null,
    rejectionMessage: 'fixture creation failed',
  };

  try {
    // BF12: derived-bytes-verified fixture → rotate 成功期待
    const verifiedFix = await input.fixtureStore.createFixture({
      docId: verifiedDocId,
      confidence: 'derived-bytes-verified',
      pdfBytes: input.pdfBytesVerified,
    });
    objectsToCleanup.push({
      docId: verifiedDocId,
      objects: [{ path: verifiedFix.objectPath, generation: verifiedFix.objectGeneration }],
    });
    const verifiedRotate = await input.rotateApiCaller.callRotate({ docId: verifiedDocId });
    if (verifiedRotate.kind === 'success') {
      derivedBytesVerifiedResult = {
        fixtureDocId: verifiedDocId,
        rotateApiResult: 'success',
        rotatedAt: verifiedRotate.rotatedAt,
        rejectionMessage: null,
      };
      // rotate で生成された新 object も cleanup 対象 (Codex 8th Important 2)
      objectsToCleanup[objectsToCleanup.length - 1].objects.push({
        path: verifiedRotate.newRotationObjectPath,
        generation: verifiedRotate.newRotationObjectGeneration,
      });
    } else if (verifiedRotate.kind === 'rejected') {
      derivedBytesVerifiedResult = {
        fixtureDocId: verifiedDocId,
        rotateApiResult: 'rejected',
        rotatedAt: null,
        rejectionMessage: `BF12 FAILED: derived-bytes-verified rotate was rejected: ${verifiedRotate.rejectionMessage}`,
      };
    } else {
      derivedBytesVerifiedResult = {
        fixtureDocId: verifiedDocId,
        rotateApiResult: 'rejected',
        rotatedAt: null,
        rejectionMessage: `BF12 FAILED: rotate error: ${verifiedRotate.message}`,
      };
    }

    // BF13: child-snapshot-only fixture → failed-precondition reject 期待
    const childFix = await input.fixtureStore.createFixture({
      docId: childSnapshotDocId,
      confidence: 'child-snapshot-only',
      pdfBytes: input.pdfBytesChildSnapshotOnly,
    });
    objectsToCleanup.push({
      docId: childSnapshotDocId,
      objects: [{ path: childFix.objectPath, generation: childFix.objectGeneration }],
    });
    const childRotate = await input.rotateApiCaller.callRotate({ docId: childSnapshotDocId });
    if (childRotate.kind === 'rejected') {
      childSnapshotResult = {
        fixtureDocId: childSnapshotDocId,
        rotateApiResult: 'rejected',
        rotatedAt: null,
        rejectionMessage: childRotate.rejectionMessage,
      };
    } else if (childRotate.kind === 'success') {
      // BF13 FAIL: gate がリーク
      childSnapshotResult = {
        fixtureDocId: childSnapshotDocId,
        rotateApiResult: 'success',
        rotatedAt: childRotate.rotatedAt,
        rejectionMessage: 'BF13 FAILED: child-snapshot-only rotate succeeded; gate leakage detected',
      };
      objectsToCleanup[objectsToCleanup.length - 1].objects.push({
        path: childRotate.newRotationObjectPath,
        generation: childRotate.newRotationObjectGeneration,
      });
    } else {
      childSnapshotResult = {
        fixtureDocId: childSnapshotDocId,
        rotateApiResult: 'rejected',
        rotatedAt: null,
        rejectionMessage: `BF13: rotate error treated as reject for safety: ${childRotate.message}`,
      };
    }
  } finally {
    // cleanup hook (try / finally で必ず実行、Codex 8th Important 2)
    for (const entry of objectsToCleanup) {
      if (!isFixtureDocId(entry.docId)) {
        fixtureCleanupFailures.push({
          fixtureDocId: entry.docId,
          objectPath: null,
          error: `docId does not match fixture allowlist prefix ${FIXTURE_PREFIX}; refused to cleanup`,
        });
        continue;
      }
      try {
        await input.fixtureStore.cleanupFixture({
          docId: entry.docId,
          objects: entry.objects,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        fixtureCleanupFailures.push({
          fixtureDocId: entry.docId,
          objectPath: entry.objects.map((o) => o.path).join(','),
          error: `cleanup failed: ${message}`,
        });
      }
    }
  }

  return {
    derivedBytesVerified: derivedBytesVerifiedResult,
    childSnapshotOnly: childSnapshotResult,
    fixtureCleanupFailures,
  };
}
