/**
 * PDF rotation merge + normalize helpers (Issue #445 PR-D3)
 *
 * pdfOperations.ts から切り出した pure helper module。
 * Firebase admin 初期化に依存しないため test 環境から直接 import 可能。
 *
 * 設計指針:
 * - `normalizeRotation`: 新規 user input 用 strict 検証 (90 倍数以外で HttpsError throw)
 * - `normalizeRotationOrFallback`: 既存 Firestore データ recover 用 (warn log + 0 fallback)
 * - `mergeRotations`: 二段階方針 (既存 = recover、新規 = strict、累積 = strict)
 *
 * silent-failure-hunter CRITICAL 1 + comment-analyzer IMP: 累積部分は strict 検証で
 * 未来の strict 経路破損混入による silent 0 化リスクを排除。
 */

import { HttpsError } from 'firebase-functions/v2/https';

/**
 * 4 値しか取らない rotation literal。Firestore に保存される pageRotations.rotation の値域。
 */
export type RotationDegrees = 0 | 90 | 180 | 270;

export function normalizeRotation(value: number): RotationDegrees {
  // 負数も正規化 ((-90 + 360) % 360 = 270)
  const normalized = ((value % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  throw new HttpsError(
    'invalid-argument',
    `rotation value ${value} is not a multiple of 90 (normalized=${normalized})`
  );
}

/**
 * 既存 Firestore データの rotation 値に対し warn + 0 fallback。
 *
 * Evaluator HIGH Q2: Firestore 既存 `pageRotations` に 45 度等の非 90 倍数が紛れていた場合、
 * `normalizeRotation` で全 rotation 操作が abort されるのは本番への破壊的変更。
 * 既存破損データは観測可能化 (warn log) しつつ 0 へ recover し、新規 user input は strict 維持 (二段階方針)。
 */
export function normalizeRotationOrFallback(
  value: number,
  context: { documentId: string; pageNumber: number }
): RotationDegrees {
  const normalized = ((value % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  console.warn('rotatePdfPages: existing pageRotations contains invalid rotation; falling back to 0', {
    operation: 'rotatePdfPages',
    stage: 'mergeRotations_legacy_recovery',
    documentId: context.documentId,
    pageNumber: context.pageNumber,
    invalidValue: value,
    normalizedValue: normalized,
  });
  return 0;
}

/**
 * 既存 pageRotations と新規 rotations 入力を merge する。
 *
 * 二段階方針 (Evaluator HIGH Q2 反映):
 * - **既存 entries**: `normalizeRotationOrFallback` で warn + 0 recover (破損データで全 rotation を block しない)
 * - **新規 user input**: `normalizeRotation` で strict 検証 (`invalid-argument` で early abort)
 * - **累積**: 既存 (recover 済の 90 倍数) + 新規 (strict 通過済の 90 倍数) = 必ず 90 倍数 → strict で検証
 *
 * H1 修正: 旧実装の `as 0|90|180|270` キャスト 4 連を runtime 検証に置換。
 */
export function mergeRotations(
  documentId: string,
  existing: Array<{ pageNumber: number; rotation: number }>,
  rotations: Array<{ pageNumber: number; degrees: number }>
): Array<{ pageNumber: number; rotation: RotationDegrees }> {
  const merged: Array<{ pageNumber: number; rotation: RotationDegrees }> = existing.map((r) => ({
    pageNumber: r.pageNumber,
    rotation: normalizeRotationOrFallback(r.rotation, { documentId, pageNumber: r.pageNumber }),
  }));
  for (const { pageNumber, degrees: deg } of rotations) {
    const normalizedDeg = normalizeRotation(deg);
    const ex = merged.find((r) => r.pageNumber === pageNumber);
    if (ex) {
      // 既存値 (recover 後 90 倍数) + 新規 (strict 通過済) = 必ず 90 倍数。strict 検証で safe。
      // silent-failure-hunter CRITICAL 1: fallback を使うと未来 strict 経路が破損混入で warn 化された際、
      // 新規 input 由来の bug が silent 0 化されるリスクがあるため strict のみ使用。
      ex.rotation = normalizeRotation(ex.rotation + normalizedDeg);
    } else {
      merged.push({ pageNumber, rotation: normalizedDeg });
    }
  }
  return merged;
}
